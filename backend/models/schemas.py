"""Pydantic models — each mirrored by a TS interface in frontend/src/lib/types.ts."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------- users / settings ----------
class Me(BaseModel):
    user_id: str
    email: str = ""
    name: str = ""
    role: str
    role_label: str


class UserRow(BaseModel):
    user_id: str
    email: str = ""
    name: str = ""
    role: str
    role_label: str


class RoleOption(BaseModel):
    value: str
    label: str


class UsersResponse(BaseModel):
    roles: list[RoleOption]
    users: list[UserRow]


class RoleIn(BaseModel):
    role: str


class Settings(BaseModel):
    empresa: str = "Locale POA"
    cmv_meta_min: float = Field(0.28, ge=0, le=1)
    cmv_meta_max: float = Field(0.30, ge=0, le=1)


# ---------- periods / uploads ----------
class Period(BaseModel):
    month: str
    faturamento: Optional[float] = None
    faturamento_parcial: bool = False
    status: Literal["aberto", "fechado"] = "aberto"
    obs: str = ""


class PeriodIn(BaseModel):
    faturamento: Optional[float] = Field(None, ge=0)
    faturamento_parcial: bool = False
    status: Literal["aberto", "fechado"] = "aberto"
    obs: str = ""


class Upload(BaseModel):
    id: str
    kind: str
    filename: str
    month: Optional[str] = None
    status: Literal["processando", "concluido", "erro", "desfeito"]
    rows: int = 0
    message: str = ""
    ai_used: bool = False
    undoable: bool = False
    user_email: str = ""
    created_at: str


# ---------- analytics ----------
class MonthRow(BaseModel):
    month: str
    label: str
    status: str
    compras: float
    notas: int
    ticket_medio: float
    fornecedores: int
    compras_ate_dia: Optional[int] = None
    compras_projecao: Optional[float] = None
    faturamento: Optional[float] = None
    faturamento_parcial: bool = False
    itens_inventario: int
    itens_com_estoque: int
    itens_valorizados: int
    estoque_valor: Optional[float] = None
    estoque_inicial: Optional[float] = None
    cmv: Optional[float] = None
    cmv_pct: Optional[float] = None
    obs: str = ""


class Alert(BaseModel):
    level: Literal["danger", "warning", "info", "success"]
    title: str
    detail: str


class Dashboard(BaseModel):
    settings: Settings
    months: list[MonthRow]
    alerts: list[Alert]
    compras_total: float
    notas_total: int
    custos_cadastrados: int
    custos_ref: str = ""
    compras_classe_a_media: float
    faturamento_medio: Optional[float] = None
    cmv_pct_medio: Optional[float] = None


class SupplierRow(BaseModel):
    rank: int
    fornecedor: str
    total: float
    pct: float
    acumulado: float
    classe: Literal["A", "B", "C"]
    frequencia: int
    media_nota: float
    menor_nota: float
    maior_nota: float
    primeira: str
    ultima: str
    por_mes: dict[str, float]


class SuppliersResponse(BaseModel):
    months: list[str]
    total: float
    suppliers: list[SupplierRow]
    classe_counts: dict[str, int]
    classe_totals: dict[str, float]


class ReorderItem(BaseModel):
    item: str
    descricao: str
    um: str = ""
    grupo: str = ""
    qtd_anterior: float
    qtd_atual: float
    variacao: float
    var_pct: float
    status: str
    sugestao: str
    custo: Optional[float] = None
    valor_reposicao: float = 0


class ReorderResponse(BaseModel):
    from_month: Optional[str] = None
    to_month: Optional[str] = None
    counts: dict[str, int]
    valor_reposicao_total: float
    items: list[ReorderItem]


# ---------- AI ----------
class AiModel(BaseModel):
    id: str
    name: str
    badge: str


class InsightIn(BaseModel):
    model: str
    focus: Literal["geral", "cmv", "fornecedores", "estoque", "economia"] = "geral"
    question: str = Field("", max_length=600)


class Insight(BaseModel):
    id: str
    model: str
    model_name: str
    focus: str
    question: str = ""
    content: str
    user_email: str = ""
    created_at: str
