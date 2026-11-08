"""Sector requisitions: rascunho → enviada → aprovada/rejeitada/devolvida → comprada → recebida."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from lib.auth import VIEWERS, require_role
from lib.dates import now_local
from lib.db import db
from lib.ingest import now_iso
from lib.metrics import cost_map
from lib.sectors import SECTORS, audit, can_see_costs
from models.schemas import Notifications, ReqActionIn, Requisition, RequisitionIn
from routers.stock import get_windows, open_sectors

router = APIRouter()
viewer = require_role(*VIEWERS)
OPEN = ["enviada", "aprovada", "comprada"]
LABEL = {"enviar": "enviada", "aprovar": "aprovada", "rejeitar": "rejeitada", "devolver": "devolvida para ajuste",
         "comprada": "marcada como comprada", "recebida": "marcada como recebida", "excluir": "excluída"}


def scope(member: dict) -> dict:
    if member["role"] == "gerente":
        return {}
    if member["role"] == "chefe":
        return {"sector": member.get("sector") or "-"}
    return {"$or": [{"requested_by": member.get("email", "")}, {"sector": "Estoque"}]}


def present(r: dict, member: dict) -> dict:
    if not can_see_costs(member, r["sector"]):
        r = {**r, "valor_total": None, "items": [{**ln, "custo": None} for ln in r["items"]]}
    return r


async def _next_number() -> int:
    doc = await db.counters.find_one_and_update({"_id": "requisition"}, {"$inc": {"n": 1}}, upsert=True,
                                                return_document=ReturnDocument.AFTER)
    return doc["n"]


async def _lines(body: RequisitionIn) -> tuple[list[dict], float]:
    costs = await cost_map()
    lines = [{**ln.model_dump(), "custo": costs.get(ln.item)} for ln in body.items]
    return lines, round(sum(ln["qty"] * (ln["custo"] or 0) for ln in lines), 2)


async def _duplicates(sector: str, items: list[dict], exclude: Optional[str] = None) -> list[str]:
    today = now_local().strftime("%Y-%m-%d")
    codes = {ln["item"] for ln in items}
    dup = []
    async for r in db.requisitions.find({"sector": sector, "status": {"$in": OPEN}, "local_date": today, "id": {"$ne": exclude}}, {"_id": 0}):
        for ln in r["items"]:
            if ln["item"] in codes:
                dup.append(f"{ln['descricao']} (Nº {r['number']})")
    return dup


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


@router.post("/requisitions", response_model=Requisition)
async def create(body: RequisitionIn, member: dict = Depends(viewer)):
    sector = member.get("sector") if member["role"] == "chefe" else body.sector
    if sector not in SECTORS:
        raise HTTPException(status_code=422, detail="Setor inválido")
    if body.submit and not body.items:
        raise HTTPException(status_code=422, detail="Adicione pelo menos um item")
    lines, total = await _lines(body)
    if body.submit and not body.force:
        dup = await _duplicates(sector, lines)
        if dup:
            raise HTTPException(status_code=409, detail="Já existe requisição aberta hoje para: " + ", ".join(dup[:5]) + ". Deseja criar mesmo assim?")
    status, direct = await _initial_status(member, sector, body.submit)
    now, who = now_iso(), member.get("email", "")
    history = [{"at": now, "user": who, "action": "criada" if status == "rascunho" else "enviada", "comment": body.note}]
    if direct:
        history.append({"at": now, "user": "sistema", "action": "aprovada automaticamente (horário livre)", "comment": ""})
    doc = {"id": str(uuid.uuid4()), "number": await _next_number(), "sector": sector, "priority": body.priority, "status": status,
           "items": lines, "valor_total": total, "note": body.note, "direct": direct, "requested_by": who,
           "created_at": now, "updated_at": now, "local_date": now_local().strftime("%Y-%m-%d"), "history": history, "notify": False}
    await db.requisitions.insert_one(dict(doc))
    await audit(member, "requisição criada", f"Nº {doc['number']} {sector} ({status})")
    return present(doc, member)


@router.put("/requisitions/{rid}", response_model=Requisition)
async def update(rid: str, body: RequisitionIn, member: dict = Depends(viewer)):
    r = await _get(rid, member)
    if r["status"] not in ("rascunho", "devolvida") or (member["role"] != "gerente" and r["requested_by"] != member.get("email")):
        raise HTTPException(status_code=409, detail="Só rascunhos ou devolvidas podem ser editadas pelo solicitante")
    lines, total = await _lines(body)
    if body.submit and not lines:
        raise HTTPException(status_code=422, detail="Adicione pelo menos um item")
    if body.submit and not body.force:
        dup = await _duplicates(r["sector"], lines, exclude=rid)
        if dup:
            raise HTTPException(status_code=409, detail="Já existe requisição aberta hoje para: " + ", ".join(dup[:5]) + ". Deseja criar mesmo assim?")
    status, direct = await _initial_status(member, r["sector"], body.submit)
    now = now_iso()
    ev = [{"at": now, "user": member.get("email", ""), "action": "editada" if status == "rascunho" else "enviada", "comment": body.note}]
    upd = {"items": lines, "valor_total": total, "priority": body.priority, "note": body.note, "status": status,
           "direct": direct, "updated_at": now, "local_date": now_local().strftime("%Y-%m-%d")}
    await db.requisitions.update_one({"id": rid}, {"$set": upd, "$push": {"history": {"$each": ev}}})
    return present({**r, **upd, "history": r["history"] + ev}, member)


@router.post("/requisitions/{rid}/action", response_model=Requisition)
async def action(rid: str, body: ReqActionIn, member: dict = Depends(viewer)):
    r = await _get(rid, member)
    role, a, st = member["role"], body.action, r["status"]
    rules = {
        "enviar": (st in ("rascunho", "devolvida") and (role == "gerente" or r["requested_by"] == member.get("email")), "enviada"),
        "aprovar": (role == "gerente" and st == "enviada", "aprovada"),
        "rejeitar": (role == "gerente" and st == "enviada", "rejeitada"),
        "devolver": (role == "gerente" and st == "enviada", "devolvida"),
        "comprada": (role in ("gerente", "alimentador") and st == "aprovada", "comprada"),
        "recebida": (role in ("gerente", "alimentador") and st in ("aprovada", "comprada"), "recebida"),
        "excluir": (role == "gerente", "excluida"),
    }
    allowed, new = rules[a]
    if not allowed:
        raise HTTPException(status_code=403, detail="Ação não permitida para seu perfil ou para o status atual")
    if a in ("rejeitar", "devolver", "excluir") and not body.comment.strip():
        raise HTTPException(status_code=422, detail="Informe o motivo / comentário")
    if a == "enviar" and not r["items"]:
        raise HTTPException(status_code=422, detail="Adicione pelo menos um item")
    now = now_iso()
    ev = {"at": now, "user": member.get("email", ""), "action": LABEL[a], "comment": body.comment.strip()}
    notify = member.get("email") != r["requested_by"]
    await db.requisitions.update_one({"id": rid}, {"$set": {"status": new, "updated_at": now, "notify": notify}, "$push": {"history": ev}})
    await audit(member, f"requisição {LABEL[a]}", f"Nº {r['number']} {r['sector']}" + (f" — {body.comment.strip()}" if body.comment.strip() else ""))
    return present({**r, "status": new, "updated_at": now, "history": r["history"] + [ev]}, member)


@router.get("/requisitions", response_model=list[Requisition])
async def list_reqs(status: Optional[str] = None, sector: Optional[str] = None, priority: Optional[str] = None,
                    member: dict = Depends(viewer)):
    q: dict = {"status": {"$ne": "excluida"}, **scope(member)}
    if status:
        q["status"] = status
    if sector and member["role"] == "gerente":
        q["sector"] = sector
    if priority:
        q["priority"] = priority
    rows = await db.requisitions.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [present(r, member) for r in rows]


@router.get("/notifications", response_model=Notifications)
async def notifications(member: dict = Depends(viewer)):
    items = []
    if member["role"] == "gerente":
        async for r in db.requisitions.find({"status": "enviada"}, {"_id": 0}).sort("created_at", -1).limit(30):
            items.append({"id": r["id"], "number": r["number"], "sector": r["sector"], "priority": r["priority"], "status": r["status"], "at": r["updated_at"],
                          "message": f"Nº {r['number']} · {r['sector']} · {len(r['items'])} itens{' · URGENTE' if r['priority'] == 'urgente' else ''} — aguardando aprovação"})
    async for r in db.requisitions.find({"requested_by": member.get("email", ""), "notify": True}, {"_id": 0}).sort("updated_at", -1).limit(30):
        last = r["history"][-1] if r["history"] else {}
        items.append({"id": r["id"], "number": r["number"], "sector": r["sector"], "priority": r["priority"], "status": r["status"], "at": r["updated_at"],
                      "message": f"Nº {r['number']} {last.get('action', r['status'])}" + (f": {last['comment']}" if last.get("comment") else "")})
    items.sort(key=lambda i: (i["priority"] != "urgente", i["at"]), reverse=False)
    return {"count": len(items), "items": items}


@router.post("/notifications/seen", response_model=Notifications)
async def mark_seen(member: dict = Depends(viewer)):
    await db.requisitions.update_many({"requested_by": member.get("email", ""), "notify": True}, {"$set": {"notify": False}})
    return await notifications(member)
