from fastapi import APIRouter, Depends, HTTPException

from lib.auth import IN_ENV, RANK, ROLE_LABELS, ROLES, VIEWERS, current_member, effective_role, require_role
from lib.db import db
from lib.metrics import get_settings
from models.schemas import Me, RoleIn, RoleOption, Settings, UserRow, UsersResponse

router = APIRouter()


def _row(p: dict) -> dict:
    role = effective_role(p.get("role"))
    return {"user_id": p["user_id"], "email": p.get("email", ""), "name": p.get("name", ""),
            "role": role, "role_label": ROLE_LABELS[role]}


@router.get("/me", response_model=Me)
async def me(member: dict = Depends(current_member)):
    return _row(member)


@router.get("/users", response_model=UsersResponse)
async def list_users(admin: dict = Depends(require_role("gerente"))):
    people = await db.users.find(IN_ENV, {"_id": 0}).to_list(1000)
    roles = [RoleOption(value=r, label=ROLE_LABELS[r]) for r in ROLES if RANK[r] <= RANK[admin["role"]]]
    return {"roles": roles, "users": [_row(p) for p in people]}


@router.patch("/users/{user_id}/role", response_model=UserRow)
async def set_role(user_id: str, body: RoleIn, admin: dict = Depends(require_role("gerente"))):
    if body.role not in ROLES or RANK[body.role] > RANK[admin["role"]]:
        raise HTTPException(status_code=403, detail="Sem permissão para esta ação")
    target = await db.users.find_one({"user_id": user_id, **IN_ENV}, {"_id": 0})
    if target is None:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if (effective_role(target.get("role")) == "gerente" and body.role != "gerente"
            and await db.users.count_documents({"role": "gerente", **IN_ENV}) <= 1):
        raise HTTPException(status_code=409, detail="Mantenha pelo menos um gerente")
    await db.users.update_one({"user_id": user_id}, {"$set": {"role": body.role}})
    return _row({**target, "role": body.role})


@router.get("/settings", response_model=Settings)
async def read_settings(_: dict = Depends(require_role(*VIEWERS))):
    return await get_settings()


@router.put("/settings", response_model=Settings)
async def update_settings(body: Settings, _: dict = Depends(require_role("gerente"))):
    if body.cmv_meta_min > body.cmv_meta_max:
        raise HTTPException(status_code=422, detail="Meta mínima maior que a máxima")
    await db.settings.update_one({"_id": "global"}, {"$set": body.model_dump()}, upsert=True)
    return body
