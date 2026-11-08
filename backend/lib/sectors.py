"""Sectors, item→sector mapping and audit log helpers."""

from lib.db import db
from lib.ingest import now_iso
from lib.parsers import norm

SECTORS = ["Cozinha", "Bar", "Salão", "Quiosque", "Boqueta", "Produção", "Garde", "Estoque"]
CHEF_SECTORS = ["Cozinha", "Bar", "Salão", "Quiosque"]
COST_SECTORS = {"Cozinha", "Bar", "Quiosque"}  # Chefe Salão never sees values
QUIOSQUE_SUB = ("CAFE", "CHA", "DOCE", "SNACK")


def item_sector(ggrupo: str, grupo: str, sgrupo: str) -> str:
    g, gr, s = norm(ggrupo).upper(), norm(grupo).upper(), norm(sgrupo).upper()
    if any(k in s for k in QUIOSQUE_SUB) and "PRODU" not in gr:
        return "Quiosque"
    if g.startswith("BEBIDA") or any(k in gr for k in ("ALCOOL", "VINHO", "DESTILAD", "CERVEJ", "SOFT")):
        return "Bar"
    if g.startswith("DESCART") or g.startswith("UTENS") or "DESCART" in gr:
        return "Salão"
    if g.startswith("ALIMENT"):
        return "Cozinha"
    return "Estoque"


def can_see_costs(member: dict, sector: str | None = None) -> bool:
    if member["role"] == "gerente":
        return True
    if member["role"] == "chefe":
        own = member.get("sector")
        return own in COST_SECTORS and (sector is None or sector == own)
    return False


async def audit(member: dict | str, action: str, detail: str = "") -> None:
    who = member if isinstance(member, str) else (member.get("email") or member.get("user_id", ""))
    await db.audit.insert_one({"at": now_iso(), "user": who, "action": action, "detail": detail[:500]})
