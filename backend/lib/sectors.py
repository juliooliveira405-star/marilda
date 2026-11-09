"""Sectors, item→sector and supplier→sector mapping, audit log and in-app notifications."""

import uuid

from lib.db import db
from lib.ingest import now_iso
from lib.parsers import norm

SECTORS = ["Cozinha", "Bar", "Quiosque", "Salão", "Estoque"]  # "Café" was renamed "Quiosque"
CHEF_SECTORS = ["Cozinha", "Bar", "Salão", "Quiosque"]
COST_SECTORS = {"Cozinha", "Bar", "Quiosque"}  # Chefe Salão never sees values
CMV_SECTORS = ["Cozinha", "Bar", "Quiosque"]
QUIOSQUE_SUB = ("CAFE", "CHA", "DOCE", "SNACK")

# Supplier name keywords → sector (first match wins). Gerente can override per supplier.
SUPPLIER_RULES = [
    ("Quiosque", ("CAFE", "CACAU", "SNACK", "CREAMERY")),
    ("Bar", ("BEBID", "VINHO", "WINE", "CERVEJ", "CHOPP", "ESPUMANT", "DESTIL", "MISTRAL", "HNK", "SPAL", "AMBEV", "GELO", "ICEBEN", "ICE BEN")),
    ("Salão", ("EMBALAG", "DESCART", "GRAFICA", "PAPE", "LIMPEZA", "HIGIENE", "UNIFORM", "PORCELANA", "TALHER", "SEGURANCA")),
    ("Cozinha", ("PESCAD", "PEIXE", "FRUTOS DO MAR", "CARNE", "FRIGOR", "AVES", "HORTI", "FRUT", "LATIC", "ALIMENT", "MASSA",
                 "COGUMEL", "GASTRONOM", "PADARIA", "PARMA", "FOODS", "GOURMET", "COOPERATIVA", "TARTUFI", "COLAVITA")),
]


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


def guess_supplier_sector(fornecedor: str, razao: str = "") -> str | None:
    text = norm(f"{fornecedor} {razao}").upper()
    for sector, keys in SUPPLIER_RULES:
        if any(k in text for k in keys):
            return sector
    return None


async def supplier_sector_map() -> dict[str, tuple[str | None, str]]:
    """fornecedor → (sector, fonte). fonte: manual (Gerente) > ia (sugestão IA) > regra (palavra-chave) > "" (sem setor)."""
    saved = {d["fornecedor"]: d async for d in db.supplier_sectors.find({}, {"_id": 0})}
    out: dict[str, tuple[str | None, str]] = {}
    for r in await db.purchases.aggregate([{"$group": {"_id": "$fornecedor", "rs": {"$first": "$razao_social"}}}]).to_list(None):
        f = r["_id"]
        if f in saved:
            out[f] = (saved[f].get("sector"), saved[f].get("source", "manual"))
        else:
            g = guess_supplier_sector(f, r.get("rs") or "")
            out[f] = (g, "regra" if g else "")
    return out


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


async def role_emails(*roles: str) -> list[str]:
    from lib.auth import IN_ENV
    return [u["email"] async for u in db.users.find({"role": {"$in": list(roles)}, "email": {"$nin": [None, ""]}, **IN_ENV}, {"_id": 0, "email": 1})]


async def notify(emails: list[str], req: dict, message: str, actor: str = "") -> None:
    """One unread in-app notification per recipient (the actor never notifies himself)."""
    at = now_iso()
    docs = [{"id": str(uuid.uuid4()), "to": e, "req_id": req["id"], "number": req["number"], "sector": req["sector"],
             "priority": req["priority"], "status": req["status"], "message": message, "at": at, "read": False}
            for e in dict.fromkeys(emails) if e and e != actor]
    if docs:
        await db.notifications.insert_many(docs)
