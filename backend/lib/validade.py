"""Expiry alerts for labels read in the counts (QR or photo): validade ≤ today + N days, grouped by sector."""

from datetime import date, timedelta

from lib.dates import now_local
from lib.db import db
from lib.qr import parse_label


def _prev_month(m: str) -> str:
    y, mo = map(int, m.split("-"))
    return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"


async def expiring(member: dict, days: int = 3) -> list[dict]:
    """Labels counted this month or last month, not yet written off, expiring within `days` (expired included)."""
    today = now_local().date()
    cur = today.strftime("%Y-%m")
    q: dict = {"month": {"$in": [cur, _prev_month(cur)]}, "qr_code": {"$nin": [None, ""]}, "deleted": {"$ne": True}}
    from lib.sectors import SECTORS, op_sectors
    ops = op_sectors(member)
    if set(ops) != set(SECTORS):
        q["sector"] = {"$in": ops}
    entries: dict[str, dict] = {}
    async for e in db.count_entries.find(q, {"_id": 0}).sort("created_at", -1):
        entries.setdefault(e["qr_code"], e)
    if not entries:
        return []
    limit = (today + timedelta(days=days)).isoformat()
    out = []
    async for lb in db.qr_labels.find({"code": {"$in": list(entries)}, "baixa": {"$ne": True}, "validade": {"$nin": [None, ""], "$lte": limit}}, {"_id": 0}):
        try:
            d = date.fromisoformat(lb["validade"][:10])
        except ValueError:
            continue
        e = entries[lb["code"]]
        out.append({"code": lb["code"], "item": lb["item"], "descricao": lb["descricao"], "validade": d.isoformat(),
                    "dias": (d - today).days, "sector": e.get("sector") or "Estoque", "qty": e.get("qty") or lb.get("qty") or 0,
                    "um": lb.get("um") or e.get("um") or "", "label_id": parse_label(lb.get("raw", ""))["label_id"]})
    out.sort(key=lambda a: (a["dias"], a["sector"]))
    return out
