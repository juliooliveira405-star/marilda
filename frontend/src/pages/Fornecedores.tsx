import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClassBadge, EmptyState, PageHeader, Panel, Skeleton } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSuppliers } from "@/lib/queries";
import { brl, compactBrl, dateBr, monthLabel, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

const CLASSES = ["Todas", "A", "B", "C"] as const;

export default function Fornecedores() {
  const { data, isLoading, isError } = useSuppliers();
  const [q, setQ] = useState("");
  const [classe, setClasse] = useState<(typeof CLASSES)[number]>("Todas");
  const suppliers = isError ? [] : (data?.suppliers ?? []);
  const filtered = useMemo(
    () => suppliers.filter((s) => (classe === "Todas" || s.classe === classe) && s.fornecedor.toLowerCase().includes(q.toLowerCase())),
    [suppliers, q, classe],
  );
  const pareto = suppliers.slice(0, 20).map((s) => ({ name: s.fornecedor.slice(0, 14), Total: s.total, Acumulado: +(s.acumulado * 100).toFixed(1) }));
  const months = data?.months ?? [];

  return (
    <div>
      <PageHeader eyebrow="Compras" title="Curva ABC de Fornecedores" subtitle="Classe A = fornecedores que somam até 80% das compras, B até 95%, C o restante." />
      {isLoading ? (
        <Skeleton className="h-72" />
      ) : suppliers.length === 0 ? (
        <EmptyState title="Sem compras lançadas" detail="Envie as notas/exports VMarket em Carregar Dados." />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {(["A", "B", "C"] as const).map((c) => (
              <Panel key={c} testId={`abc-summary-${c}`}>
                <div className="flex items-center justify-between">
                  <ClassBadge classe={c} />
                  <span className="text-xs text-slate-500">{data?.classe_counts[c]} fornecedores</span>
                </div>
                <div className="num mt-3 text-xl font-semibold">{brl(data?.classe_totals[c])}</div>
                <div className="text-xs text-slate-500">{pct((data?.classe_totals[c] ?? 0) / (data?.total || 1))} do total</div>
              </Panel>
            ))}
          </div>

          <Panel title="Pareto — top 20" testId="abc-pareto-chart">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={pareto}>
                  <CartesianGrid stroke="#1E293B" vertical={false} />
                  <XAxis dataKey="name" stroke="#64748B" fontSize={10} interval={0} angle={-35} textAnchor="end" height={70} />
                  <YAxis yAxisId="v" stroke="#64748B" fontSize={11} tickFormatter={(v: number) => compactBrl(v)} width={70} />
                  <YAxis yAxisId="p" orientation="right" stroke="#64748B" fontSize={11} unit="%" domain={[0, 100]} width={40} />
                  <Tooltip contentStyle={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, name: string) => (name === "Acumulado" ? `${v}%` : brl(v))} />
                  <Bar yAxisId="v" dataKey="Total" fill="#818CF8" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="p" dataKey="Acumulado" stroke="#F59E0B" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel
            title="Ranking"
            testId="abc-suppliers-table"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-slate-800 p-0.5">
                  {CLASSES.map((c) => (
                    <button key={c} data-testid={`abc-filter-${c}`} onClick={() => setClasse(c)}
                      className={cn("rounded-md px-2.5 py-1 text-xs transition-colors duration-150", classe === c ? "bg-amber text-black" : "text-slate-400 hover:text-slate-100")}>
                      {c}
                    </button>
                  ))}
                </div>
                <Input data-testid="abc-search-input" placeholder="Buscar fornecedor" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-48" />
              </div>
            }
          >
            <div className="max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 bg-[#0F172A] hover:bg-[#0F172A]">
                    {["#", "Fornecedor", "Classe", "Total", "%", "Acum.", "Notas", "Média/nota", ...months.map(monthLabel), "Última"].map((h) => (
                      <TableHead key={h} className="whitespace-nowrap text-xs uppercase text-slate-400">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.fornecedor} data-testid={`abc-row-${s.rank}`} className="border-slate-800/70 hover:bg-slate-800/30">
                      <TableCell className="num text-slate-500">{s.rank}</TableCell>
                      <TableCell className="max-w-[240px] truncate font-medium" title={s.fornecedor}>{s.fornecedor}</TableCell>
                      <TableCell><ClassBadge classe={s.classe} /></TableCell>
                      <TableCell className="num text-right">{brl(s.total)}</TableCell>
                      <TableCell className="num text-right">{pct(s.pct)}</TableCell>
                      <TableCell className="num text-right text-slate-400">{pct(s.acumulado)}</TableCell>
                      <TableCell className="num text-right">{s.frequencia}</TableCell>
                      <TableCell className="num text-right">{brl(s.media_nota)}</TableCell>
                      {months.map((m) => (
                        <TableCell key={m} className="num text-right text-slate-300">{s.por_mes[m] ? compactBrl(s.por_mes[m]) : "—"}</TableCell>
                      ))}
                      <TableCell className="num whitespace-nowrap text-xs text-slate-400">{dateBr(s.ultima)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
