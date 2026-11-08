import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, PageHeader, Panel, Skeleton } from "@/components/common";
import { PartialMonthAlerts, PartialTag } from "@/components/PartialAlerts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDashboard } from "@/lib/queries";
import { brl, cmvTone, compactBrl, pct, TONE_CLASSES } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function CmvEstoque() {
  const { data, isLoading, isError } = useDashboard();
  const months = isError ? [] : (data?.months ?? []);
  const max = data?.settings.cmv_meta_max ?? 0.3;
  const chart = months.filter((m) => m.estoque_valor !== null).map((m) => ({ label: m.label, Estoque: m.estoque_valor ?? 0 }));

  return (
    <div>
      <PageHeader
        eyebrow="Apuração mensal"
        title="CMV & Estoque"
        subtitle="CMV = Estoque Inicial + Compras − Estoque Final. Estoque = quantidade do inventário × custo unitário médio."
      />
      {isLoading ? (
        <Skeleton className="h-72" />
      ) : months.length === 0 ? (
        <EmptyState title="Sem meses apurados" detail="Envie inventários, compras e faturamento." />
      ) : (
        <div className="space-y-6">
          <PartialMonthAlerts months={months} testId="cmv-partial-alerts" />
          <Panel title="Demonstrativo mensal" testId="cmv-monthly-table">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 bg-[#0F172A] hover:bg-[#0F172A]">
                  {["Mês", "Status", "Est. Inicial", "Compras", "Est. Final", "CMV R$", "Faturamento", "CMV %", "Itens valorizados"].map((h) => (
                    <TableHead key={h} className={cn("text-xs uppercase tracking-wider text-slate-400", h !== "Mês" && h !== "Status" && "text-right")}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => (
                  <TableRow key={m.month} data-testid={`cmv-row-${m.month}`} className="border-slate-800/70 hover:bg-slate-800/30">
                    <TableCell className="font-semibold">{m.label}</TableCell>
                    <TableCell>
                      <span data-testid={`cmv-status-${m.month}`} title={m.alerta_parcial ?? ""} className={cn("text-xs", m.status === "fechado" ? "text-slate-400" : "text-amber")}>
                        {m.status === "fechado" ? "fechado" : "incompleto"}
                      </span>
                      {m.pendencias.length > 0 && <div className="text-[10px] text-slate-500">falta: {m.pendencias.join(", ")}</div>}
                    </TableCell>
                    <TableCell className="num text-right">{brl(m.estoque_inicial)}</TableCell>
                    <TableCell className="num text-right">
                      {brl(m.compras)}
                      {m.compras_ate_dia && <div className="text-[10px] text-slate-500">até dia {m.compras_ate_dia}</div>}
                    </TableCell>
                    <TableCell className="num text-right">{brl(m.estoque_valor)}</TableCell>
                    <TableCell className="num text-right font-semibold">{brl(m.cmv)}</TableCell>
                    <TableCell className="num text-right">
                      {brl(m.faturamento)}
                      {m.faturamento_parcial && <div className="text-[10px] text-amber">parcial</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-1">
                        {m.cmv_pct !== null && <PartialTag month={m} />}
                        <span className={cn("num rounded px-2 py-0.5 text-xs font-semibold", TONE_CLASSES[cmvTone(m.cmv_pct, max)])} data-testid={`cmv-pct-${m.month}`}>{pct(m.cmv_pct)}</span>
                      </span>
                    </TableCell>
                    <TableCell className="num text-right text-xs text-slate-400">{m.itens_valorizados}/{m.itens_com_estoque}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 space-y-1 text-xs text-slate-500">
              {months.filter((m) => m.obs).map((m) => <div key={m.month}>• {m.label}: {m.obs}</div>)}
              <div>• CMV só é calculado quando existem inventários de dois meses consecutivos.</div>
              <div>• Um mês só fecha com inventário de fechamento + faturamento completo + compras do mês inteiro; até lá o CMV % é parcial.</div>
            </div>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Estoque valorizado por mês" testId="estoque-chart">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart}>
                    <defs>
                      <linearGradient id="est" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1E293B" vertical={false} />
                    <XAxis dataKey="label" stroke="#64748B" fontSize={12} />
                    <YAxis stroke="#64748B" fontSize={11} tickFormatter={(v: number) => compactBrl(v)} width={70} />
                    <Tooltip contentStyle={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => brl(v)} />
                    <Area type="monotone" dataKey="Estoque" stroke="#F59E0B" strokeWidth={2} fill="url(#est)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Compras por mês" testId="compras-table">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    {["Mês", "Total", "Notas", "Ticket médio", "Fornec."].map((h) => (
                      <TableHead key={h} className={cn("text-xs uppercase text-slate-400", h !== "Mês" && "text-right")}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {months.filter((m) => m.notas).map((m) => (
                    <TableRow key={m.month} className="border-slate-800/70">
                      <TableCell>{m.label}</TableCell>
                      <TableCell className="num text-right">{brl(m.compras)}</TableCell>
                      <TableCell className="num text-right">{m.notas}</TableCell>
                      <TableCell className="num text-right">{brl(m.ticket_medio, true)}</TableCell>
                      <TableCell className="num text-right">{m.fornecedores}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
