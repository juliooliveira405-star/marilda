"""PDF documents (reportlab) — built server-side so the browser downloads a ready file."""

import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

STATUS_LABEL = {"rascunho": "Rascunho", "enviada": "Enviada", "aprovada": "Aprovada", "devolvida": "Devolvida p/ ajuste",
                "rejeitada": "Rejeitada", "em_preparo": "Em preparo", "pronto": "Pronto", "entregue": "Entregue",
                "comprada": "Comprada", "recebida": "Recebida", "excluida": "Excluída"}
AVAIL_LABEL = {"pendente": "—", "ok": "Disponível", "parcial": "Parcial", "sem_estoque": "Sem estoque"}


def _dt(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%d/%m/%Y %H:%M")
    except ValueError:
        return iso[:16]


def _num(v) -> str:
    return "—" if v is None else f"{v:,.3f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")


def _brl(v) -> str:
    return "—" if v is None else "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def requisition_pdf(r: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm,
                            title=f"Requisição {r['number']}")
    ss = getSampleStyleSheet()
    p = lambda t, st="BodyText": Paragraph(escape(str(t)), ss[st])  # noqa: E731 — user text is escaped, never markup
    approver = next((h for h in reversed(r["history"]) if h["action"].startswith("aprovada") or "aprovada" in h["action"]), None)
    show_cost = r.get("valor_total") is not None
    story = [
        p(f"Madrila ERP · Requisição Nº {r['number']}", "Title"),
        p(f"Setor: {r['sector']}   ·   Prioridade: {r['priority'].capitalize()}   ·   Status: {STATUS_LABEL.get(r['status'], r['status'])}"),
        p(f"Solicitante: {r['requested_by']}   ·   Criada em: {_dt(r['created_at'])}   ·   Atualizada: {_dt(r['updated_at'])}"),
    ]
    if r.get("note"):
        story.append(p(f"Observação: {r['note']}"))
    story.append(Spacer(1, 6 * mm))
    head = ["Item", "Descrição", "Qtd", "UM", "Atendido", "Disponib."] + (["Custo R$"] if show_cost else [])
    rows = [head]
    for ln in r["items"]:
        row = [ln["item"], Paragraph(escape(ln["descricao"]), ss["BodyText"]), _num(ln["qty"]), ln.get("um", ""),
               _num(ln.get("atendido")), AVAIL_LABEL.get(ln.get("disponibilidade", "pendente"), "—")]
        if show_cost:
            row.append(_brl((ln.get("custo") or 0) * ln["qty"]) if ln.get("custo") is not None else "—")
        rows.append(row)
    widths = [22 * mm, None, 18 * mm, 14 * mm, 20 * mm, 24 * mm] + ([24 * mm] if show_cost else [])
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F59E0B")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]))
    story += [t, Spacer(1, 4 * mm)]
    if show_cost:
        story.append(p(f"Valor total estimado: {_brl(r['valor_total'])}"))
    story += [Spacer(1, 6 * mm), p("Histórico", "Heading4")]
    for h in r["history"]:
        story.append(p(f"{_dt(h['at'])} · {h['user']} · {h['action']}" + (f" — “{h['comment']}”" if h.get("comment") else "")))
    story += [
        Spacer(1, 12 * mm),
        p(f"Aprovado por: {approver['user'] + ' em ' + _dt(approver['at']) if approver else '________________________'}"),
        Spacer(1, 10 * mm),
        p("Assinatura do aprovador: ______________________________      Recebido por: ______________________________"),
        Spacer(1, 8 * mm),
        p(f"Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')} · Madrila ERP · Locale POA", "Italic"),
    ]
    doc.build(story)
    return buf.getvalue()


def _pct(v) -> str:
    return "—" if v is None else f"{v * 100:.1f}%".replace(".", ",")


def _table(rows: list[list], widths: list | None = None, head_color: str = "#F59E0B") -> Table:
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(head_color)), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]))
    return t


STATUS_SHORT = {**STATUS_LABEL, "devolvida": "Devolvida"}


