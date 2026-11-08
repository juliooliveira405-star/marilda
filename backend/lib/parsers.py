"""Spreadsheet/CSV parsing with header auto-detection for each data kind."""

import csv
import io
import re
import unicodedata
from datetime import date, datetime, timedelta
from typing import Any, Optional

import openpyxl

MONTHS_PT = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
}
MONTH_LABELS = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def norm(v: Any) -> str:
    s = "" if v is None else str(v)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.strip().lower())


def month_label(month: str) -> str:
    y, m = month.split("-")
    return f"{MONTH_LABELS[int(m)]}/{y[2:]}"


def to_float(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if not s or s in "-.,":
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def to_date(v: Any) -> Optional[date]:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and 30000 < v < 60000:  # Excel serial
        return date(1899, 12, 30) + timedelta(days=int(v))
    s = str(v).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(s[:19] if "%H" in fmt else s[:10], fmt).date()
        except ValueError:
            continue
    return None


def month_from_text(text: str) -> Optional[str]:
    """'Contagem Jul-26', 'Out/26*', 'julho 2026', '2026-07', 'MES 08.26' -> 'YYYY-MM'."""
    s = norm(text)
    m = re.search(r"(20\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    m = re.search(r"\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*[\s/\-.]*(\d{2,4})", s)
    if m:
        y = m.group(2)
        y = f"20{y}" if len(y) == 2 else y
        return f"{y}-{MONTHS_PT[m.group(1)]:02d}"
    m = re.search(r"\b(\d{2})[./](\d{2})\b", s)
    if m and 1 <= int(m.group(1)) <= 12:
        return f"20{m.group(2)}-{m.group(1)}"
    return None


# ---------- table loading ----------
def load_tables(content: bytes, filename: str) -> list[tuple[str, list[list]]]:
    name = filename.lower()
    if name.endswith((".xlsx", ".xlsm")):
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
        out = []
        for ws in wb.worksheets:
            rows = [list(r) for r in ws.iter_rows(values_only=True)]
            out.append((ws.title, rows))
        return out
    if name.endswith((".csv", ".txt")):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
        try:
            dialect = csv.Sniffer().sniff(text[:4000], delimiters=";,\t")
            delim = dialect.delimiter
        except csv.Error:
            delim = ";" if text.count(";") > text.count(",") else ","
        return [(filename, [row for row in csv.reader(io.StringIO(text), delimiter=delim)])]
    raise ValueError("Formato não suportado. Use .xlsx, .csv ou .pdf")


def tables_to_csv_text(tables: list[tuple[str, list[list]]], max_rows: int = 2500) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    n = 0
    for title, rows in tables:
        w.writerow([f"### ABA: {title}"])
        for r in rows:
            if all(c is None or c == "" for c in r):
                continue
            w.writerow(["" if c is None else c for c in r])
            n += 1
            if n >= max_rows:
                return buf.getvalue()
    return buf.getvalue()


# ---------- header detection ----------
SPECS: dict[str, dict] = {
    "compras": {
        "fields": {
            "data": ["data emissao", "data de emissao", "data entrada", "data", "emissao", "dt"],
            "razao_social": ["razao social", "razao"],
            "fornecedor": ["fornecedor", "nome fantasia", "emitente"],
            "valor": ["valor (r$)", "valor total", "valor nota", "valor", "total"],
            "numero": ["numero", "n nota", "nota", "nf", "documento"],
            "serie": ["serie"],
        },
        "required": [["data"], ["valor"], ["fornecedor", "razao_social"]],
    },
    "inventario": {
        "fields": {
            "item": ["item", "codigo", "cod. item", "cod"],
            "descricao": ["descricao", "produto", "nome"],
            "um": ["um", "unidade", "und", "un"],
            "qty": ["q. estoque", "q estoque", "qtd estoque", "quantidade", "qtd", "qtde", "saldo", "estoque"],
            "ggrupo": ["ggrupo"],
            "sgrupo": ["sgrupo", "subgrupo"],
            "grupo": ["grupo", "categoria"],
        },
        "required": [["qty"], ["item", "descricao"]],
    },
    "custos": {
        "fields": {
            "item": ["item", "codigo", "cod"],
            "descricao": ["descricao", "produto", "nome"],
            "grupo": ["grupo", "categoria"],
            "custo": ["v. custo medio", "custo medio", "custo unitario", "v. custo", "custo unit", "custo"],
        },
        "required": [["custo"], ["item", "descricao"]],
    },
    "faturamento": {
        "fields": {
            "data": ["data", "dia"],
            "mes": ["mes", "competencia", "periodo"],
            "valor": ["realizado total", "realizado", "faturamento r$", "faturamento", "vendas", "venda", "valor", "total"],
        },
        "required": [["valor"], ["data", "mes"]],
    },
}


def _match_header(cells: list[str], fields: dict[str, list[str]]) -> dict[str, int]:
    used: set[int] = set()
    colmap: dict[str, int] = {}
    for exact in (True, False):
        for field, cands in fields.items():
            if field in colmap:
                continue
            for cand in cands:
                hit = None
                for i, c in enumerate(cells):
                    if i in used or not c:
                        continue
                    if (exact and c == cand) or (not exact and len(cand) > 3 and cand in c):
                        hit = i
                        break
                if hit is not None:
                    colmap[field] = hit
                    used.add(hit)
                    break
    return colmap


def find_header(rows: list[list], kind: str) -> tuple[int, dict[str, int]] | None:
    spec = SPECS[kind]
    for idx, row in enumerate(rows[:20]):
        cells = [norm(c) for c in row]
        colmap = _match_header(cells, spec["fields"])
        if all(any(f in colmap for f in group) for group in spec["required"]):
            return idx, colmap
    return None


def _cell(row: list, colmap: dict[str, int], field: str):
    i = colmap.get(field)
    return row[i] if i is not None and i < len(row) else None


def _code(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


# ---------- per-kind row extraction ----------
def parse_kind(tables: list[tuple[str, list[list]]], kind: str) -> list[dict]:
    out: list[dict] = []
    for title, rows in tables:
        found = find_header(rows, kind)
        if not found:
            continue
        hidx, cm = found
        for row in rows[hidx + 1:]:
            rec = _row_to_record(kind, row, cm, title)
            if rec:
                out.append(rec)
    return out


def _row_to_record(kind: str, row: list, cm: dict[str, int], title: str) -> Optional[dict]:
    if kind == "compras":
        d = to_date(_cell(row, cm, "data"))
        valor = to_float(_cell(row, cm, "valor"))
        forn = str(_cell(row, cm, "fornecedor") or _cell(row, cm, "razao_social") or "").strip()
        if not d or valor is None or not forn or norm(forn) in ("total", "subtotal"):
            return None
        return {
            "date": d.isoformat(), "month": d.strftime("%Y-%m"), "fornecedor": forn.upper(),
            "razao_social": str(_cell(row, cm, "razao_social") or "").strip(),
            "numero": _code(_cell(row, cm, "numero")), "serie": _code(_cell(row, cm, "serie")),
            "valor": round(valor, 2),
        }
    if kind == "inventario":
        qty = to_float(_cell(row, cm, "qty"))
        item = _code(_cell(row, cm, "item"))
        desc = str(_cell(row, cm, "descricao") or "").strip()
        if qty is None or not (item or desc) or norm(desc).startswith("total"):
            return None
        return {
            "item": item or norm(desc), "descricao": desc, "um": str(_cell(row, cm, "um") or "").strip(),
            "qty": qty, "ggrupo": str(_cell(row, cm, "ggrupo") or "").strip(),
            "grupo": str(_cell(row, cm, "grupo") or "").strip(), "sgrupo": str(_cell(row, cm, "sgrupo") or "").strip(),
        }
    if kind == "custos":
        custo = to_float(_cell(row, cm, "custo"))
        item = _code(_cell(row, cm, "item"))
        desc = str(_cell(row, cm, "descricao") or "").strip()
        if custo is None or custo < 0 or not (item or desc):
            return None
        return {"item": item or norm(desc), "descricao": desc, "grupo": str(_cell(row, cm, "grupo") or "").strip(), "custo": custo}
    if kind == "faturamento":
        valor = to_float(_cell(row, cm, "valor"))
        if valor is None or valor <= 0:
            return None
        d = to_date(_cell(row, cm, "data"))
        raw_mes = _cell(row, cm, "mes")
        month = d.strftime("%Y-%m") if d else (month_from_text(str(raw_mes)) if raw_mes else None)
        if not month:
            raw = _cell(row, cm, "data")
            month = month_from_text(str(raw)) if raw else None
        if not month:
            return None
        parcial = "*" in str(raw_mes or _cell(row, cm, "data") or "")
        return {"month": month, "valor": valor, "parcial": parcial, "ate": d.isoformat() if d else None}
    return None


def aggregate_faturamento(rows: list[dict]) -> list[dict]:
    agg: dict[str, dict] = {}
    for r in rows:
        a = agg.setdefault(r["month"], {"month": r["month"], "valor": 0.0, "parcial": False, "ate": None})
        a["valor"] += r["valor"]
        a["parcial"] = a["parcial"] or r.get("parcial", False)
        if r.get("ate") and (a["ate"] is None or r["ate"] > a["ate"]):
            a["ate"] = r["ate"]
    return list(agg.values())


# ---------- full Madrila/Locale analysis workbook ----------
def parse_full_workbook(tables: list[tuple[str, list[list]]]) -> dict:
    """Recognises the analysis workbook layout (Tabela de Custos, Contagem <Mês>, Dados Brutos Compras, Resumo)."""
    result: dict = {"custos": [], "inventario": {}, "compras": [], "faturamento": []}
    for title, rows in tables:
        t = norm(title)
        if "custo" in t and "tabela" in t:
            result["custos"] += parse_kind([(title, rows)], "custos")
        elif t.startswith("contagem") or t.startswith("inventario"):
            month = month_from_text(title)
            if month:
                result["inventario"][month] = parse_kind([(title, rows)], "inventario")
        elif "compras" in t and ("bruto" in t or "notas" in t):
            result["compras"] += parse_kind([(title, rows)], "compras")
        elif t.startswith("resumo"):
            result["faturamento"] += _parse_resumo_faturamento(rows)
    return result


def _parse_resumo_faturamento(rows: list[list]) -> list[dict]:
    out = []
    for i, row in enumerate(rows):
        cells = [norm(c) for c in row]
        if "faturamento r$" in cells:
            col = cells.index("faturamento r$")
            for nxt in rows[i + 1:]:
                label = next((c for c in nxt[:col] if c), None)
                val = to_float(nxt[col]) if col < len(nxt) else None
                if not label or val is None:
                    break
                month = month_from_text(str(label))
                if month:
                    status = " ".join(norm(c) for c in nxt[col + 1:] if c)
                    out.append({"month": month, "valor": val, "parcial": "*" in str(label) or "ate" in status})
            break
    return out
