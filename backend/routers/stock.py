"""Stock operations: item catalog, QR labels, QR/manual inventory counts, sector withdrawals."""

import os
import tempfile
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pymongo import UpdateOne

from lib import ai, qr
from lib.auth import VIEWERS, require_role
from lib.dates import now_local
from lib.db import db
from lib.ingest import now_iso
from lib.parsers import month_label, norm
from lib.sectors import SECTORS, audit
from models.schemas import (
    CatalogItem, CountApplyOut, CountEntry, CountEntryIn, CountSummary, QrLabel, QrLabelIn,
    QrPhotoOut, QrResolveIn, QrResolveOut, WindowsIn, WindowsResponse,
)

router = APIRouter()
viewer = require_role(*VIEWERS)



# ---------- catalog ----------
async def load_catalog() -> list[dict]:
    items: dict[str, dict] = {}
    async for c in db.costs.find({}, {"_id": 0}):
        items[c["item"]] = {"item": c["item"], "descricao": c.get("descricao", ""), "um": "", "grupo": c.get("grupo", ""), "custo": c.get("custo")}
    months = sorted(await db.inventory.distinct("month"))
    if months:
        async for r in db.inventory.find({"month": months[-1]}, {"_id": 0}):
            cur = items.setdefault(r["item"], {"item": r["item"], "descricao": r.get("descricao", ""), "um": "", "grupo": "", "custo": None})
            cur["um"] = cur["um"] or r.get("um", "")
            cur["grupo"] = r.get("sgrupo") or r.get("grupo") or cur["grupo"]
            cur["descricao"] = cur["descricao"] or r.get("descricao", "")
    return sorted(items.values(), key=lambda x: x["descricao"])


@router.get("/items", response_model=list[CatalogItem])
async def list_items(q: str = "", _: dict = Depends(viewer)):
    cat = await load_catalog()
    if q.strip():
        nq = norm(q)
        cat = [c for c in cat if nq in norm(c["descricao"]) or nq == norm(c["item"])]
    return cat[:50]


# ---------- QR labels ----------
@router.post("/qr/resolve", response_model=QrResolveOut)
async def resolve_qr(body: QrResolveIn, _: dict = Depends(viewer)):
    code = qr.label_code(body.raw)
    parsed = qr.parse_label(body.raw)
    label = await db.qr_labels.find_one({"code": code}, {"_id": 0})
    cat = await load_catalog()
    suggestions = []
    if parsed["produto"]:
        alias = await db.qr_aliases.find_one({"alias": norm(parsed["produto"])}, {"_id": 0})
        if alias:
            suggestions = [c for c in cat if c["item"] == alias["item"]]
        suggestions += [c for c in qr.suggest(parsed["produto"], cat) if c not in suggestions]
    return {"code": code, "known": label is not None, "label": label, "parsed": parsed, "suggestions": suggestions[:6]}


@router.post("/qr/labels", response_model=QrLabel)
async def save_label(body: QrLabelIn, _: dict = Depends(viewer)):
    code = qr.label_code(body.raw)
    doc = {"code": code, "item": body.item, "descricao": body.descricao, "um": body.um, "qty": body.qty,
           "lote": body.lote, "validade": body.validade, "raw": body.raw[:2000], "created_at": now_iso()}
    await db.qr_labels.update_one({"code": code}, {"$set": doc}, upsert=True)
    produto = qr.parse_label(body.raw)["produto"]
    if produto:  # remember product name → item for future labels of the same product
        await db.qr_aliases.update_one({"alias": norm(produto)}, {"$set": {"alias": norm(produto), "item": body.item}}, upsert=True)
    doc.pop("raw")
    return doc


PHOTO_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


@router.post("/qr/photo", response_model=QrPhotoOut)
async def label_photo(file: UploadFile = File(...), qr_text: str = Form(""), member: dict = Depends(viewer)):
    """Photo of a Suflex label → printed fields via AI. The QR text (decoded on the phone, if any) is kept as a fallback ID."""
    mime = (file.content_type or "").lower()
    if mime not in PHOTO_MIME:
        raise HTTPException(status_code=422, detail="Envie uma foto (JPG, PNG, WEBP ou HEIC)")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Foto maior que 10 MB")
    suffix = {"image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif"}.get(mime, ".jpg")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        path = tmp.name
    try:
        f = await ai.read_label_photo(path, mime)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Não consegui ler a etiqueta pela foto — tente de novo mais perto e sem reflexo ({str(exc)[:80]})")
    finally:
        os.unlink(path)
    lid = str(f.get("label_id") or "").lstrip("#").strip()
    if not lid and qr_text.strip():
        lid = qr.parse_label(qr_text)["label_id"] or qr_text.strip()[:40]
    peso = f.get("peso")
    parts = [f"id: {lid}" if lid else "", f"produto: {f.get('produto') or ''}",
             f"peso: {peso} {f.get('um') or ''}" if peso not in (None, "") else "",
             f"validade: {f.get('validade') or ''}" if f.get("validade") else "",
             f"manipulacao: {f.get('fabricacao') or ''}" if f.get("fabricacao") else "",
             f"lote: {f.get('lote')}" if f.get("lote") else ""]
    raw = "; ".join(p for p in parts if p)
    if not (f.get("produto") or lid):
        raise HTTPException(status_code=422, detail="Não encontrei uma etiqueta legível na foto")
    await audit(member, "etiqueta lida por foto", raw[:300])
    return {"raw": raw, "parsed": qr.parse_label(raw), "qr_lido": bool(qr_text.strip())}


