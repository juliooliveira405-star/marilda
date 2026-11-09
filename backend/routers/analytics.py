import io
import uuid
from typing import Optional

import openpyxl
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from lib import ai, metrics
from lib.ai import AI_MODELS, generate_insight
from lib.auth import VIEWERS, require_role
from lib.db import db
from lib.ingest import now_iso
from lib.parsers import month_label
from lib.sectors import CHEF_SECTORS, CMV_SECTORS, SECTORS, audit, can_see_costs, item_sector, supplier_sector_map
from models.schemas import (
    AiModel, AuditRow, Dashboard, Insight, InsightIn, Overview, ReorderResponse, SectorCmv, SupplierSector,
    SupplierSectorIn, SuppliersResponse,
)

router = APIRouter()
viewer = require_role(*VIEWERS)
manager = require_role("gerente")


@router.get("/dashboard", response_model=Dashboard)
async def get_dashboard(_: dict = Depends(manager)):
    return await metrics.dashboard()


@router.get("/overview", response_model=Overview)
async def overview(member: dict = Depends(viewer)):
    """Value-free summary for every profile; Chefe of a cost sector also gets own-sector stock value."""
    months = await metrics.compute_months()
    sector = member.get("sector") if member["role"] == "chefe" else None
    reorder = await metrics.compute_reorder(sector=sector)
    costs_visible = can_see_costs(member)
    stock = []
    if member["role"] == "chefe" and costs_visible:
        costs = await metrics.cost_map()
        agg: dict[str, dict] = {}
        async for r in db.inventory.find({}, {"_id": 0, "month": 1, "item": 1, "qty": 1, "ggrupo": 1, "grupo": 1, "sgrupo": 1}):
            if item_sector(r.get("ggrupo", ""), r.get("grupo", ""), r.get("sgrupo", "")) != sector:
                continue
            a = agg.setdefault(r["month"], {"valor": 0.0, "itens": 0})
            q, c = r.get("qty") or 0, costs.get(r["item"])
            if q > 0 and c is not None:
                a["valor"] += q * c
                a["itens"] += 1
        stock = [{"month": m, "label": month_label(m), "valor": round(v["valor"], 2), "itens": v["itens"]} for m, v in sorted(agg.items())]
    sem_custo = [i["descricao"] for i in reorder["items"] if i["custo"] is None and i["qtd_atual"] > 0][:15]
    return {
        "months": [{**{k: m[k] for k in ("month", "label", "status", "alerta_parcial", "pendencias")},
                    "tem_inventario": m["itens_inventario"] > 0} for m in months],
        "zerados": reorder["counts"].get("ZERADO", 0), "baixou_forte": reorder["counts"].get("BAIXOU FORTE", 0),
        "sector": sector, "costs_visible": costs_visible, "sector_stock": stock,
        "itens_sem_custo": sem_custo if member["role"] == "gerente" else [],
    }


@router.get("/suppliers", response_model=SuppliersResponse)
async def get_suppliers(_: dict = Depends(manager)):
    return await metrics.compute_suppliers()


@router.get("/cmv/sector", response_model=SectorCmv)
async def sector_cmv(sector: Optional[str] = None, member: dict = Depends(viewer)):
    """Gerente: any CMV sector. Chefe Cozinha/Bar/Quiosque: only own sector. Others: 403."""
    if member["role"] == "chefe":
        sector = member.get("sector")
    elif member["role"] != "gerente":
        raise HTTPException(status_code=403, detail="Seu perfil não vê CMV")
    if sector not in CMV_SECTORS or not can_see_costs(member, sector):
        raise HTTPException(status_code=403, detail="CMV por setor disponível só para Cozinha, Bar e Quiosque")
    data = await metrics.compute_sector_months(sector)
    if member["role"] != "gerente":
        data["compras_nao_alocadas"] = None
        for m in data["months"]:
            m["faturamento"] = None
    return data


@router.get("/suppliers/sectors", response_model=list[SupplierSector])
async def supplier_sectors(_: dict = Depends(manager)):
    smap = await supplier_sector_map()
    rows = await db.purchases.aggregate([{"$group": {"_id": "$fornecedor", "t": {"$sum": "$valor"}, "rs": {"$first": "$razao_social"}}},
                                         {"$sort": {"t": -1}}]).to_list(None)
    return [{"fornecedor": r["_id"], "razao_social": r.get("rs") or "", "total": round(r["t"], 2),
             "sector": smap.get(r["_id"], (None, ""))[0], "auto": smap.get(r["_id"], (None, ""))[1] != "manual",
             "fonte": smap.get(r["_id"], (None, ""))[1]} for r in rows]


@router.post("/suppliers/sectors/suggest", response_model=list[SupplierSector])
async def suggest_supplier_sectors(member: dict = Depends(manager)):
    """AI suggestion for every supplier still without sector — saved as fonte "ia" so the Gerente can confirm or change."""
    rows = [r for r in await supplier_sectors(member) if not r["sector"]]
    if rows:
        try:
            sug = await ai.suggest_supplier_sectors(rows)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"A IA não respondeu agora — tente de novo ({str(exc)[:80]})")
        n = 0
        for r in rows:
            sec = sug.get(r["fornecedor"])
            if sec in SECTORS:
                await db.supplier_sectors.update_one({"fornecedor": r["fornecedor"]},
                                                     {"$set": {"fornecedor": r["fornecedor"], "sector": sec, "source": "ia"}}, upsert=True)
                n += 1
        await audit(member, "fornecedor → setor (sugestão IA)", f"{n} de {len(rows)} fornecedores")
    return await supplier_sectors(member)


