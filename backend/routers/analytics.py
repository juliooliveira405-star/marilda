import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from lib import metrics
from lib.ai import AI_MODELS, generate_insight
from lib.auth import VIEWERS, require_role
from lib.db import db
from lib.ingest import now_iso
from models.schemas import AiModel, Dashboard, Insight, InsightIn, ReorderResponse, SuppliersResponse

router = APIRouter()
viewer = require_role(*VIEWERS)


@router.get("/dashboard", response_model=Dashboard)
async def get_dashboard(_: dict = Depends(viewer)):
    return await metrics.dashboard()


@router.get("/suppliers", response_model=SuppliersResponse)
async def get_suppliers(_: dict = Depends(viewer)):
    return await metrics.compute_suppliers()


@router.get("/reorder", response_model=ReorderResponse)
async def get_reorder(from_month: Optional[str] = None, to_month: Optional[str] = None, _: dict = Depends(viewer)):
    return await metrics.compute_reorder(from_month, to_month)


@router.get("/ai/models", response_model=list[AiModel])
async def ai_models(_: dict = Depends(viewer)):
    return [{"id": k, "name": v[2], "badge": v[3]} for k, v in AI_MODELS.items()]


@router.get("/insights", response_model=list[Insight])
async def list_insights(_: dict = Depends(viewer)):
    return await db.insights.find({}, {"_id": 0}).sort("created_at", -1).to_list(20)


@router.post("/insights", response_model=Insight)
async def create_insight(body: InsightIn, member: dict = Depends(viewer)):
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
