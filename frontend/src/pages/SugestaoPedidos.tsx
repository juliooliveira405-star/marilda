import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { EmptyState, PageHeader, Panel, Skeleton, StatusBadge, STATUS_STYLES } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDashboard, useReorder } from "@/lib/queries";
import { brl, monthLabel, qty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReorderItem } from "@/lib/types";

const ALL = "TODOS";

function exportCsv(items: ReorderItem[], from: string, to: string) {
  const head = ["Item", "Descrição", "UM", "Grupo", `Qtd ${from}`, `Qtd ${to}`, "Variação", "Var %", "Status", "Sugestão", "Custo unit.", "Reposição R$"];
  const lines = items.map((i) =>
    [i.item, i.descricao, i.um, i.grupo, i.qtd_anterior, i.qtd_atual, i.variacao, i.var_pct, i.status, i.sugestao, i.custo ?? "", i.valor_reposicao]
      .map((v) => `"${typeof v === "number" ? String(v).replace(".", ",") : String(v).replace(/"/g, '""')}"`)
      .join(";"),
  );
  const blob = new Blob(["\uFEFF" + [head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sugestao_pedido_${to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function SugestaoPedidos() {
  const { data: dash } = useDashboard();
  const invMonths = (dash?.months ?? []).filter((m) => m.itens_inventario > 0).map((m) => m.month);
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();
  const { data, isLoading, isError } = useReorder(from, to);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);

  const items = isError ? [] : (data?.items ?? []);
  const filtered = useMemo(
    () =>
      items.filter(
        (i) => (status === ALL || i.status === status) && `${i.item} ${i.descricao} ${i.grupo}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [items, q, status],
  );
  const shown = filtered.slice(0, 300);

  return (
    <div>
      <PageHeader
        eyebrow="Estoque"
        title="Sugestão de Pedidos"
        subtitle="Comparação entre dois inventários. ZERADO = priorizar; BAIXOU FORTE (≥40% e ≥2 un) = revisar; SUBIU MUITO (≥50% e ≥5 un) = checar sobreestoque."
        actions={
          <Button variant="outline" size="sm" data-testid="reorder-export-button" disabled={!filtered.length}
            onClick={() => exportCsv(filtered, monthLabel(data?.from_month), monthLabel(data?.to_month))}>
            <Download className="mr-1 h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-400">Comparar</span>
        <Select value={from ?? data?.from_month ?? ""} onValueChange={(v: string) => setFrom(v)}>
          <SelectTrigger size="sm" className="w-32" data-testid="reorder-from-select"><SelectValue>{(v: string) => monthLabel(v)}</SelectValue></SelectTrigger>
          <SelectContent>{invMonths.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-slate-400">→</span>
        <Select value={to ?? data?.to_month ?? ""} onValueChange={(v: string) => setTo(v)}>
          <SelectTrigger size="sm" className="w-32" data-testid="reorder-to-select"><SelectValue>{(v: string) => monthLabel(v)}</SelectValue></SelectTrigger>
          <SelectContent>{invMonths.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
        </Select>
        <div className="ml-auto rounded-lg border border-amber/30 bg-amber/5 px-3 py-1.5 text-xs text-slate-300" data-testid="reorder-total">
          Reposição estimada (zerados + baixou forte): <span className="num font-semibold text-amber">{brl(data?.valor_reposicao_total)}</span>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" data-testid="reorder-counts">
        {Object.entries(data?.counts ?? {}).map(([s, n]) => (
          <button key={s} data-testid={`reorder-chip-${s.toLowerCase().replace(/\s|á/g, "-")}`} onClick={() => setStatus(status === s ? ALL : s)}
            className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-[border-color,transform] duration-150 hover:-translate-y-0.5",
              status === s ? "border-amber" : "border-slate-800")}>
            <span className={cn("rounded px-1.5 py-0.5 font-semibold", STATUS_STYLES[s])}>{s}</span>
            <span className="num text-slate-200">{n}</span>
          </button>
        ))}
      </div>

      <Panel
        testId="reorder-suggestion-table"
        title={`${filtered.length} itens`}
        action={
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={(v: string) => setStatus(v)}>
              <SelectTrigger size="sm" className="w-40" data-testid="reorder-status-select"><SelectValue>{(v: string) => (v === ALL ? "Todos os status" : v)}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os status</SelectItem>
                {Object.keys(STATUS_STYLES).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input data-testid="reorder-search-input" placeholder="Buscar item ou grupo" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-52" />
          </div>
        }
      >
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : !items.length ? (
          <EmptyState title="São necessários dois inventários" detail="Envie as contagens de dois meses para gerar a sugestão." />
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 bg-[#0F172A] hover:bg-[#0F172A]">
                  {["Item", "Descrição", "Grupo", monthLabel(data?.from_month), monthLabel(data?.to_month), "Var.", "Var %", "Status", "Sugestão", "Reposição"].map((h, i) => (
                    <TableHead key={`${h}-${i}`} className="whitespace-nowrap text-xs uppercase text-slate-400">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((i, idx) => (
                  <TableRow key={i.item} data-testid={`reorder-row-${idx}`} className="border-slate-800/70 hover:bg-slate-800/30">
                    <TableCell className="num text-xs text-slate-500">{i.item}</TableCell>
                    <TableCell className="max-w-[260px] truncate" title={i.descricao}>{i.descricao}</TableCell>
                    <TableCell className="text-xs text-slate-400">{i.grupo}</TableCell>
                    <TableCell className="num text-right">{qty(i.qtd_anterior)} <span className="text-[10px] text-slate-500">{i.um}</span></TableCell>
                    <TableCell className="num text-right">{qty(i.qtd_atual)}</TableCell>
                    <TableCell className={cn("num text-right", i.variacao < 0 ? "text-[#FB923C]" : i.variacao > 0 ? "text-[#60A5FA]" : "text-slate-500")}>{qty(i.variacao)}</TableCell>
                    <TableCell className="num text-right text-slate-400">{i.var_pct.toFixed(0)}%</TableCell>
                    <TableCell><StatusBadge status={i.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-300">{i.sugestao}</TableCell>
                    <TableCell className="num text-right">{i.valor_reposicao ? brl(i.valor_reposicao) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length > shown.length && <div className="p-3 text-center text-xs text-slate-500">Mostrando 300 de {filtered.length} — refine a busca ou exporte o CSV.</div>}
          </div>
        )}
      </Panel>
    </div>
  );
}
