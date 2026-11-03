import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, FileText, Loader2, RotateCcw, Sparkles, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiDelete, apiPut, apiUpload, errorMessage } from "@/lib/api";
import { DERIVED_KEYS, useMe, usePeriods, useUploads } from "@/lib/queries";
import { dateTimeBr, monthLabel } from "@/lib/format";
import type { Period, PeriodIn, Upload, UploadKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const KINDS: { id: UploadKind; title: string; hint: string }[] = [
  { id: "compras", title: "Compras / notas", hint: "Exports VMarket, my_export, notas (data, fornecedor, valor)" },
  { id: "inventario", title: "Inventário do mês", hint: "Contagem Everest (item, descrição, UM, quantidade)" },
  { id: "custos", title: "Custos unitários", hint: "Inventário valorizado Everest — PDF ou planilha (V. Custo Médio)" },
  { id: "faturamento", title: "Faturamento", hint: "Planilha de vendas (data + realizado) — soma por mês" },
  { id: "completa", title: "Planilha completa", hint: "Workbook de análise com abas de custos, contagens, compras e resumo" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.title])) as Record<string, string>;

function StatusIcon({ s }: { s: Upload["status"] }) {
  if (s === "processando") return <Loader2 className="h-4 w-4 animate-spin text-amber" />;
  if (s === "concluido") return <CheckCircle2 className="h-4 w-4 text-emerald" />;
  if (s === "desfeito") return <RotateCcw className="h-4 w-4 text-slate-500" />;
  return <XCircle className="h-4 w-4 text-[#F87171]" />;
}

function UploadForm() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<UploadKind>("compras");
  const [month, setMonth] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("kind", kind);
      if (month) fd.append("month", month);
      fd.append("file", file as File);
      return apiUpload<Upload>("/uploads", fd);
    },
    onSuccess: () => {
      toast.success("Arquivo recebido — processando…");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["uploads"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Falha no envio")),
  });

  const isPdf = file?.name.toLowerCase().endsWith(".pdf");

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" data-testid="upload-type-selector">
        {KINDS.map((k) => (
          <button key={k.id} data-testid={`upload-kind-${k.id}`} onClick={() => setKind(k.id)}
            className={cn("rounded-lg border p-3 text-left transition-[border-color,background-color,transform] duration-150 hover:-translate-y-0.5",
              kind === k.id ? "border-amber bg-amber/10" : "border-slate-800 hover:border-slate-600")}>
            <div className={cn("text-sm font-semibold", kind === k.id ? "text-amber" : "text-slate-200")}>{k.title}</div>
            <div className="mt-1 text-[11px] leading-snug text-slate-500">{k.hint}</div>
          </button>
        ))}
      </div>

      {kind === "inventario" && (
        <div className="max-w-xs">
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Mês da contagem</Label>
          <Input type="month" data-testid="upload-month-input" value={month} onChange={(e) => setMonth(e.target.value)} />
          <p className="mt-1 text-[11px] text-slate-500">Se vazio, tentamos detectar pelo nome do arquivo. Substitui a contagem existente do mês.</p>
        </div>
      )}

      <label
        data-testid="file-upload-dropzone"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
        className={cn("flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-[border-color,background-color] duration-200",
          drag ? "border-amber bg-amber/5" : "border-slate-700 hover:border-slate-500")}
      >
        <input ref={inputRef} type="file" className="hidden" data-testid="upload-file-input" accept=".xlsx,.xlsm,.csv,.txt,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <>
            {isPdf ? <FileText className="h-8 w-8 text-amber" /> : <FileSpreadsheet className="h-8 w-8 text-emerald" />}
            <div className="text-sm font-semibold text-slate-100" data-testid="upload-selected-file">{file.name}</div>
            <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB {isPdf && "· será lido por IA (Gemini 3 Flash)"}</div>
          </>
        ) : (
          <>
            <UploadCloud className="h-8 w-8 text-slate-500" />
            <div className="text-sm text-slate-300">Arraste o arquivo aqui ou <span className="text-amber">clique para escolher</span></div>
            <div className="text-xs text-slate-500">.xlsx, .csv ou .pdf · até 15 MB · colunas detectadas automaticamente (IA como plano B)</div>
          </>
        )}
      </label>

      <Button data-testid="upload-process-btn" disabled={!file || send.isPending} onClick={() => send.mutate()}>
        {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
        Processar {KIND_LABEL[kind].toLowerCase()}
      </Button>
    </div>
  );
}

