"""Sectors, item→sector and supplier→sector mapping, audit log and in-app notifications."""

import uuid

from lib.db import db
from lib.ingest import now_iso
from lib.parsers import norm

SECTORS = ["Cozinha", "Bar", "Quiosque", "Salão", "Estoque"]  # "Café" was renamed "Quiosque"
CHEF_SECTORS = ["Cozinha", "Bar", "Estoque", "Salão", "Quiosque"]
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


# ---------- Permission matrix (single source of truth; the frontend only mirrors GET /api/me.perms) ----------
ALL = "*"
# Sector a person works for → sectors he operates (requisição/contagem). Cozinha also covers Quiosque.
SECTOR_GROUP = {"Cozinha": ["Cozinha", "Quiosque"], "Bar": ["Bar"], "Salão": ["Salão"], "Quiosque": ["Quiosque"], "Estoque": list(SECTORS)}
ROLE_SECTORS = {"chefe": ["Cozinha", "Bar", "Estoque", "Salão", "Quiosque"], "alimentador": ["Cozinha", "Bar", "Estoque", "Salão"]}
COST_BY_CHEF = {"Cozinha": ["Cozinha", "Quiosque"], "Bar": ["Bar"], "Quiosque": ["Quiosque"]}


def sector_of(member: dict) -> str | None:
    s = member.get("sector")
    if member["role"] == "alimentador" and s not in ROLE_SECTORS["alimentador"]:
        return "Estoque"  # legacy alimentador without sector = estoquista
    return s


def full_view(member: dict) -> bool:
    """Gerente Geral and Chefe Estoque see every value and every sector (read)."""
    return member["role"] == "gerente" or (member["role"] == "chefe" and sector_of(member) == "Estoque")


def cost_sectors(member: dict) -> list[str] | str:
    if full_view(member):
        return ALL
    if member["role"] == "chefe":
        return COST_BY_CHEF.get(sector_of(member) or "", [])
    return []  # REGRA ABSOLUTA: nenhum Alimentador (nem Chefe Salão) vê CMV ou custo


def can_see_costs(member: dict, sector: str | None = None) -> bool:
    cs = cost_sectors(member)
    if cs == ALL:
        return True
    return bool(cs) and (sector is None or sector in cs)


def is_stock(member: dict) -> bool:
    """Separa, marca falta, baixa parcial, entrega, compra/recebe, aplica contagem."""
    return full_view(member) or (member["role"] == "alimentador" and sector_of(member) == "Estoque")


def op_sectors(member: dict) -> list[str]:
    if full_view(member) or is_stock(member):
        return list(SECTORS)
    return SECTOR_GROUP.get(sector_of(member) or "", [])


def can_ifood(member: dict) -> bool:
    return full_view(member) or (member["role"] == "chefe" and sector_of(member) == "Cozinha")


def can_upload(member: dict) -> bool:
    return full_view(member) or (member["role"] == "alimentador" and sector_of(member) in ("Estoque", "Salão"))


def upload_kinds(member: dict) -> list[str] | str:
    """Alimentador Salão only sends faturamento; full/estoque send everything."""
    if member["role"] == "alimentador" and sector_of(member) == "Salão":
        return ["faturamento"]
    return ALL if can_upload(member) else []


def perms(member: dict) -> dict:
    cs = cost_sectors(member)
    return {"full": full_view(member), "costs": cs == ALL or bool(cs), "cost_sectors": list(SECTORS) if cs == ALL else cs,
            "stock": is_stock(member), "op_sectors": op_sectors(member), "manage": member["role"] == "gerente",
            "approve": member["role"] == "gerente", "ifood": can_ifood(member), "upload": can_upload(member),
            "upload_kinds": ["*"] if upload_kinds(member) == ALL else upload_kinds(member), "print": member["role"] in ("gerente", "chefe")}


async def audit(member: dict | str, action: str, detail: str = "") -> None:
    who = member if isinstance(member, str) else (member.get("email") or member.get("user_id", ""))
    await db.audit.insert_one({"at": now_iso(), "user": who, "action": action, "detail": detail[:500]})


async def role_emails(*roles: str) -> list[str]:
    from lib.auth import IN_ENV
    return [u["email"] async for u in db.users.find({"role": {"$in": list(roles)}, "email": {"$nin": [None, ""]}, "deleted": {"$ne": True}, **IN_ENV},
                                                    {"_id": 0, "email": 1})]


async def stock_emails() -> list[str]:
    """Gerentes + Chefe Estoque + Alimentador Estoque (and legacy alimentador without sector) — who prepares requisitions."""
    from lib.auth import IN_ENV
    q = {"email": {"$nin": [None, ""]}, "deleted": {"$ne": True}, **IN_ENV, "$or": [
        {"role": "gerente"}, {"role": "chefe", "sector": "Estoque"},
        {"role": "alimentador", "sector": {"$nin": ["Cozinha", "Bar", "Salão"]}}]}
    return [u["email"] async for u in db.users.find(q, {"_id": 0, "email": 1})]


async def notify(emails: list[str], req: dict, message: str, actor: str = "") -> None:
    """One unread in-app notification per recipient (the actor never notifies himself)."""
    at = now_iso()
    docs = [{"id": str(uuid.uuid4()), "to": e, "req_id": req["id"], "number": req["number"], "sector": req["sector"],
             "priority": req["priority"], "status": req["status"], "message": message, "at": at, "read": False}
            for e in dict.fromkeys(emails) if e and e != actor]
    if docs:
        await db.notifications.insert_many(docs)
