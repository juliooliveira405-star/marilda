import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bike, Loader2, Save, UploadCloud } from "lucide-react";
import { EmptyState, KpiCard, PageHeader, Panel, Skeleton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiPut, apiUpload, errorMessage } from "@/lib/api";
import { qk, useIfood } from "@/lib/queries";
import { brl, monthLabel, pct, qty } from "@/lib/format";
import type { IfoodConfig, IfoodItem, IfoodMapIn, IfoodUploadOut } from "@/lib/types";

const SETORES = ["Quiosque", "Cozinha", "Bar"] as const;
const ALL = "todos";
const num = (s: string) => Number(s.replace(",", "."));

function ConfigForm({ cfg }: { cfg: IfoodConfig }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ taxa: String(cfg.taxa * 100), cmv: String(cfg.cmv_estimado * 100), setor: cfg.setor_padrao, incluir: cfg.incluir_cmv, formato: cfg.formato });
  const save = useMutation({
    mutationFn: () => apiPut<IfoodConfig>("/ifood/config", { taxa: num(f.taxa) / 100, cmv_estimado: num(f.cmv) / 100, setor_padrao: f.setor, incluir_cmv: f.incluir, formato: f.formato } satisfies IfoodConfig),
    onSuccess: () => { toast.success("Configuração iFood salva"); void qc.invalidateQueries({ queryKey: qk.ifood }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Configuração" testId="ifood-config">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label className="mb-1.5 text-xs text-slate-400">Taxa iFood (%)</Label><Input inputMode="decimal" data-testid="ifood-config-taxa" value={f.taxa} onChange={(e) => setF({ ...f, taxa: e.target.value })} /></div>
        <div><Label className="mb-1.5 text-xs text-slate-400">CMV estimado iFood (%)</Label><Input inputMode="decimal" data-testid="ifood-config-cmv" value={f.cmv} onChange={(e) => setF({ ...f, cmv: e.target.value })} /></div>
        <div>
          <Label className="mb-1.5 text-xs text-slate-400">Setor padrão</Label>
          <Select value={f.setor} onValueChange={(v: string) => setF({ ...f, setor: v as IfoodConfig["setor_padrao"] })}>
            <SelectTrigger data-testid="ifood-config-setor"><SelectValue /></SelectTrigger>
            <SelectContent>{SETORES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label className="mb-1.5 text-xs text-slate-400">Formato do relatório</Label><Input data-testid="ifood-config-formato" maxLength={40} value={f.formato} onChange={(e) => setF({ ...f, formato: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2">
          <Checkbox data-testid="ifood-config-incluir" checked={f.incluir} onCheckedChange={(c: boolean) => setF({ ...f, incluir: c })} />Incluir iFood no CMV geral (quando o formato estiver definido)
        </label>
      </div>
      <Button className="mt-4" data-testid="ifood-config-save" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar configuração
      </Button>
    </Panel>
  );
}

function MapRow({ it }: { it: IfoodItem }) {
  const qc = useQueryClient();
  const [custo, setCusto] = useState(it.custo === null ? "" : String(it.custo).replace(".", ","));
  const save = useMutation({
    mutationFn: (b: IfoodMapIn) => apiPut<IfoodConfig>("/ifood/map", b),
    onSuccess: () => { toast.success(`${it.item} mapeado`); void qc.invalidateQueries({ queryKey: qk.ifood }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const body = (patch: Partial<IfoodMapIn>): IfoodMapIn => ({ item: it.item, setor: it.setor as IfoodMapIn["setor"], entra_cmv: it.entra_cmv, custo: custo ? num(custo) : null, ...patch });
  return (
    <TableRow className="border-slate-800/70" data-testid={`ifood-item-${it.item}`}>
      <TableCell className="max-w-[220px] truncate" title={it.item}>{it.item}{!it.mapeado && <span className="ml-1 text-[10px] text-amber">novo</span>}</TableCell>
      <TableCell className="num text-right">{qty(it.qtd)}</TableCell>
      <TableCell className="num text-right">{brl(it.bruto)}</TableCell>
      <TableCell>
        <Select value={it.setor} onValueChange={(v: string) => save.mutate(body({ setor: v as IfoodMapIn["setor"] }))}>
          <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{SETORES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </TableCell>
      <TableCell><Checkbox checked={it.entra_cmv} onCheckedChange={(c: boolean) => save.mutate(body({ entra_cmv: c }))} aria-label="Entra no CMV" /></TableCell>
      <TableCell>
        <Input inputMode="decimal" className="h-8 w-24" placeholder="custo un." value={custo} onChange={(e) => setCusto(e.target.value)}
          onBlur={() => custo !== (it.custo === null ? "" : String(it.custo).replace(".", ",")) && save.mutate(body({}))} />
      </TableCell>
      <TableCell className="num text-right">{brl(it.cmv)}</TableCell>
    </TableRow>
  );
}

export default function Ifood() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(ALL);
  const { data, isLoading } = useIfood(month === ALL ? undefined : month);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); return apiUpload<IfoodUploadOut>("/ifood/upload", fd); },
    onSuccess: (r) => { toast.success(r.message); void qc.invalidateQueries({ queryKey: qk.ifood }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao importar")),
  });
  return (
    <div>
      <PageHeader eyebrow="Delivery" title="iFood" subtitle="Estrutura pronta: aguardando o formato oficial do relatório. Setor padrão Quiosque. Colunas reconhecidas: Data, ID Pedido, Item, Quantidade, Valor Unitário/Total, Taxa iFood."
        actions={<>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" data-testid="ifood-upload-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
          <Button size="lg" data-testid="ifood-upload-button" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
            {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}Importar relatório
          </Button>
        </>} />
      {isLoading || !data ? <Skeleton className="h-72" /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={month} onValueChange={(v: string) => setMonth(v)}>
              <SelectTrigger size="sm" className="w-36" data-testid="ifood-month-select"><SelectValue>{(v: string) => (v === ALL ? "Todos os meses" : monthLabel(v))}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>Todos os meses</SelectItem>{data.months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard testId="ifood-kpi-bruto" label="Faturamento bruto" value={brl(data.bruto)} hint={`${data.pedidos} pedidos · ticket ${brl(data.ticket_medio)}`} icon={<Bike className="h-4 w-4" />} />
            <KpiCard testId="ifood-kpi-taxas" label="Taxas iFood" value={brl(data.taxas)} hint={`config: ${pct(data.config.taxa)}`} />
            <KpiCard testId="ifood-kpi-liquido" label="Líquido" value={brl(data.liquido)} />
            <KpiCard testId="ifood-kpi-cmv" label="CMV iFood" value={pct(data.cmv_pct)} hint={`${brl(data.cmv)} · ${data.itens_sem_custo} itens sem custo · estimado ${pct(data.config.cmv_estimado)}`} />
          </div>
          <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
            <ConfigForm key={JSON.stringify(data.config)} cfg={data.config} />
            <Panel title={`Mapeamento de itens (${data.items.length})`} testId="ifood-items">
              {!data.items.length ? <EmptyState title="Nenhum relatório importado" detail="Quando o formato do relatório iFood chegar, importe aqui (CSV ou Excel)." testId="ifood-empty" /> : (
                <div className="max-h-[520px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        {["Item", "Qtd", "Bruto", "Setor", "CMV?", "Custo un.", "CMV R$"].map((h) => <TableHead key={h} className="whitespace-nowrap text-xs uppercase text-slate-400">{h}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>{data.items.map((it) => <MapRow key={`${it.item}-${it.custo ?? ""}`} it={it} />)}</TableBody>
                  </Table>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
