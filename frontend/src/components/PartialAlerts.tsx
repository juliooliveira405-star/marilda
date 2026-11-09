import { AlertTriangle } from "lucide-react";
import type { MonthRow } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Mandatory banner for every open / incomplete month (CMV % is partial until closing). */
type AlertMonth = Pick<MonthRow, "month" | "alerta_parcial">;

export function PartialMonthAlerts({ months, testId = "partial-month-alerts", className }: { months: AlertMonth[]; testId?: string; className?: string }) {
  const open = months.filter((m) => m.alerta_parcial);
  if (!open.length) return null;
  return (
    <div data-testid={testId} className={cn("space-y-2", className)}>
      {open.map((m) => (
        <div
          key={m.month}
          data-testid={`${testId}-${m.month}`}
          className="flex items-start gap-3 rounded-lg border border-[#FBBF24]/30 border-l-4 border-l-[#FBBF24] bg-[#78350F]/20 px-3 py-2.5 text-sm text-[#FDE68A]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{m.alerta_parcial}</span>
        </div>
      ))}
    </div>
  );
}

export function PartialTag({ month, testId }: { month: Pick<MonthRow, "status" | "alerta_parcial"> | undefined; testId?: string }) {
  if (!month || month.status === "fechado") return null;
  return (
    <span data-testid={testId} title={month.alerta_parcial ?? ""} className="rounded bg-[#78350F] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#FDE68A]">
      Parcial
    </span>
  );
}
