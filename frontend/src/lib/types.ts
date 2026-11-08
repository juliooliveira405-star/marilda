// Hand-written mirrors of backend/models/schemas.py — keep in sync.

export type Role = "gerente" | "alimentador" | "chefe" | "pendente";

export interface Me {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  role_label: string;
  sector: string | null;
}

export interface UserRow {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  role_label: string;
  status: "ativo" | "pendente";
  sector: string | null;
}

export interface InviteIn {
  email: string;
  role: Exclude<Role, "pendente">;
  sector: string | null;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  role_label: string;
  status: "enviado" | "aceito" | "revogado";
  sector: string | null;
  invited_by: string;
  created_at: string;
}

export interface RoleOption {
  value: Role;
  label: string;
}

export interface UsersResponse {
  roles: RoleOption[];
  users: UserRow[];
  invites: Invite[];
}

export interface Settings {
  empresa: string;
  cmv_meta_min: number;
  cmv_meta_max: number;
}

export interface Period {
  month: string;
  faturamento: number | null;
  faturamento_parcial: boolean;
  faturamento_ate: string | null;
  estoque_ate: string | null;
  compras_completas: boolean | null;
  obs: string;
}

export type PeriodIn = Omit<Period, "month">;

export type UploadKind = "compras" | "inventario" | "custos" | "faturamento" | "completa";

export interface Upload {
  id: string;
  kind: UploadKind;
  filename: string;
  month: string | null;
  status: "processando" | "concluido" | "erro" | "desfeito";
  rows: number;
  message: string;
  ai_used: boolean;
  undoable: boolean;
  user_email: string;
  created_at: string;
}

export interface MonthRow {
  month: string;
  label: string;
  status: string;
  compras: number;
  notas: number;
  ticket_medio: number;
  fornecedores: number;
  compras_ate_dia: number | null;
  compras_projecao: number | null;
  faturamento: number | null;
  faturamento_parcial: boolean;
  itens_inventario: number;
  itens_com_estoque: number;
  itens_valorizados: number;
  estoque_valor: number | null;
  estoque_inicial: number | null;
  cmv: number | null;
  cmv_pct: number | null;
  obs: string;
  compras_ate: string | null;
  estoque_ate: string | null;
  faturamento_ate: string | null;
  inventario_final: boolean;
  faturamento_completo: boolean;
  compras_completas: boolean;
  pendencias: string[];
  alerta_parcial: string | null;
}

export interface Alert {
  level: "danger" | "warning" | "info" | "success";
  title: string;
  detail: string;
}

export interface Dashboard {
  settings: Settings;
  months: MonthRow[];
  alerts: Alert[];
  compras_total: number;
  notas_total: number;
  custos_cadastrados: number;
  custos_ref: string;
  compras_classe_a_media: number;
  faturamento_medio: number | null;
  cmv_pct_medio: number | null;
}

export interface SupplierRow {
  rank: number;
  fornecedor: string;
  total: number;
  pct: number;
  acumulado: number;
  classe: "A" | "B" | "C";
  frequencia: number;
  media_nota: number;
  menor_nota: number;
  maior_nota: number;
  primeira: string;
  ultima: string;
  por_mes: Record<string, number>;
}

export interface SuppliersResponse {
  months: string[];
  total: number;
  suppliers: SupplierRow[];
  classe_counts: Record<string, number>;
  classe_totals: Record<string, number>;
}

export interface ReorderItem {
  item: string;
  descricao: string;
  um: string;
  grupo: string;
  qtd_anterior: number;
  qtd_atual: number;
  variacao: number;
  var_pct: number;
  status: string;
  sugestao: string;
  setor: string;
  custo: number | null;
  valor_reposicao: number | null;
}

export interface ReorderResponse {
  from_month: string | null;
  to_month: string | null;
  counts: Record<string, number>;
  valor_reposicao_total: number | null;
  sector: string | null;
  costs_visible: boolean;
  items: ReorderItem[];
}

export interface AiModel {
  id: string;
  name: string;
  badge: string;
}

