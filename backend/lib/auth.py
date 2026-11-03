"""Roles for Madrila ERP. The role LIST is code; each person's role is data in db.users."""

import os

import requests
from fastapi import Depends, HTTPException
from pymongo import ReturnDocument
from starlette.concurrency import run_in_threadpool

try:
    from backend.clerk_auth import require_user
except ModuleNotFoundError:
    from clerk_auth import require_user

from lib.db import db

# Highest first. gerente = admin.
ROLES = ["gerente", "alimentador", "chefe", "pendente"]
ROLE_LABELS = {
    "gerente": "Gerente",
    "alimentador": "Alimentador",
    "chefe": "Chefe de Departamento",
    "pendente": "Pendente",
}
DEFAULT_ROLE = "pendente"
RETIRED_ROLES: dict[str, str] = {}
RANK = {r: len(ROLES) - i for i, r in enumerate(ROLES)}

VIEWERS = ("gerente", "alimentador", "chefe")
FEEDERS = ("gerente", "alimentador")

ENV = "live" if os.environ.get("CLERK_PUBLISHABLE_KEY", "").startswith("pk_live_") else "preview"
IN_ENV = {"env": {"$in": [ENV, None]}}


def effective_role(role) -> str:
    role = RETIRED_ROLES.get(role, role)
    return role if role in ROLES else DEFAULT_ROLE


async def move_retired_roles() -> None:
    for old, new in RETIRED_ROLES.items():
        await db.users.update_many({"role": old}, {"$set": {"role": new}})


def _clerk_profile(user_id: str) -> dict:
    """One Clerk lookup on first sign-in: email, name and whether it is a verified admin email."""
    admins = {e.strip().lower() for e in os.environ.get("ADMIN_EMAIL", "").split(",") if e.strip()}
    r = requests.get(
        f"https://api.clerk.com/v1/users/{user_id}",
        timeout=10,
        headers={"Authorization": f"Bearer {os.environ['CLERK_SECRET_KEY']}", "User-Agent": "emergent-app"},
    )
    r.raise_for_status()
    data = r.json()
    emails = data.get("email_addresses") or []
    primary = next((e for e in emails if e.get("id") == data.get("primary_email_address_id")), emails[0] if emails else {})
    is_admin = any(
        e["email_address"].lower() in admins and (e.get("verification") or {}).get("status") == "verified"
        for e in emails
    )
    name = " ".join(p for p in [data.get("first_name"), data.get("last_name")] if p) or ""
    return {"email": primary.get("email_address", ""), "name": name, "is_admin": is_admin}


async def current_member(user: dict = Depends(require_user)) -> dict:
    uid = user["user_id"]
    member = await db.users.find_one({"user_id": uid}, {"_id": 0})
    if member is None or not member.get("role"):
        profile = await run_in_threadpool(_clerk_profile, uid)
        role = "gerente" if profile["is_admin"] else DEFAULT_ROLE
        await db.users.update_one({"user_id": uid, "role": {"$in": [None, ""]}}, {"$set": {"role": role}})
        member = await db.users.find_one_and_update(
            {"user_id": uid},
            {
                "$setOnInsert": {"user_id": uid, "role": role},
                "$set": {"email": profile["email"], "name": profile["name"]},
            },
            upsert=True,
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
        )
    if member.get("env") != ENV:
        await db.users.update_one({"user_id": uid}, {"$set": {"env": ENV}})
    return {**member, "env": ENV, "role": effective_role(member["role"])}


def require_role(*roles: str):
    async def check(member: dict = Depends(current_member)) -> dict:
        if member["role"] not in roles:
            raise HTTPException(status_code=403, detail="Sem permissão para esta ação")
        return member

    return check
