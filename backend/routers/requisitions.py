"""Sector requisitions.

rascunho → enviada → aprovada | rejeitada | devolvida
aprovada → em_preparo → pronto → entregue          (estoque separa e leva ao setor)
aprovada/em_preparo → comprada → recebida → …       (quando precisa comprar)
Per line the stock marks disponibilidade (ok / parcial / sem_estoque) and qty atendida.
"""

import io
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pymongo import ReturnDocument

from lib import pdf
from lib.auth import VIEWERS, require_role
from lib.dates import now_local
from lib.db import db
from lib.ingest import now_iso
from lib.metrics import compute_months, cost_map
from lib.validade import expiring
from lib.sectors import SECTORS, audit, can_see_costs, notify, role_emails
from models.schemas import (
    DupCheck, DupCheckIn, FulfillIn, Notifications, ReqActionIn, Requisition, RequisitionIn,
)
from routers.stock import get_windows, open_sectors

router = APIRouter()
viewer = require_role(*VIEWERS)
STOCK = ("gerente", "alimentador")  # "estoquista": prepares, delivers, buys
OPEN = ["enviada", "aprovada", "em_preparo", "pronto", "comprada", "recebida"]
PHRASE = {"aprovar": "foi aprovada", "rejeitar": "foi rejeitada", "devolver": "foi devolvida para ajuste", "em_preparo": "está em preparo",
          "pronto": "está pronta para retirada/entrega", "entregue": "foi entregue ao setor", "comprada": "está em compra (itens faltantes)",
          "recebida": "teve a compra recebida no estoque"}
LABEL = {"enviar": "enviada", "aprovar": "aprovada", "rejeitar": "rejeitada", "devolver": "devolvida para ajuste",
         "em_preparo": "em preparo", "pronto": "pronta para retirada/entrega", "entregue": "entregue ao setor",
         "comprada": "marcada como comprada", "recebida": "compra recebida", "excluir": "excluída"}
# action → (roles allowed, statuses it can start from, new status)
RULES = {
    "aprovar": (("gerente",), ("enviada",), "aprovada"),
    "rejeitar": (("gerente",), ("enviada",), "rejeitada"),
    "devolver": (("gerente",), ("enviada",), "devolvida"),
    "em_preparo": (STOCK, ("aprovada", "comprada", "recebida"), "em_preparo"),
    "pronto": (STOCK, ("aprovada", "em_preparo", "recebida"), "pronto"),
    "entregue": (STOCK, ("aprovada", "em_preparo", "pronto", "recebida"), "entregue"),
    "comprada": (STOCK, ("aprovada", "em_preparo"), "comprada"),
    "recebida": (STOCK, ("comprada",), "recebida"),
}


def scope(member: dict) -> dict:
    if member["role"] == "gerente":
        return {}
    if member["role"] == "chefe":
        return {"sector": member.get("sector") or "-"}
    # Alimentador = estoquista: own drafts + every submitted requisition (to prepare / deliver).
    return {"$or": [{"requested_by": member.get("email", "")}, {"status": {"$ne": "rascunho"}}]}


def present(r: dict, member: dict) -> dict:
    if not can_see_costs(member, r["sector"]):
        r = {**r, "valor_total": None, "items": [{**ln, "custo": None} for ln in r["items"]]}
    return r


async def _next_number() -> int:
    doc = await db.counters.find_one_and_update({"_id": "requisition"}, {"$inc": {"n": 1}}, upsert=True,
                                                return_document=ReturnDocument.AFTER)
    return doc["n"]


async def _lines(items) -> tuple[list[dict], float]:
    costs = await cost_map()
    lines = [{**ln.model_dump(), "custo": costs.get(ln.item), "disponibilidade": "pendente", "atendido": None, "obs_estoque": ""}
             for ln in items]
    return lines, _total(lines)


def _total(lines: list[dict]) -> float:
    return round(sum(ln["qty"] * (ln.get("custo") or 0) for ln in lines), 2)


async def _duplicates(sector: str, codes: set[str], member: dict, exclude: Optional[str] = None) -> list[dict]:
    today = now_local().strftime("%Y-%m-%d")
    out = []
    q = {"sector": sector, "status": {"$in": OPEN}, "local_date": today, "id": {"$ne": exclude}, **scope(member)}
    async for r in db.requisitions.find(q, {"_id": 0}).sort("number", -1):
        hit = [ln["descricao"] for ln in r["items"] if ln["item"] in codes]
        if hit:
            out.append({"id": r["id"], "number": r["number"], "status": r["status"], "itens": hit[:8]})
    return out


