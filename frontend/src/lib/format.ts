const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export const MONTHS = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function brl(v: number | null | undefined, cents = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return (cents ? brl2 : brl0).format(v);
}

export function compactBrl(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${num.format(v / 1_000_000)} mi`;
  if (Math.abs(v) >= 1_000) return `R$ ${Math.round(v / 1_000)} mil`;
  return brl(v);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}

export function qty(v: number): string {
  return num.format(v);
}

export function monthLabel(m: string | null | undefined): string {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  return `${MONTHS[Number(mo)]}/${y.slice(2)}`;
}

export function dateBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString("pt-BR");
}

export function dateTimeBr(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export type CmvTone = "ok" | "warn" | "danger" | "none";

export function cmvTone(v: number | null | undefined, max: number): CmvTone {
  if (v === null || v === undefined) return "none";
  if (v <= max) return "ok";
  if (v <= max + 0.03) return "warn";
  return "danger";
}

export const TONE_CLASSES: Record<CmvTone, string> = {
  ok: "bg-[#064E3B] text-[#6EE7B7]",
  warn: "bg-[#78350F] text-[#FDE68A]",
  danger: "bg-[#7F1D1D] text-[#FCA5A5]",
  none: "bg-slate-800 text-slate-300",
};
