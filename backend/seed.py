"""Seed Madrila ERP with the user's original workbook (Locale POA, Jul–Out/26).
Run: cd /app/backend && python seed.py [--reset]   (idempotent; --reset wipes data collections first)"""

import asyncio
import sys
import uuid
from pathlib import Path

from lib.db import db, ensure_indexes
from lib.ingest import import_full, now_iso
from lib.parsers import load_tables

WORKBOOK = Path(__file__).parent / "seed_data" / "Analise_CMV_Estoque_Locale_POA.xlsx"
DATA_COLLECTIONS = ["purchases", "inventory", "costs", "periods", "uploads", "insights", "settings"]


async def main(reset: bool) -> None:
    if reset:
        for c in DATA_COLLECTIONS:
            await db[c].drop()
    await ensure_indexes()
    if await db.uploads.find_one({"filename": WORKBOOK.name, "status": "concluido"}):
        print("Seed já aplicado — nada a fazer (use --reset para recarregar).")
        return
    batch = str(uuid.uuid4())
    tables = load_tables(WORKBOOK.read_bytes(), WORKBOOK.name)
    n, msg = await import_full(tables, batch, "sistema", "2026-10-18")
    # Period status/notes exactly as in the workbook
    meta = {
        "2026-07": ("fechado", "Inventário consolidado com menos itens — distorce o CMV de Ago"),
        "2026-08": ("fechado", ""),
        "2026-09": ("fechado", ""),
        "2026-10": ("aberto", "Compras até 22/10, contagem 04–18/10, faturamento até ~24/10"),
    }
    for month, (status, obs) in meta.items():
        await db.periods.update_one({"month": month}, {"$set": {"status": status, "obs": obs},
                                                      "$setOnInsert": {"month": month, "faturamento": None, "faturamento_parcial": False}},
                                    upsert=True)
    await db.settings.update_one({"_id": "global"}, {"$setOnInsert": {"empresa": "Locale POA", "cmv_meta_min": 0.28, "cmv_meta_max": 0.30}}, upsert=True)
    await db.uploads.insert_one({
        "id": batch, "kind": "completa", "filename": WORKBOOK.name, "month": None, "status": "concluido", "rows": n,
        "message": f"Importação inicial — {msg}", "ai_used": False, "undoable": False, "user_email": "sistema", "created_at": now_iso(),
    })
    print(msg)


if __name__ == "__main__":
    asyncio.run(main("--reset" in sys.argv))
