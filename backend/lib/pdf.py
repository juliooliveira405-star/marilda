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
