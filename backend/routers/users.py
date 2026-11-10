import os
import uuid

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from lib.auth import ENV, IN_ENV, RANK, ROLE_LABELS, ROLES, VIEWERS, current_member, effective_role, require_role
from lib.db import db
from lib.ingest import now_iso
from lib.metrics import get_settings
from lib.dates import now_local
from lib.sectors import ROLE_SECTORS, audit, perms, sector_of
from models.schemas import Invite, InviteIn, Me, RoleIn, RoleOption, Settings, TempSub, UserRow, UsersResponse

router = APIRouter()
CLERK_API = "https://api.clerk.com/v1"


def label(role: str, sector: str | None) -> str:
    return f"{ROLE_LABELS[role]} {sector}" if role in ROLE_SECTORS and sector else ROLE_LABELS[role]


def _row(p: dict) -> dict:
    role = effective_role(p.get("role"))
    sector = sector_of({**p, "role": role}) if role in ROLE_SECTORS else None
    status = "excluido" if p.get("deleted") else ("pendente" if role == "pendente" else "ativo")
    return {"user_id": p["user_id"], "email": p.get("email", ""), "name": p.get("name", ""),
            "role": role, "role_label": label(role, sector), "status": status, "sector": sector, "temp": p.get("temp") or None}


def _check_sector(role: str, sector: str | None) -> None:
    if role in ROLE_SECTORS and sector not in ROLE_SECTORS[role]:
        raise HTTPException(status_code=422, detail=f"Escolha o setor ({', '.join(ROLE_SECTORS[role])})")


async def _target(user_id: str) -> dict:
    target = await db.users.find_one({"user_id": user_id, **IN_ENV}, {"_id": 0})
    if target is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return target


async def _keep_one_manager(target: dict) -> None:
    if (effective_role(target.get("role")) == "gerente"
            and await db.users.count_documents({"role": "gerente", "deleted": {"$ne": True}, **IN_ENV}) <= 1):
        raise HTTPException(status_code=409, detail="Mantenha pelo menos um Gerente Geral")


def _invite_row(i: dict) -> dict:
    return {**i, "role_label": label(i["role"], i.get("sector")) if i["role"] in ROLE_LABELS else i["role"]}


def _clerk(method: str, path: str, body: dict | None = None) -> dict:
    r = requests.request(method, f"{CLERK_API}{path}", json=body, timeout=15, headers={
        "Authorization": f"Bearer {os.environ['CLERK_SECRET_KEY']}", "User-Agent": "emergent-app"})
    if r.status_code >= 400:
        try:
            msg = r.json()["errors"][0].get("long_message") or r.json()["errors"][0]["message"]
        except Exception:
            msg = r.text[:200]
        raise HTTPException(status_code=422 if r.status_code < 500 else 502, detail=f"Convite não enviado: {msg}")
    return r.json()


@router.get("/me", response_model=Me)
async def me(member: dict = Depends(current_member)):
    row = _row({**member, "deleted": False})
    if member.get("temp_active"):
        row["role_label"] = f"{label(member['role'], member.get('sector'))} (substituição até {member['temp']['end'][8:10]}/{member['temp']['end'][5:7]})"
    return {**row, "perms": perms(member) if member["role"] != "pendente" else {}, "temp_active": bool(member.get("temp_active"))}


@router.get("/users", response_model=UsersResponse)
async def list_users(admin: dict = Depends(require_role("gerente"))):
    people = await db.users.find(IN_ENV, {"_id": 0}).to_list(1000)
    rows = sorted((_row(p) for p in people), key=lambda r: (r["status"] != "pendente", r["email"]))
    invites = await db.invites.find({"status": "enviado", **IN_ENV}, {"_id": 0}).sort("created_at", -1).to_list(200)
    roles = [RoleOption(value=r, label=ROLE_LABELS[r]) for r in ROLES if RANK[r] <= RANK[admin["role"]]]
    return {"roles": roles, "users": rows, "invites": [_invite_row(i) for i in invites]}


@router.patch("/users/{user_id}/role", response_model=UserRow)
async def set_role(user_id: str, body: RoleIn, admin: dict = Depends(require_role("gerente"))):
    if body.role not in ROLES or RANK[body.role] > RANK[admin["role"]]:
        raise HTTPException(status_code=403, detail="Sem permissão para esta ação")
    _check_sector(body.role, body.sector)
    target = await _target(user_id)
    if body.role != "gerente":
        await _keep_one_manager(target)
    sector = body.sector if body.role in ROLE_SECTORS else None
    await db.users.update_one({"user_id": user_id}, {"$set": {"role": body.role, "sector": sector}})
    await audit(admin, "perfil alterado", f"{target.get('email')}: {label(effective_role(target.get('role')), target.get('sector'))} → {label(body.role, sector)}")
    return _row({**target, "role": body.role, "sector": sector})


