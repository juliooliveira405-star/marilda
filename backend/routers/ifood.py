"""iFood (estrutura preparatória): config, import of the order report (CSV/Excel), item → setor mapping, summary.
The real report format is still pending — headers are matched by common synonyms."""

import hashlib
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from lib.auth import require_role
from lib.db import db
from lib.ingest import now_iso
from lib.parsers import _match_header, load_tables, norm, to_date, to_float
from lib.sectors import audit
from models.schemas import IfoodConfig, IfoodMapIn, IfoodSummary, IfoodUploadOut

router = APIRouter()
manager = require_role("gerente")
FIELDS = {
    "data": ["data", "data do pedido", "data pedido", "dia"],
    "pedido": ["id pedido", "pedido", "id do pedido", "numero do pedido", "n pedido", "codigo"],
    "item": ["item", "produto", "nome do produto", "descricao"],
    "qtd": ["quantidade", "qtd", "qtde", "quant"],
    "unit": ["valor unitario", "valor unit", "preco", "preco unitario"],
    "total": ["valor total", "total", "valor"],
    "taxa": ["taxa ifood", "taxa", "comissao"],
}


async def get_config() -> dict:
    doc = await db.settings.find_one({"_id": "ifood"}, {"_id": 0}) or {}
    return IfoodConfig(**doc).model_dump()


@router.get("/ifood/config", response_model=IfoodConfig)
async def read_config(_: dict = Depends(manager)):
    return await get_config()


@router.put("/ifood/config", response_model=IfoodConfig)
async def save_config(body: IfoodConfig, member: dict = Depends(manager)):
    await db.settings.update_one({"_id": "ifood"}, {"$set": body.model_dump()}, upsert=True)
    await audit(member, "iFood configuração", str(body.model_dump()))
    return body


def _parse(tables) -> tuple[list[dict], int]:
    rows, ignored = [], 0
    for _, table in tables:
        for hi, r in enumerate(table[:30]):
            cm = _match_header([norm(c).lower() for c in r], FIELDS)
            if {"item", "qtd"} <= set(cm) and ("total" in cm or "unit" in cm):
                break
        else:
            continue
        for r in table[hi + 1:]:
            get = lambda f: r[cm[f]] if f in cm and cm[f] < len(r) else None  # noqa: E731
            item, qtd = " ".join(str(get("item") or "").split()), to_float(get("qtd"))
            if not item or not qtd:
                ignored += 1
                continue
            unit, total = to_float(get("unit")), to_float(get("total"))
            total = total if total is not None else round((unit or 0) * qtd, 2)
            d = to_date(get("data"))
            rows.append({"data": d.isoformat() if d else None, "month": d.strftime("%Y-%m") if d else None,
                         "pedido": norm(get("pedido")), "item": item, "qtd": qtd, "unit": unit if unit is not None else round(total / qtd, 2),
                         "total": total, "taxa": to_float(get("taxa"))})
    return rows, ignored


@router.post("/ifood/upload", response_model=IfoodUploadOut)
async def upload(file: UploadFile = File(...), member: dict = Depends(manager)):
    content = await file.read()
    try:
        rows, ignored = _parse(load_tables(content, file.filename or "ifood.csv"))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Não consegui ler o arquivo: {exc}")
    if not rows:
        raise HTTPException(status_code=422, detail="Nenhuma linha reconhecida. Colunas esperadas: Data, ID Pedido, Item, Quantidade, Valor Unitário/Total, Taxa iFood")
    batch = str(uuid.uuid4())
    new = 0
    for r in rows:
        key = hashlib.sha1(f"{r['data']}|{r['pedido']}|{r['item']}|{r['qtd']}|{r['total']}".encode()).hexdigest()
        res = await db.ifood_orders.update_one({"key": key}, {"$setOnInsert": {**r, "key": key, "batch_id": batch, "created_at": now_iso()}}, upsert=True)
        new += 1 if res.upserted_id else 0
    msg = f"iFood: {new} linhas novas ({len(rows) - new} já existiam, {ignored} ignoradas)"
    await audit(member, "upload iFood", f"{file.filename}: {msg}")
    return {"rows": new, "ignored": ignored, "message": msg}


@router.put("/ifood/map", response_model=IfoodConfig)
async def save_map(body: IfoodMapIn, member: dict = Depends(manager)):
    await db.ifood_map.update_one({"item": body.item}, {"$set": body.model_dump()}, upsert=True)
    await audit(member, "iFood mapeamento", f"{body.item} → {body.setor} · CMV {'sim' if body.entra_cmv else 'não'} · custo {body.custo}")
    return await get_config()


@router.get("/ifood/summary", response_model=IfoodSummary)
async def summary(month: Optional[str] = None, _: dict = Depends(manager)):
    cfg = await get_config()
    months = sorted(m for m in await db.ifood_orders.distinct("month") if m)
    q = {"month": month} if month else {}
    mapping = {m["item"]: m async for m in db.ifood_map.find({}, {"_id": 0})}
    items: dict[str, dict] = {}
    pedidos, taxas = set(), 0.0
    async for o in db.ifood_orders.find(q, {"_id": 0}):
        pedidos.add(o.get("pedido") or o["key"])
        taxas += o["taxa"] if o.get("taxa") is not None else o["total"] * cfg["taxa"]
        a = items.setdefault(o["item"], {"item": o["item"], "qtd": 0.0, "bruto": 0.0})
        a["qtd"] += o["qtd"]
        a["bruto"] += o["total"]
    out, cmv, sem_custo = [], 0.0, 0
    for it in sorted(items.values(), key=lambda x: -x["bruto"]):
        m = mapping.get(it["item"])
        setor, entra, custo = (m["setor"], m["entra_cmv"], m.get("custo")) if m else (cfg["setor_padrao"], True, None)
        c = round(it["qtd"] * custo, 2) if (entra and custo is not None) else None
        cmv += c or 0
        sem_custo += 1 if (entra and custo is None) else 0
        out.append({**it, "qtd": round(it["qtd"], 3), "bruto": round(it["bruto"], 2), "setor": setor, "entra_cmv": entra,
                    "custo": custo, "cmv": c, "mapeado": m is not None})
    bruto = round(sum(i["bruto"] for i in out), 2)
    return {"config": cfg, "months": months, "month": month, "pedidos": len(pedidos), "bruto": bruto, "taxas": round(taxas, 2),
            "liquido": round(bruto - taxas, 2), "cmv": round(cmv, 2), "cmv_pct": round(cmv / bruto, 4) if (bruto and cmv) else None,
            "ticket_medio": round(bruto / len(pedidos), 2) if pedidos else None, "itens_sem_custo": sem_custo, "items": out[:300]}
