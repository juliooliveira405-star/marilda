import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, Panel } from "@/components/common";
import { LabelConfirm, ManualLine, QrReader, type PickedLine } from "@/components/QrTools";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiDelete, apiPost, errorMessage } from "@/lib/api";
import { DERIVED_KEYS, qk, useCounts, useMe, useOverview, useValidades } from "@/lib/queries";
import { dateTimeBr, monthLabel, qty } from "@/lib/format";
import type { BaixaIn, CountApplyOut, CountEntry, CountEntryIn, ValidadeAlert } from "@/lib/types";
import { cn } from "@/lib/utils";

type CountSector = "Cozinha" | "Bar" | "Quiosque" | "Estoque";
const PROD_SECTORS: CountSector[] = ["Cozinha", "Bar", "Quiosque", "Estoque"];

function ValidadesPanel() {
  const qc = useQueryClient();
  const { data } = useValidades();
  const baixa = useMutation({
    mutationFn: ({ code, motivo }: { code: string; motivo: BaixaIn["motivo"] }) => apiPost<ValidadeAlert[]>(`/validades/${code}/baixa`, { motivo }),
    onSuccess: (r) => {
      qc.setQueryData(qk.validades, r);
      void qc.invalidateQueries({ queryKey: qk.notifications });
      toast.success("Baixa registrada");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = data ?? [];
  const { hash } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hash === "#validades" && data) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash, data]);
  const bySector = list.reduce<Record<string, ValidadeAlert[]>>((acc, v) => ({ ...acc, [v.sector]: [...(acc[v.sector] ?? []), v] }), {});
  return (
    <div id="validades" ref={ref} className="scroll-mt-20">
      <Panel title={`Validades — próximos 7 dias (${list.length})`} testId="validades-panel">
        {!list.length ? (
          <p className="text-xs text-slate-500" data-testid="validades-empty">Nenhuma etiqueta lida vencendo nos próximos 7 dias. O sino avisa quando faltar 3 dias ou menos.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(bySector).map(([sec, rows]) => (
              <div key={sec}>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{sec}</div>
                <ul className="space-y-2">
                  {rows.map((v) => (
                    <li key={v.code} className={cn("rounded-lg border p-2.5 text-sm", v.dias <= 3 ? "border-[#F87171]/50 bg-[#450A0A]/25" : "border-slate-800")} data-testid={`validade-row-${v.code}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-slate-100">{v.descricao}</span>
                          <span className="text-[11px] text-slate-500">{qty(v.qty)} {v.um}{v.label_id && ` · #${v.label_id}`}</span>
                        </span>
                        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", v.dias <= 3 ? "bg-[#450A0A] text-[#F87171]" : "bg-[#78350F] text-[#FDE68A]")}>
                          {v.dias < 0 ? "vencido" : v.dias === 0 ? "vence hoje" : `${v.dias} dia${v.dias > 1 ? "s" : ""}`} · {v.validade.slice(8, 10)}/{v.validade.slice(5, 7)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(["consumido", "transferido", "descartado"] as const).map((m) => (
                          <Button key={m} size="sm" variant={m === "descartado" ? "destructive" : "outline"} className="h-8 text-xs capitalize"
                            data-testid={`validade-baixa-${m}-${v.code}`} disabled={baixa.isPending} onClick={() => baixa.mutate({ code: v.code, motivo: m })}>
                            {m}
                          </Button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function ContagemQR() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: dash } = useOverview();
  const defaultMonth = dash?.months.at(-1)?.month ?? "";
  const [monthSel, setMonthSel] = useState("");
  const month = monthSel || defaultMonth;
  const { data } = useCounts(month);
  const [raw, setRaw] = useState<string | null>(null);
  const [autoKnown, setAutoKnown] = useState(true);
  const [confirmApply, setConfirmApply] = useState(false);
  const mySectors = PROD_SECTORS.filter((s) => me?.perms.op_sectors.includes(s));
  const [sector, setSector] = useState<CountSector>(mySectors.includes("Estoque") ? "Estoque" : (mySectors[0] ?? "Estoque"));
  const monthRow = dash?.months.find((m) => m.month === month);

  const add = useMutation({
    mutationFn: (body: CountEntryIn) => apiPost<CountEntry>("/counts", body),
    onSuccess: (e) => {
      toast.success(`+${qty(e.qty)} ${e.um} · ${e.descricao}`);
      void qc.invalidateQueries({ queryKey: [...qk.counts, month] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível registrar")),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete<CountEntry>(`/counts/entries/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...qk.counts, month] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => apiPost<CountApplyOut>(`/counts/${month}/apply`),
    onSuccess: (r) => {
      toast.success(r.message);
      setConfirmApply(false);
      void qc.invalidateQueries({ queryKey: [...qk.counts, month] });
      DERIVED_KEYS.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const addLine = useCallback(
    (l: PickedLine) => {
      setRaw(null);
      add.mutate({ month, ...l, sector });
    },
    [add, month, sector],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Inventário"
        title="Contagem por QR Code"
        subtitle="Leia as etiquetas Suflex (ou digite) e o peso/quantidade entra direto na contagem do mês — sem digitação, sem erro."
      />
      <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Panel testId="count-month-panel">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Mês da contagem</Label>
                <Input type="month" data-testid="count-month-input" value={month} onChange={(e) => setMonthSel(e.target.value)} className="w-44" />
              </div>
              <div>
                <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Setor da produção</Label>
                <div className="flex flex-wrap gap-1.5" data-testid="count-sector-selector">
                  {mySectors.map((s) => (
                    <button key={s} type="button" data-testid={`count-sector-${s}`} onClick={() => setSector(s)}
                      className={cn("min-h-10 rounded-lg border px-3 text-xs transition-[border-color,background-color] duration-150",
                        sector === s ? "border-amber bg-amber/10 text-amber" : "border-slate-800 text-slate-400 hover:border-slate-600")}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 pb-2 text-xs text-slate-300">
                <Checkbox data-testid="count-auto-known-checkbox" checked={autoKnown} onCheckedChange={(c: boolean) => setAutoKnown(c)} />
                Somar etiquetas já conhecidas automaticamente
              </label>
            </div>
          </Panel>
          <Panel>
            <Tabs defaultValue="qr">
              <TabsList className="mb-4">
                <TabsTrigger value="qr" data-testid="count-tab-qr">QR Code</TabsTrigger>
                <TabsTrigger value="manual" data-testid="count-tab-manual">Sem etiqueta</TabsTrigger>
              </TabsList>
              <TabsContent value="qr" className="space-y-4">
                <QrReader onScan={setRaw} testId="count-qr" />
                {raw && <LabelConfirm key={raw} raw={raw} autoKnown={autoKnown} onConfirm={addLine} onCancel={() => setRaw(null)} />}
              </TabsContent>
              <TabsContent value="manual" className="space-y-3">
                <p className="rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber" data-testid="count-manual-hint">
                  Fallback sem etiqueta: a leitura fica marcada como “pendente Suflex” e registrada no log de auditoria.
                </p>
                <ManualLine onAdd={addLine} testId="count-manual" />
              </TabsContent>
            </Tabs>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title={`Contagem ${monthLabel(month)} — ${data?.items.length ?? 0} itens`}
            testId="count-summary"
            action={
              me?.perms.stock && <Button size="sm" data-testid="count-apply-button" disabled={!data?.items.length} onClick={() => setConfirmApply(true)}>
                <CheckCheck className="mr-1 h-4 w-4" /> Aplicar ao inventário
              </Button>
            }
          >
            {data?.applied_at && (
              <p className="mb-3 text-xs text-slate-500" data-testid="count-applied-info">Última aplicação: {dateTimeBr(data.applied_at)} por {data.applied_by}</p>
            )}
            {!data?.items.length ? (
              <EmptyState title="Nenhuma leitura ainda" detail="Leia a primeira etiqueta ao lado." />
            ) : (
              <ul className="divide-y divide-slate-800/70">
                {data.items.map((i) => (
                  <li key={i.item} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid={`count-item-${i.item}`}>
                    <span className="min-w-0">
                      <span className="block truncate text-slate-100">{i.descricao}</span>
                      <span className="text-[11px] text-slate-500">#{i.item} · {i.leituras} leitura(s)</span>
                    </span>
                    <span className="num shrink-0 font-semibold text-amber">{qty(i.qty)} {i.um}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <ValidadesPanel />
          <Panel title="Últimas leituras" testId="count-entries">
            <ul className="max-h-80 divide-y divide-slate-800/70 overflow-y-auto">
              {(data?.entries ?? []).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-xs" data-testid={`count-entry-${e.id}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-slate-200">{e.descricao} {e.qr_code ? <span className="ml-1 rounded bg-[#1E1B4B] px-1 text-[10px] text-[#A5B4FC]">QR</span>
                      : <span className="ml-1 rounded bg-[#78350F] px-1 text-[10px] text-[#FDE68A]" data-testid={`count-entry-manual-${e.id}`}>manual · pendente Suflex</span>}</span>
                    <span className="text-slate-500">{dateTimeBr(e.created_at)} · {e.sector ?? "Estoque"} · {e.user_email}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="num text-slate-200">{qty(e.qty)} {e.um}</span>
                    {(me?.role === "gerente" || me?.email === e.user_email) && (
                      <Button variant="ghost" size="icon-xs" aria-label="Apagar leitura" data-testid={`count-entry-delete-${e.id}`} onClick={() => del.mutate(e.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Dialog open={confirmApply} onOpenChange={setConfirmApply}>
        <DialogContent data-testid="count-apply-dialog">
          <DialogHeader>
            <DialogTitle>Aplicar contagem de {monthLabel(month)}?</DialogTitle>
            <DialogDescription>
              {data?.items.length} itens terão a quantidade do inventário de {monthLabel(month)} substituída pela soma das leituras. Os demais itens do inventário não mudam.
              {monthRow && !monthRow.tem_inventario && " Ainda não existe inventário deste mês — será criado só com os itens lidos."}
              {" "}Estoque, CMV e sugestões serão recalculados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmApply(false)} data-testid="count-apply-cancel">Cancelar</Button>
            <Button onClick={() => apply.mutate()} disabled={apply.isPending} data-testid="count-apply-confirm">
              {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