export type InsightFocus = "geral" | "cmv" | "fornecedores" | "estoque" | "economia";

export interface InsightIn {
  model: string;
  focus: InsightFocus;
  question: string;
}

export interface Insight {
  id: string;
  model: string;
  model_name: string;
  focus: string;
  question: string;
  content: string;
  user_email: string;
  created_at: string;
}

// ---------- stock: catalog, QR, counts, withdrawals ----------
export interface CatalogItem {
  item: string;
  descricao: string;
  um: string;
  grupo: string;
  custo: number | null;
}

export interface QrParsed {
  produto: string;
  peso: number | null;
  um: string;
  lote: string;
  validade: string;
  fabricacao: string;
  label_id: string;
}

export interface QrLabel {
  code: string;
  item: string;
  descricao: string;
  um: string;
  qty: number;
  lote: string;
  validade: string;
  created_at: string;
}

export interface QrResolveOut {
  code: string;
  known: boolean;
  label: QrLabel | null;
  parsed: QrParsed;
  suggestions: CatalogItem[];
}

export interface QrLabelIn {
  raw: string;
  item: string;
  descricao: string;
  um: string;
  qty: number;
  lote: string;
  validade: string;
}

export interface CountEntryIn {
  month: string;
  item: string;
  descricao: string;
  um: string;
  qty: number;
  qr_code: string | null;
}

export interface CountEntry extends CountEntryIn {
  id: string;
  user_email: string;
  created_at: string;
}

export interface CountItem {
  item: string;
  descricao: string;
  um: string;
  qty: number;
  leituras: number;
}

export interface CountSummary {
  month: string;
  entries: CountEntry[];
  items: CountItem[];
  applied_at: string | null;
  applied_by: string;
}

export interface CountApplyOut {
  month: string;
  itens: number;
  message: string;
}

export interface TimeWindow {
  id: string;
  sectors: string[];
  days: number[];
  start: string;
  end: string;
}

export interface WindowsResponse {
  sectors: string[];
  windows: TimeWindow[];
  now: string;
  open_sectors: string[];
}

export interface ReqLine {
  item: string;
  descricao: string;
  um: string;
  qty: number;
  custo: number | null;
  qr_code: string | null;
}

export type ReqStatus = "rascunho" | "enviada" | "aprovada" | "devolvida" | "rejeitada" | "comprada" | "recebida" | "excluida";

export interface RequisitionIn {
  sector: string;
  priority: "normal" | "urgente";
  items: Omit<ReqLine, "custo">[];
  note: string;
  submit: boolean;
  force: boolean;
}

export interface ReqEvent {
  at: string;
  user: string;
  action: string;
  comment: string;
}

export interface Requisition {
  id: string;
  number: number;
  sector: string;
  priority: "normal" | "urgente";
  status: ReqStatus;
  items: ReqLine[];
  valor_total: number | null;
  note: string;
  direct: boolean;
  requested_by: string;
  created_at: string;
  updated_at: string;
  history: ReqEvent[];
}

export type ReqAction = "enviar" | "aprovar" | "rejeitar" | "devolver" | "comprada" | "recebida" | "excluir";

export interface ReqActionIn {
  action: ReqAction;
  comment: string;
}

export interface NotificationItem {
  id: string;
  number: number;
  sector: string;
  priority: string;
  status: string;
  message: string;
  at: string;
}

export interface Notifications {
  count: number;
  items: NotificationItem[];
}

export interface OverviewMonth {
  month: string;
  label: string;
  status: string;
  tem_inventario: boolean;
  alerta_parcial: string | null;
  pendencias: string[];
}

export interface SectorStock {
  month: string;
  label: string;
  valor: number;
  itens: number;
}

export interface Overview {
  months: OverviewMonth[];
  zerados: number;
  baixou_forte: number;
  sector: string | null;
  costs_visible: boolean;
  sector_stock: SectorStock[];
  itens_sem_custo: string[];
}

export interface AuditRow {
  at: string;
  user: string;
  action: string;
  detail: string;
}
