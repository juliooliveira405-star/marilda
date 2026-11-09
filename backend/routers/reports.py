"""Reports: expiry alerts (validades) and the one-click monthly PDF for the board."""

import io
from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from lib import metrics, pdf
from lib.auth import VIEWERS, require_role
from lib.dates import now_local
from lib.db import db
from lib.ingest import now_iso
from lib.sectors import CMV_SECTORS, audit, supplier_sector_map
from lib.validade import expiring
from models.schemas import BaixaIn, ValidadeAlert

router = APIRouter()
viewer = require_role(*VIEWERS)
manager = require_role("gerente")


@router.get("/validades", response_model=list[ValidadeAlert])
async def validades(dias: int = 7, member: dict = Depends(viewer)):
    return await expiring(member, max(0, min(dias, 60)))


@router.post("/validades/{code}/baixa", response_model=list[ValidadeAlert])
async def baixa(code: str, body: BaixaIn, member: dict = Depends(viewer)):
    lb = await db.qr_labels.find_one({"code": code}, {"_id": 0, "descricao": 1, "validade": 1})
    if not lb:
        raise HTTPException(status_code=404, detail="Etiqueta não encontrada")
    await db.qr_labels.update_one({"code": code}, {"$set": {"baixa": True, "baixa_motivo": body.motivo, "baixa_by": member.get("email", ""),
                                                             "baixa_at": now_iso()}})
    await audit(member, f"validade: baixa ({body.motivo})", f"{lb['descricao']} · validade {lb.get('validade', '')}")
    return await expiring(member, 7)


async def _report_data(month: str) -> dict:
    months = await metrics.compute_months()
    row = next((m for m in months if m["month"] == month), None)
    if not row:
        raise HTTPException(status_code=404, detail="Mês sem dados")
    settings = await metrics.get_settings()
    sectors = []
    for s in CMV_SECTORS:
        sm = next((x for x in (await metrics.compute_sector_months(s))["months"] if x["month"] == month), None)
        if sm:
            sectors.append({"sector": s, **sm})
    smap = await supplier_sector_map()
    top = await db.purchases.aggregate([{"$match": {"month": month}}, {"$group": {"_id": "$fornecedor", "t": {"$sum": "$valor"}, "n": {"$sum": 1}}},
                                        {"$sort": {"t": -1}}, {"$limit": 10}]).to_list(None)
    reqs = await db.requisitions.find({"created_at": {"$regex": f"^{month}"}, "status": {"$ne": "excluida"}}, {"_id": 0}).to_list(2000)
    falta = Counter(ln["descricao"] for r in reqs for ln in r["items"] if ln.get("disponibilidade") in ("sem_estoque", "parcial"))
    inv_months = [m["month"] for m in months if m["itens_inventario"]]
    reorder = None
    if month in inv_months and inv_months.index(month) > 0:
        reorder = await metrics.compute_reorder(inv_months[inv_months.index(month) - 1], month)
    return {
        "month": row, "settings": settings, "sectors": sectors,
        "top": [{"fornecedor": t["_id"], "total": t["t"], "notas": t["n"], "sector": smap.get(t["_id"], (None, ""))[0]} for t in top],
        "req_status": Counter(r["status"] for r in reqs), "req_sector": Counter(r["sector"] for r in reqs), "req_total": len(reqs),
        "req_urgentes": sum(1 for r in reqs if r["priority"] == "urgente"), "falta": falta.most_common(10),
        "reorder": reorder, "validades": await expiring({"role": "gerente"}, 7),
        "gerado": now_local().strftime("%d/%m/%Y %H:%M"),
    }


@router.get("/reports/monthly")
async def monthly_report(month: Optional[str] = None, member: dict = Depends(manager)):
    month = month or now_local().strftime("%Y-%m")
    data = await _report_data(month)
    content = pdf.monthly_report_pdf(data)
    await audit(member, "relatório mensal PDF", data["month"]["label"])
    return StreamingResponse(io.BytesIO(content), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="madrila_relatorio_{month}.pdf"'})
