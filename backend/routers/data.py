import asyncio
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from lib.auth import VIEWERS, require_perm, require_role
from lib.sectors import ALL, can_upload, upload_kinds
from lib.db import db
from lib.ingest import KIND_LABELS, now_iso, process_upload
from lib.sectors import audit
from models.schemas import Period, PeriodIn, Upload

router = APIRouter()
_tasks: set[asyncio.Task] = set()
MONTH_RE = re.compile(r"^20\d{2}-(0[1-9]|1[0-2])$")
MAX_BYTES = 15 * 1024 * 1024


@router.post("/uploads", response_model=Upload)
async def create_upload(
    kind: str = Form(...),
    month: Optional[str] = Form(None),
    file: UploadFile = File(...),
    member: dict = Depends(require_perm(can_upload)),
):
    if kind not in KIND_LABELS:
        raise HTTPException(status_code=422, detail="Tipo de dado inválido")
    kinds = upload_kinds(member)
    if kinds != ALL and kind not in kinds:
        raise HTTPException(status_code=403, detail="Seu perfil só envia faturamento")
    if month and not MONTH_RE.match(month):
        raise HTTPException(status_code=422, detail="Mês inválido (use AAAA-MM)")
    name = file.filename or "arquivo"
    if not name.lower().endswith((".xlsx", ".xlsm", ".csv", ".txt", ".pdf")):
        raise HTTPException(status_code=422, detail="Formato não suportado. Use .xlsx, .csv ou .pdf")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="Arquivo vazio")
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Arquivo maior que 15 MB")
    doc = {
        "id": str(uuid.uuid4()), "kind": kind, "filename": name, "month": month or None, "status": "processando",
        "rows": 0, "message": "Processando…", "ai_used": False, "undoable": False,
        "user_email": member.get("email", ""), "created_at": now_iso(),
    }
    await db.uploads.insert_one(dict(doc))
    await audit(member, "upload", f"{KIND_LABELS[kind]}: {name}")
    task = asyncio.create_task(process_upload(doc["id"], kind, content, name, month or None, member.get("email", "")))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return doc


@router.get("/uploads", response_model=list[Upload])
async def list_uploads(_: dict = Depends(require_perm(can_upload))):
    return await db.uploads.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)


@router.delete("/uploads/{upload_id}", response_model=Upload)
async def undo_upload(upload_id: str, member: dict = Depends(require_role("gerente"))):
    up = await db.uploads.find_one({"id": upload_id}, {"_id": 0})
    if not up:
        raise HTTPException(status_code=404, detail="Envio não encontrado")
    if not up.get("undoable") or up["status"] != "concluido":
        raise HTTPException(status_code=409, detail="Este envio não pode ser desfeito")
    coll = db.purchases if up["kind"] == "compras" else db.inventory
    await coll.delete_many({"batch_id": upload_id})
    await db.uploads.update_one({"id": upload_id}, {"$set": {"status": "desfeito", "undoable": False}})
    await audit(member, "upload desfeito", up["filename"])
    return {**up, "status": "desfeito", "undoable": False}


@router.get("/periods", response_model=list[Period])
async def list_periods(_: dict = Depends(require_role(*VIEWERS))):
    return await db.periods.find({}, {"_id": 0}).sort("month", 1).to_list(500)


@router.put("/periods/{month}", response_model=Period)
async def upsert_period(month: str, body: PeriodIn, member: dict = Depends(require_perm(can_upload))):
    if not MONTH_RE.match(month):
        raise HTTPException(status_code=422, detail="Mês inválido (use AAAA-MM)")
    data = {**body.model_dump(), "month": month, "updated_by": member.get("email", "")}
    await db.periods.update_one({"month": month}, {"$set": data}, upsert=True)
    await audit(member, "lançamento manual", f"{month}: faturamento {body.faturamento}")
    return data