def _dup_error(dup: list[dict]):
    names = ", ".join(f"{d['itens'][0]} (Nº {d['number']})" for d in dup[:4])
    raise HTTPException(status_code=409, detail=f"Já existe requisição aberta para este item: {names}. Deseja adicionar ou criar nova?")


async def _get(rid: str, member: dict) -> dict:
    r = await db.requisitions.find_one({"id": rid, "status": {"$ne": "excluida"}, **scope(member)}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Requisição não encontrada")
    return r


async def _initial_status(member: dict, sector: str, submit: bool) -> tuple[str, bool]:
    if not submit:
        return "rascunho", False
    if member["role"] == "alimentador" and sector in open_sectors(await get_windows()):
        return "aprovada", True
    return "enviada", False


def _summary(r: dict) -> str:
    return f"Nº {r['number']} · {r['sector']} · {len(r['items'])} itens" + (" · URGENTE" if r["priority"] == "urgente" else "")


async def _notify_submitted(r: dict, actor: str) -> None:
    if r["status"] == "enviada":
        await notify(await role_emails("gerente", "alimentador"), r, f"Nova requisição {_summary(r)} — aguardando aprovação", actor)
    elif r["status"] == "aprovada":
        await notify(await role_emails("gerente", "alimentador"), r, f"Nova requisição {_summary(r)} — aprovada automaticamente, separar itens", actor)


@router.post("/requisitions/check", response_model=DupCheck)
async def check(body: DupCheckIn, member: dict = Depends(viewer)):
    sector = member.get("sector") if member["role"] == "chefe" else body.sector
    return {"duplicates": await _duplicates(sector, {i.item for i in body.items}, member)}


@router.post("/requisitions", response_model=Requisition)
async def create(body: RequisitionIn, member: dict = Depends(viewer)):
    sector = member.get("sector") if member["role"] == "chefe" else body.sector
    if sector not in SECTORS:
        raise HTTPException(status_code=422, detail="Setor inválido")
    if body.submit and not body.items:
        raise HTTPException(status_code=422, detail="Adicione pelo menos um item")
    lines, total = await _lines(body.items)
    if body.submit and not body.force:
        dup = await _duplicates(sector, {ln["item"] for ln in lines}, member)
        if dup:
            _dup_error(dup)
    status, direct = await _initial_status(member, sector, body.submit)
    now, who = now_iso(), member.get("email", "")
    history = [{"at": now, "user": who, "action": "criada" if status == "rascunho" else "enviada", "comment": body.note}]
    if direct:
        history.append({"at": now, "user": "sistema", "action": "aprovada automaticamente (horário livre)", "comment": ""})
    doc = {"id": str(uuid.uuid4()), "number": await _next_number(), "sector": sector, "priority": body.priority, "status": status,
           "items": lines, "valor_total": total, "note": body.note, "direct": direct, "requested_by": who,
           "created_at": now, "updated_at": now, "local_date": now_local().strftime("%Y-%m-%d"), "history": history}
    await db.requisitions.insert_one(dict(doc))
    await audit(member, "requisição criada", f"Nº {doc['number']} {sector} ({status})")
    await _notify_submitted(doc, who)
    return present(doc, member)


@router.put("/requisitions/{rid}", response_model=Requisition)
async def update(rid: str, body: RequisitionIn, member: dict = Depends(viewer)):
    r = await _get(rid, member)
    if r["status"] not in ("rascunho", "devolvida") or (member["role"] != "gerente" and r["requested_by"] != member.get("email")):
        raise HTTPException(status_code=409, detail="Só rascunhos ou devolvidas podem ser editadas pelo solicitante")
    lines, total = await _lines(body.items)
    if body.submit and not lines:
        raise HTTPException(status_code=422, detail="Adicione pelo menos um item")
    if body.submit and not body.force:
        dup = await _duplicates(r["sector"], {ln["item"] for ln in lines}, member, exclude=rid)
        if dup:
            _dup_error(dup)
    status, direct = await _initial_status(member, r["sector"], body.submit)
    now = now_iso()
    ev = [{"at": now, "user": member.get("email", ""), "action": "editada" if status == "rascunho" else "enviada", "comment": body.note}]
    upd = {"items": lines, "valor_total": total, "priority": body.priority, "note": body.note, "status": status,
           "direct": direct, "updated_at": now, "local_date": now_local().strftime("%Y-%m-%d")}
    await db.requisitions.update_one({"id": rid}, {"$set": upd, "$push": {"history": {"$each": ev}}})
    out = {**r, **upd, "history": r["history"] + ev}
    await _notify_submitted(out, member.get("email", ""))
    return present(out, member)


@router.post("/requisitions/{rid}/add-items", response_model=Requisition)
async def add_items(rid: str, body: RequisitionIn, member: dict = Depends(viewer)):
    """E1: add the new lines to the requisition already open today instead of creating a duplicate."""
    r = await _get(rid, member)
    if r["status"] not in ("rascunho", "enviada", "aprovada", "em_preparo"):
        raise HTTPException(status_code=409, detail="Essa requisição já está pronta/entregue — crie uma nova")
    new_lines, _ = await _lines(body.items)
    merged = [dict(ln) for ln in r["items"]]
    for ln in new_lines:
        same = next((m for m in merged if m["item"] == ln["item"]), None)
        if same:
            same["qty"] = round(same["qty"] + ln["qty"], 4)
        else:
            merged.append(ln)
    now = now_iso()
    ev = {"at": now, "user": member.get("email", ""), "action": f"{len(new_lines)} itens adicionados", "comment": body.note}
    upd = {"items": merged, "valor_total": _total(merged), "updated_at": now,
           "priority": "urgente" if body.priority == "urgente" else r["priority"]}
    await db.requisitions.update_one({"id": rid}, {"$set": upd, "$push": {"history": ev}})
    out = {**r, **upd, "history": r["history"] + [ev]}
    await audit(member, "itens adicionados à requisição", f"Nº {r['number']} +{len(new_lines)}")
    if r["status"] != "rascunho":
        await notify(await role_emails("gerente", "alimentador") + [r["requested_by"]], out,
                     f"Nº {r['number']} · {r['sector']}: {len(new_lines)} itens adicionados", member.get("email", ""))
    return present(out, member)


@router.post("/requisitions/{rid}/action", response_model=Requisition)
async def action(rid: str, body: ReqActionIn, member: dict = Depends(viewer)):
    r = await _get(rid, member)
    role, a, st, me = member["role"], body.action, r["status"], member.get("email", "")
    comment = body.comment.strip()
    if a == "enviar":
        if st not in ("rascunho", "devolvida") or not (role == "gerente" or r["requested_by"] == me):
            raise HTTPException(status_code=403, detail="Ação não permitida para seu perfil ou para o status atual")
        if not r["items"]:
            raise HTTPException(status_code=422, detail="Adicione pelo menos um item")
        new, _ = await _initial_status(member, r["sector"], True)
    elif a == "excluir":
        if role != "gerente":
            raise HTTPException(status_code=403, detail="Só o Gerente pode excluir")
        new = "excluida"
    else:
        roles, starts, new = RULES[a]
        if role not in roles or st not in starts:
            raise HTTPException(status_code=403, detail="Ação não permitida para seu perfil ou para o status atual")
    if a in ("rejeitar", "devolver", "excluir") and not comment:
        raise HTTPException(status_code=422, detail="Informe o motivo / comentário")
    now = now_iso()
    ev = {"at": now, "user": me, "action": LABEL[a] if not (a == "enviar" and new == "aprovada") else "enviada e aprovada automaticamente", "comment": comment}
    await db.requisitions.update_one({"id": rid}, {"$set": {"status": new, "updated_at": now}, "$push": {"history": ev}})
    out = {**r, "status": new, "updated_at": now, "history": r["history"] + [ev]}
    await audit(member, f"requisição {LABEL[a]}", f"Nº {r['number']} {r['sector']}" + (f" — {comment}" if comment else ""))
    if a == "enviar":
        await _notify_submitted(out, me)
    elif new != "excluida":
        msg = f"Sua requisição Nº {r['number']} ({r['sector']}) {PHRASE[a]}" + (f": “{comment}”" if comment else "")
        await notify([r["requested_by"]], out, msg, me)
        if a == "aprovar":
            await notify(await role_emails("alimentador"), out, f"Nº {r['number']} aprovada — separar itens para {r['sector']}", me)
    return present(out, member)


@router.put("/requisitions/{rid}/fulfillment", response_model=Requisition)
async def fulfillment(rid: str, body: FulfillIn, member: dict = Depends(viewer)):
    """Stock marks per item: tem (ok), parcial (qty atendida) ou sem estoque — the requester is notified."""
    if member["role"] not in STOCK:
        raise HTTPException(status_code=403, detail="Só o estoque (Gerente/Alimentador) marca a separação")
    r = await _get(rid, member)
    if r["status"] not in ("aprovada", "em_preparo", "comprada", "recebida", "pronto"):
        raise HTTPException(status_code=409, detail="A separação só pode ser marcada depois da aprovação")
    items = [dict(ln) for ln in r["items"]]
    for f in body.lines:
        if f.index >= len(items):
            raise HTTPException(status_code=422, detail="Item inválido")
        ln = items[f.index]
        ln["disponibilidade"] = f.disponibilidade
        ln["atendido"] = {"ok": ln["qty"], "sem_estoque": 0.0}.get(f.disponibilidade, f.atendido)
        if f.disponibilidade == "parcial" and (f.atendido is None or f.atendido >= ln["qty"]):
            raise HTTPException(status_code=422, detail=f"Informe a quantidade parcial (< {ln['qty']}) de {ln['descricao']}")
        if f.disponibilidade == "pendente":
            ln["atendido"] = None
        ln["obs_estoque"] = f.obs.strip()
    now = now_iso()
    falta = [ln["descricao"] for ln in items if ln.get("disponibilidade") in ("sem_estoque", "parcial")]
    ev = {"at": now, "user": member.get("email", ""), "action": "separação atualizada",
          "comment": ("Sem estoque/parcial: " + ", ".join(falta[:6])) if falta else "todos os itens disponíveis"}
    status = "em_preparo" if r["status"] == "aprovada" else r["status"]
    await db.requisitions.update_one({"id": rid}, {"$set": {"items": items, "status": status, "updated_at": now}, "$push": {"history": ev}})
    out = {**r, "items": items, "status": status, "updated_at": now, "history": r["history"] + [ev]}
    await audit(member, "requisição separação", f"Nº {r['number']} — {ev['comment']}")
    msg = (f"Nº {r['number']}: {len(falta)} itens sem estoque ou parciais ({', '.join(falta[:3])}{'…' if len(falta) > 3 else ''})"
           if falta else f"Nº {r['number']}: em preparo — todos os itens disponíveis")
    await notify([r["requested_by"]], out, msg, member.get("email", ""))
    return present(out, member)


@router.get("/requisitions", response_model=list[Requisition])
async def list_reqs(status: Optional[str] = None, sector: Optional[str] = None, priority: Optional[str] = None,
                    member: dict = Depends(viewer)):
    q: dict = {"status": {"$ne": "excluida"}, **scope(member)}
    if status:
        q["status"] = status
    if sector and member["role"] in STOCK:
        q["sector"] = sector
    if priority:
        q["priority"] = priority
    rows = await db.requisitions.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [present(r, member) for r in rows]


@router.get("/requisitions/{rid}/pdf")
async def req_pdf(rid: str, member: dict = Depends(viewer)):
    if member["role"] == "alimentador":
        raise HTTPException(status_code=403, detail="Seu perfil não imprime requisições")
    r = present(await _get(rid, member), member)
    data = pdf.requisition_pdf(r)
    await audit(member, "requisição PDF", f"Nº {r['number']}")
    return StreamingResponse(io.BytesIO(data), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="requisicao_{r["number"]}.pdf"'})


@router.get("/notifications", response_model=Notifications)
async def notifications(member: dict = Depends(viewer)):
    rows = await db.notifications.find({"to": member.get("email", ""), "read": False}, {"_id": 0}).sort("at", -1).to_list(50)
    rows.sort(key=lambda n: n["priority"] != "urgente")  # urgent on top, newest first inside each group
    meses = [m["alerta_parcial"] for m in (await compute_months())[-2:] if m["alerta_parcial"]]
    validades = await expiring(member, 3)
    return {"count": len(rows) + len(validades), "items": rows, "meses": meses, "validades": validades}


@router.post("/notifications/seen", response_model=Notifications)
async def mark_seen(member: dict = Depends(viewer)):
    await db.notifications.update_many({"to": member.get("email", ""), "read": False}, {"$set": {"read": True}})
    return await notifications(member)


@router.post("/notifications/{nid}/read", response_model=Notifications)
async def mark_read(nid: str, member: dict = Depends(viewer)):
    await db.notifications.update_one({"id": nid, "to": member.get("email", "")}, {"$set": {"read": True}})
    return await notifications(member)
