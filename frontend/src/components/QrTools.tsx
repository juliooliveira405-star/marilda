import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, CameraOff, Check, ImageUp, Loader2, ScanLine, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPost, apiUpload, errorMessage } from "@/lib/api";
import { qty as fmtQty } from "@/lib/format";
import type { CatalogItem, QrLabel, QrLabelIn, QrPhotoOut, QrResolveOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface PickedLine {
  item: string;
  descricao: string;
  um: string;
  qty: number;
  qr_code: string | null;
}

/** Camera QR reader (iOS/Android/desktop webcam) + text field for USB/Bluetooth scanners or pasted codes. */
export function QrReader({ onScan, testId = "qr" }: { onScan: (raw: string) => void; testId?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [active, setActive] = useState(false);
  const [manual, setManual] = useState("");
  const lastRef = useRef<{ raw: string; at: number }>({ raw: "", at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => () => scannerRef.current?.destroy(), []);

  const start = async () => {
    if (!videoRef.current) return;
    try {
      if (!scannerRef.current) {
        scannerRef.current = new QrScanner(
          videoRef.current,
          (res) => {
            const now = Date.now();
            // ignore the same label held in front of the camera
            if (res.data === lastRef.current.raw && now - lastRef.current.at < 3000) return;
            lastRef.current = { raw: res.data, at: now };
            if (navigator.vibrate) navigator.vibrate(80);
            onScanRef.current(res.data);
          },
          { preferredCamera: "environment", highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true },
        );
      }
      await scannerRef.current.start();
      setActive(true);
    } catch {
      toast.error("Não foi possível abrir a câmera. Permita o acesso à câmera ou use o campo de texto.");
    }
  };

  const stop = () => {
    scannerRef.current?.stop();
    setActive(false);
  };

  // Photo of the whole label: QR decoded on the phone when possible + printed text read by AI (product, weight, dates, #ID).
  const fileRef = useRef<HTMLInputElement>(null);
  const photo = useMutation({
    mutationFn: async (file: File) => {
      const qrText = await QrScanner.scanImage(file, { returnDetailedScanResult: true }).then((r) => r.data).catch(() => "");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("qr_text", qrText);
      return apiUpload<QrPhotoOut>("/qr/photo", fd);
    },
    onSuccess: (r) => {
      if (navigator.vibrate) navigator.vibrate(80);
      toast.success(`Etiqueta lida: ${r.parsed.produto || r.parsed.label_id}`);
      onScanRef.current(r.raw);
    },
    onError: (e) => toast.error(errorMessage(e, "Não consegui ler a etiqueta pela foto")),
  });

  return (
    <div className="space-y-3">
      <div className={cn("relative overflow-hidden rounded-xl border border-slate-800 bg-black", active ? "aspect-[4/3]" : "h-0 border-0")}>
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline data-testid={`${testId}-video`} />
      </div>
      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button variant="outline" onClick={stop} data-testid={`${testId}-camera-stop`}>
            <CameraOff className="mr-2 h-4 w-4" /> Fechar câmera
          </Button>
        ) : (
          <Button onClick={() => void start()} data-testid={`${testId}-camera-start`}>
            <Camera className="mr-2 h-4 w-4" /> Ler QR com a câmera
          </Button>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid={`${testId}-photo-input`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) photo.mutate(f); e.target.value = ""; }} />
        <Button variant="outline" disabled={photo.isPending} onClick={() => fileRef.current?.click()} data-testid={`${testId}-photo-button`}>
          {photo.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageUp className="mr-2 h-4 w-4" />}
          {photo.isPending ? "Lendo etiqueta…" : "Foto da etiqueta"}
        </Button>
      </div>
      {photo.isPending && <p className="text-xs text-slate-400" data-testid={`${testId}-photo-reading`}>Lendo produto, peso, validade e código da etiqueta (≈10 s)…</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            onScan(manual.trim());
            setManual("");
          }
        }}
      >
        <Input
          data-testid={`${testId}-manual-input`}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Leitor USB/Bluetooth ou cole o conteúdo do QR"
        />
        <Button type="submit" variant="outline" data-testid={`${testId}-manual-submit`} disabled={!manual.trim()}>
          <ScanLine className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

export function ItemPicker({ onPick, selected, initial = [], testId = "item-picker" }: { onPick: (i: CatalogItem) => void; selected?: string; initial?: CatalogItem[]; testId?: string }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["items", q],
    queryFn: () => apiGet<CatalogItem[]>(`/items?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
  const list = q.trim().length >= 2 ? (data ?? []) : initial;
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
        <Input data-testid={`${testId}-search`} className="pl-8" placeholder="Buscar insumo (nome ou código)" value={q} onChange={(e) => setQ(e.target.value)} />
        {isFetching && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-slate-500" />}
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {list.map((i) => (
          <li key={i.item}>
            <button
              type="button"
              data-testid={`${testId}-option-${i.item}`}
              onClick={() => onPick(i)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-[border-color,background-color] duration-150",
                selected === i.item ? "border-amber bg-amber/10" : "border-slate-800 hover:border-slate-600",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-slate-100">{i.descricao}</span>
                <span className="text-[11px] text-slate-500">#{i.item} {i.grupo && `· ${i.grupo}`}</span>
              </span>
              <span className="shrink-0 text-[11px] text-slate-400">{i.um}</span>
            </button>
          </li>
        ))}
        {q.trim().length >= 2 && !isFetching && !list.length && <li className="px-1 text-xs text-slate-500">Nenhum insumo encontrado.</li>}
      </ul>
    </div>
  );
}

/** Resolves a scanned label: known labels pre-fill everything; unknown ones are confirmed once and memorised. */
export function LabelConfirm({ raw, onConfirm, onCancel, autoKnown }: { raw: string; onConfirm: (l: PickedLine) => void; onCancel: () => void; autoKnown: boolean }) {
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [qtyStr, setQtyStr] = useState("");
  const [lote, setLote] = useState("");
  const [validade, setValidade] = useState("");
  const doneRef = useRef(false);
  const [nonce] = useState(() => Date.now()); // every scan resolves fresh (a label may have just been memorised)

  const resolve = useQuery({
    queryKey: ["qr-resolve", raw, nonce],
    queryFn: () => apiPost<QrResolveOut>("/qr/resolve", { raw }),
    staleTime: 0,
    gcTime: 0,
  });
  const r = resolve.data;

  useEffect(() => {
    if (!r) return;
    if (r.label) {
      setItem({ item: r.label.item, descricao: r.label.descricao, um: r.label.um, grupo: "", custo: null });
      setQtyStr(String(r.label.qty));
      setLote(r.label.lote);
      setValidade(r.label.validade);
      if (autoKnown && !doneRef.current) {
        doneRef.current = true;
        onConfirm({ item: r.label.item, descricao: r.label.descricao, um: r.label.um, qty: r.label.qty, qr_code: r.code });
      }
    } else {
      if (r.suggestions[0]) setItem(r.suggestions[0]);
      if (r.parsed.peso) setQtyStr(String(r.parsed.peso));
      setLote(r.parsed.lote);
      setValidade(r.parsed.validade);
    }
  }, [r, autoKnown, onConfirm]);

  const save = useMutation({
    mutationFn: (body: QrLabelIn) => apiPost<QrLabel>("/qr/labels", body),
    onError: (e) => toast.error(errorMessage(e, "Não foi possível memorizar a etiqueta")),
  });

  const qtyN = Number(qtyStr.replace(",", "."));
  const um = item?.um || r?.parsed.um || "";

  const confirm = async () => {
    if (!item || !(qtyN > 0) || !r) return;
    await save.mutateAsync({ raw, item: item.item, descricao: item.descricao, um, qty: qtyN, lote, validade });
    onConfirm({ item: item.item, descricao: item.descricao, um, qty: qtyN, qr_code: r.code });
  };

  if (resolve.isLoading) return <div className="flex items-center gap-2 p-4 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Lendo etiqueta…</div>;
  if (resolve.isError || !r) return <div className="p-4 text-sm text-[#FCA5A5]">Falha ao ler a etiqueta. <button className="underline" onClick={onCancel}>Fechar</button></div>;
  if (r.known && autoKnown) return null;

  return (
    <div className="space-y-4 rounded-xl border border-amber/30 bg-amber/5 p-4 animate-rise" data-testid="qr-confirm-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-amber">{r.known ? "Etiqueta conhecida" : "Nova etiqueta — confirme uma vez"}</div>
          <div className="mt-1 break-all text-[11px] text-slate-500" data-testid="qr-raw">{raw.slice(0, 140)}</div>
        </div>
        {r.parsed.produto && <span className="shrink-0 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">Lido: {r.parsed.produto}</span>}
      </div>
      <div>
        <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Insumo</Label>
        <ItemPicker onPick={setItem} selected={item?.item} initial={item && !r.suggestions.some((s) => s.item === item.item) ? [item, ...r.suggestions] : r.suggestions} testId="qr-item" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Peso / quantidade {um && `(${um})`}</Label>
          <Input data-testid="qr-qty-input" inputMode="decimal" value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} />
        </div>
        <div>
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Lote</Label>
          <Input data-testid="qr-lote-input" value={lote} onChange={(e) => setLote(e.target.value)} />
        </div>
        <div>
          <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Validade</Label>
          <Input data-testid="qr-validade-input" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button data-testid="qr-confirm-button" disabled={!item || !(qtyN > 0) || save.isPending} onClick={() => void confirm()}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Confirmar {item && qtyN > 0 && `${fmtQty(qtyN)} ${um}`}
        </Button>
        <Button variant="ghost" data-testid="qr-cancel-button" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

/** Manual line entry (no QR): pick an item and type the quantity. */
export function ManualLine({ onAdd, testId = "manual-line" }: { onAdd: (l: PickedLine) => void; testId?: string }) {
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [qtyStr, setQtyStr] = useState("");
  const qtyN = Number(qtyStr.replace(",", "."));
  return (
    <div className="space-y-3">
      <ItemPicker onPick={setItem} selected={item?.item} testId={`${testId}-item`} />
      <div className="flex gap-2">
        <Input data-testid={`${testId}-qty`} inputMode="decimal" placeholder={`Quantidade${item?.um ? ` (${item.um})` : ""}`} value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} />
        <Button
          data-testid={`${testId}-add`}
          disabled={!item || !(qtyN > 0)}
          onClick={() => {
            if (!item) return;
            onAdd({ item: item.item, descricao: item.descricao, um: item.um, qty: qtyN, qr_code: null });
            setQtyStr("");
            setItem(null);
          }}
        >
          Adicionar
        </Button>
      </div>
    </div>
  );
}