# ---------- counts ----------
@router.post("/counts", response_model=CountEntry)
async def add_count(body: CountEntryIn, member: dict = Depends(viewer)):
    if body.qr_code and await db.count_entries.find_one({"month": body.month, "qr_code": body.qr_code, "deleted": {"$ne": True}}):
        raise HTTPException(status_code=409, detail="Esta etiqueta já foi contada nesta sessão — não foi somada de novo")
    origem = "qr" if body.qr_code else "manual"
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "origem": origem, "user_email": member.get("email", ""), "created_at": now_iso()}
    await db.count_entries.insert_one(dict(doc))
    if origem == "manual":  # fallback without Suflex label: always audited, flagged "pendente Suflex"
        await audit(member, "contagem manual (pendente Suflex)", f"{month_label(body.month)} · {body.sector or 'Estoque'} · {body.descricao} {body.qty} {body.um}")
    return doc


@router.get("/counts/{month}", response_model=CountSummary)
async def get_counts(month: str, _: dict = Depends(viewer)):
    entries = await db.count_entries.find({"month": month, "deleted": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    agg: dict[str, dict] = {}
    for e in entries:
        a = agg.setdefault(e["item"], {"item": e["item"], "descricao": e["descricao"], "um": e.get("um", ""), "qty": 0.0, "leituras": 0})
        a["qty"] = round(a["qty"] + e["qty"], 4)
        a["leituras"] += 1
    sess = await db.count_sessions.find_one({"month": month}, {"_id": 0}) or {}
    return {"month": month, "entries": entries[:300], "items": sorted(agg.values(), key=lambda x: x["descricao"]),
            "applied_at": sess.get("applied_at"), "applied_by": sess.get("applied_by", "")}


@router.delete("/counts/entries/{entry_id}", response_model=CountEntry)
async def delete_count(entry_id: str, member: dict = Depends(viewer)):
    e = await db.count_entries.find_one({"id": entry_id, "deleted": {"$ne": True}}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Leitura não encontrada")
    if member["role"] != "gerente" and e.get("user_email") != member.get("email"):
        raise HTTPException(status_code=403, detail="Só quem registrou (ou um gerente) pode apagar")
    await db.count_entries.update_one({"id": entry_id}, {"$set": {"deleted": True, "deleted_by": member.get("email", "")}})
    return e


@router.post("/counts/{month}/apply", response_model=CountApplyOut)
async def apply_counts(month: str, member: dict = Depends(viewer)):
    entries = await db.count_entries.find({"month": month, "deleted": {"$ne": True}}, {"_id": 0}).to_list(20000)
    if not entries:
        raise HTTPException(status_code=422, detail="Nenhuma leitura neste mês")
    agg: dict[str, dict] = {}
    for e in entries:
        a = agg.setdefault(e["item"], {"descricao": e["descricao"], "um": e.get("um", ""), "qty": 0.0})
        a["qty"] += e["qty"]
    batch = f"qr-{month}"
    ops = [UpdateOne({"month": month, "item": item}, {
        "$set": {"qty": round(a["qty"], 4), "descricao": a["descricao"], "um": a["um"], "batch_id": batch},
        "$setOnInsert": {"id": str(uuid.uuid4()), "month": month, "item": item, "ggrupo": "", "grupo": "", "sgrupo": ""},
    }, upsert=True) for item, a in agg.items()]
    await db.inventory.bulk_write(ops, ordered=False)
    at = now_iso()
    await db.count_sessions.update_one({"month": month}, {"$set": {"month": month, "applied_at": at, "applied_by": member.get("email", "")}}, upsert=True)
    msg = f"Contagem por leitura de {month_label(month)}: {len(agg)} itens atualizados no inventário ({len(entries)} leituras)"
    await db.uploads.insert_one({"id": str(uuid.uuid4()), "kind": "inventario", "filename": "Contagem por QR / leitura", "month": month,
                                 "status": "concluido", "rows": len(agg), "message": msg, "ai_used": False, "undoable": False,
                                 "user_email": member.get("email", ""), "created_at": at})
    await audit(member, "contagem aplicada", msg)
    return {"month": month, "itens": len(agg), "message": msg}


# ---------- requisition time windows (Alimentador auto-approval) ----------
async def get_windows() -> list[dict]:
    doc = await db.settings.find_one({"_id": "retirada_windows"}) or {}
    return doc.get("windows", [])


def open_sectors(windows: list[dict]) -> list[str]:
    now = now_local()
    hm, wd = now.strftime("%H:%M"), now.weekday()
    out = set()
    for w in windows:
        if wd in w["days"] and w["start"] <= hm <= w["end"]:
            out.update(w["sectors"] or SECTORS)
    return [s for s in SECTORS if s in out]


@router.get("/withdrawals/windows", response_model=WindowsResponse)
async def read_windows(_: dict = Depends(viewer)):
    w = await get_windows()
    return {"sectors": SECTORS, "windows": w, "now": now_local().strftime("%Y-%m-%d %H:%M"), "open_sectors": open_sectors(w)}


@router.put("/withdrawals/windows", response_model=WindowsResponse)
async def save_windows(body: WindowsIn, member: dict = Depends(require_role("gerente"))):
    windows = []
    for w in body.windows:
        if w.start >= w.end:
            raise HTTPException(status_code=422, detail="Horário inicial deve ser antes do final")
        if any(d < 0 or d > 6 for d in w.days) or any(s not in SECTORS for s in w.sectors):
            raise HTTPException(status_code=422, detail="Dia ou setor inválido")
        windows.append({**w.model_dump(), "id": w.id or str(uuid.uuid4())})
    await db.settings.update_one({"_id": "retirada_windows"}, {"$set": {"windows": windows}}, upsert=True)
    await audit(member, "horários de retirada alterados", f"{len(windows)} faixa(s)")
    return {"sectors": SECTORS, "windows": windows, "now": now_local().strftime("%Y-%m-%d %H:%M"), "open_sectors": open_sectors(windows)}
