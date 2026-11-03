import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, type CmvTone } from "@/lib/format";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import type { Alert } from "@/lib/types";

export function CreditBadge({ className }: { className?: string }) {
  return (
    <div
      data-testid="creator-credit-badge"
      className={cn("inline-flex items-center gap-2 text-[11px] tracking-wide text-slate-400", className)}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_8px_#F59E0B]" />
      <span>
        <span className="font-semibold text-slate-200">Madrila ERP</span> • Idealizado e criado por{" "}
        <span className="font-semibold text-amber">Julio Acauã</span>
      </span>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between animate-rise">
      <div>
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl" data-testid="page-title">
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className, title, action, testId }: { children: ReactNode; className?: string; title?: string; action?: ReactNode; testId?: string }) {
  return (
    <section
      data-testid={testId}
      className={cn(
        "rounded-xl border border-slate-800/80 border-t-white/10 bg-panel p-4 md:p-5 animate-rise",
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function KpiCard({ label, value, hint, testId, tone, icon }: { label: string; value: string; hint?: ReactNode; testId: string; tone?: CmvTone; icon?: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="group relative min-w-[210px] overflow-hidden rounded-xl border border-slate-800/80 border-t-white/10 bg-panel p-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-amber/40 animate-rise"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <span className="text-slate-500 group-hover:text-amber transition-colors duration-200">{icon}</span>
      </div>
      <div className="num mt-3 text-2xl font-semibold text-slate-50" data-testid={`${testId}-value`}>
        {value}
      </div>
      {hint && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          {tone && tone !== "none" && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", TONE_CLASSES[tone])}>{tone === "ok" ? "Na meta" : tone === "warn" ? "Atenção" : "Crítico"}</span>}
          {hint}
        </div>
      )}
    </div>
  );
}

export const STATUS_STYLES: Record<string, string> = {
  ZERADO: "bg-[#450A0A] text-[#F87171]",
  "BAIXOU FORTE": "bg-[#7C2D12] text-[#FB923C]",
  BAIXOU: "bg-[#713F12] text-[#FBBF24]",
  "ESTÁVEL": "bg-[#064E3B] text-[#34D399]",
  SUBIU: "bg-[#1E3A8A] text-[#60A5FA]",
  "SUBIU MUITO": "bg-[#1E1B4B] text-[#A5B4FC]",
  NOVO: "bg-[#581C87] text-[#C084FC]",
};

export function StatusBadge({ status, testId }: { status: string; testId?: string }) {
  return (
    <span data-testid={testId} className={cn("inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLES[status] ?? "bg-slate-800 text-slate-300")}>
      {status}
    </span>
  );
}

const CLASS_STYLES: Record<string, string> = {
  A: "bg-[#1E1B4B] text-[#A5B4FC]",
  B: "bg-[#14532D] text-[#86EFAC]",
  C: "bg-[#374151] text-[#D1D5DB]",
};

export function ClassBadge({ classe }: { classe: string }) {
  return <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold", CLASS_STYLES[classe])}>{classe}</span>;
}

const ALERT_META = {
  danger: { icon: OctagonAlert, cls: "border-l-[#F87171] text-[#FCA5A5]" },
  warning: { icon: AlertTriangle, cls: "border-l-[#FBBF24] text-[#FDE68A]" },
  info: { icon: Info, cls: "border-l-[#60A5FA] text-[#93C5FD]" },
  success: { icon: CheckCircle2, cls: "border-l-[#34D399] text-[#6EE7B7]" },
};

export function AlertItem({ alert, index }: { alert: Alert; index: number }) {
  const meta = ALERT_META[alert.level];
  const Icon = meta.icon;
  return (
    <li data-testid={`alert-item-${index}`} className={cn("flex gap-3 rounded-lg border border-slate-800/60 border-l-4 bg-panel-2/60 p-3", meta.cls)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="text-sm font-semibold text-slate-100">{alert.title}</div>
        <div className="text-xs text-slate-400">{alert.detail}</div>
      </div>
    </li>
  );
}

export function EmptyState({ title, detail, testId }: { title: string; detail?: string; testId?: string }) {
  return (
    <div data-testid={testId ?? "empty-state"} className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 p-8 text-center">
      <div className="text-sm font-semibold text-slate-300">{title}</div>
      {detail && <div className="mt-1 max-w-sm text-xs text-slate-500">{detail}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-lg bg-[linear-gradient(90deg,#111827_0%,#1E293B_50%,#111827_100%)] bg-[length:800px_100%] animate-shimmer", className)}
    />
  );
}
