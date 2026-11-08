"""All spreadsheet math: monthly CMV, ABC suppliers, reorder suggestion, alerts."""

import calendar
from collections import defaultdict
from typing import Optional

from lib.dates import now_local
from lib.db import db
from lib.parsers import month_label

DEFAULT_SETTINGS = {"empresa": "Locale POA", "cmv_meta_min": 0.28, "cmv_meta_max": 0.30}


async def get_settings() -> dict:
    doc = await db.settings.find_one({"_id": "global"}) or {}
    return {k: doc.get(k, v) for k, v in DEFAULT_SETTINGS.items()}


async def cost_map() -> dict[str, float]:
    return {c["item"]: c["custo"] async for c in db.costs.find({}, {"_id": 0, "item": 1, "custo": 1})}


def _br(d: Optional[str]) -> str:
    return f"{d[8:10]}/{d[5:7]}" if d else ""


def _month_range(months: set[str], current: str) -> list[str]:
    """Continuous month list from the first month with data up to the current month."""
    if not months:
        return [current]
    out, m = [], min(months | {current})
    last = max(months | {current})
    while m <= last:
        out.append(m)
        m = _next_month(m)
    return out


def completeness(month: str, notas: int, last_date: Optional[str], has_inv: bool, per: dict) -> dict:
    y, mo = map(int, month.split("-"))
    days = calendar.monthrange(y, mo)[1]
    month_end = f"{month}-{days:02d}"
    near_end = f"{month}-{max(days - 3, 1):02d}"
    estoque_ate = per.get("estoque_ate")
    fat_ate = per.get("faturamento_ate")
    inv_final = has_inv and (not estoque_ate or estoque_ate >= f"{month}-{max(days - 2, 1):02d}")
    fat = per.get("faturamento")
    fat_ok = bool(fat) and not per.get("faturamento_parcial") and (not fat_ate or fat_ate >= month_end)
    override = per.get("compras_completas")
    compras_ok = notas > 0 and (override if override is not None else bool(last_date and last_date >= near_end))
    pend = []
    if not inv_final:
        pend.append("inventário de fechamento")
    if not compras_ok:
        pend.append("compras")
    if not fat_ok:
        pend.append("faturamento")
    alerta = None
    if pend:
        label = month_label(month)
        parts = []
        if has_inv:
            parts.append(f"estoque até {_br(estoque_ate)}" if estoque_ate else ("estoque contado" if inv_final else "contagem parcial"))
        if notas:
            parts.append(f"compras até {_br(last_date)}")
        if fat:
            parts.append(f"faturamento até {_br(fat_ate)}" if fat_ate else ("faturamento parcial" if not fat_ok else "faturamento completo"))
        missing = [p for p, ok in (("inventário de fechamento", has_inv), ("compras", notas > 0), ("faturamento", bool(fat))) if not ok]
        if not parts:
            alerta = f"{label} incompleto — aguardando inventário de fechamento, compras e faturamento do mês."
        else:
            alerta = f"{label} incompleto — " + " · ".join(parts)
            if missing:
                alerta += " · aguardando " + ", ".join(missing)
            alerta += ". CMV % é parcial até o fechamento."
    return {
        "inventario_final": inv_final, "faturamento_completo": fat_ok, "compras_completas": compras_ok,
        "pendencias": pend, "alerta_parcial": alerta, "status": "fechado" if not pend else "aberto",
        "estoque_ate": estoque_ate, "faturamento_ate": fat_ate, "compras_ate": last_date,
    }


