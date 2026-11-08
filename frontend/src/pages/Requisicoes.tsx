import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Download, Loader2, Pencil, Plus, Printer, Send, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, Panel } from "@/components/common";
import { LabelConfirm, ManualLine, QrReader, type PickedLine } from "@/components/QrTools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, apiPost, apiPut, errorMessage } from "@/lib/api";
import { qk, useMe, useNotifications, useRequisitions, useWindows } from "@/lib/queries";
import { brl, dateTimeBr, qty } from "@/lib/format";
import type { Me, Notifications, ReqAction, ReqStatus, Requisition, RequisitionIn, TimeWindow, WindowsResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const STATUS: Record<ReqStatus, { label: string; cls: string }> = {
  rascunho: { label: "Rascunho", cls: "bg-slate-800 text-slate-300" },
  enviada: { label: "Enviada", cls: "bg-[#1E3A8A] text-[#93C5FD]" },
  aprovada: { label: "Aprovada", cls: "bg-[#064E3B] text-[#6EE7B7]" },
  devolvida: { label: "Devolvida p/ ajuste", cls: "bg-[#78350F] text-[#FDE68A]" },
  rejeitada: { label: "Rejeitada", cls: "bg-[#450A0A] text-[#F87171]" },
  comprada: { label: "Comprada", cls: "bg-[#1E1B4B] text-[#A5B4FC]" },
  recebida: { label: "Recebida", cls: "bg-[#14532D] text-[#86EFAC]" },
  excluida: { label: "Excluída", cls: "bg-slate-900 text-slate-500" },
};
const ALL = "todos";
const invalidate = (qc: ReturnType<typeof useQueryClient>) => [qk.requisitions, qk.notifications].forEach((k) => void qc.invalidateQueries({ queryKey: k }));

function printReq(r: Requisition) {
  const w = window.open("", "_blank");
  if (!w) return toast.error("Permita pop-ups para imprimir");
  const approver = [...r.history].reverse().find((h) => h.action.startsWith("aprovada"));
  const rows = r.items.map((i) => `<tr><td>${i.item}</td><td>${i.descricao}</td><td style="text-align:right">${qty(i.qty)}</td><td>${i.um}</td></tr>`).join("");
  w.document.write(`<html><head><title>Requisição ${r.number}</title><style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px;font-size:13px;text-align:left}</style></head><body>
    <h2>Madrila ERP · Requisição Nº ${r.number}</h2><p>Setor: <b>${r.sector}</b> · Prioridade: ${r.priority} · Status: <b>${STATUS[r.status].label}</b></p>
    <p>Solicitante: ${r.requested_by} · Data: ${dateTimeBr(r.created_at)}</p>${r.note ? `<p>Obs: ${r.note}</p>` : ""}
    <table><thead><tr><th>Item</th><th>Descrição</th><th>Qtd</th><th>UM</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:32px">Aprovado por: ${approver ? `${approver.user} em ${dateTimeBr(approver.at)}` : "________________"}</p>
    <p style="margin-top:32px">Assinatura: ______________________________</p><p style="font-size:11px;color:#777">Idealizado e criado por Julio Acauã</p></body></html>`);
  w.document.close();
  w.print();
}

function exportCsv(list: Requisition[]) {
  const head = ["Nº", "Data", "Setor", "Prioridade", "Status", "Solicitante", "Item", "Descrição", "Qtd", "UM"];
  const lines = list.flatMap((r) => r.items.map((i) => [r.number, r.created_at.slice(0, 10), r.sector, r.priority, STATUS[r.status].label, r.requested_by, i.item, i.descricao, String(i.qty).replace(".", ","), i.um]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")));
  const blob = new Blob(["\uFEFF" + [head.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "requisicoes.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function Editor({ me, sectors, openSectors, editing, onDone }: { me: Me; sectors: string[]; openSectors: string[]; editing: Requisition | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [sector, setSector] = useState(editing?.sector ?? (me.role === "chefe" ? me.sector ?? "" : ""));
  const [priority, setPriority] = useState<"normal" | "urgente">(editing?.priority ?? "normal");
  const [lines, setLines] = useState<PickedLine[]>(editing?.items.map(({ item, descricao, um, qty: q, qr_code }) => ({ item, descricao, um, qty: q, qr_code })) ?? []);
  const [note, setNote] = useState(editing?.note ?? "");
  const [raw, setRaw] = useState<string | null>(null);
  const addLine = useCallback((l: PickedLine) => { setRaw(null); setLines((p) => [...p, l]); }, []);

  const save = useMutation({
    mutationFn: (body: RequisitionIn) => (editing ? apiPut<Requisition>(`/requisitions/${editing.id}`, body) : apiPost<Requisition>("/requisitions", body)),
    onSuccess: (r) => {
      toast.success(r.status === "rascunho" ? `Rascunho Nº ${r.number} salvo` : r.direct ? `Nº ${r.number} aprovada automaticamente (horário livre)` : `Nº ${r.number} enviada para aprovação`);
      invalidate(qc);
      onDone();
    },
    onError: (e, body) => {
      if (e instanceof ApiError && e.status === 409 && !body.force && window.confirm(errorMessage(e))) save.mutate({ ...body, force: true });
      else toast.error(errorMessage(e, "Não foi possível salvar"));
    },
  });
  const body = (submit: boolean): RequisitionIn => ({ sector, priority, items: lines, note, submit, force: false });
  const chefLocked = me.role === "chefe";

  return (
    <Panel title={editing ? `Editar requisição Nº ${editing.number}` : "Nova requisição"} testId="requisition-editor">
      <div className="space-y-5">
        <div>
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Setor</Label>
          <div className="flex flex-wrap gap-2" data-testid="requisition-sector-selector">
            {(chefLocked ? [me.sector ?? ""] : sectors).map((s) => (
              <button key={s} data-testid={`requisition-sector-${s}`} disabled={chefLocked} onClick={() => setSector(s)}
                className={cn("rounded-lg border px-3 py-2 text-sm transition-[border-color,background-color] duration-150",
                  sector === s ? "border-amber bg-amber/10 text-amber" : "border-slate-800 text-slate-300 hover:border-slate-600")}>
                {s}{openSectors.includes(s) && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald align-middle" />}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2" data-testid="requisition-priority">
          {(["normal", "urgente"] as const).map((p) => (
            <button key={p} data-testid={`requisition-priority-${p}`} onClick={() => setPriority(p)}
              className={cn("rounded-lg border px-3 py-2 text-sm capitalize transition-colors duration-150",
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
              {lines.map((l, i) => (
                <li key={`${l.item}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.descricao}</span>
                  <Input data-testid={`requisition-line-qty-${i}`} inputMode="decimal" className="h-8 w-20" value={String(l.qty)}
                    onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); setLines(lines.map((x, j) => (j === i ? { ...x, qty: v > 0 ? v : x.qty } : x))); }} />
                  <span className="w-10 text-[11px] text-slate-500">{l.um}</span>
                  <Button variant="ghost" size="icon-xs" aria-label="Remover" data-testid={`requisition-line-remove-${i}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Input data-testid="requisition-note-input" placeholder="Observação (opcional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button size="lg" data-testid="requisition-submit-button" disabled={!sector || !lines.length || save.isPending} onClick={() => save.mutate(body(true))}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar
          </Button>
          <Button size="lg" variant="outline" data-testid="requisition-draft-button" disabled={!sector || save.isPending} onClick={() => save.mutate(body(false))}>Salvar rascunho</Button>
          <Button size="lg" variant="ghost" data-testid="requisition-cancel-button" onClick={onDone}>Cancelar</Button>
        </div>
        {me.role === "alimentador" && sector && (
          <p className="text-xs text-slate-400" data-testid="requisition-mode-hint">
            {openSectors.includes(sector) ? `${sector} está em horário livre — será aprovada automaticamente.` : "Será enviada para aprovação do Gerente."}
          </p>
        )}
      </div>
    </Panel>
  );
}

function Card({ r, me, onEdit }: { r: Requisition; me: Me; onEdit: (r: Requisition) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const act = useMutation({
    mutationFn: (a: ReqAction) => apiPost<Requisition>(`/requisitions/${r.id}/action`, { action: a, comment }),
    onSuccess: (x) => { toast.success(`Nº ${x.number}: ${STATUS[x.status].label}`); setComment(""); invalidate(qc); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const isOwner = r.requested_by === me.email;
  const g = me.role === "gerente";
  const btn = (a: ReqAction, label: string, Icon: typeof Check, variant: "default" | "outline" | "destructive" = "outline") => (
    <Button size="sm" variant={variant} data-testid={`requisition-${a}-${r.id}`} disabled={act.isPending} onClick={() => act.mutate(a)}><Icon className="mr-1 h-4 w-4" />{label}</Button>
  );
  return (
    <li className={cn("rounded-xl border bg-panel-2/50 p-3", r.priority === "urgente" && r.status === "enviada" ? "border-[#F87171]/60" : "border-slate-800")} data-testid={`requisition-card-${r.id}`}>
      <button className="w-full text-left" onClick={() => setOpen(!open)} data-testid={`requisition-toggle-${r.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="num text-xs text-slate-500">Nº {r.number}</span>
            <span className="font-semibold text-slate-100">{r.sector}</span>
            {r.priority === "urgente" && <span className="rounded bg-[#450A0A] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#F87171]">Urgente</span>}
          </div>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", STATUS[r.status].cls)} data-testid={`requisition-status-${r.id}`}>{STATUS[r.status].label}</span>
        </div>
        <div className="mt-1 truncate text-xs text-slate-400">{r.items.length} itens · {r.items.slice(0, 3).map((i) => i.descricao).join(", ")}{r.items.length > 3 ? "…" : ""}</div>
        <div className="mt-1 text-[11px] text-slate-500">{dateTimeBr(r.created_at)} · {r.requested_by}{r.valor_total !== null && ` · ${brl(r.valor_total)}`}</div>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3 animate-rise">
          <ul className="space-y-1 text-xs">{r.items.map((i, k) => <li key={k} className="flex justify-between gap-2"><span className="truncate text-slate-300">{i.descricao}</span><span className="num shrink-0">{qty(i.qty)} {i.um}{i.custo !== null && <span className="ml-2 text-slate-500">{brl(i.custo * i.qty)}</span>}</span></li>)}</ul>
          <ol className="space-y-1 border-l border-slate-800 pl-3 text-[11px] text-slate-500" data-testid={`requisition-history-${r.id}`}>
            {r.history.map((h, k) => <li key={k}>{dateTimeBr(h.at)} · {h.user} · <span className="text-slate-300">{h.action}</span>{h.comment && ` — “${h.comment}”`}</li>)}
          </ol>
          {(g || (isOwner && ["rascunho", "devolvida"].includes(r.status))) && (
            <Input data-testid={`requisition-comment-${r.id}`} placeholder="Comentário (obrigatório para rejeitar, devolver ou excluir)" value={comment} onChange={(e) => setComment(e.target.value)} />
          )}
          <div className="flex flex-wrap gap-2">
            {(isOwner || g) && ["rascunho", "devolvida"].includes(r.status) && <>
              <Button size="sm" variant="outline" data-testid={`requisition-edit-${r.id}`} onClick={() => onEdit(r)}><Pencil className="mr-1 h-4 w-4" />Editar</Button>
              {btn("enviar", "Enviar", Send, "default")}
            </>}
            {g && r.status === "enviada" && <>{btn("aprovar", "Aprovar", Check, "default")}{btn("devolver", "Devolver p/ ajuste", Undo2)}{btn("rejeitar", "Rejeitar", X, "destructive")}</>}
            {(g || me.role === "alimentador") && r.status === "aprovada" && btn("comprada", "Comprada", Check)}
            {(g || me.role === "alimentador") && ["aprovada", "comprada"].includes(r.status) && btn("recebida", "Recebida", Check)}
            {me.role !== "alimentador" && <Button size="sm" variant="outline" data-testid={`requisition-print-${r.id}`} onClick={() => printReq(r)}><Printer className="mr-1 h-4 w-4" />Imprimir</Button>}
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
  const upd = (i: number, patch: Partial<TimeWindow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <Panel title="Horários de aprovação automática (Alimentador)" testId="withdrawal-windows-editor"
      action={<Button size="sm" variant="outline" data-testid="window-add-button" onClick={() => setRows([...rows, { id: "", sectors: [], days: [0, 1, 2, 3, 4, 5], start: "09:00", end: "11:00" }])}><Plus className="mr-1 h-4 w-4" />Horário</Button>}>
      <p className="mb-4 text-xs text-slate-500">Requisições de Alimentador feitas nesses horários são aprovadas sozinhas. Setor vazio = todos.</p>
      <div className="space-y-4">
        {rows.map((w, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-slate-800 p-3" data-testid={`window-row-${i}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="time" className="w-28" value={w.start} data-testid={`window-start-${i}`} onChange={(e) => upd(i, { start: e.target.value })} />
              <span className="text-xs text-slate-500">até</span>
              <Input type="time" className="w-28" value={w.end} data-testid={`window-end-${i}`} onChange={(e) => upd(i, { end: e.target.value })} />
              <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Remover horário" data-testid={`window-remove-${i}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <div className="flex flex-wrap gap-1">{DAYS.map((d, di) => <button key={d} data-testid={`window-day-${i}-${di}`} onClick={() => upd(i, { days: toggle(w.days, di) })} className={cn("rounded-md px-2 py-1 text-xs", w.days.includes(di) ? "bg-amber text-black" : "bg-slate-800 text-slate-400")}>{d}</button>)}</div>
            <div className="flex flex-wrap gap-1">{data.sectors.map((s) => <button key={s} data-testid={`window-sector-${i}-${s}`} onClick={() => upd(i, { sectors: toggle(w.sectors, s) })} className={cn("rounded-md border px-2 py-1 text-xs", w.sectors.includes(s) ? "border-emerald text-emerald" : "border-slate-800 text-slate-500")}>{s}</button>)}</div>
          </div>
        ))}
        <Button data-testid="windows-save-button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar horários</Button>
      </div>
    </Panel>
  );
}

export default function Requisicoes() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: win } = useWindows();
  const { data: list, isError } = useRequisitions();
  const { data: notif } = useNotifications();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Requisition | "new" | null>(null);
  const [fStatus, setFStatus] = useState(ALL);
  const [fPrio, setFPrio] = useState(ALL);
  const [fSector, setFSector] = useState(ALL);
  const items = isError ? [] : (list ?? []);

  useEffect(() => {
    const id = params.get("abrir");
    const r = id && items.find((x) => x.id === id);
    if (r) { setEditing(r); setParams({}, { replace: true }); }
  }, [params, items, setParams]);

  const seen = useMutation({
    mutationFn: () => apiPost<Notifications>("/notifications/seen"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.notifications }),
  });
  const filtered = useMemo(() => items
    .filter((r) => (fStatus === ALL || r.status === fStatus) && (fPrio === ALL || r.priority === fPrio) && (fSector === ALL || r.sector === fSector))
    .sort((a, b) => Number(b.status === "enviada" && b.priority === "urgente") - Number(a.status === "enviada" && a.priority === "urgente")), [items, fStatus, fPrio, fSector]);
  if (!me) return null;

  return (
    <div>
      <PageHeader eyebrow="Estoque" title="Requisições" subtitle={me.role === "gerente" ? "Todas as requisições dos setores — aprove, rejeite ou devolva para ajuste." : `Requisições ${me.sector ? `do setor ${me.sector}` : "que você criou"}.`}
        actions={<>
          <Button size="lg" data-testid="requisition-new-button" onClick={() => setEditing("new")}><Plus className="mr-2 h-5 w-5" />Nova Requisição</Button>
          {me.role !== "alimentador" && <Button variant="outline" size="lg" data-testid="requisition-export-button" disabled={!filtered.length} onClick={() => exportCsv(filtered)}><Download className="mr-2 h-4 w-4" />Exportar</Button>}
        </>} />

      {!!notif?.count && (
        <Panel className="mb-6 border-amber/40" testId="requisition-notifications"
          title={`Notificações (${notif.count})`}
          action={<Button size="sm" variant="ghost" data-testid="notifications-seen-button" onClick={() => seen.mutate()}>Marcar como vistas</Button>}>
          <ul className="space-y-1 text-sm">
            {notif.items.slice(0, 8).map((n) => (
              <li key={`${n.id}-${n.status}`} className={cn("flex items-center gap-2", n.priority === "urgente" ? "text-[#FCA5A5]" : "text-slate-300")}>
                <Bell className="h-3.5 w-3.5 shrink-0" />{n.message}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {editing && win && <Editor key={editing === "new" ? "new" : editing.id} me={me} sectors={win.sectors} openSectors={win.open_sectors} editing={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
          <Panel title={`Requisições (${filtered.length})`} testId="requisition-list"
            action={
              <div className="flex flex-wrap gap-2">
                <Select value={fStatus} onValueChange={(v: string) => setFStatus(v)}>
                  <SelectTrigger size="sm" className="w-36" data-testid="requisition-filter-status"><SelectValue>{(v: string) => (v === ALL ? "Todos status" : STATUS[v as ReqStatus]?.label)}</SelectValue></SelectTrigger>
                  <SelectContent><SelectItem value={ALL}>Todos status</SelectItem>{(Object.keys(STATUS) as ReqStatus[]).filter((s) => s !== "excluida").map((s) => <SelectItem key={s} value={s}>{STATUS[s].label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={fPrio} onValueChange={(v: string) => setFPrio(v)}>
                  <SelectTrigger size="sm" className="w-32" data-testid="requisition-filter-priority"><SelectValue>{(v: string) => (v === ALL ? "Prioridade" : v)}</SelectValue></SelectTrigger>
                  <SelectContent><SelectItem value={ALL}>Todas</SelectItem><SelectItem value="urgente">Urgente</SelectItem><SelectItem value="normal">Normal</SelectItem></SelectContent>
                </Select>
                {me.role === "gerente" && win && (
                  <Select value={fSector} onValueChange={(v: string) => setFSector(v)}>
                    <SelectTrigger size="sm" className="w-32" data-testid="requisition-filter-sector"><SelectValue>{(v: string) => (v === ALL ? "Setor" : v)}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value={ALL}>Todos</SelectItem>{win.sectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
            }>
            {filtered.length ? <ul className="space-y-2">{filtered.map((r) => <Card key={r.id} r={r} me={me} onEdit={(x) => { setEditing(x); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}</ul>
              : <EmptyState title="Nenhuma requisição" detail="Toque em Nova Requisição ou gere pela Sugestão de Pedidos." testId="requisition-empty" />}
          </Panel>
        </div>
        {me.role === "gerente" && win && <div className="min-w-0"><WindowsEditor key={JSON.stringify(win.windows)} data={win} /></div>}
      </div>
    </div>
  );
}
