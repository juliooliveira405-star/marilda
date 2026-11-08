"""LLM helpers (Emergent universal key): PDF/spreadsheet extraction (Gemini) and insights."""

import json
import os
import re
import uuid
from typing import Optional

from emergentintegrations.llm.chat import FileContentWithMimeType, LlmChat, StreamDone, TextDelta, UserMessage

AI_MODELS = {
    "claude-sonnet-4.5": ("anthropic", "claude-sonnet-4-5-20250929", "Claude Sonnet 4.5", "Profundo & analítico"),
    "gemini-3-flash": ("gemini", "gemini-3-flash-preview", "Gemini 3 Flash", "Rápido & direto"),
    "gpt-5.2": ("openai", "gpt-5.2", "GPT-5.2", "Estratégico"),
}
EXTRACTION_MODEL = ("gemini", "gemini-3-flash-preview")

SCHEMAS = {
    "compras": '{"rows":[{"date":"YYYY-MM-DD","fornecedor":"NOME FANTASIA","razao_social":"","numero":"","serie":"","valor":0.0}]}',
    "inventario": '{"month":"YYYY-MM ou null","rows":[{"item":"codigo","descricao":"","um":"KG/UNID/LITRO","qty":0.0,"grupo":""}]}',
    "custos": '{"rows":[{"item":"codigo","descricao":"","grupo":"","custo":0.0}]}',
    "faturamento": '{"rows":[{"month":"YYYY-MM","valor":0.0,"parcial":false,"ate":"YYYY-MM-DD ou null"}]}',
}
KIND_HINTS = {
    "compras": "notas fiscais de compra / entradas de mercadoria. Uma linha por nota: data de emissão, fornecedor, número, valor total da nota.",
    "inventario": "contagem de inventário/estoque. Uma linha por item: código, descrição, unidade, quantidade em estoque, grupo.",
    "custos": "inventário valorizado (ex: Everest) com custo unitário médio. Uma linha por item: código, descrição, grupo/categoria e V. Custo Médio (custo unitário, NÃO o total).",
    "faturamento": "faturamento/vendas. Some por mês e devolva uma linha por mês com o valor total vendido (realizado); parcial=true se o mês não tem vendas até o último dia; ate = último dia com venda lançada.",
}


def _key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


async def _run(chat: LlmChat, message: UserMessage) -> str:
    parts: list[str] = []
    async for ev in chat.stream_message(message):
        if isinstance(ev, TextDelta):
            parts.append(ev.content)
        elif isinstance(ev, StreamDone):
            break
    return "".join(parts)


def _parse_json(text: str) -> dict:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("A IA não retornou dados estruturados")
    return json.loads(t[start:end + 1])


async def extract_rows(kind: str, file_path: str, mime: str) -> tuple[list[dict], Optional[str]]:
    """Ask Gemini to read a PDF/CSV and return rows for `kind`. Returns (rows, month_hint)."""
    chat = LlmChat(
        api_key=_key(),
        session_id=f"extract-{uuid.uuid4()}",
        system_message="Você extrai dados de documentos financeiros de restaurantes brasileiros e responde SOMENTE JSON válido.",
    ).with_model(*EXTRACTION_MODEL)
    prompt = (
        f"O arquivo anexo contém {KIND_HINTS[kind]}\n"
        f"Extraia TODAS as linhas e responda apenas com JSON neste formato exato: {SCHEMAS[kind]}\n"
        "Números com ponto decimal (ex: 1234.56), sem separador de milhar. Ignore linhas de total/subtotal e cabeçalhos repetidos."
    )
    text = await _run(chat, UserMessage(text=prompt, file_contents=[FileContentWithMimeType(file_path=file_path, mime_type=mime)]))
    data = _parse_json(text)
    return list(data.get("rows") or []), data.get("month")


async def generate_insight(model_key: str, context: str, focus: str, question: str) -> str:
    provider, model, _, _ = AI_MODELS[model_key]
    chat = LlmChat(
        api_key=_key(),
        session_id=f"insight-{uuid.uuid4()}",
        system_message=(
            "Você é um consultor sênior de custos para restaurantes (controladoria, CMV, compras e estoque). "
            "Responda em português do Brasil, direto ao ponto, com números em R$ no padrão brasileiro. "
            "Use markdown simples: títulos com ##, listas com -, negrito com **."
        ),
    ).with_model(provider, model)
    focus_text = {
        "geral": "Faça um diagnóstico geral do negócio.",
        "cmv": "Foque no CMV: causas de desvio da meta e como corrigir.",
        "fornecedores": "Foque nos fornecedores (curva ABC): concentração, negociação e riscos.",
        "estoque": "Foque no estoque: itens zerados, rupturas, sobreestoque e pedido sugerido.",
        "economia": "Foque em economia: quanto dá para economizar, em quanto tempo e com quais ações.",
    }[focus]
    prompt = (
        f"{focus_text}\n"
        + (f"Pergunta do usuário: {question}\n" if question else "")
        + "Estruture em: ## Diagnóstico, ## Alertas, ## Ações recomendadas (com impacto estimado em R$ e prazo), ## Próximos passos. "
        "Máximo ~450 palavras. Regras: meta de CMV 28–30%; meses marcados 'aberto/incompleto' têm CMV % PARCIAL — sempre ressalve; "
        "Jul/26 teve inventário consolidado com menos itens, o que distorce o CMV de Ago/26 — CMV baixo em Ago/Set NÃO é erro, trate com ressalva; "
        "nunca afirme que os dados estão errados sem dizer qual dado falta.\n\n"
        f"DADOS:\n{context}"
    )
    return (await _run(chat, UserMessage(text=prompt))).strip()