async def compute_months() -> list[dict]:
    costs = await cost_map()
    purchases = await db.purchases.aggregate([
        {"$group": {"_id": "$month", "total": {"$sum": "$valor"}, "notas": {"$sum": 1},
                    "forn": {"$addToSet": "$fornecedor"}, "last": {"$max": "$date"}}},
    ]).to_list(None)
    pmap = {p["_id"]: p for p in purchases}

    inv: dict[str, dict] = defaultdict(lambda: {"itens": 0, "com": 0, "val": 0, "valor": 0.0})
    async for r in db.inventory.find({}, {"_id": 0, "month": 1, "item": 1, "qty": 1}):
        m = inv[r["month"]]
        m["itens"] += 1
        q = r.get("qty") or 0
        if q > 0:
            m["com"] += 1
            c = costs.get(r["item"])
            if c is not None:
                m["val"] += 1
                m["valor"] += q * c

    periods = {p["month"]: p async for p in db.periods.find({}, {"_id": 0})}
    current = now_local().strftime("%Y-%m")
    data_months = set(pmap) | set(inv) | {m for m, p in periods.items() if p.get("faturamento")}
    months = _month_range(data_months, current)

    out: list[dict] = []
    prev_stock: Optional[float] = None
    prev_month: Optional[str] = None
    for month in months:
        p = pmap.get(month, {})
        per = periods.get(month, {})
        compras = round(p.get("total", 0.0), 2)
        notas = p.get("notas", 0)
        inv_m = inv.get(month)
        estoque = round(inv_m["valor"], 2) if inv_m else None
        comp = completeness(month, notas, p.get("last"), inv_m is not None, per)

        y, mo = map(int, month.split("-"))
        days = calendar.monthrange(y, mo)[1]
        last_day = int(p["last"][8:10]) if p.get("last") else None
        projecao = None
        if not comp["compras_completas"] and last_day and last_day < days:
            projecao = round(compras * days / last_day, 2)

        consecutive = prev_month is not None and _next_month(prev_month) == month
        ei = prev_stock if consecutive else None
        cmv = round(ei + compras - estoque, 2) if (ei is not None and estoque is not None and notas) else None
        fat = per.get("faturamento")
        cmv_pct = round(cmv / fat, 4) if (cmv is not None and fat) else None

        out.append({
            "month": month, "label": month_label(month),
            "compras": compras, "notas": notas, "ticket_medio": round(compras / notas, 2) if notas else 0,
            "fornecedores": len(p.get("forn", [])), "compras_ate_dia": last_day if not comp["compras_completas"] else None,
            "compras_projecao": projecao, "faturamento": fat, "faturamento_parcial": bool(per.get("faturamento_parcial")),
            "itens_inventario": inv_m["itens"] if inv_m else 0, "itens_com_estoque": inv_m["com"] if inv_m else 0,
            "itens_valorizados": inv_m["val"] if inv_m else 0, "estoque_valor": estoque, "estoque_inicial": ei,
            "cmv": cmv, "cmv_pct": cmv_pct, "obs": per.get("obs", ""), **comp,
        })
        prev_stock, prev_month = estoque, month
    return out


def _next_month(m: str) -> str:
    y, mo = map(int, m.split("-"))
    return f"{y + (mo == 12)}-{(mo % 12) + 1:02d}"


async def compute_suppliers() -> dict:
    rows = await db.purchases.aggregate([
        {"$group": {"_id": {"f": "$fornecedor", "m": "$month"}, "total": {"$sum": "$valor"}, "n": {"$sum": 1},
                    "min": {"$min": "$valor"}, "max": {"$max": "$valor"}, "first": {"$min": "$date"}, "last": {"$max": "$date"}}},
    ]).to_list(None)
    agg: dict[str, dict] = {}
    months: set[str] = set()
    for r in rows:
        f, m = r["_id"]["f"], r["_id"]["m"]
        months.add(m)
        a = agg.setdefault(f, {"total": 0.0, "n": 0, "min": float("inf"), "max": 0.0, "first": "9999", "last": "", "por_mes": {}})
        a["total"] += r["total"]
        a["n"] += r["n"]
        a["min"] = min(a["min"], r["min"])
        a["max"] = max(a["max"], r["max"])
        a["first"] = min(a["first"], r["first"])
        a["last"] = max(a["last"], r["last"])
        a["por_mes"][m] = round(a["por_mes"].get(m, 0) + r["total"], 2)
    grand = sum(a["total"] for a in agg.values()) or 1
    ordered = sorted(agg.items(), key=lambda kv: -kv[1]["total"])
    acc = 0.0
    suppliers = []
    counts = {"A": 0, "B": 0, "C": 0}
    totals = {"A": 0.0, "B": 0.0, "C": 0.0}
    for i, (f, a) in enumerate(ordered, 1):
        pct = a["total"] / grand
        prev_acc = acc
        acc += pct
        classe = "A" if prev_acc < 0.80 else ("B" if prev_acc < 0.95 else "C")
        counts[classe] += 1
        totals[classe] += a["total"]
        suppliers.append({
            "rank": i, "fornecedor": f, "total": round(a["total"], 2), "pct": round(pct, 4), "acumulado": round(acc, 4),
            "classe": classe, "frequencia": a["n"], "media_nota": round(a["total"] / a["n"], 2),
            "menor_nota": round(a["min"], 2), "maior_nota": round(a["max"], 2),
            "primeira": a["first"], "ultima": a["last"], "por_mes": a["por_mes"],
        })
    return {"months": sorted(months), "total": round(grand if agg else 0, 2), "suppliers": suppliers,
            "classe_counts": counts, "classe_totals": {k: round(v, 2) for k, v in totals.items()}}


