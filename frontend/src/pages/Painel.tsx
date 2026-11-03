import { Link } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { Boxes, Receipt, Target, TrendingUp, UploadCloud, Wallet } from "lucide-react";
import { AlertItem, EmptyState, KpiCard, PageHeader, Panel, Skeleton } from "@/components/common";
import { buttonVariants } from "@/components/ui/button";
import { useDashboard, useMe } from "@/lib/queries";
import { brl, cmvTone, compactBrl, pct, TONE_CLASSES } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Painel() {
  const { data, isLoading, isError } = useDashboard();
  const { data: me } = useMe();
  const canFeed = me?.role === "gerente" || me?.role === "alimentador";
  const months = isError ? [] : (data?.months ?? []);
  const max = data?.settings.cmv_meta_max ?? 0.3;
  const min = data?.settings.cmv_meta_min ?? 0.28;
  const last = [...months].reverse().find((m) => m.notas > 0);
  const lastCmv = [...months].reverse().find((m) => m.cmv_pct !== null);
  const chart = months.map((m) => ({
    label: m.label,
    Compras: m.compras,
    Faturamento: m.faturamento ?? 0,
    "CMV %": m.cmv_pct !== null ? +(m.cmv_pct * 100).toFixed(1) : null,
  }));

  return (
    <div>
      <PageHeader
        eyebrow={data?.settings.empresa ?? "Locale POA"}
        title="Painel Executivo"
        subtitle="Compras, faturamento, estoque e CMV calculados automaticamente a partir dos dados enviados."
        actions={
          canFeed && (
            <Link to="/carregar-dados" className={buttonVariants({ size: "sm" })} data-testid="painel-upload-link">
              <UploadCloud className="mr-1 h-4 w-4" /> Carregar dados
            </Link>
          )
        }
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : !last ? (
        <EmptyState testId="painel-empty" title="Sem dados ainda" detail="Envie compras, inventários, custos e faturamento em Carregar Dados para ver os indicadores." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2" data-testid="month-status-pills">
            {months.map((m) => (
              <span key={m.month} className={cn("rounded-full border border-slate-800 px-3 py-1 text-xs", m.status === "fechado" ? "text-slate-300" : "text-amber border-amber/40")}>
                {m.label} · {m.status === "fechado" ? "fechado" : "aberto"}
                {m.cmv_pct !== null && <span className={cn("ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold", TONE_CLASSES[cmvTone(m.cmv_pct, max)])}>{pct(m.cmv_pct)}</span>}
              </span>
            ))}
          </div>

          <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-5">
            <KpiCard testId="kpi-card-compras" label={`Compras ${last.label}`} value={brl(last.compras)} icon={<Receipt className="h-4 w-4" />}
              hint={last.compras_projecao ? <>Projeção: <span className="num text-slate-200">{brl(last.compras_projecao)}</span></> : `${last.notas} notas · ${last.fornecedores} fornecedores`} />
            <KpiCard testId="kpi-card-faturamento" label={`Faturamento ${last.label}`} value={brl(last.faturamento)} icon={<TrendingUp className="h-4 w-4" />}
              hint={last.faturamento_parcial ? "Parcial" : last.faturamento ? "Mês completo" : "Não lançado"} />
            <KpiCard testId="kpi-card-cmv-percent" label={`CMV % ${lastCmv?.label ?? ""}`} value={pct(lastCmv?.cmv_pct)} icon={<Target className="h-4 w-4" />}
              tone={cmvTone(lastCmv?.cmv_pct, max)} hint={`Meta ${pct(min, 0)}–${pct(max, 0)}`} />
            <KpiCard testId="kpi-card-cmv-valor" label={`CMV R$ ${lastCmv?.label ?? ""}`} value={brl(lastCmv?.cmv)} icon={<Wallet className="h-4 w-4" />}
              hint={lastCmv ? `EI ${compactBrl(lastCmv.estoque_inicial ?? 0)} + compras − EF` : "Precisa de 2 inventários"} />
            <KpiCard testId="kpi-card-estoque-valor" label={`Estoque ${last.label}`} value={brl(last.estoque_valor)} icon={<Boxes className="h-4 w-4" />}
              hint={`${last.itens_valorizados}/${last.itens_com_estoque} itens valorizados`} />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Panel title="Evolução mensal" testId="painel-chart">
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1E293B" vertical={false} />
                    <XAxis dataKey="label" stroke="#64748B" fontSize={12} />
                    <YAxis yAxisId="v" stroke="#64748B" fontSize={11} tickFormatter={(v: number) => compactBrl(v)} width={70} />
                    <YAxis yAxisId="p" orientation="right" stroke="#64748B" fontSize={11} unit="%" width={40} />
                    <Tooltip
                      contentStyle={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, fontSize: 12 }}
                      formatter={(value: number, name: string) => (name === "CMV %" ? `${value}%` : brl(value))}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="v" dataKey="Faturamento" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={36} />
                    <Bar yAxisId="v" dataKey="Compras" fill="#F59E0B" radius={[4, 4, 0, 0]} maxBarSize={36} />
                    <ReferenceLine yAxisId="p" y={max * 100} stroke="#F87171" strokeDasharray="4 4" />
                    <Line yAxisId="p" type="monotone" dataKey="CMV %" stroke="#A5B4FC" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Alertas & sugestões" testId="painel-alerts">
              <ul className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {(data?.alerts ?? []).map((a, i) => <AlertItem key={i} alert={a} index={i} />)}
              </ul>
            </Panel>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Panel testId="painel-total-compras">
              <div className="text-xs uppercase tracking-wider text-slate-400">Compras no período</div>
              <div className="num mt-2 text-xl font-semibold">{brl(data?.compras_total)}</div>
              <div className="text-xs text-slate-500">{data?.notas_total} notas fiscais</div>
            </Panel>
            <Panel testId="painel-cmv-medio">
              <div className="text-xs uppercase tracking-wider text-slate-400">CMV % médio (meses apurados)</div>
              <div className="num mt-2 text-xl font-semibold">{pct(data?.cmv_pct_medio)}</div>
              <div className="text-xs text-slate-500">Faturamento médio {brl(data?.faturamento_medio)}</div>
            </Panel>
            <Panel testId="painel-custos">
              <div className="text-xs uppercase tracking-wider text-slate-400">Custos unitários cadastrados</div>
              <div className="num mt-2 text-xl font-semibold">{data?.custos_cadastrados}</div>
              <div className="text-xs text-slate-500">Referência: {data?.custos_ref || "—"}</div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
