"""Flexible QR label parsing (Suflex and generic): JSON, URL params, key:value text, or free text."""

import difflib
import hashlib
import json
import re
from urllib.parse import parse_qsl, urlparse

from lib.parsers import norm, to_date, to_float

KEY_MAP = {
    "produto": "produto", "nome": "produto", "item": "produto", "descricao": "produto", "insumo": "produto", "product": "produto",
    "peso": "peso", "peso liquido": "peso", "qtd": "peso", "quantidade": "peso", "qty": "peso", "weight": "peso", "liquido": "peso",
    "un": "um", "unidade": "um", "um": "um", "unit": "um",
    "lote": "lote", "lot": "lote", "batch": "lote",
    "validade": "validade", "val": "validade", "venc": "validade", "vencimento": "validade", "expira": "validade", "validade apos manipulacao": "validade",
    "fabricacao": "fabricacao", "fab": "fabricacao", "manipulacao": "fabricacao", "data de manipulacao": "fabricacao", "manip": "fabricacao",
    "id": "label_id", "etiqueta": "label_id", "codigo": "label_id", "code": "label_id", "uuid": "label_id", "tag": "label_id",
}
WEIGHT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|lt|ml|un|und|unid)\b", re.I)
DATE_RE = re.compile(r"\b(\d{2}/\d{2}/\d{2,4}|\d{4}-\d{2}-\d{2})\b")


def label_code(raw: str) -> str:
    """Identity of a physical label: its printed/encoded ID (e.g. Suflex #F35747) when present, else the raw content."""
    lid = re.sub(r"[^A-Z0-9]", "", str(parse_label(raw)["label_id"]).upper())
    key = f"id:{lid}" if len(lid) >= 4 else raw.strip()
    return hashlib.sha1(key.encode()).hexdigest()[:20]


def _iso(v: str) -> str:
    d = to_date(v)
    return d.isoformat() if d else str(v or "").strip()


def _apply_unit(value: float | None, unit: str) -> tuple[float | None, str]:
    u = unit.lower()
    if value is None:
        return None, unit.upper()
    if u in ("kg", "l", "lt") and value >= 100 and float(value).is_integer():
        value = round(value / 1000, 4)  # Suflex prints "1500 kg" for 1,500 kg (no decimal separator)
    if u in ("g", "gr"):
        return round(value / 1000, 4), "KG"
    if u == "ml":
        return round(value / 1000, 4), "LITRO"
    if u in ("l", "lt"):
        return value, "LITRO"
    if u in ("un", "und", "unid"):
        return value, "UNID"
    return value, u.upper()


def parse_label(raw: str) -> dict:
    s = raw.strip()
    kv: dict[str, str] = {}
    try:
        data = json.loads(s)
        if isinstance(data, dict):
            kv = {norm(k): str(v) for k, v in data.items() if v is not None}
    except (ValueError, TypeError):
        pass
    out = {"produto": "", "peso": None, "um": "", "lote": "", "validade": "", "fabricacao": "", "label_id": ""}
    if not kv and s.lower().startswith(("http://", "https://")):
        u = urlparse(s)
        kv = {norm(k): v for k, v in parse_qsl(u.query)}
        seg = [p for p in u.path.split("/") if p]
        if seg:
            out["label_id"] = seg[-1]
    if not kv:
        for m in re.finditer(r"([A-Za-zÀ-ÿ .]{2,30})\s*[:=]\s*([^;|\n\r]+)", s):
            kv[norm(m.group(1))] = m.group(2).strip()
    for k, v in kv.items():
        field = KEY_MAP.get(k) or next((f for key, f in KEY_MAP.items() if len(key) > 3 and key in k), None)
        if field and not out.get(field):
            out[field] = v
    # weight with unit, e.g. "1,250 kg" either in the peso field or anywhere in the text
    wsrc = str(out["peso"] or "") or s
    wm = WEIGHT_RE.search(wsrc) or WEIGHT_RE.search(s)
    if wm:
        out["peso"], out["um"] = _apply_unit(to_float(wm.group(1)), out["um"] or wm.group(2))
    elif out["peso"] is not None:
        out["peso"] = to_float(out["peso"])
    if not out["validade"] or not out["fabricacao"]:
        dates = sorted({_iso(d) for d in DATE_RE.findall(s)})
        if dates and not out["validade"]:
            out["validade"] = dates[-1]
        if len(dates) > 1 and not out["fabricacao"]:
            out["fabricacao"] = dates[0]
    out["validade"] = _iso(out["validade"]) if out["validade"] else ""
    out["fabricacao"] = _iso(out["fabricacao"]) if out["fabricacao"] else ""
    if not out["produto"] and not kv:
        # free text: first line without digits-only content is the product name
        first = next((ln.strip() for ln in s.splitlines() if re.search(r"[A-Za-zÀ-ÿ]{3,}", ln)), "")
        if first and not first.lower().startswith("http"):
            out["produto"] = WEIGHT_RE.sub("", DATE_RE.sub("", first)).strip(" -|;")[:120]
    out["um"] = str(out["um"] or "").upper()
    return out


def suggest(produto: str, catalog: list[dict], limit: int = 6) -> list[dict]:
    q = norm(produto)
    if not q:
        return []
    tokens = [t for t in q.split() if len(t) > 2]
    scored = []
    for c in catalog:
        d = norm(c["descricao"])
        score = difflib.SequenceMatcher(None, q, d).ratio()
        if tokens:
            score += 0.6 * sum(1 for t in tokens if t in d) / len(tokens)
        if q == norm(c["item"]):
            score += 2
        scored.append((score, c))
    scored.sort(key=lambda x: -x[0])
    return [c for s, c in scored[:limit] if s > 0.35]
