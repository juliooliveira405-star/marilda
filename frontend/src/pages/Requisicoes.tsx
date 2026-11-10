import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check, ChefHat, CopyPlus, Download, FileDown, Loader2, PackageCheck, PackageOpen, Pencil, Plus, Send, ShoppingBag, Trash2, Truck, Undo2, X,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, Panel } from "@/components/common";
import { LabelConfirm, ManualLine, QrReader, type PickedLine } from "@/components/QrTools";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiDownload, apiPost, apiPut, errorMessage } from "@/lib/api";
import { qk, useMe, useRequisitions, useWindows } from "@/lib/queries";
import { brl, dateTimeBr, qty } from "@/lib/format";
import type {
  Availability, DupCheck, DupReq, FulfillIn, Me, ReqAction, ReqLineIn, ReqStatus, Requisition, RequisitionIn, TimeWindow, WindowsResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const SECTORS = ["Cozinha", "Bar", "Quiosque", "Salão", "Estoque"];
const STATUS: Record<ReqStatus, { label: string; cls: string }> = {
  rascunho: { label: "Rascunho", cls: "bg-slate-800 text-slate-300" },
  enviada: { label: "Enviada", cls: "bg-[#1E3A8A] text-[#93C5FD]" },
  aprovada: { label: "Aprovada", cls: "bg-[#064E3B] text-[#6EE7B7]" },
  devolvida: { label: "Devolvida p/ ajuste", cls: "bg-[#78350F] text-[#FDE68A]" },
  rejeitada: { label: "Rejeitada", cls: "bg-[#450A0A] text-[#F87171]" },
  em_preparo: { label: "Em preparo", cls: "bg-[#7C2D12] text-[#FDBA74]" },
  pronto: { label: "Pronto", cls: "bg-[#713F12] text-[#FDE047]" },
  entregue: { label: "Entregue", cls: "bg-[#14532D] text-[#86EFAC]" },
  comprada: { label: "Comprada", cls: "bg-[#1E1B4B] text-[#A5B4FC]" },
  recebida: { label: "Compra recebida", cls: "bg-[#164E63] text-[#67E8F9]" },
  excluida: { label: "Excluída", cls: "bg-slate-900 text-slate-500" },
};
const AVAIL: Record<Availability, { label: string; cls: string }> = {
  pendente: { label: "A separar", cls: "text-slate-500" },
  ok: { label: "Tem", cls: "bg-[#064E3B] text-[#6EE7B7]" },
  parcial: { label: "Parcial", cls: "bg-[#78350F] text-[#FDE68A]" },
  sem_estoque: { label: "Sem estoque", cls: "bg-[#450A0A] text-[#F87171]" },
};
const STEPS: ReqStatus[] = ["enviada", "aprovada", "em_preparo", "pronto", "entregue"];
const STOCK_STAGE: ReqStatus[] = ["aprovada", "em_preparo", "comprada", "recebida", "pronto"];
const GROUPS: Record<string, { label: string; match: (s: ReqStatus) => boolean }> = {
  todos: { label: "Todas", match: () => true },
  aguardando: { label: "Aguardando aprovação", match: (s) => s === "enviada" },
  separar: { label: "Para separar / entregar", match: (s) => STOCK_STAGE.includes(s) },
  finalizadas: { label: "Entregues", match: (s) => s === "entregue" },
  ajuste: { label: "Rascunho / ajuste / rejeitadas", match: (s) => ["rascunho", "devolvida", "rejeitada"].includes(s) },
};
const ALL = "todos";
const isStock = (me: Me) => me.perms.stock;
const invalidate = (qc: ReturnType<typeof useQueryClient>) => [qk.requisitions, qk.notifications].forEach((k) => void qc.invalidateQueries({ queryKey: k }));
type EditorLine = ReqLineIn & { key: string };
const toLines = (items: ReqLineIn[]): EditorLine[] => items.map(({ item, descricao, um, qty: q, qr_code }) => ({ item, descricao, um, qty: q, qr_code, key: crypto.randomUUID() }));

function exportCsv(list: Requisition[]) {
  const head = ["Nº", "Data", "Setor", "Prioridade", "Status", "Solicitante", "Item", "Descrição", "Qtd", "UM", "Atendido", "Disponibilidade"];
  const lines = list.flatMap((r) => r.items.map((i) => [r.number, r.created_at.slice(0, 10), r.sector, r.priority, STATUS[r.status].label, r.requested_by,
    i.item, i.descricao, String(i.qty).replace(".", ","), i.um, i.atendido === null ? "" : String(i.atendido).replace(".", ","), AVAIL[i.disponibilidade].label]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")));
  const blob = new Blob(["\uFEFF" + [head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "requisicoes.csv";
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function Editor({ me, openSectors, editing, template, onDone }: { me: Me; openSectors: string[]; editing: Requisition | null; template: Requisition | null; onDone: () => void }) {
  const qc = useQueryClient();
  const base = editing ?? template;
  const mySectors = SECTORS.filter((s) => me.perms.op_sectors.includes(s));
  const [sector, setSector] = useState(base?.sector && mySectors.includes(base.sector) ? base.sector : mySectors.length === 1 ? mySectors[0] : "");
  const [priority, setPriority] = useState<"normal" | "urgente">(base?.priority ?? "normal");
  const [lines, setLines] = useState<EditorLine[]>(toLines(base?.items ?? []));
  const [note, setNote] = useState(editing?.note ?? (template ? `Nova a partir da Nº ${template.number}` : ""));
  const [raw, setRaw] = useState<string | null>(null);
  const [dups, setDups] = useState<DupReq[] | null>(null);
  const addLine = useCallback((l: PickedLine) => {
    setRaw(null);
    setLines((p) => [...p, { item: l.item, descricao: l.descricao, um: l.um, qty: l.qty, qr_code: l.qr_code, key: crypto.randomUUID() }]);
  }, []);
  const body = (submit: boolean, force = false): RequisitionIn => ({ sector, priority, items: lines.map(({ key: _k, ...l }) => l), note, submit, force });
  const done = (r: Requisition) => {
    toast.success(r.status === "rascunho" ? `Rascunho Nº ${r.number} salvo` : r.direct ? `Nº ${r.number} aprovada automaticamente (horário livre)` : `Nº ${r.number} enviada — estoque e gerente notificados`);
    setDups(null);
    invalidate(qc);
    onDone();
  };
  const save = useMutation({
    mutationFn: (b: RequisitionIn) => (editing ? apiPut<Requisition>(`/requisitions/${editing.id}`, b) : apiPost<Requisition>("/requisitions", b)),
    onSuccess: done,
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar")),
  });
  const merge = useMutation({
    mutationFn: (rid: string) => apiPost<Requisition>(`/requisitions/${rid}/add-items`, body(true)),
    onSuccess: (r) => { toast.success(`Itens adicionados à Nº ${r.number}`); setDups(null); invalidate(qc); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const check = useMutation({
    mutationFn: () => apiPost<DupCheck>("/requisitions/check", { sector, items: body(true).items }),
    onSuccess: (r) => {
      const others = r.duplicates.filter((d) => d.id !== editing?.id);
      if (others.length) setDups(others);
      else save.mutate(body(true, true));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const busy = save.isPending || check.isPending || merge.isPending;

  return (
    <Panel title={editing ? `Editar requisição Nº ${editing.number}` : "Nova requisição"} testId="requisition-editor">
      <div className="space-y-5">
        <div>
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Setor de origem</Label>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap" data-testid="requisition-sector-selector">
            {mySectors.map((s) => (
              <button key={s} type="button" data-testid={`requisition-sector-${s}`} disabled={mySectors.length === 1} onClick={() => setSector(s)}
                className={cn("min-h-11 rounded-lg border px-3 py-2 text-sm transition-[border-color,background-color] duration-150",
                  sector === s ? "border-amber bg-amber/10 text-amber" : "border-slate-800 text-slate-300 hover:border-slate-600")}>
                {s}{openSectors.includes(s) && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald align-middle" />}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2" data-testid="requisition-priority">
          {(["normal", "urgente"] as const).map((p) => (
            <button key={p} type="button" data-testid={`requisition-priority-${p}`} onClick={() => setPriority(p)}
              className={cn("min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm capitalize transition-colors duration-150 sm:flex-none",
                priority === p ? (p === "urgente" ? "border-[#F87171] bg-[#450A0A] text-[#F87171]" : "border-amber bg-amber/10 text-amber") : "border-slate-800 text-slate-400")}>
              {p}
            </button>
          ))}
        </div>
        <Tabs defaultValue="manual">
          <TabsList className="mb-3">
            <TabsTrigger value="manual" data-testid="requisition-tab-manual">Buscar item</TabsTrigger>
            <TabsTrigger value="qr" data-testid="requisition-tab-qr">Escanear QR</TabsTrigger>
          </TabsList>
          <TabsContent value="manual"><ManualLine onAdd={addLine} testId="requisition-manual" /></TabsContent>
          <TabsContent value="qr" className="space-y-4">
            <QrReader onScan={setRaw} testId="requisition-qr" />
            {raw && <LabelConfirm key={raw} raw={raw} autoKnown={false} onConfirm={addLine} onCancel={() => setRaw(null)} />}
          </TabsContent>
        </Tabs>
        <div>
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Itens ({lines.length})</Label>
          {!lines.length ? <p className="text-xs text-slate-500">Busque itens, escaneie etiquetas ou gere pela Sugestão de Pedidos.</p> : (
            <ul className="max-h-80 divide-y divide-slate-800/70 overflow-y-auto rounded-lg border border-slate-800" data-testid="requisition-lines">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.descricao}</span>
                  <Input data-testid={`requisition-line-qty-${l.item}`} inputMode="decimal" className="h-9 w-20" defaultValue={String(l.qty).replace(".", ",")}
                    onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); if (v > 0) setLines((p) => p.map((x) => (x.key === l.key ? { ...x, qty: v } : x))); }} />
                  <span className="w-10 text-[11px] text-slate-500">{l.um}</span>
                  <Button variant="ghost" size="icon-sm" aria-label="Remover" data-testid={`requisition-line-remove-${l.item}`} onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Input data-testid="requisition-note-input" placeholder="Observação (opcional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="lg" data-testid="requisition-submit-button" disabled={!sector || !lines.length || busy} onClick={() => check.mutate()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar requisição
          </Button>
          <Button size="lg" variant="outline" data-testid="requisition-draft-button" disabled={!sector || busy} onClick={() => save.mutate(body(false))}>Salvar rascunho</Button>
          <Button size="lg" variant="ghost" data-testid="requisition-cancel-button" onClick={onDone}>Cancelar</Button>
        </div>
        {me.role === "alimentador" && me.perms.stock && sector && (
          <p className="text-xs text-slate-400" data-testid="requisition-mode-hint">
            {openSectors.includes(sector) ? `${sector} está em horário livre — será aprovada automaticamente.` : "Será enviada para aprovação do Gerente."}
          </p>
        )}
      </div>

      <Dialog open={!!dups} onOpenChange={(o) => !o && setDups(null)}>
        <DialogContent data-testid="requisition-duplicate-dialog">
          <DialogHeader>
            <DialogTitle>Já existe requisição aberta para este item</DialogTitle>
            <DialogDescription>Deseja adicionar os itens à requisição existente ou criar uma nova?</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {dups?.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-2">
                <span className="min-w-0"><span className="font-semibold">Nº {d.number}</span> <span className="text-xs text-slate-400">({STATUS[d.status as ReqStatus]?.label ?? d.status}) · {d.itens.join(", ")}</span></span>
                {!editing && <Button size="sm" data-testid={`requisition-merge-${d.number}`} disabled={busy} onClick={() => merge.mutate(d.id)}><CopyPlus className="mr-1 h-4 w-4" />Adicionar à Nº {d.number}</Button>}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" data-testid="requisition-duplicate-cancel" onClick={() => setDups(null)}>Cancelar</Button>
            <Button data-testid="requisition-duplicate-create-new" disabled={busy} onClick={() => save.mutate(body(true, true))}>Criar nova mesmo assim</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function Progress({ status }: { status: ReqStatus }) {
  const bought = status === "comprada" || status === "recebida";
  const idx = bought ? 1 : STEPS.indexOf(status);
  if (idx < 0) return null;
  return (
    <ol className="mt-2 flex items-center gap-1" data-testid="requisition-progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col gap-1">
          <span className={cn("h-1.5 rounded-full transition-colors duration-300", i <= idx ? "bg-amber" : "bg-slate-800")} />
          <span className={cn("hidden text-[10px] sm:block", i <= idx ? "text-slate-300" : "text-slate-600")}>{STATUS[s].label}</span>
        </li>
      ))}
    </ol>
  );
}

type Pick = { disp: Availability; atendido: string; obs: string };

function Separation({ r, onClose }: { r: Requisition; onClose: () => void }) {
  const qc = useQueryClient();
  const [picks, setPicks] = useState<Pick[]>(r.items.map((i) => ({ disp: i.disponibilidade, atendido: i.atendido === null ? "" : String(i.atendido).replace(".", ","), obs: i.obs_estoque })));
  const set = (i: number, patch: Partial<Pick>) => setPicks((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = useMutation({
    mutationFn: () => apiPut<Requisition>(`/requisitions/${r.id}/fulfillment`, {
      lines: picks.map((p, index) => ({ index, disponibilidade: p.disp, atendido: p.disp === "parcial" ? Number(p.atendido.replace(",", ".")) || 0 : null, obs: p.obs })),
    } satisfies FulfillIn),
    onSuccess: (x) => { toast.success(`Separação da Nº ${x.number} salva — solicitante notificado`); invalidate(qc); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-3 rounded-lg border border-amber/30 bg-amber/5 p-3" data-testid={`requisition-separation-${r.id}`}>
      <p className="text-xs text-slate-300">Marque o que tem para levar ao setor. Itens sem estoque ou parciais avisam o solicitante.</p>
      <ul className="space-y-3">
        {r.items.map((i, idx) => (
          <li key={`${i.item}-${i.qr_code ?? ""}`} className="space-y-2 border-b border-slate-800/70 pb-3 last:border-0">
            <div className="flex justify-between gap-2 text-sm"><span className="min-w-0 truncate">{i.descricao}</span><span className="num shrink-0 text-slate-400">{qty(i.qty)} {i.um}</span></div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["ok", "parcial", "sem_estoque"] as const).map((d) => (
                <button key={d} type="button" data-testid={`separation-${d}-${i.item}`} onClick={() => set(idx, { disp: d })}
                  className={cn("min-h-10 rounded-md border px-2 text-xs font-medium transition-[background-color,border-color] duration-150",
                    picks[idx].disp === d ? cn(AVAIL[d].cls, "border-transparent") : "border-slate-800 text-slate-400 hover:border-slate-600")}>
                  {AVAIL[d].label}
                </button>
              ))}
            </div>
            {picks[idx].disp === "parcial" && (
              <div className="flex items-center gap-2">
                <Input inputMode="decimal" className="h-9 w-28" placeholder="Qtd que tem" data-testid={`separation-qty-${i.item}`} value={picks[idx].atendido} onChange={(e) => set(idx, { atendido: e.target.value })} />
                <span className="text-xs text-slate-500">de {qty(i.qty)} {i.um}</span>
              </div>
            )}
            {picks[idx].disp !== "ok" && picks[idx].disp !== "pendente" && (
              <Input className="h-9" placeholder="Obs. (ex.: chega amanhã, substituir por…)" maxLength={200} data-testid={`separation-obs-${i.item}`} value={picks[idx].obs} onChange={(e) => set(idx, { obs: e.target.value })} />
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" data-testid={`separation-all-ok-${r.id}`} onClick={() => setPicks((p) => p.map((x) => ({ ...x, disp: "ok" })))}>Marcar tudo “Tem”</Button>
        <Button size="sm" data-testid={`separation-save-${r.id}`} disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Salvar separação</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Fechar</Button>
      </div>
    </div>
  );
}

function Card({ r, me, highlight, onEdit, onCopy }: { r: Requisition; me: Me; highlight: boolean; onEdit: (r: Requisition) => void; onCopy: (r: Requisition) => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(highlight);
  const [separating, setSeparating] = useState(false);
  const [comment, setComment] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  useEffect(() => {
    if (highlight) {
      setOpen(true);
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);
  const act = useMutation({
    mutationFn: (a: ReqAction) => apiPost<Requisition>(`/requisitions/${r.id}/action`, { action: a, comment }),
    onSuccess: (x) => { toast.success(`Nº ${x.number}: ${STATUS[x.status].label}`); setComment(""); invalidate(qc); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const isOwner = r.requested_by === me.email;
  const g = me.perms.approve;
  const stock = isStock(me);
  const missing = r.items.filter((i) => i.disponibilidade === "sem_estoque" || i.disponibilidade === "parcial").length;
  const btn = (a: ReqAction, label: string, Icon: typeof Check, variant: "default" | "outline" | "destructive" = "outline") => (
    <Button size="sm" variant={variant} className="min-h-10" data-testid={`requisition-${a}-${r.id}`} disabled={act.isPending} onClick={() => act.mutate(a)}><Icon className="mr-1 h-4 w-4" />{label}</Button>
  );
  const pdf = async () => {
    setPdfBusy(true);
    try { await apiDownload(`/requisitions/${r.id}/pdf`, `requisicao_${r.number}.pdf`); }
    catch (e) { toast.error(errorMessage(e, "Falha ao gerar o PDF")); } finally { setPdfBusy(false); }
  };
  return (
    <li ref={ref} className={cn("rounded-xl border bg-panel-2/50 p-3 transition-[border-color,box-shadow] duration-300",
      r.priority === "urgente" && ["enviada", "aprovada", "em_preparo"].includes(r.status) ? "border-[#F87171]/60" : "border-slate-800",
      highlight && "shadow-[0_0_0_2px_rgba(245,158,11,0.6)]")} data-testid={`requisition-card-${r.id}`}>
      <button className="w-full text-left" onClick={() => setOpen(!open)} data-testid={`requisition-toggle-${r.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="num text-xs text-slate-500">Nº {r.number}</span>
            <span className="font-semibold text-slate-100">{r.sector}</span>
            {r.priority === "urgente" && <span className="rounded bg-[#450A0A] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#F87171]">Urgente</span>}
            {missing > 0 && <span className="rounded bg-[#450A0A]/70 px-1.5 py-0.5 text-[10px] font-semibold text-[#FCA5A5]" data-testid={`requisition-missing-${r.id}`}>{missing} sem estoque/parcial</span>}
          </div>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", STATUS[r.status].cls)} data-testid={`requisition-status-${r.id}`}>{STATUS[r.status].label}</span>
        </div>
        <div className="mt-1 truncate text-xs text-slate-400">{r.items.length} itens · {r.items.slice(0, 3).map((i) => i.descricao).join(", ")}{r.items.length > 3 ? "…" : ""}</div>
        <div className="mt-1 text-[11px] text-slate-500">{dateTimeBr(r.created_at)} · {r.requested_by}{r.valor_total !== null && ` · ${brl(r.valor_total)}`}</div>
        <Progress status={r.status} />
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3 animate-rise">
          {separating ? <Separation r={r} onClose={() => setSeparating(false)} /> : (
            <ul className="space-y-1.5 text-xs" data-testid={`requisition-items-${r.id}`}>
              {r.items.map((i) => (
                <li key={`${i.item}-${i.qr_code ?? ""}`} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-300">{i.descricao}</span>
                    {i.obs_estoque && <span className="block text-[11px] text-slate-500">Estoque: {i.obs_estoque}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {i.disponibilidade !== "pendente" && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", AVAIL[i.disponibilidade].cls)}>{AVAIL[i.disponibilidade].label}{i.disponibilidade === "parcial" && i.atendido !== null ? ` ${qty(i.atendido)}` : ""}</span>}
                    <span className="num">{qty(i.qty)} {i.um}</span>
                    {i.custo !== null && <span className="num text-slate-500">{brl(i.custo * i.qty)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ol className="space-y-1 border-l border-slate-800 pl-3 text-[11px] text-slate-500" data-testid={`requisition-history-${r.id}`}>
            {r.history.map((h) => <li key={`${h.at}-${h.action}-${h.user}`}>{dateTimeBr(h.at)} · {h.user} · <span className="text-slate-300">{h.action}</span>{h.comment && ` — “${h.comment}”`}</li>)}
          </ol>
          {(g || (isOwner && ["rascunho", "devolvida"].includes(r.status))) && (
            <Input data-testid={`requisition-comment-${r.id}`} placeholder="Comentário (obrigatório para rejeitar, devolver ou excluir)" value={comment} onChange={(e) => setComment(e.target.value)} />
          )}
          <div className="flex flex-wrap gap-2">
            {(isOwner || g) && ["rascunho", "devolvida"].includes(r.status) && <>
              <Button size="sm" variant="outline" className="min-h-10" data-testid={`requisition-edit-${r.id}`} onClick={() => onEdit(r)}><Pencil className="mr-1 h-4 w-4" />Editar</Button>
              {btn("enviar", "Enviar", Send, "default")}
            </>}
            {g && r.status === "enviada" && <>{btn("aprovar", "Aprovar", Check, "default")}{btn("devolver", "Devolver p/ ajuste", Undo2)}{btn("rejeitar", "Rejeitar", X, "destructive")}</>}
            {stock && STOCK_STAGE.includes(r.status) && !separating && (
              <Button size="sm" variant="outline" className="min-h-10 border-amber/50 text-amber" data-testid={`requisition-separate-${r.id}`} onClick={() => setSeparating(true)}><PackageOpen className="mr-1 h-4 w-4" />Separar itens</Button>
            )}
            {stock && ["aprovada", "comprada", "recebida"].includes(r.status) && btn("em_preparo", "Em preparo", ChefHat)}
            {stock && ["aprovada", "em_preparo", "recebida"].includes(r.status) && btn("pronto", "Pronto", PackageCheck)}
            {stock && ["aprovada", "em_preparo", "pronto", "recebida"].includes(r.status) && btn("entregue", "Entregue", Truck, "default")}
            {stock && ["aprovada", "em_preparo"].includes(r.status) && btn("comprada", "Precisa comprar / comprada", ShoppingBag)}
            {stock && r.status === "comprada" && btn("recebida", "Compra recebida", Check)}
            {r.status === "rejeitada" && (isOwner || g) && (
              <Button size="sm" variant="outline" className="min-h-10" data-testid={`requisition-copy-${r.id}`} onClick={() => onCopy(r)}><CopyPlus className="mr-1 h-4 w-4" />Criar nova corrigida</Button>
            )}
            {me.perms.print && <Button size="sm" variant="outline" className="min-h-10" data-testid={`requisition-pdf-${r.id}`} disabled={pdfBusy} onClick={() => void pdf()}>{pdfBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}PDF</Button>}
            {g && btn("excluir", "Excluir", Trash2, "destructive")}
          </div>
        </div>
      )}
    </li>
  );
}

function WindowsEditor({ data }: { data: WindowsResponse }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<TimeWindow[]>(data.windows);
  const save = useMutation({
    mutationFn: () => apiPut<WindowsResponse>("/withdrawals/windows", { windows: rows }),
    onSuccess: (r) => { setRows(r.windows); toast.success("Horários salvos"); void qc.invalidateQueries({ queryKey: qk.windows }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const upd = (id: string, patch: Partial<TimeWindow>) => setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <Panel title="Horários de aprovação automática (Alimentador)" testId="withdrawal-windows-editor"
      action={<Button size="sm" variant="outline" data-testid="window-add-button" onClick={() => setRows((p) => [...p, { id: crypto.randomUUID(), sectors: [], days: [0, 1, 2, 3, 4, 5], start: "09:00", end: "11:00" }])}><Plus className="mr-1 h-4 w-4" />Horário</Button>}>
      <p className="mb-4 text-xs text-slate-500">Requisições de Alimentador feitas nesses horários são aprovadas sozinhas. Setor vazio = todos.</p>
      <div className="space-y-4">
        {rows.map((w) => (
          <div key={w.id} className="space-y-3 rounded-lg border border-slate-800 p-3" data-testid={`window-row-${w.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="time" className="w-28" value={w.start} data-testid={`window-start-${w.id}`} onChange={(e) => upd(w.id, { start: e.target.value })} />
              <span className="text-xs text-slate-500">até</span>
              <Input type="time" className="w-28" value={w.end} data-testid={`window-end-${w.id}`} onChange={(e) => upd(w.id, { end: e.target.value })} />
              <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Remover horário" data-testid={`window-remove-${w.id}`} onClick={() => setRows((p) => p.filter((x) => x.id !== w.id))}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <div className="flex flex-wrap gap-1">{DAYS.map((d, di) => <button key={d} type="button" data-testid={`window-day-${w.id}-${di}`} onClick={() => upd(w.id, { days: toggle(w.days, di) })} className={cn("rounded-md px-2 py-1 text-xs", w.days.includes(di) ? "bg-amber text-black" : "bg-slate-800 text-slate-400")}>{d}</button>)}</div>
            <div className="flex flex-wrap gap-1">{data.sectors.map((s) => <button key={s} type="button" data-testid={`window-sector-${w.id}-${s}`} onClick={() => upd(w.id, { sectors: toggle(w.sectors, s) })} className={cn("rounded-md border px-2 py-1 text-xs", w.sectors.includes(s) ? "border-emerald text-emerald" : "border-slate-800 text-slate-500")}>{s}</button>)}</div>
          </div>
        ))}
        <Button data-testid="windows-save-button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar horários</Button>
      </div>
    </Panel>
  );
}

export default function Requisicoes() {
  const { data: me } = useMe();
  const { data: win } = useWindows();
  const { data: list, isError } = useRequisitions();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Requisition | "new" | null>(null);
  const [template, setTemplate] = useState<Requisition | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [fGroup, setFGroup] = useState(ALL);
  const [fPrio, setFPrio] = useState(ALL);
  const [fSector, setFSector] = useState(ALL);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const items = useMemo(() => (isError ? [] : (list ?? [])), [isError, list]);

  // ?abrir=<id> (from a notification or "Gerar requisição dos zerados"): drafts open in the editor, others expand in the list.
  useEffect(() => {
    const id = params.get("abrir");
    const r = id ? items.find((x) => x.id === id) : undefined;
    if (!r) return;
    if (r.status === "rascunho" && r.requested_by === me?.email) setEditing(r);
    else setHighlight(r.id);
    setParams({}, { replace: true });
  }, [params, items, setParams, me?.email]);

  const filtered = useMemo(() => items
    .filter((r) => GROUPS[fGroup].match(r.status) && (fPrio === ALL || r.priority === fPrio) && (fSector === ALL || r.sector === fSector)
      && (!fFrom || r.created_at.slice(0, 10) >= fFrom) && (!fTo || r.created_at.slice(0, 10) <= fTo))
    .sort((a, b) => Number(b.priority === "urgente" && b.status !== "entregue") - Number(a.priority === "urgente" && a.status !== "entregue")),
  [items, fGroup, fPrio, fSector, fFrom, fTo]);
  if (!me) return null;
  const canExport = me.perms.print;
  const counts = Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, items.filter((r) => g.match(r.status)).length]));

  return (
    <div>
      <PageHeader eyebrow="Estoque" title="Requisições"
        subtitle={me.perms.approve ? "Todas as requisições dos setores — aprove, acompanhe a separação e a entrega."
          : me.perms.stock ? "Estoque: separe os itens, marque o que não tem e devolva o status ao setor (Em preparo → Pronto → Entregue)."
            : `Requisições de ${me.perms.op_sectors.join(" + ")}.`}
        actions={<>
          <Button size="lg" className="min-h-12 w-full sm:w-auto" data-testid="requisition-new-button" onClick={() => { setTemplate(null); setEditing("new"); }}><Plus className="mr-2 h-5 w-5" />Nova Requisição</Button>
          {canExport && <Button variant="outline" size="lg" data-testid="requisition-export-button" disabled={!filtered.length} onClick={() => exportCsv(filtered)}><Download className="mr-2 h-4 w-4" />Exportar CSV</Button>}
        </>} />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" data-testid="requisition-groups">
        {Object.entries(GROUPS).map(([k, g]) => (
          <button key={k} type="button" data-testid={`requisition-group-${k}`} onClick={() => setFGroup(k)}
            className={cn("flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-xs transition-[border-color,background-color] duration-150",
              fGroup === k ? "border-amber bg-amber/10 text-amber" : "border-slate-800 text-slate-400 hover:border-slate-600")}>
            {g.label}<span className="num rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-200">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {editing && win && (
            <Editor key={editing === "new" ? `new-${template?.id ?? ""}` : editing.id} me={me} openSectors={win.open_sectors}
              editing={editing === "new" ? null : editing} template={editing === "new" ? template : null} onDone={() => { setEditing(null); setTemplate(null); }} />
          )}
          <Panel title={`Requisições (${filtered.length})`} testId="requisition-list"
            action={
              <div className="flex flex-wrap gap-2">
                <Select value={fPrio} onValueChange={(v: string) => setFPrio(v)}>
                  <SelectTrigger size="sm" className="w-32" data-testid="requisition-filter-priority"><SelectValue>{(v: string) => (v === ALL ? "Prioridade" : v)}</SelectValue></SelectTrigger>
                  <SelectContent><SelectItem value={ALL}>Todas</SelectItem><SelectItem value="urgente">Urgente</SelectItem><SelectItem value="normal">Normal</SelectItem></SelectContent>
                </Select>
                {(isStock(me) || me.perms.op_sectors.length > 1) && (
                  <Select value={fSector} onValueChange={(v: string) => setFSector(v)}>
                    <SelectTrigger size="sm" className="w-32" data-testid="requisition-filter-sector"><SelectValue>{(v: string) => (v === ALL ? "Setor" : v)}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value={ALL}>Todos</SelectItem>{SECTORS.filter((s) => me.perms.op_sectors.includes(s)).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Input type="date" className="h-8 w-36" aria-label="De" data-testid="requisition-filter-from" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
                <Input type="date" className="h-8 w-36" aria-label="Até" data-testid="requisition-filter-to" value={fTo} onChange={(e) => setFTo(e.target.value)} />
              </div>
            }>
            {filtered.length ? (
              <ul className="space-y-2">
                {filtered.map((r) => (
                  <Card key={r.id} r={r} me={me} highlight={highlight === r.id}
                    onEdit={(x) => { setTemplate(null); setEditing(x); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    onCopy={(x) => { setTemplate(x); setEditing("new"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
                ))}
              </ul>
            ) : <EmptyState title="Nenhuma requisição" detail="Toque em Nova Requisição ou gere pela Sugestão de Pedidos." testId="requisition-empty" />}
          </Panel>
        </div>
        {me.perms.manage && win && <div className="min-w-0"><WindowsEditor key={JSON.stringify(win.windows)} data={win} /></div>}
      </div>
    </div>
  );
}
