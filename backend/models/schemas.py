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
    sector: Optional[str] = None


class UserRow(BaseModel):
    user_id: str
    email: str = ""
    name: str = ""
    role: str
    role_label: str
    status: Literal["ativo", "pendente"] = "ativo"
    sector: Optional[str] = None


class InviteIn(BaseModel):
    email: str = Field(..., min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: Literal["gerente", "alimentador", "chefe"]
    sector: Optional[str] = None


class Invite(BaseModel):
    id: str
    email: str
    role: str
    role_label: str
    status: Literal["enviado", "aceito", "revogado"]
    sector: Optional[str] = None
    invited_by: str = ""
    created_at: str


class RoleOption(BaseModel):
    value: str
    label: str


class UsersResponse(BaseModel):
    roles: list[RoleOption]
    users: list[UserRow]
    invites: list[Invite]


class RoleIn(BaseModel):
    role: str
    sector: Optional[str] = None


class Settings(BaseModel):
    empresa: str = "Locale POA"
    cmv_meta_min: float = Field(0.28, ge=0, le=1)
    cmv_meta_max: float = Field(0.30, ge=0, le=1)


# ---------- periods / uploads ----------
DATE_RE = r"^20\d{2}-\d{2}-\d{2}$"


class Period(BaseModel):
    month: str
    faturamento: Optional[float] = None
    faturamento_parcial: bool = False
    faturamento_ate: Optional[str] = None
    estoque_ate: Optional[str] = None
    compras_completas: Optional[bool] = None
    obs: str = ""


class PeriodIn(BaseModel):
    faturamento: Optional[float] = Field(None, ge=0)
    faturamento_parcial: bool = False
    faturamento_ate: Optional[str] = Field(None, pattern=DATE_RE)
    estoque_ate: Optional[str] = Field(None, pattern=DATE_RE)
    compras_completas: Optional[bool] = None
    obs: str = Field("", max_length=300)


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
    compras_ate: Optional[str] = None
    estoque_ate: Optional[str] = None
    faturamento_ate: Optional[str] = None
    inventario_final: bool = False
    faturamento_completo: bool = False
    compras_completas: bool = False
    pendencias: list[str] = []
    alerta_parcial: Optional[str] = None


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
    setor: str = ""
    custo: Optional[float] = None
    valor_reposicao: Optional[float] = None


class ReorderResponse(BaseModel):
    from_month: Optional[str] = None
    to_month: Optional[str] = None
    counts: dict[str, int]
    valor_reposicao_total: Optional[float] = None
    sector: Optional[str] = None
    costs_visible: bool = True
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


# ---------- stock: catalog, QR, counts, withdrawals ----------
class CatalogItem(BaseModel):
    item: str
    descricao: str
    um: str = ""
    grupo: str = ""
    custo: Optional[float] = None


class QrResolveIn(BaseModel):
    raw: str = Field(..., min_length=1, max_length=4000)


class QrParsed(BaseModel):
    produto: str = ""
    peso: Optional[float] = None
    um: str = ""
    lote: str = ""
    validade: str = ""
    fabricacao: str = ""
    label_id: str = ""


class QrLabel(BaseModel):
    code: str
    item: str
    descricao: str
    um: str = ""
    qty: float
    lote: str = ""
    validade: str = ""
    created_at: str


class QrResolveOut(BaseModel):
    code: str
    known: bool
    label: Optional[QrLabel] = None
    parsed: QrParsed
    suggestions: list[CatalogItem]


class QrLabelIn(BaseModel):
    raw: str = Field(..., min_length=1, max_length=4000)
    item: str
    descricao: str
    um: str = ""
    qty: float = Field(..., gt=0)
    lote: str = ""
    validade: str = ""


class CountEntryIn(BaseModel):
    month: str = Field(..., pattern=r"^20\d{2}-(0[1-9]|1[0-2])$")
    item: str = Field(..., min_length=1)
    descricao: str = ""
    um: str = ""
    qty: float = Field(..., gt=0)
    qr_code: Optional[str] = None


class CountEntry(BaseModel):
    id: str
    month: str
    item: str
    descricao: str
    um: str = ""
    qty: float
    qr_code: Optional[str] = None
    user_email: str = ""
    created_at: str


class CountItem(BaseModel):
    item: str
    descricao: str
    um: str = ""
    qty: float
    leituras: int


class CountSummary(BaseModel):
    month: str
    entries: list[CountEntry]
    items: list[CountItem]
    applied_at: Optional[str] = None
    applied_by: str = ""


class CountApplyOut(BaseModel):
    month: str
    itens: int
    message: str


class TimeWindow(BaseModel):
    id: str = ""
    sectors: list[str] = []
    days: list[int] = Field(..., min_length=1)
    start: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class WindowsResponse(BaseModel):
    sectors: list[str]
    windows: list[TimeWindow]
    now: str
    open_sectors: list[str]


class WindowsIn(BaseModel):
    windows: list[TimeWindow] = Field(..., max_length=50)


class ReqLineIn(BaseModel):
    item: str = Field(..., min_length=1)
    descricao: str = ""
    um: str = ""
    qty: float = Field(..., gt=0)
    qr_code: Optional[str] = None


class ReqLine(BaseModel):
    item: str
    descricao: str
    um: str = ""
    qty: float
    custo: Optional[float] = None
    qr_code: Optional[str] = None


class RequisitionIn(BaseModel):
    sector: str
    priority: Literal["normal", "urgente"] = "normal"
    items: list[ReqLineIn] = Field(..., max_length=300)
    note: str = Field("", max_length=500)
    submit: bool = True
    force: bool = False


class ReqEvent(BaseModel):
    at: str
    user: str
    action: str
    comment: str = ""


class Requisition(BaseModel):
    id: str
    number: int
    sector: str
    priority: Literal["normal", "urgente"]
    status: Literal["rascunho", "enviada", "aprovada", "devolvida", "rejeitada", "comprada", "recebida", "excluida"]
    items: list[ReqLine]
    valor_total: Optional[float] = None
    note: str = ""
    direct: bool = False
    requested_by: str = ""
    created_at: str
    updated_at: str
    history: list[ReqEvent] = []


class ReqActionIn(BaseModel):
    action: Literal["enviar", "aprovar", "rejeitar", "devolver", "comprada", "recebida", "excluir"]
    comment: str = Field("", max_length=500)


class Notification(BaseModel):
    id: str
    number: int
    sector: str
    priority: str
    status: str
    message: str
    at: str


class Notifications(BaseModel):
    count: int
    items: list[Notification]


class OverviewMonth(BaseModel):
    month: str
    label: str
    status: str
    tem_inventario: bool = False
    alerta_parcial: Optional[str] = None
    pendencias: list[str] = []


class SectorStock(BaseModel):
    month: str
    label: str
    valor: float
    itens: int


class Overview(BaseModel):
    months: list[OverviewMonth]
    zerados: int
    baixou_forte: int
    sector: Optional[str] = None
    costs_visible: bool
    sector_stock: list[SectorStock]
    itens_sem_custo: list[str]


class AuditRow(BaseModel):
    at: str
    user: str
    action: str
    detail: str = ""