function ManualForm() {
  const qc = useQueryClient();
  const { data: periods } = usePeriods();
  const [month, setMonth] = useState("");
  const [form, setForm] = useState<PeriodIn>({ faturamento: null, faturamento_parcial: false, status: "aberto", obs: "" });

  const pick = (m: string) => {
    setMonth(m);
    const p: Period | undefined = periods?.find((x) => x.month === m);
    setForm(p ? { faturamento: p.faturamento, faturamento_parcial: p.faturamento_parcial, status: p.status, obs: p.obs } : { faturamento: null, faturamento_parcial: false, status: "aberto", obs: "" });
  };

  const save = useMutation({
    mutationFn: () => apiPut<Period>(`/periods/${month}`, form),
    onSuccess: () => {
      toast.success(`${monthLabel(month)} salvo — indicadores recalculados`);
      DERIVED_KEYS.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar")),
  });

  return (
    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <div>
        <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Mês</Label>
        <Input type="month" data-testid="manual-month-input" value={month} onChange={(e) => pick(e.target.value)} />
      </div>
      <div>
        <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Faturamento (R$)</Label>
        <Input type="number" min={0} step="0.01" data-testid="manual-revenue-input" value={form.faturamento ?? ""}
          onChange={(e) => setForm({ ...form, faturamento: e.target.value === "" ? null : Number(e.target.value) })} />
      </div>
      <div>
        <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Situação do mês</Label>
        <Select value={form.status} onValueChange={(v: string) => setForm({ ...form, status: v as Period["status"] })}>
          <SelectTrigger className="w-full" data-testid="manual-status-select"><SelectValue>{(v: string) => (v === "fechado" ? "Fechado" : "Aberto (parcial)")}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="aberto">Aberto (parcial)</SelectItem>
            <SelectItem value="fechado">Fechado</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-300">
        <Checkbox data-testid="manual-partial-checkbox" checked={form.faturamento_parcial} onCheckedChange={(c: boolean) => setForm({ ...form, faturamento_parcial: c })} />
        Faturamento parcial
      </label>
      <div className="sm:col-span-2">
        <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Observação</Label>
        <Input data-testid="manual-obs-input" value={form.obs} maxLength={300} onChange={(e) => setForm({ ...form, obs: e.target.value })} placeholder="Ex: faltam notas de 25 a 31" />
      </div>
      <div className="sm:col-span-2">
        <Button data-testid="manual-save-button" disabled={!month || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar lançamento
        </Button>
      </div>
    </div>
  );
}

function History() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: uploads, isError } = useUploads();
  const processing = useRef<Set<string>>(new Set());

  // When a processing upload finishes, refresh every derived metric and notify.
  useEffect(() => {
    if (!uploads) return;
    for (const u of uploads) {
      if (u.status === "processando") processing.current.add(u.id);
      else if (processing.current.has(u.id)) {
        processing.current.delete(u.id);
        DERIVED_KEYS.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
        if (u.status === "concluido") toast.success(u.message);
        else toast.error(u.message);
      }
    }
  }, [uploads, qc]);

  const undo = useMutation({
    mutationFn: (id: string) => apiDelete<Upload>(`/uploads/${id}`),
    onSuccess: () => {
      toast.success("Envio desfeito");
      DERIVED_KEYS.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Panel title="Histórico de envios" testId="upload-history">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            {["", "Quando", "Tipo", "Arquivo", "Resultado", "Por", ""].map((h, i) => <TableHead key={i} className="text-xs uppercase text-slate-400">{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(isError ? [] : (uploads ?? [])).map((u) => (
            <TableRow key={u.id} data-testid={`upload-row-${u.id}`} className="border-slate-800/70">
              <TableCell><StatusIcon s={u.status} /></TableCell>
              <TableCell className="whitespace-nowrap text-xs text-slate-400">{dateTimeBr(u.created_at)}</TableCell>
              <TableCell className="whitespace-nowrap text-xs">{KIND_LABEL[u.kind] ?? u.kind}{u.month && ` · ${monthLabel(u.month)}`}</TableCell>
              <TableCell className="max-w-[200px] truncate text-xs" title={u.filename}>{u.filename}</TableCell>
              <TableCell className="max-w-[380px] text-xs text-slate-300" data-testid={`upload-message-${u.id}`}>
                {u.ai_used && <span className="mr-1 rounded bg-[#1E1B4B] px-1.5 py-0.5 text-[10px] text-[#A5B4FC]">IA</span>}
                {u.message}
              </TableCell>
              <TableCell className="text-xs text-slate-500">{u.user_email}</TableCell>
              <TableCell>
                {me?.role === "gerente" && u.undoable && u.status === "concluido" && (
                  <Button variant="ghost" size="xs" data-testid={`upload-undo-${u.id}`} disabled={undo.isPending} onClick={() => undo.mutate(u.id)}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Desfazer
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!uploads?.length && (
            <TableRow><TableCell colSpan={7} className="py-6 text-center text-xs text-slate-500">Nenhum envio ainda.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Panel>
  );
}

export default function CarregarDados() {
  return (
    <div>
      <PageHeader eyebrow="Alimentação" title="Carregar Dados & PDFs"
        subtitle="Envie o arquivo e pronto: o Madrila ERP reconhece as colunas, guarda os dados e recalcula CMV, estoque, ABC e sugestões." />
      <div className="space-y-6">
        <Panel>
          <Tabs defaultValue="arquivo">
            <TabsList className="mb-5">
              <TabsTrigger value="arquivo" data-testid="tab-upload-file">Enviar arquivo</TabsTrigger>
              <TabsTrigger value="manual" data-testid="tab-manual-entry">Lançamento manual</TabsTrigger>
            </TabsList>
            <TabsContent value="arquivo"><UploadForm /></TabsContent>
            <TabsContent value="manual"><ManualForm /></TabsContent>
          </Tabs>
        </Panel>
        <History />
      </div>
    </div>
  );
}
