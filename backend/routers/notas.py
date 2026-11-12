"""Conferência de nota por foto: IA lê a nota → conferente marca cada item → se Recebida OK/Parcial dá entrada no estoque."""

import os
import tempfile
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from lib import ai, qr
from lib.auth import require_perm
from lib.db import db
from lib.ingest import now_iso
from lib.parsers import to_date, to_float
from lib.sectors import audit, can_notas, can_see_costs, full_view, op_sectors
from models.schemas import Nota, NotaConfIn
from routers.stock import load_catalog

router = APIRouter()
conferente = require_perm(can_notas, "Seu perfil não confere notas")
MIME = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif", "application/pdf": ".pdf"}
ENTRADA = ("recebida_ok", "parcial")
COUNTS = ("ok", "sobrando", "danificado")  # danificado entra e fica anotado; faltou/errado não entram


def present(n: dict, member: dict) -> dict:
    """Alimentador never sees purchase prices (REGRA ABSOLUTA: nenhum custo unitário)."""
    if can_see_costs(member, n.get("setor")):
        return n
    return {**n, "total": None, "itens": [{**i, "valor_unit": None, "valor_total": None} for i in n["itens"]]}


def scope(member: dict) -> dict:
    return {} if full_view(member) or member["role"] == "alimentador" else \
        {"$or": [{"setor": {"$in": op_sectors(member)}}, {"criado_por": member.get("email", "")}]}


@router.post("/notas/photo", response_model=Nota)
async def nota_photo(file: UploadFile = File(...), member: dict = Depends(conferente)):
    mime = (file.content_type or "").lower()
    if mime not in MIME:
        raise HTTPException(status_code=422, detail="Envie foto (JPG/PNG/WEBP/HEIC) ou PDF da nota")
    content = await file.read()
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Arquivo maior que 15 MB")
    with tempfile.NamedTemporaryFile(suffix=MIME[mime], delete=False) as tmp:
        tmp.write(content)
        path = tmp.name
    try:
        data = await ai.read_nota(path, mime)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Não consegui ler a nota — tente outra foto, reta e sem reflexo ({str(exc)[:80]})")
    finally:
        os.unlink(path)
    raw = [i for i in (data.get("itens") or []) if isinstance(i, dict) and str(i.get("descricao") or "").strip()]
    if not raw:
        raise HTTPException(status_code=422, detail="Não encontrei itens na nota")
    cat = await load_catalog()
    itens = []
    for i in raw[:300]:
        desc = " ".join(str(i["descricao"]).split())
        match = (qr.suggest(desc, cat, limit=1) or [None])[0]
        itens.append({"descricao": desc, "qtd": to_float(i.get("qtd")) or 0, "um": str(i.get("um") or "").upper()[:6],
                      "valor_unit": to_float(i.get("valor_unit")), "valor_total": to_float(i.get("valor_total")),
                      "item": match["item"] if match else None, "item_desc": match["descricao"] if match else "",
                      "status": "pendente", "qtd_recebida": None, "obs": ""})
    d = to_date(data.get("data"))
    doc = {"id": str(uuid.uuid4()), "numero": str(data.get("numero") or "")[:30], "fornecedor": str(data.get("fornecedor") or "")[:120],
           "data": d.isoformat() if d else None, "total": to_float(data.get("total")), "setor": "Estoque", "status": "conferencia",
           "anotacao": "", "anotacao_tipos": [], "itens": itens, "criado_por": member.get("email", ""), "conferido_por": "",
           "conferido_em": None, "entrada": False, "created_at": now_iso()}
    await db.notas.insert_one(dict(doc))
    await audit(member, "nota lida por foto", f"NF {doc['numero']} · {doc['fornecedor']} · {len(itens)} itens")
    return present(doc, member)


@router.get("/notas", response_model=list[Nota])
async def list_notas(member: dict = Depends(conferente)):
    rows = await db.notas.find(scope(member), {"_id": 0}).sort("created_at", -1).to_list(200)
    return [present(n, member) for n in rows]


@router.put("/notas/{nid}/conferencia", response_model=Nota)
async def conferir(nid: str, body: NotaConfIn, member: dict = Depends(conferente)):
    n = await db.notas.find_one({"id": nid, **scope(member)}, {"_id": 0})
    if not n:
        raise HTTPException(status_code=404, detail="Nota não encontrada")
    if n["entrada"]:
        raise HTTPException(status_code=409, detail="Esta nota já deu entrada no estoque")
    if body.setor not in op_sectors(member):
        raise HTTPException(status_code=403, detail=f"Seu perfil confere notas só de: {', '.join(op_sectors(member))}")
    itens = [dict(i) for i in n["itens"]]
    for f in body.itens:
        if f.index >= len(itens):
            raise HTTPException(status_code=422, detail="Item inválido")
        it = itens[f.index]
        it["status"], it["obs"] = f.status, f.obs.strip()
        it["item"] = f.item or it.get("item")
        it["qtd_recebida"] = 0.0 if f.status in ("faltou", "errado") else (f.qtd_recebida if f.qtd_recebida is not None else it["qtd"])
    if body.status in ENTRADA and any(i["status"] == "pendente" for i in itens):
        raise HTTPException(status_code=422, detail="Marque todos os itens antes de dar entrada")
    if body.status in ("divergencia", "devolvida", "cancelada") and not (body.anotacao.strip() or body.anotacao_tipos):
        raise HTTPException(status_code=422, detail="Descreva a anotação (erro, falta, devolução, dano ou cancelada)")
    now, who = now_iso(), member.get("email", "")
    entrada = body.status in ENTRADA
    upd = {"itens": itens, "status": body.status, "setor": body.setor, "anotacao": body.anotacao.strip(),
           "anotacao_tipos": list(dict.fromkeys(body.anotacao_tipos)), "conferido_por": who, "conferido_em": now, "entrada": entrada}
    if entrada:  # stock movement log (does not change the monthly physical inventory nor the CMV formula)
        moves = [{"id": str(uuid.uuid4()), "nota_id": nid, "tipo": "entrada", "item": i["item"], "descricao": i["item_desc"] or i["descricao"],
                  "qty": i["qtd_recebida"], "um": i["um"], "setor": body.setor, "status_item": i["status"], "at": now, "by": who}
                 for i in itens if i["status"] in COUNTS and i.get("item") and (i["qtd_recebida"] or 0) > 0]
        if moves:
            await db.stock_moves.insert_many(moves)
        upd["entradas"] = len(moves)
    await db.notas.update_one({"id": nid}, {"$set": upd})
    resumo = ", ".join(f"{k} {sum(1 for i in itens if i['status'] == k)}" for k in ("ok", "faltou", "sobrando", "danificado", "errado")
                       if any(i["status"] == k for i in itens))
    await audit(member, f"nota conferida ({body.status})", f"NF {n['numero']} · {n['fornecedor']} · {resumo}"
                + (f" · entrada de {upd.get('entradas', 0)} itens" if entrada else "") + (f" — {body.anotacao[:150]}" if body.anotacao else ""))
    return present({**n, **upd}, member)
