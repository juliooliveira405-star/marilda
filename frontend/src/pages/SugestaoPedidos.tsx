import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FilePlus2, Loader2 } from "lucide-react";
import { apiPost, errorMessage } from "@/lib/api";
import { EmptyState, PageHeader, Panel, Skeleton, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMe, useOverview, useReorder } from "@/lib/queries";
import { brl, monthLabel, qty, STATUS_STYLES } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReorderItem, Requisition, RequisitionIn } from "@/lib/types";
const SECTOR_FILTER = ["Todos", "Cozinha", "Bar", "Salão", "Quiosque", "Estoque"];

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
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: dash } = useOverview();
  const invMonths = (dash?.months ?? []).filter((m) => m.tem_inventario).map((m) => m.month);
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();
  const [sectorSel, setSectorSel] = useState("Todos");
  const isManager = me?.role === "gerente";
  const { data, isLoading, isError } = useReorder(from, to, isManager && sectorSel !== "Todos" ? sectorSel : undefined);
  const draft = useMutation({
    mutationFn: (body: RequisitionIn) => apiPost<Requisition>("/requisitions", body),
    onSuccess: (r) => {
      toast.success(`Rascunho Nº ${r.number} criado com ${r.items.length} itens — revise e envie`);
      navigate(`/requisicoes?abrir=${r.id}`);
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível gerar a requisição")),
  });
  const gerarZerados = () => {
    const lines = (data?.items ?? []).filter((i) => i.status === "ZERADO" || i.status === "BAIXOU FORTE").map((i) => ({
      item: i.item, descricao: i.descricao, um: i.um, qty: Math.max(+(i.qtd_anterior - Math.max(i.qtd_atual, 0)).toFixed(3), 1), qr_code: null,
    }));
    if (!lines.length) return toast.info("Nenhum item zerado ou com baixa forte");
    const sector = me?.role === "chefe" ? (me.sector ?? "Estoque") : sectorSel !== "Todos" ? sectorSel : "Estoque";
    draft.mutate({ sector, priority: "normal", items: lines, note: `Gerada da sugestão ${monthLabel(data?.from_month)} → ${monthLabel(data?.to_month)}`, submit: false, force: false });
  };
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);

  const items = useMemo(() => (isError ? [] : (data?.items ?? [])), [isError, data]);
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
          <>
            <Button size="sm" data-testid="reorder-generate-requisition-button" disabled={draft.isPending || !items.length} onClick={gerarZerados}>
              {draft.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-1 h-4 w-4" />} Gerar requisição dos zerados
            </Button>
            {isManager && (
              <Button variant="outline" size="sm" data-testid="reorder-export-button" disabled={!filtered.length}
                onClick={() => exportCsv(filtered, monthLabel(data?.from_month), monthLabel(data?.to_month))}>
                <Download className="mr-1 h-4 w-4" /> Exportar CSV
              </Button>
            )}
          </>
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
        {isManager ? (
          <Select value={sectorSel} onValueChange={(v: string) => setSectorSel(v)}>
            <SelectTrigger size="sm" className="w-36" data-testid="reorder-sector-select"><SelectValue>{(v: string) => (v === "Todos" ? "Todos os setores" : v)}</SelectValue></SelectTrigger>
            <SelectContent>{SECTOR_FILTER.map((s) => <SelectItem key={s} value={s}>{s === "Todos" ? "Todos os setores" : s}</SelectItem>)}</SelectContent>
          </Select>
        ) : data?.sector ? (
          <span className="rounded bg-amber/10 px-2 py-1 text-xs text-amber" data-testid="reorder-locked-sector">Setor {data.sector}</span>
        ) : null}
        {data?.costs_visible && data.valor_reposicao_total !== null && (
          <div className="ml-auto rounded-lg border border-amber/30 bg-amber/5 px-3 py-1.5 text-xs text-slate-300" data-testid="reorder-total">
            Reposição estimada (zerados + baixou forte): <span className="num font-semibold text-amber">{brl(data.valor_reposicao_total)}</span>
          </div>
        )}
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
                  {["Item", "Descrição", "Setor", monthLabel(data?.from_month), monthLabel(data?.to_month), "Var.", "Var %", "Status", "Sugestão", ...(data?.costs_visible ? ["Custo unit.", "Reposição"] : [])].map((h, i) => (
                    <TableHead key={`${h}-${i}`} className="whitespace-nowrap text-xs uppercase text-slate-400">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((i, idx) => (
                  <TableRow key={i.item} data-testid={`reorder-row-${idx}`} className="border-slate-800/70 hover:bg-slate-800/30">
                    <TableCell className="num text-xs text-slate-500">{i.item}</TableCell>
                    <TableCell className="max-w-[260px] truncate" title={i.descricao}>{i.descricao}</TableCell>
                    <TableCell className="text-xs text-slate-400">{i.setor}<div className="text-[10px] text-slate-600">{i.grupo}</div></TableCell>
                    <TableCell className="num text-right">{qty(i.qtd_anterior)} <span className="text-[10px] text-slate-500">{i.um}</span></TableCell>
                    <TableCell className="num text-right">{qty(i.qtd_atual)}</TableCell>
                    <TableCell className={cn("num text-right", i.variacao < 0 ? "text-[#FB923C]" : i.variacao > 0 ? "text-[#60A5FA]" : "text-slate-500")}>{qty(i.variacao)}</TableCell>
                    <TableCell className="num text-right text-slate-400">{i.var_pct.toFixed(0)}%</TableCell>
                    <TableCell><StatusBadge status={i.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-300">{i.sugestao}</TableCell>
                    {data?.costs_visible && <TableCell className="num text-right">{i.custo !== null ? brl(i.custo, true) : <span className="text-[#FBBF24]">sem custo</span>}</TableCell>}
                    {data?.costs_visible && <TableCell className="num text-right">{i.valor_reposicao ? brl(i.valor_reposicao) : "—"}</TableCell>}
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
