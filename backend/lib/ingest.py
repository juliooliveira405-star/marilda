"""Store parsed rows and run the upload pipeline (spreadsheet heuristics → AI fallback)."""

import hashlib
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Optional

from pymongo import UpdateOne

from lib import ai, parsers
from lib.db import db

logger = logging.getLogger(__name__)

KIND_LABELS = {
    "compras": "Compras / notas",
    "inventario": "Inventário (contagem)",
    "custos": "Custos unitários",
    "faturamento": "Faturamento",
    "completa": "Planilha completa",
}
UNDOABLE = {"compras", "inventario"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def store_compras(rows: list[dict], batch_id: str) -> tuple[int, str]:
    ops = []
    seen: dict[str, int] = {}
    for r in rows:
        base = f"{r['date']}|{r.get('numero','')}|{r.get('serie','')}|{r['fornecedor']}|{float(r['valor']):.2f}"
        n = seen.get(base, 0)
        seen[base] = n + 1
        key = hashlib.sha1(f"{base}|{n}".encode()).hexdigest()
        doc = {
            "id": str(uuid.uuid4()), "key": key, "date": r["date"], "month": r["date"][:7],
            "numero": str(r.get("numero") or ""), "serie": str(r.get("serie") or ""),
            "fornecedor": str(r["fornecedor"]).strip().upper(), "razao_social": r.get("razao_social", ""),
            "valor": float(r["valor"]), "batch_id": batch_id,
        }
        ops.append(UpdateOne({"key": key}, {"$setOnInsert": doc}, upsert=True))
    if not ops:
        return 0, "Nenhuma nota encontrada"
    res = await db.purchases.bulk_write(ops, ordered=False)
    new = res.upserted_count
    return new, f"{new} notas novas importadas, {len(ops) - new} já existiam (ignoradas)"


async def store_inventario(rows: list[dict], month: str, batch_id: str) -> tuple[int, str]:
    if not rows:
        return 0, "Nenhum item encontrado"
    await db.inventory.delete_many({"month": month})
    docs = [{
        "id": str(uuid.uuid4()), "month": month, "item": str(r.get("item") or parsers.norm(r.get("descricao", ""))),
        "descricao": r.get("descricao", ""), "um": r.get("um", ""), "qty": float(r.get("qty") or 0),
        "ggrupo": r.get("ggrupo", ""), "grupo": r.get("grupo", ""), "sgrupo": r.get("sgrupo", ""), "batch_id": batch_id,
    } for r in rows]
    await db.inventory.insert_many(docs)
    com = sum(1 for d in docs if d["qty"] > 0)
    return len(docs), f"Contagem de {parsers.month_label(month)}: {len(docs)} itens ({com} com estoque) — substituiu a contagem anterior do mês"


async def store_custos(rows: list[dict], batch_id: str, ref: str) -> tuple[int, str]:
    ops = []
    for r in rows:
        item = str(r.get("item") or parsers.norm(r.get("descricao", "")))
        ops.append(UpdateOne({"item": item}, {"$set": {
            "item": item, "descricao": r.get("descricao", ""), "grupo": r.get("grupo", ""),
            "custo": float(r["custo"]), "ref": ref, "batch_id": batch_id,
        }}, upsert=True))
    if not ops:
        return 0, "Nenhum custo encontrado"
    await db.costs.bulk_write(ops, ordered=False)
    return len(ops), f"{len(ops)} custos unitários atualizados — todos os estoques foram revalorizados"


async def store_faturamento(rows: list[dict], user_email: str) -> tuple[int, str]:
    for r in rows:
        await db.periods.update_one(
            {"month": r["month"]},
            {"$set": {"faturamento": float(r["valor"]), "faturamento_parcial": bool(r.get("parcial")), "updated_by": user_email},
             "$setOnInsert": {"month": r["month"], "status": "aberto", "obs": ""}},
            upsert=True,
        )
    if not rows:
        return 0, "Nenhum faturamento encontrado"
    resumo = ", ".join(f"{parsers.month_label(r['month'])} R$ {r['valor']:,.0f}".replace(",", ".") for r in rows)
    return len(rows), f"Faturamento atualizado: {resumo}"


def _normalize_ai_rows(kind: str, rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        if kind == "compras":
            d = parsers.to_date(r.get("date"))
            v = parsers.to_float(r.get("valor"))
            if d and v is not None and r.get("fornecedor"):
                out.append({**r, "date": d.isoformat(), "valor": v})
        elif kind == "inventario":
            q = parsers.to_float(r.get("qty"))
            if q is not None and (r.get("item") or r.get("descricao")):
                out.append({**r, "item": str(r.get("item") or ""), "qty": q})
        elif kind == "custos":
            c = parsers.to_float(r.get("custo"))
            if c is not None and (r.get("item") or r.get("descricao")):
                out.append({**r, "item": str(r.get("item") or ""), "custo": c})
        elif kind == "faturamento":
            v = parsers.to_float(r.get("valor"))
            m = parsers.month_from_text(str(r.get("month") or ""))
            if v and m:
                out.append({"month": m, "valor": v, "parcial": bool(r.get("parcial"))})
    return out


async def import_full(tables, batch_id: str, user_email: str, ref: str) -> tuple[int, str]:
    data = parsers.parse_full_workbook(tables)
    msgs, total = [], 0
    if data["custos"]:
        n, _ = await store_custos(data["custos"], batch_id, ref)
        total += n
        msgs.append(f"{n} custos")
    for month, rows in sorted(data["inventario"].items()):
        n, _ = await store_inventario(rows, month, batch_id)
        total += n
        msgs.append(f"inventário {parsers.month_label(month)} ({n} itens)")
    if data["compras"]:
        n, _ = await store_compras(data["compras"], batch_id)
        total += n
        msgs.append(f"{n} notas de compra novas")
    if data["faturamento"]:
        n, _ = await store_faturamento(data["faturamento"], user_email)
        msgs.append(f"faturamento de {n} meses")
    if not msgs:
        return 0, "Nenhuma aba reconhecida (esperado: Tabela de Custos, Contagem <Mês>, Dados Brutos Compras, Resumo)"
    return total, "Importado: " + "; ".join(msgs)


async def run_pipeline(kind: str, content: bytes, filename: str, month: Optional[str], batch_id: str,
                       user_email: str) -> tuple[int, str, bool, Optional[str]]:
    """Returns (rows, message, ai_used, month)."""
    is_pdf = filename.lower().endswith(".pdf")
    ref = datetime.now(timezone.utc).date().isoformat()
    rows: list[dict] = []
    ai_used = False
    tables = None

    if not is_pdf:
        tables = parsers.load_tables(content, filename)
        if kind == "completa":
            n, msg = await import_full(tables, batch_id, user_email, ref)
            return n, msg, False, None
        rows = parsers.parse_kind(tables, kind)

    if kind == "completa":
        raise ValueError("A planilha completa precisa ser .xlsx")

    if not rows:
        ai_used = True
        suffix = ".pdf" if is_pdf else ".csv"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(content if is_pdf else parsers.tables_to_csv_text(tables or []).encode("utf-8"))
            path = f.name
        try:
            raw, month_hint = await ai.extract_rows(kind, path, "application/pdf" if is_pdf else "text/csv")
        finally:
            os.unlink(path)
        rows = _normalize_ai_rows(kind, raw)
        if kind == "inventario" and not month and month_hint:
            month = parsers.month_from_text(str(month_hint))

    if kind == "inventario":
        month = month or parsers.month_from_text(filename)
        if not month:
            raise ValueError("Informe o mês da contagem")
        n, msg = await store_inventario(rows, month, batch_id)
    elif kind == "compras":
        n, msg = await store_compras(rows, batch_id)
    elif kind == "custos":
        n, msg = await store_custos(rows, batch_id, ref)
    elif kind == "faturamento":
        rows = parsers.aggregate_faturamento(rows) if not ai_used else rows
        n, msg = await store_faturamento(rows, user_email)
    else:
        raise ValueError("Tipo de dado inválido")
    if ai_used:
        msg = f"Lido por IA — {msg}"
    return n, msg, ai_used, month


async def process_upload(upload_id: str, kind: str, content: bytes, filename: str, month: Optional[str], user_email: str):
    try:
        n, msg, ai_used, month = await run_pipeline(kind, content, filename, month, upload_id, user_email)
        status = "concluido" if n > 0 else "erro"
        await db.uploads.update_one({"id": upload_id}, {"$set": {
            "status": status, "rows": n, "message": msg, "ai_used": ai_used, "month": month,
            "undoable": kind in UNDOABLE and n > 0,
        }})
    except Exception as exc:  # surface any parsing/AI failure on the upload card
        logger.exception("upload %s failed", upload_id)
        await db.uploads.update_one({"id": upload_id}, {"$set": {"status": "erro", "message": f"Falha ao processar: {exc}"}})
