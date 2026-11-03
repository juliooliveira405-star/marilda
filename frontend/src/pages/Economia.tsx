import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, PiggyBank, Target } from "lucide-react";
import { PageHeader, Panel, Skeleton } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDashboard } from "@/lib/queries";
import { brl, compactBrl, pct } from "@/lib/format";

function Slider({ label, value, min, max, step, onChange, display, testId }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string; testId: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wider text-slate-400">{label}</Label>
        <span className="num text-sm font-semibold text-amber" data-testid={`${testId}-value`}>{display}</span>
      </div>
      <input type="range" className="range w-full" min={min} max={max} step={step} value={value} data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export default function Economia() {
  const { data, isLoading } = useDashboard();
  const lastCmv = [...(data?.months ?? [])].reverse().find((m) => m.cmv_pct !== null);
  const baseCmvDefault = lastCmv?.cmv_pct ?? data?.cmv_pct_medio ?? 0.35;
  const fatDefault = data?.faturamento_medio ?? 0;

  const [cmvAtual, setCmvAtual] = useState<number | null>(null);
  const [meta, setMeta] = useState<number | null>(null);
  const [meses, setMeses] = useState(6);
  const [neg, setNeg] = useState(3);
  const [fat, setFat] = useState<string>("");
  const [goal, setGoal] = useState<string>("100000");

  const atual = cmvAtual ?? Math.round(baseCmvDefault * 1000) / 10;
  const alvo = meta ?? Math.round((data?.settings.cmv_meta_max ?? 0.3) * 1000) / 10;
  const faturamento = fat === "" ? fatDefault : Number(fat) || 0;
  const classeA = data?.compras_classe_a_media ?? 0;

  const calc = useMemo(() => {
    const cmvMensal = Math.max(0, (atual - alvo) / 100) * faturamento;
    const negMensal = (neg / 100) * classeA;
    const mensal = cmvMensal + negMensal;
    const series = Array.from({ length: meses }, (_, i) => ({
      mes: `Mês ${i + 1}`,
      "Ajuste de CMV": Math.round(cmvMensal * (i + 1)),
      "Negociação A": Math.round(negMensal * (i + 1)),
    }));
    const goalN = Number(goal) || 0;
    const mesesMeta = mensal > 0 && goalN > 0 ? Math.ceil(goalN / mensal) : null;
    return { cmvMensal, negMensal, mensal, total: mensal * meses, anual: mensal * 12, series, mesesMeta };
  }, [atual, alvo, faturamento, neg, classeA, meses, goal]);

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <div>
      <PageHeader eyebrow="Planejamento" title="Simulador de Economia"
        subtitle="Quanto você economiza — e em quanto tempo — reduzindo o CMV até a meta e renegociando com os fornecedores classe A." />

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <Panel title="Parâmetros" testId="savings-params">
          <div className="space-y-6">
            <Slider testId="savings-current-slider" label={`CMV atual (${lastCmv ? `último: ${lastCmv.label}` : "estimado"})`} value={atual} min={15} max={50} step={0.1}
              onChange={setCmvAtual} display={`${atual.toFixed(1).replace(".", ",")}%`} />
            <Slider testId="savings-target-slider" label="Meta de CMV" value={alvo} min={15} max={45} step={0.1}
              onChange={setMeta} display={`${alvo.toFixed(1).replace(".", ",")}%`} />
            <Slider testId="savings-horizon-slider" label="Prazo" value={meses} min={1} max={12} step={1} onChange={setMeses} display={`${meses} ${meses === 1 ? "mês" : "meses"}`} />
            <Slider testId="savings-discount-slider" label="Renegociação com classe A" value={neg} min={0} max={15} step={0.5}
              onChange={setNeg} display={`${neg.toFixed(1).replace(".", ",")}%`} />
            <div>
              <Label className="mb-2 text-xs uppercase tracking-wider text-slate-400">Faturamento mensal (R$)</Label>
              <Input data-testid="savings-revenue-input" type="number" min={0} placeholder={String(Math.round(fatDefault))} value={fat} onChange={(e) => setFat(e.target.value)} />
              <p className="mt-1 text-[11px] text-slate-500">Padrão: média dos meses lançados ({brl(fatDefault)}). Compras classe A/mês: {brl(classeA)}.</p>
            </div>
          </div>
        </Panel>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Panel testId="savings-monthly">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400"><PiggyBank className="h-4 w-4 text-amber" />Economia por mês</div>
              <div className="num mt-2 text-2xl font-semibold text-slate-50" data-testid="savings-monthly-value">{brl(calc.mensal)}</div>
              <div className="text-xs text-slate-500">CMV {brl(calc.cmvMensal)} + negociação {brl(calc.negMensal)}</div>
            </Panel>
            <Panel testId="savings-calculated-total" className="border-amber/40 bg-gradient-to-br from-amber/10 to-transparent">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber"><Target className="h-4 w-4" />Acumulado em {meses} {meses === 1 ? "mês" : "meses"}</div>
              <div className="num mt-2 text-3xl font-semibold text-slate-50" data-testid="savings-total-value">{brl(calc.total)}</div>
              <div className="text-xs text-slate-400">Em 12 meses: {brl(calc.anual)}</div>
            </Panel>
            <Panel testId="savings-goal">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400"><Clock className="h-4 w-4 text-emerald" />Quero economizar</div>
              <Input data-testid="savings-goal-input" type="number" min={0} value={goal} onChange={(e) => setGoal(e.target.value)} className="mt-2 h-8" />
              <div className="mt-2 text-sm text-slate-300" data-testid="savings-goal-result">
                {calc.mesesMeta ? <>Leva <span className="num font-semibold text-emerald">{calc.mesesMeta} {calc.mesesMeta === 1 ? "mês" : "meses"}</span></> : "Ajuste a meta ou a negociação"}
              </div>
            </Panel>
          </div>

          <Panel title="Economia acumulada" testId="savings-chart">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={calc.series}>
                  <CartesianGrid stroke="#1E293B" vertical={false} />
                  <XAxis dataKey="mes" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} tickFormatter={(v: number) => compactBrl(v)} width={70} />
                  <Tooltip contentStyle={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => brl(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Ajuste de CMV" stackId="a" fill="#F59E0B" />
                  <Bar dataKey="Negociação A" stackId="a" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Ajuste de CMV = (CMV atual − meta) × faturamento mensal. Cada 1 p.p. de CMV a menos vale {brl(faturamento / 100)} por mês.
              {atual <= alvo && " O CMV atual já está dentro da meta — a economia vem só da negociação."} CMV médio apurado: {pct(data?.cmv_pct_medio)}.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
