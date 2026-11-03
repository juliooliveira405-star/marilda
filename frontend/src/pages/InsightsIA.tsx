import { Fragment, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, errorMessage } from "@/lib/api";
import { qk, useAiModels, useInsights } from "@/lib/queries";
import { dateTimeBr } from "@/lib/format";
import type { Insight, InsightFocus, InsightIn } from "@/lib/types";
import { cn } from "@/lib/utils";

const FOCUS: Record<InsightFocus, string> = {
  geral: "Diagnóstico geral",
  cmv: "CMV e meta",
  fornecedores: "Fornecedores (ABC)",
  estoque: "Estoque e pedidos",
  economia: "Plano de economia",
};

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="text-slate-50">{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>,
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-300">
      {text.split("\n").map((raw, i) => {
        const line = raw.trim();
        if (!line) return null;
        if (line.startsWith("#")) return <h3 key={i} className="pt-3 font-heading text-base font-semibold text-amber">{line.replace(/^#+\s*/, "")}</h3>;
        if (/^[-*•]\s/.test(line)) return <div key={i} className="flex gap-2 pl-1"><span className="text-amber">•</span><span>{inline(line.replace(/^[-*•]\s/, ""))}</span></div>;
        if (/^\d+[.)]\s/.test(line)) return <div key={i} className="pl-1">{inline(line)}</div>;
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}

export default function InsightsIA() {
  const qc = useQueryClient();
  const { data: models } = useAiModels();
  const { data: history, isError } = useInsights();
  const [model, setModel] = useState("gemini-3-flash");
  const [focus, setFocus] = useState<InsightFocus>("geral");
  const [question, setQuestion] = useState("");
  const [current, setCurrent] = useState<Insight | null>(null);
  const modelName = (id: string) => models?.find((m) => m.id === id)?.name ?? id;

  const gen = useMutation({
    mutationFn: (body: InsightIn) => apiPost<Insight>("/insights", body),
    onSuccess: (ins) => {
      setCurrent(ins);
      void qc.invalidateQueries({ queryKey: qk.insights });
      toast.success("Diagnóstico gerado");
    },
    onError: (e) => toast.error(errorMessage(e, "A IA não respondeu. Tente outro modelo.")),
  });

  const shown = current ?? (isError ? null : history?.[0]) ?? null;

  return (
    <div>
      <PageHeader eyebrow="Inteligência" title="Insights & Diagnóstico IA" subtitle="A IA lê todos os indicadores calculados (CMV, compras, ABC, estoque) e sugere ações com impacto em R$." />
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Panel title="Gerar diagnóstico" testId="ai-form">
            <div className="space-y-4">
              <div>
                <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Modelo de IA</Label>
                <div className="grid gap-2" data-testid="ai-model-selector">
                  {(models ?? []).map((m) => (
                    <button key={m.id} data-testid={`ai-model-${m.id}`} onClick={() => setModel(m.id)}
                      className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-[border-color,background-color] duration-150",
                        model === m.id ? "border-amber bg-amber/10 text-slate-50" : "border-slate-800 text-slate-300 hover:border-slate-600")}>
                      <span className="font-medium">{m.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">{m.badge}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Foco</Label>
                <Select value={focus} onValueChange={(v: string) => setFocus(v as InsightFocus)}>
                  <SelectTrigger className="w-full" data-testid="ai-focus-select"><SelectValue>{(v: string) => FOCUS[v as InsightFocus]}</SelectValue></SelectTrigger>
                  <SelectContent>{(Object.keys(FOCUS) as InsightFocus[]).map((f) => <SelectItem key={f} value={f}>{FOCUS[f]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Pergunta (opcional)</Label>
                <Textarea data-testid="ai-question-input" maxLength={600} rows={3} placeholder="Ex: Por que o CMV de outubro subiu tanto?" value={question} onChange={(e) => setQuestion(e.target.value)} />
              </div>
              <Button className="w-full" data-testid="ai-generate-insights-btn" disabled={gen.isPending} onClick={() => gen.mutate({ model, focus, question })}>
                {gen.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analisando com {modelName(model)}…</> : <><Sparkles className="mr-2 h-4 w-4" /> Gerar insights</>}
              </Button>
            </div>
          </Panel>
          <Panel title="Histórico" testId="ai-history">
            <ul className="space-y-1">
              {(isError ? [] : (history ?? [])).map((h) => (
                <li key={h.id}>
                  <button data-testid={`ai-history-${h.id}`} onClick={() => setCurrent(h)}
                    className={cn("w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-slate-800/60", shown?.id === h.id ? "text-amber" : "text-slate-400")}>
                    {dateTimeBr(h.created_at)} · {h.model_name} · {FOCUS[h.focus as InsightFocus] ?? h.focus}
                  </button>
                </li>
              ))}
              {!history?.length && <li className="text-xs text-slate-500">Nenhum diagnóstico ainda.</li>}
            </ul>
          </Panel>
        </div>
        <Panel testId="ai-insights-content" className="min-h-[420px]">
          {gen.isPending && !current ? (
            <div className="flex h-80 flex-col items-center justify-center gap-3 text-sm text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin text-amber" /> Cruzando CMV, compras, fornecedores e estoque…
            </div>
          ) : shown ? (
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded bg-amber/10 px-2 py-0.5 font-semibold text-amber">{shown.model_name}</span>
                <span>{FOCUS[shown.focus as InsightFocus] ?? shown.focus}</span>
                <span>· {dateTimeBr(shown.created_at)}</span>
                {shown.user_email && <span>· {shown.user_email}</span>}
              </div>
              {shown.question && <p className="mb-3 text-sm italic text-slate-400">“{shown.question}”</p>}
              <Markdown text={shown.content} />
            </div>
          ) : (
            <EmptyState title="Gere o primeiro diagnóstico" detail="Escolha o modelo e o foco ao lado." />
          )}
        </Panel>
      </div>
    </div>
  );
}