@router.put("/users/{user_id}/temp", response_model=UserRow)
async def set_temp(user_id: str, body: TempSub, admin: dict = Depends(require_role("gerente"))):
    """Substituição temporária: o usuário assume outro perfil entre start e end (inclusive) e depois volta sozinho."""
    _check_sector(body.role, body.sector)
    if body.end < body.start or body.end < now_local().date().isoformat():
        raise HTTPException(status_code=422, detail="Período inválido (fim antes do início ou já passado)")
    target = await _target(user_id)
    temp = {**body.model_dump(), "sector": body.sector if body.role in ROLE_SECTORS else None, "by": admin.get("email", "")}
    await db.users.update_one({"user_id": user_id}, {"$set": {"temp": temp}})
    await audit(admin, "substituição temporária", f"{target.get('email')} → {label(body.role, temp['sector'])} de {body.start} a {body.end}"
                + (f" — {body.motivo}" if body.motivo else ""))
    return _row({**target, "temp": temp})


@router.delete("/users/{user_id}/temp", response_model=UserRow)
async def clear_temp(user_id: str, admin: dict = Depends(require_role("gerente"))):
    target = await _target(user_id)
    await db.users.update_one({"user_id": user_id}, {"$unset": {"temp": ""}})
    await audit(admin, "substituição encerrada", target.get("email", ""))
    return _row({**target, "temp": None})


@router.delete("/users/{user_id}", response_model=UserRow)
async def delete_user(user_id: str, admin: dict = Depends(require_role("gerente"))):
    """Excluir perfil = bloqueio imediato de acesso (soft delete; histórico e auditoria preservados)."""
    target = await _target(user_id)
    if target["user_id"] == admin["user_id"]:
        raise HTTPException(status_code=409, detail="Você não pode excluir o próprio perfil")
    await _keep_one_manager(target)
    await db.users.update_one({"user_id": user_id}, {"$set": {"deleted": True, "deleted_at": now_iso(), "deleted_by": admin.get("email", "")}})
    await audit(admin, "perfil excluído", target.get("email", ""))
    return _row({**target, "deleted": True})


@router.post("/users/{user_id}/restore", response_model=UserRow)
async def restore_user(user_id: str, admin: dict = Depends(require_role("gerente"))):
    target = await _target(user_id)
    await db.users.update_one({"user_id": user_id}, {"$set": {"deleted": False}})
    await audit(admin, "perfil reativado", target.get("email", ""))
    return _row({**target, "deleted": False})


@router.post("/users/invite", response_model=Invite)
async def invite_user(body: InviteIn, request: Request, admin: dict = Depends(require_role("gerente"))):
    email = body.email.strip().lower()
    _check_sector(body.role, body.sector)
    existing = await db.users.find_one({"email": email, **IN_ENV}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Este e-mail já tem conta — ajuste o perfil na lista de usuários")
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host", "")).split(",")[0].strip()
    origin = request.headers.get("origin") or f"https://{host}"
    clerk_inv = await run_in_threadpool(_clerk, "POST", "/invitations", {
        "email_address": email, "redirect_url": f"{origin}/sign-up", "notify": True, "ignore_existing": True,
        "public_metadata": {"role": body.role},
    })
    await db.invites.update_many({"email": email, "status": "enviado", **IN_ENV}, {"$set": {"status": "revogado"}})
    doc = {"id": str(uuid.uuid4()), "clerk_id": clerk_inv.get("id", ""), "email": email, "role": body.role,
           "sector": body.sector if body.role in ROLE_SECTORS else None,
           "status": "enviado", "invited_by": admin.get("email", ""), "created_at": now_iso(), "env": ENV}
    await db.invites.insert_one(dict(doc))
    await audit(admin, "convite enviado", f"{email} ({label(body.role, body.sector)})")
    doc.pop("clerk_id")
    doc.pop("env")
    return _invite_row(doc)


@router.delete("/users/invites/{invite_id}", response_model=Invite)
async def revoke_invite(invite_id: str, _: dict = Depends(require_role("gerente"))):
    inv = await db.invites.find_one({"id": invite_id, **IN_ENV}, {"_id": 0})
    if not inv or inv["status"] != "enviado":
        raise HTTPException(status_code=404, detail="Convite não encontrado")
    if inv.get("clerk_id"):
        try:
            await run_in_threadpool(_clerk, "POST", f"/invitations/{inv['clerk_id']}/revoke")
        except HTTPException:
            pass  # already accepted/expired at Clerk — still revoke locally
    await db.invites.update_one({"id": invite_id}, {"$set": {"status": "revogado"}})
    inv.pop("clerk_id", None)
    inv.pop("env", None)
    return _invite_row({**inv, "status": "revogado"})


@router.get("/settings", response_model=Settings)
async def read_settings(_: dict = Depends(require_role(*VIEWERS))):
    return await get_settings()


@router.put("/settings", response_model=Settings)
async def update_settings(body: Settings, _: dict = Depends(require_role("gerente"))):
    if body.cmv_meta_min > body.cmv_meta_max:
        raise HTTPException(status_code=422, detail="Meta mínima maior que a máxima")
    await db.settings.update_one({"_id": "global"}, {"$set": body.model_dump()}, upsert=True)
    await audit(_, "metas alteradas", f"CMV {body.cmv_meta_min:.0%}–{body.cmv_meta_max:.0%}")
    return body