def monthly_report_pdf(d: dict) -> bytes:
    """One-click board report: CMV, estoque, setores, compras, requisições, reposição e validades of one month."""
    buf = io.BytesIO()
    m, st = d["month"], d["settings"]
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"Madrila ERP · Relatório {m['label']}")
    ss = getSampleStyleSheet()
    p = lambda t, s="BodyText": Paragraph(escape(str(t)), ss[s])  # noqa: E731
    meta = f"{st['cmv_meta_min'] * 100:.0f}–{st['cmv_meta_max'] * 100:.0f}%"
    pct = m.get("cmv_pct")
    situ = "—" if pct is None else ("na meta" if pct <= st["cmv_meta_max"] else "ACIMA da meta")
    story = [p(f"Madrila ERP · Relatório mensal {m['label']}", "Title"),
             p(f"{st.get('empresa', 'Locale POA')} · Status do mês: {'fechado' if m['status'] == 'fechado' else 'incompleto'} · gerado em {d['gerado']}")]
    if m.get("alerta_parcial"):
        story.append(p(m["alerta_parcial"], "Italic"))
    story += [Spacer(1, 4 * mm), p("1. CMV & Estoque", "Heading3"), _table([
        ["Faturamento", "Compras", "Est. inicial", "Est. final", "CMV R$", "CMV %", "Meta"],
        [_brl(m.get("faturamento")), _brl(m.get("compras")), _brl(m.get("estoque_inicial")), _brl(m.get("estoque_valor")),
         _brl(m.get("cmv")), _pct(pct), meta]]),
        p(f"CMV = Estoque Inicial + Compras − Estoque Final. Situação: {situ}. {m.get('notas', 0)} notas de {m.get('fornecedores', 0)} fornecedores; "
          f"{m.get('itens_valorizados', 0)} itens valorizados no inventário."), Spacer(1, 3 * mm)]
    if d["sectors"]:
        story += [p("2. CMV por setor", "Heading3"), _table(
            [["Setor", "Est. inicial", "Compras do setor", "Est. final", "CMV R$", "% do fat. total"]] +
            [[s["sector"], _brl(s["estoque_inicial"]), _brl(s["compras"]), _brl(s["estoque_valor"]), _brl(s["cmv"]), _pct(s["cmv_pct"])] for s in d["sectors"]]),
            p("Compras do setor = notas dos fornecedores atribuídos ao setor (Curva ABC)."), Spacer(1, 3 * mm)]
    if d["top"]:
        story += [p("3. Top 10 fornecedores do mês", "Heading3"), _table(
            [["Fornecedor", "Setor", "Notas", "Total"]] +
            [[Paragraph(escape(t["fornecedor"]), ss["BodyText"]), t["sector"] or "sem setor", str(t["notas"]), _brl(t["total"])] for t in d["top"]],
            [None, 26 * mm, 16 * mm, 30 * mm]), Spacer(1, 3 * mm)]
    story.append(p("4. Requisições dos setores", "Heading3"))
    if d["req_total"]:
        story.append(p(f"{d['req_total']} requisições ({d['req_urgentes']} urgentes). Por status: "
                       + ", ".join(f"{STATUS_SHORT.get(k, k)} {v}" for k, v in d["req_status"].most_common())
                       + ". Por setor: " + ", ".join(f"{k} {v}" for k, v in d["req_sector"].most_common()) + "."))
        if d["falta"]:
            story.append(_table([["Itens mais pedidos sem estoque / parciais", "Vezes"]] + [[Paragraph(escape(n), ss["BodyText"]), str(c)] for n, c in d["falta"]],
                                [None, 20 * mm], "#FCA5A5"))
    else:
        story.append(p("Nenhuma requisição registrada no mês."))
    story.append(Spacer(1, 3 * mm))
    r = d["reorder"]
    if r:
        c = r["counts"]
        story += [p("5. Reposição (comparação de inventários)", "Heading3"),
                  p(f"{r['from_month']} → {r['to_month']}: " + ", ".join(f"{k} {v}" for k, v in c.items())
                    + (f". Reposição estimada (zerados + baixou forte): {_brl(r.get('valor_reposicao_total'))}." if r.get("valor_reposicao_total") else "."))]
        zer = sorted([i for i in r["items"] if i["status"] == "ZERADO"], key=lambda i: -(i.get("valor_reposicao") or 0))[:10]
        if zer:
            story.append(_table([["Zerados prioritários", "Antes", "Reposição"]] +
                                [[Paragraph(escape(i["descricao"]), ss["BodyText"]), _num(i["qtd_anterior"]), _brl(i.get("valor_reposicao"))] for i in zer],
                                [None, 22 * mm, 30 * mm]))
        story.append(Spacer(1, 3 * mm))
    story.append(p("6. Validades (próximos 7 dias)", "Heading3"))
    if d["validades"]:
        story.append(_table([["Produto", "Setor", "Qtd", "Validade", "Dias"]] +
                            [[Paragraph(escape(v["descricao"]), ss["BodyText"]), v["sector"], f"{_num(v['qty'])} {v['um']}",
                              v["validade"][8:10] + "/" + v["validade"][5:7], "vencido" if v["dias"] < 0 else str(v["dias"])] for v in d["validades"][:20]],
                            [None, 24 * mm, 22 * mm, 20 * mm, 16 * mm], "#FDE68A"))
    else:
        story.append(p("Nenhuma etiqueta lida vencendo nos próximos 7 dias."))
    story += [Spacer(1, 8 * mm), p("Madrila ERP · Idealizado e criado por Julio Acauã · documento interno da diretoria", "Italic")]
    doc.build(story)
    return buf.getvalue()