SUGESTOES = {
    "ZERADO": "Priorizar reposição",
    "BAIXOU FORTE": "Revisar pedido",
    "BAIXOU": "Acompanhar / repor lote padrão",
    "ESTÁVEL": "Sem ação",
    "SUBIU": "Sem necessidade de compra",
    "SUBIU MUITO": "Checar sobreestoque",
    "NOVO": "Item novo/entrada — validar",
}
STATUS_ORDER = list(SUGESTOES)


def classify(ant: float, atu: float) -> tuple[str, float, float]:
    var = atu - ant
    pct = (var / ant * 100) if ant > 0 else (100.0 if atu > 0 else 0.0)
    if ant > 0 and atu <= 0:
        s = "ZERADO"
    elif ant <= 0 and atu > 0:
        s = "NOVO"
    elif abs(var) < 1e-9:
        s = "ESTÁVEL"
    elif var < 0:
        s = "BAIXOU FORTE" if (pct <= -40 and var <= -2) else "BAIXOU"
    else:
        s = "SUBIU MUITO" if (pct >= 50 and var >= 5) else "SUBIU"
    return s, var, pct


async def compute_reorder(from_month: Optional[str] = None, to_month: Optional[str] = None, sector: Optional[str] = None) -> dict:
    from lib.sectors import item_sector
    inv_months = sorted(await db.inventory.distinct("month"))
    if not to_month and inv_months:
        to_month = inv_months[-1]
    if not from_month and to_month:
        earlier = [m for m in inv_months if m < to_month]
        from_month = earlier[-1] if earlier else None
    counts = {s: 0 for s in STATUS_ORDER}
    if not from_month or not to_month:
        return {"from_month": from_month, "to_month": to_month, "counts": counts, "valor_reposicao_total": 0, "items": []}
    costs = await cost_map()
    a = {r["item"]: r async for r in db.inventory.find({"month": from_month}, {"_id": 0})}
    b = {r["item"]: r async for r in db.inventory.find({"month": to_month}, {"_id": 0})}
    items = []
    total_rep = 0.0
    for code in list(a) + [k for k in b if k not in a]:
        ra, rb = a.get(code), b.get(code)
        ref = rb or ra
        ant = (ra or {}).get("qty", 0) or 0
        atu = (rb or {}).get("qty", 0) or 0
        setor = item_sector(ref.get("ggrupo", ""), ref.get("grupo", ""), ref.get("sgrupo", ""))
        if sector and setor != sector:
            continue
        status, var, pct = classify(ant, atu)
        custo = costs.get(code)
        rep = round(max(0.0, ant - max(atu, 0)) * custo, 2) if (custo and status in ("ZERADO", "BAIXOU FORTE")) else 0.0
        total_rep += rep
        counts[status] += 1
        items.append({
            "item": code, "descricao": ref.get("descricao", ""), "um": ref.get("um", ""),
            "grupo": ref.get("sgrupo") or ref.get("grupo", ""), "qtd_anterior": round(ant, 3), "qtd_atual": round(atu, 3),
            "variacao": round(var, 3), "var_pct": round(pct, 1), "status": status, "sugestao": SUGESTOES[status],
            "custo": round(custo, 4) if custo is not None else None, "valor_reposicao": rep, "setor": setor,
        })
    items.sort(key=lambda x: (STATUS_ORDER.index(x["status"]), -x["valor_reposicao"], x["variacao"]))
    return {"from_month": from_month, "to_month": to_month, "counts": counts, "sector": sector,
            "valor_reposicao_total": round(total_rep, 2), "items": items}


