// Hand-written mirrors of backend/models/schemas.py — keep in sync.

export type Role = "gerente" | "alimentador" | "chefe" | "pendente";

export interface Me {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  role_label: string;
}

export interface UserRow {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  role_label: string;
}

export interface RoleOption {
  value: Role;
  label: string;
}

export interface UsersResponse {
  roles: RoleOption[];
  users: UserRow[];
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
  status: "aberto" | "fechado";
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
  custo: number | null;
  valor_reposicao: number;
}

export interface ReorderResponse {
  from_month: string | null;
  to_month: string | null;
  counts: Record<string, number>;
  valor_reposicao_total: number;
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
