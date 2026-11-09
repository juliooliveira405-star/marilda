import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClassBadge, EmptyState, PageHeader, Panel, Skeleton } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost, apiPut, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CheckCheck, Loader2, Sparkles } from "lucide-react";
import { qk, useSupplierSectors, useSuppliers } from "@/lib/queries";
import type { SupplierSector, SupplierSectorIn } from "@/lib/types";
import { brl, compactBrl, dateBr, monthLabel, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

const CLASSES = ["Todas", "A", "B", "C"] as const;
const SECTOR_OPTS = ["Cozinha", "Bar", "Quiosque", "Salão", "Estoque"];
const NONE = "__none";

function SectorPicker({ row }: { row: SupplierSector | undefined }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (b: SupplierSectorIn) => apiPut<SupplierSector>("/suppliers/sectors", b),
    onSuccess: (r) => {
      toast.success(`${r.fornecedor} → ${r.sector ?? "sem setor"}`);
      void qc.invalidateQueries({ queryKey: qk.supplierSectors });
      void qc.invalidateQueries({ queryKey: qk.sectorCmv });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!row) return <span className="text-xs text-slate-600">—</span>;
  return (
    <div className="flex items-center gap-1">
      <Select value={row.sector ?? NONE} onValueChange={(v: string) => save.mutate({ fornecedor: row.fornecedor, sector: v === NONE ? null : v })}>
        <SelectTrigger size="sm" className={cn("w-28", !row.sector && "border-amber/50 text-amber")} data-testid={`supplier-sector-${row.fornecedor}`}>
          <SelectValue>{(v: string) => (v === NONE ? "Sem setor" : v)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Sem setor</SelectItem>
          {SECTOR_OPTS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
      {row.sector && row.fonte !== "manual" && (
        <span className={cn("text-[9px] uppercase", row.fonte === "ia" ? "text-[#A5B4FC]" : "text-slate-500")} title="Sugestão automática — confirme ou troque">
          {row.fonte === "ia" ? "IA" : "regra"}
        </span>
      )}
    </div>
  );
}

function ReviewPanel({ rows }: { rows: SupplierSector[] }) {
  const qc = useQueryClient();
  const pending = rows.filter((r) => !r.sector || r.fonte === "ia").sort((a, b) => b.total - a.total);
  const [busyAll, setBusyAll] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.supplierSectors });
    void qc.invalidateQueries({ queryKey: qk.sectorCmv });
  };
  const suggest = useMutation({
    mutationFn: () => apiPost<SupplierSector[]>("/suppliers/sectors/suggest", {}),
    onSuccess: (r) => { qc.setQueryData(qk.supplierSectors, r); refresh(); toast.success("Sugestões da IA aplicadas — confirme ou troque cada uma"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setOne = useMutation({
    mutationFn: (b: SupplierSectorIn) => apiPut<SupplierSector>("/suppliers/sectors", b),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const confirmAll = async () => {
    setBusyAll(true);
    try {
      for (const r of pending.filter((x) => x.sector)) await apiPut<SupplierSector>("/suppliers/sectors", { fornecedor: r.fornecedor, sector: r.sector });
      toast.success("Sugestões confirmadas");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyAll(false);
      refresh();
    }
  };
  if (!pending.length) return null;
  const semSetor = pending.filter((r) => !r.sector);
  return (
    <Panel title={`Revisar setor dos fornecedores (${pending.length})`} testId="supplier-review-panel"
      action={
        <div className="flex flex-wrap gap-2">
          {semSetor.length > 0 && (
            <Button size="sm" variant="outline" data-testid="supplier-review-suggest" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
              {suggest.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}Sugerir com IA
            </Button>
          )}
          {pending.some((r) => r.sector) && (
            <Button size="sm" data-testid="supplier-review-confirm-all" disabled={busyAll} onClick={() => void confirmAll()}>
              {busyAll ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-1 h-4 w-4" />}Confirmar todas
            </Button>
          )}
        </div>
      }>
      <p className="mb-3 text-xs text-slate-400">
        {semSetor.length > 0 && <>{semSetor.length} sem setor ({brl(semSetor.reduce((a, r) => a + r.total, 0))}) ficam fora do CMV por setor. </>}
        Sugestões da IA (roxo) já contam no CMV do setor — toque no setor certo para confirmar. “Estoque” = compras gerais/mistas.
      </p>
      <ul className="max-h-[420px] divide-y divide-slate-800/70 overflow-y-auto">
        {pending.map((r) => (
          <li key={r.fornecedor} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between" data-testid={`supplier-review-row-${r.fornecedor}`}>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-100">{r.fornecedor}</div>
              <div className="truncate text-[11px] text-slate-500">{r.razao_social} · {brl(r.total)}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {SECTOR_OPTS.map((o) => (
                <button key={o} type="button" data-testid={`supplier-review-${r.fornecedor}-${o}`} disabled={setOne.isPending}
                  onClick={() => setOne.mutate({ fornecedor: r.fornecedor, sector: o })}
                  className={cn("min-h-9 rounded-md border px-2.5 text-xs transition-[background-color,border-color] duration-150",
                    r.sector === o ? "border-[#818CF8] bg-[#1E1B4B] text-[#C7D2FE]" : "border-slate-800 text-slate-400 hover:border-slate-600")}>
                  {o}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function Fornecedores() {
  const { data, isLoading, isError } = useSuppliers();
  const [q, setQ] = useState("");
  const [classe, setClasse] = useState<(typeof CLASSES)[number]>("Todas");
  const [fSector, setFSector] = useState("todos");
  const { data: sectorRows } = useSupplierSectors(true);
  const sectorOf = useMemo(() => new Map((sectorRows ?? []).map((r) => [r.fornecedor, r])), [sectorRows]);
  const suppliers = useMemo(() => (isError ? [] : (data?.suppliers ?? [])), [isError, data]);
  const filtered = useMemo(
    () => suppliers.filter((s) => {
      const sec = sectorOf.get(s.fornecedor)?.sector ?? NONE;
      return (classe === "Todas" || s.classe === classe) && s.fornecedor.toLowerCase().includes(q.toLowerCase()) && (fSector === "todos" || sec === fSector);
    }),
    [suppliers, q, classe, fSector, sectorOf],
  );
  const pareto = suppliers.slice(0, 20).map((s) => ({ name: s.fornecedor.slice(0, 14), Total: s.total, Acumulado: +(s.acumulado * 100).toFixed(1) }));
  const months = data?.months ?? [];

  return (
    <div>
      <PageHeader eyebrow="Compras" title="Curva ABC de Fornecedores" subtitle="Classe A = fornecedores que somam até 80% das compras, B até 95%, C o restante. O setor de cada fornecedor define as compras do CMV por setor." />
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

          {sectorRows && <ReviewPanel rows={sectorRows} />}

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
                <Select value={fSector} onValueChange={(v: string) => setFSector(v)}>
                  <SelectTrigger size="sm" className="w-32" data-testid="abc-filter-sector"><SelectValue>{(v: string) => (v === "todos" ? "Setor" : v === NONE ? "Sem setor" : v)}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos setores</SelectItem>
                    <SelectItem value={NONE}>Sem setor</SelectItem>
                    {SECTOR_OPTS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input data-testid="abc-search-input" placeholder="Buscar fornecedor" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-48" />
              </div>
            }
          >
            <div className="max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 bg-[#0F172A] hover:bg-[#0F172A]">
                    {["#", "Fornecedor", "Setor (CMV)", "Classe", "Total", "%", "Acum.", "Notas", "Média/nota", ...months.map(monthLabel), "Última"].map((h) => (
                      <TableHead key={h} className="whitespace-nowrap text-xs uppercase text-slate-400">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.fornecedor} data-testid={`abc-row-${s.rank}`} className="border-slate-800/70 hover:bg-slate-800/30">
                      <TableCell className="num text-slate-500">{s.rank}</TableCell>
                      <TableCell className="max-w-[240px] truncate font-medium" title={s.fornecedor}>{s.fornecedor}</TableCell>
                      <TableCell><SectorPicker row={sectorOf.get(s.fornecedor)} /></TableCell>
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