def _brl(v: float) -> str:
    return "R$ " + f"{v:,.0f}".replace(",", ".")


def _pct(v: float) -> str:
    return f"{v * 100:.1f}%".replace(".", ",")


def build_alerts(months: list[dict], settings: dict, suppliers: dict, reorder: dict, costs_count: int) -> list[dict]:
    alerts: list[dict] = []
    mx, mn = settings["cmv_meta_max"], settings["cmv_meta_min"]
    for m in months:
        if m["cmv_pct"] is None:
            continue
        pct = m["cmv_pct"]
        if pct > mx:
            excess = (pct - mx) * (m["faturamento"] or 0)
            alerts.append({"level": "danger", "title": f"CMV {m['label']} em {_pct(pct)} — acima da meta",
                           "detail": f"Excesso de {_brl(excess)} sobre a meta de {_pct(mx)}."
                                     + (" CMV parcial — mês ainda incompleto." if m["status"] != "fechado" else "")})
        elif pct < mn - 0.05:
            alerts.append({"level": "warning", "title": f"CMV {m['label']} muito abaixo da meta ({_pct(pct)})",
                           "detail": "Pode indicar inventário inicial incompleto ou compras não lançadas — confira os dados."})
        else:
            alerts.append({"level": "success", "title": f"CMV {m['label']} em {_pct(pct)}",
                           "detail": f"Dentro ou abaixo da faixa {mn*100:.0f}–{_pct(mx)}."})
    for m in months:
        if m["alerta_parcial"]:
            alerts.append({"level": "warning", "title": f"{m['label']} aberto / incompleto", "detail": m["alerta_parcial"]})
    for m in months:
        if m["notas"] and not m["faturamento"]:
            alerts.append({"level": "warning", "title": f"Faturamento de {m['label']} não lançado",
                           "detail": "Sem faturamento não é possível calcular o CMV %. Lance em Carregar Dados."})
        if m["itens_com_estoque"] and m["itens_valorizados"] < 0.9 * m["itens_com_estoque"]:
            falt = m["itens_com_estoque"] - m["itens_valorizados"]
            alerts.append({"level": "warning", "title": f"{falt} itens de {m['label']} sem custo — CMV pode estar subestimado",
                           "detail": "Envie o PDF/planilha de custos para valorizar 100% do estoque. Lista em Sugestão de Pedidos (coluna custo vazia)."})
    open_m = [m for m in months if m["compras_projecao"]]
    for m in open_m[-1:]:
        alerts.append({"level": "info", "title": f"Projeção de compras {m['label']}: {_brl(m['compras_projecao'])}",
                       "detail": f"Compras até o dia {m['compras_ate_dia']}: {_brl(m['compras'])} (projeção linear)."})
    if suppliers["suppliers"]:
        top = suppliers["suppliers"][0]
        if top["pct"] > 0.15:
            alerts.append({"level": "info", "title": f"{top['fornecedor']} concentra {_pct(top['pct'])} das compras",
                           "detail": "Alta dependência de um fornecedor: negocie preço/prazo ou busque alternativas."})
    if reorder["counts"].get("ZERADO"):
        alerts.append({"level": "danger" if reorder["counts"]["ZERADO"] > 20 else "warning",
                       "title": f"{reorder['counts']['ZERADO']} itens zerados no último inventário",
                       "detail": f"Reposição estimada (zerados + baixou forte): {_brl(reorder['valor_reposicao_total'])}."})
    if reorder["counts"].get("SUBIU MUITO"):
        alerts.append({"level": "info", "title": f"{reorder['counts']['SUBIU MUITO']} itens com possível sobreestoque",
                       "detail": "Estoque subiu muito entre os dois últimos inventários — evite novos pedidos desses itens."})
    if not costs_count:
        alerts.append({"level": "warning", "title": "Nenhum custo unitário cadastrado",
                       "detail": "Envie o inventário valorizado (PDF Everest) para calcular estoque e CMV."})
    order = {"danger": 0, "warning": 1, "info": 2, "success": 3}
    return sorted(alerts, key=lambda a: order[a["level"]])