@router.put("/suppliers/sectors", response_model=SupplierSector)
async def set_supplier_sector(body: SupplierSectorIn, member: dict = Depends(manager)):
    if body.sector is not None and body.sector not in SECTORS:
        raise HTTPException(status_code=422, detail="Setor inválido")
    await db.supplier_sectors.update_one({"fornecedor": body.fornecedor},
                                         {"$set": {"fornecedor": body.fornecedor, "sector": body.sector, "source": "manual"}}, upsert=True)
    await audit(member, "fornecedor → setor", f"{body.fornecedor}: {body.sector or 'não alocado'}")
    tot = await db.purchases.aggregate([{"$match": {"fornecedor": body.fornecedor}}, {"$group": {"_id": None, "t": {"$sum": "$valor"}}}]).to_list(None)
    return {"fornecedor": body.fornecedor, "total": round(tot[0]["t"], 2) if tot else 0.0, "sector": body.sector, "auto": False, "fonte": "manual"}


@router.get("/reorder", response_model=ReorderResponse)
async def get_reorder(from_month: Optional[str] = None, to_month: Optional[str] = None, sector: Optional[str] = None,
                      member: dict = Depends(viewer)):
    if member["role"] == "chefe":
        sector = member.get("sector")  # chefe always sees only own sector
    elif sector and sector not in CHEF_SECTORS + ["Estoque"]:
        sector = None
    data = await metrics.compute_reorder(from_month, to_month, sector)
    visible = can_see_costs(member, sector) if member["role"] != "gerente" else True
    if not visible:
        for i in data["items"]:
            i["custo"] = None
            i["valor_reposicao"] = None
        data["valor_reposicao_total"] = None
    return {**data, "costs_visible": visible}


@router.get("/ai/models", response_model=list[AiModel])
async def ai_models(_: dict = Depends(manager)):
    return [{"id": k, "name": v[2], "badge": v[3]} for k, v in AI_MODELS.items()]


@router.get("/insights", response_model=list[Insight])
async def list_insights(_: dict = Depends(manager)):
    return await db.insights.find({}, {"_id": 0}).sort("created_at", -1).to_list(20)


@router.post("/insights", response_model=Insight)
async def create_insight(body: InsightIn, member: dict = Depends(manager)):
    if body.model not in AI_MODELS:
        raise HTTPException(status_code=422, detail="Modelo de IA inválido")
    context = await metrics.ai_context()
    try:
        content = await generate_insight(body.model, context, body.focus, body.question.strip())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"A IA não respondeu: {exc}")
    doc = {
        "id": str(uuid.uuid4()), "model": body.model, "model_name": AI_MODELS[body.model][2], "focus": body.focus,
        "question": body.question.strip(), "content": content, "user_email": member.get("email", ""), "created_at": now_iso(),
    }
    await db.insights.insert_one(dict(doc))
    return doc


@router.get("/audit", response_model=list[AuditRow])
async def audit_log(_: dict = Depends(manager)):
    return await db.audit.find({}, {"_id": 0}).sort("at", -1).to_list(300)


@router.get("/backup")
async def backup(member: dict = Depends(manager)):
    """Full Excel backup in the same layout the 'Planilha completa' importer reads back."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Tabela de Custos"
    ws.append(["Item", "Descrição", "Grupo", "V. Custo Médio", "Referência"])
    async for c in db.costs.find({}, {"_id": 0}):
        ws.append([c["item"], c.get("descricao", ""), c.get("grupo", ""), c.get("custo"), c.get("ref", "")])
    for m in sorted(await db.inventory.distinct("month")):
        y, mo = m.split("-")
        ws = wb.create_sheet(f"Contagem {month_label(m).replace('/', '-')}"[:31])
        ws.append(["Item", "Descrição", "UM", "Q. Estoque", "Ggrupo", "Grupo", "Sgrupo"])
        async for r in db.inventory.find({"month": m}, {"_id": 0}):
            ws.append([r["item"], r.get("descricao", ""), r.get("um", ""), r.get("qty"), r.get("ggrupo", ""), r.get("grupo", ""), r.get("sgrupo", "")])
    ws = wb.create_sheet("Dados Brutos Compras")
    ws.append(["Data", "Mês", "Número", "Série", "Fornecedor", "Razão Social", "Valor (R$)"])
    async for p in db.purchases.find({}, {"_id": 0}).sort("date", 1):
        ws.append([p["date"], p["month"], p.get("numero", ""), p.get("serie", ""), p["fornecedor"], p.get("razao_social", ""), p["valor"]])
    ws = wb.create_sheet("Resumo")
    ws.append(["Mês", "Faturamento R$", "Status", "Faturamento até", "Estoque até", "Obs"])
    async for p in db.periods.find({}, {"_id": 0}).sort("month", 1):
        if p.get("faturamento"):
            ws.append([month_label(p["month"]) + ("*" if p.get("faturamento_parcial") else ""), p["faturamento"],
                       "parcial" if p.get("faturamento_parcial") else "completo", p.get("faturamento_ate"), p.get("estoque_ate"), p.get("obs", "")])
    ws = wb.create_sheet("Requisições")
    ws.append(["Nº", "Data", "Setor", "Prioridade", "Status", "Solicitante", "Item", "Descrição", "Qtd", "UM"])
    async for r in db.requisitions.find({"status": {"$ne": "excluida"}}, {"_id": 0}).sort("number", 1):
        for ln in r["items"]:
            ws.append([r["number"], r["created_at"][:10], r["sector"], r["priority"], r["status"], r["requested_by"], ln["item"], ln["descricao"], ln["qty"], ln.get("um", "")])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    await audit(member, "backup exportado")
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="madrila_backup.xlsx"'})