async def dashboard() -> dict:
    settings = await get_settings()
    months = await compute_months()
    suppliers = await compute_suppliers()
    reorder = await compute_reorder()
    costs_count = await db.costs.count_documents({})
    last_cost = await db.costs.find_one({}, {"_id": 0, "ref": 1}, sort=[("ref", -1)])
    n_months = len([m for m in months if m["notas"]]) or 1
    with_cmv = [m for m in months if m["cmv_pct"] is not None]
    with_fat = [m for m in months if m["faturamento"]]
    return {
        "settings": settings,
        "months": months,
        "alerts": build_alerts(months, settings, suppliers, reorder, costs_count),
        "compras_total": round(sum(m["compras"] for m in months), 2),
        "notas_total": sum(m["notas"] for m in months),
        "custos_cadastrados": costs_count,
        "custos_ref": (last_cost or {}).get("ref", ""),
        "compras_classe_a_media": round(suppliers["classe_totals"]["A"] / n_months, 2),
        "faturamento_medio": round(sum(m["faturamento"] for m in with_fat) / len(with_fat), 2) if with_fat else None,
        "cmv_pct_medio": round(sum(m["cmv"] for m in with_cmv) / sum(m["faturamento"] for m in with_cmv), 4) if with_cmv else None,
    }


async def ai_context() -> str:
    d = await dashboard()
    s = await compute_suppliers()
    r = await compute_reorder()
    st = d["settings"]
    lines = [f"Restaurante: {st['empresa']}. Meta de CMV: {st['cmv_meta_min']*100:.0f}–{st['cmv_meta_max']*100:.0f}%.",
             "MESES (mês | status | compras | notas | faturamento | estoque final | estoque inicial | CMV R$ | CMV %):"]
    for m in d["months"]:
        def f(v):
            return "-" if v is None else f"{v:,.0f}"
        pct_s = "-" if m["cmv_pct"] is None else f"{m['cmv_pct'] * 100:.1f}%"
        parcial = " (fat. parcial)" if m["faturamento_parcial"] else ""
        proj = f" | compras até dia {m['compras_ate_dia']}, projeção {f(m['compras_projecao'])}" if m["compras_projecao"] else ""
        lines.append(f"{m['label']} | {m['status']}{parcial} | {f(m['compras'])} | {m['notas']} | "
                     f"{f(m['faturamento'])} | {f(m['estoque_valor'])} ({m['itens_valorizados']}/{m['itens_com_estoque']} itens valorizados) | "
                     f"{f(m['estoque_inicial'])} | {f(m['cmv'])} | {pct_s}{proj}")
    lines.append(f"FORNECEDORES: {len(s['suppliers'])} no total; classe A = {s['classe_counts']['A']} fornecedores ({_brl(s['classe_totals']['A'])}). Top 10:")
    for x in s["suppliers"][:10]:
        lines.append(f"{x['rank']}. {x['fornecedor']} {_brl(x['total'])} ({x['pct']*100:.1f}%), {x['frequencia']} notas, por mês: "
                     + ", ".join(f"{k}: {v:,.0f}" for k, v in sorted(x["por_mes"].items())))
    lines.append(f"ESTOQUE {r['from_month']} → {r['to_month']}: " + ", ".join(f"{k}: {v}" for k, v in r["counts"].items())
                 + f". Reposição estimada {_brl(r['valor_reposicao_total'])}. Principais itens a repor:")
    for it in [i for i in r["items"] if i["status"] in ("ZERADO", "BAIXOU FORTE")][:15]:
        lines.append(f"- {it['descricao']} ({it['status']}): {it['qtd_anterior']} → {it['qtd_atual']} {it['um']}, reposição {_brl(it['valor_reposicao'])}")
    lines.append("ALERTAS: " + " | ".join(a["title"] for a in d["alerts"][:10]))
    return "\n".join(lines)
