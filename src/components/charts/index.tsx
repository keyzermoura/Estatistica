import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { PowerPoint } from '../../lib/types';
import type { AnalysisChart } from '../../stats/analysis-types';
import type { HistogramResult, NormalProbabilityPlotResult } from '../../stats/normality';
import type { ConformityResult } from '../../stats/conformity';
export * from './theme';

const axis = {
  stroke: '#94a3b8',
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: '#cbd5e1' },
};

export function PowerCurveChart({
  data,
  targetPower = 0.8,
  recommended,
  height = 260,
}: {
  data: PowerPoint[];
  targetPower?: number;
  recommended?: number;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="n" {...axis} label={{ value: 'n por grupo', position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...axis} />
        <Tooltip
          formatter={(value: number, name: string) => [
            name === 'power' ? `${(Number(value) * 100).toFixed(1)}%` : Number(value).toPrecision(3),
            name === 'power' ? 'Poder' : 'Precisão',
          ]}
          labelFormatter={(label) => `n = ${label}`}
          contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
        />
        <Legend formatter={(value) => (value === 'power' ? 'Poder' : 'Semi-amplitude IC')} wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={targetPower} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'poder alvo', fontSize: 10, fill: '#b45309' }} />
        {recommended ? <ReferenceLine x={recommended} stroke="#0f766e" strokeDasharray="4 4" label={{ value: 'n', fontSize: 10, fill: '#0f766e' }} /> : null}
        <Line type="monotone" dataKey="power" stroke="#0f766e" strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ScatterPlot({
  data,
  xLabel,
  yLabel,
  height = 260,
  line = false,
}: {
  data: Array<{ x: number; y: number }>;
  xLabel?: string;
  yLabel?: string;
  height?: number;
  line?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" dataKey="x" name={xLabel} {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis type="number" dataKey="y" name={yLabel} {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <ZAxis range={[45, 45]} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        <Scatter data={data} fill="#0f766e" fillOpacity={0.75} />
        {line ? <ReferenceLine x={0} stroke="#cbd5e1" /> : null}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function ResidualPlot({
  data,
  xLabel = 'Ajustado',
  yLabel = 'Resíduo',
  height = 240,
}: {
  data: Array<{ x: number; y: number }>;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" dataKey="x" {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis type="number" dataKey="y" {...axis} />
        <ZAxis range={[40, 40]} />
        <ReferenceLine y={0} stroke="#94a3b8" />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        <Scatter data={data} fill="#0284c7" fillOpacity={0.7} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function BarSeriesChart({
  data,
  xKey,
  yKey,
  xLabel,
  yLabel,
  height = 240,
  color = '#0f766e',
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  yKey: string;
  xLabel?: string;
  yLabel?: string;
  height?: number;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey={xKey} {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis {...axis} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        <Bar dataKey={yKey} radius={[6, 6, 0, 0]}>
          {data.map((_, index) => (
            <Cell key={index} fill={index === 0 ? color : '#5eead4'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GroupMeansChart({
  data,
  height = 240,
}: {
  data: Array<{ group: string; mean: number | null; sd: number | null; n: number }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="group" {...axis} />
        <YAxis {...axis} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        <Bar dataKey="mean" fill="#0f766e" radius={[6, 6, 0, 0]} name="Média" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 1. Histograma com Curva Gaussiana Teórica Sobreposta */
export function HistogramWithNormalCurveChart({
  data: explicitData,
  result,
  chart,
  mean: explicitMean,
  sd: explicitSd,
  xLabel = 'Classes de valores',
  yLabel = 'Frequência',
  height = 260,
}: {
  data?: Array<{ classe: string; binMid: number; contagem: number; esperado: number; densidade?: number }>;
  result?: HistogramResult;
  chart?: AnalysisChart;
  mean?: number;
  sd?: number;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  const data =
    explicitData ??
    (result
      ? result.bins.map((b) => ({
          classe: b.label,
          binMid: b.binMid,
          contagem: b.count,
          esperado: Number(b.expectedCount.toFixed(2)),
          densidade: Number(b.density.toFixed(4)),
        }))
      : ((chart?.data as any) ?? []));
  const mean = explicitMean ?? result?.mean ?? (chart?.meta?.mean as number | undefined);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 12, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="classe" {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <Tooltip
          formatter={(val: number, name: string) => [
            name === 'contagem' ? `${val} obs.` : `${Number(val).toFixed(2)} esp.`,
            name === 'contagem' ? 'Frequência observada' : 'Curva Normal teórica',
          ]}
          labelFormatter={(label) => `Classe central: ${label}`}
          contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {mean !== undefined ? (
          <ReferenceLine x={mean.toFixed(2)} stroke="#0284c7" strokeDasharray="3 3" label={{ value: 'x̄', fill: '#0284c7', fontSize: 10 }} />
        ) : null}
        <Bar dataKey="contagem" fill="#0f766e" fillOpacity={0.7} stroke="#0f766e" radius={[4, 4, 0, 0]} name="Frequência" />
        <Line type="monotone" dataKey="esperado" stroke="#f59e0b" strokeWidth={2.5} dot={false} name="Curva Normal N(x̄, s²)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 2. Gráfico de Probabilidade Normal (Q–Q Plot com Reta Teórica e Bandas a 95%) */
export function NormalProbabilityPlotChart({
  data: explicitData,
  result,
  chart,
  outlierIndices,
  xLabel = 'Quantil Teórico Normal (z)',
  yLabel = 'Valor Observado',
  height = 260,
}: {
  data?: Array<{ z: number; observado: number; esperado: number; lic?: number; lsc?: number; outlier?: boolean; percentil?: number }>;
  result?: NormalProbabilityPlotResult;
  chart?: AnalysisChart;
  outlierIndices?: Set<number>;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  const data =
    explicitData ??
    (result
      ? result.points.map((p) => ({
          z: Number(p.zTheoretical.toFixed(3)),
          observado: Number(p.observed.toFixed(4)),
          esperado: Number(p.expected.toFixed(4)),
          lic: Number(p.lowerBand.toFixed(4)),
          lsc: Number(p.upperBand.toFixed(4)),
          outlier: outlierIndices ? outlierIndices.has(p.index - 1) : false,
          percentil: Number(p.percentile.toFixed(1)),
        }))
      : ((chart?.data as any) ?? []));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 12, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" dataKey="z" domain={['auto', 'auto']} {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis type="number" dataKey="observado" domain={['auto', 'auto']} {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <Tooltip
          formatter={(val: number, name: string) => [
            Number(val).toFixed(4),
            name === 'observado' ? 'Observado' : name === 'esperado' ? 'Reta Normal' : name === 'lsc' ? 'Bandas 95%' : name,
          ]}
          labelFormatter={(z) => `Quantil z = ${Number(z).toFixed(2)}`}
          contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="esperado" stroke="#0f766e" strokeWidth={2} dot={false} name="Reta Teórica Normal" />
        <Line type="monotone" dataKey="lsc" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} dot={false} name="Banda Sup. (95%)" />
        <Line type="monotone" dataKey="lic" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} dot={false} name="Banda Inf. (95%)" />
        <Scatter dataKey="observado" name="Observações">
          {data.map((entry: any, idx: number) => (
            <Cell key={`pt-${idx}`} fill={entry.outlier ? '#e11d48' : '#0284c7'} stroke={entry.outlier ? '#be123c' : '#0369a1'} strokeWidth={entry.outlier ? 2 : 1} r={entry.outlier ? 5 : 3.5} />
          ))}
        </Scatter>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 3. Cartas de Controle Shewhart (I-MR, X̄-R) com LC, LIC, LSC e Alerta Western Electric */
export function ShewhartControlChartPlot({
  data,
  center,
  lcl,
  ucl,
  xLabel = 'Ponto / Amostra',
  yLabel = 'Valor',
  height = 250,
}: {
  data: Array<{ ponto: number | string; valor: number; rotulo?: string; lc?: number; lic?: number; lsc?: number; alarme?: boolean | string }>;
  center?: number;
  lcl?: number;
  ucl?: number;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  const c = center ?? (data[0]?.lc ?? 0);
  const lo = lcl ?? (data[0]?.lic ?? 0);
  const hi = ucl ?? (data[0]?.lsc ?? 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 16, bottom: 12, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="ponto" {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis domain={['auto', 'auto']} {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <Tooltip
          formatter={(val: number, name: string) => [Number(val).toFixed(4), name === 'valor' ? 'Medição' : name]}
          labelFormatter={(label) => `Ponto #${label}`}
          contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
        />
        {c !== undefined ? <ReferenceLine y={c} stroke="#0f766e" strokeWidth={1.5} label={{ value: `LC: ${Number(c).toFixed(3)}`, fill: '#0f766e', fontSize: 10, position: 'right' }} /> : null}
        {hi !== undefined ? <ReferenceLine y={hi} stroke="#e11d48" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: `LSC: ${Number(hi).toFixed(3)}`, fill: '#e11d48', fontSize: 10, position: 'right' }} /> : null}
        {lo !== undefined ? <ReferenceLine y={lo} stroke="#e11d48" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: `LIC: ${Number(lo).toFixed(3)}`, fill: '#e11d48', fontSize: 10, position: 'right' }} /> : null}
        <Line
          type="linear"
          dataKey="valor"
          stroke="#0f766e"
          strokeWidth={2}
          name="Valor"
          dot={(props: any) => {
            const isAlarm = props.payload?.alarme === true || props.payload?.alarme === 'sim';
            return (
              <circle
                key={`dot-${props.cx}-${props.cy}`}
                cx={props.cx}
                cy={props.cy}
                r={isAlarm ? 5 : 3}
                fill={isAlarm ? '#e11d48' : '#0f766e'}
                stroke={isAlarm ? '#ffffff' : '#0f766e'}
                strokeWidth={isAlarm ? 2 : 1}
              />
            );
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 4. Gráfico de Interação Peça × Operador (Gage R&R) */
export function InteractionPlot({
  data,
  xLabel = 'Peça',
  yLabel = 'Média por Operador',
  height = 260,
}: {
  data: Array<Record<string, any>>;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  const parts = [...new Set(data.map((d) => String(d.part ?? '')))];
  const operators = [...new Set(data.map((d) => String(d.operator ?? '')))];

  const pivoted = parts.map((p) => {
    const row: Record<string, any> = { part: p };
    for (const op of operators) {
      const match = data.find((d) => String(d.part) === p && String(d.operator) === op);
      if (match) {
        row[op] = match.mean !== undefined ? match.mean : match.range;
      }
    }
    return row;
  });

  const palette = ['#0f766e', '#0284c7', '#d97706', '#9333ea', '#e11d48', '#2563eb'];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={pivoted} margin={{ top: 12, right: 16, bottom: 12, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="part" {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {operators.map((op, i) => (
          <Line key={op} type="linear" dataKey={op} stroke={palette[i % palette.length]} strokeWidth={2.2} dot={{ r: 4 }} name={`Operador ${op}`} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 5. Gráfico de Bland–Altman Completo com Viés Médio e Limites de Concordância 95% */
export function BlandAltmanPlotChart({
  data,
  dBar = 0,
  loaLower = -1,
  loaUpper = 1,
  xLabel = 'Média das Medições',
  yLabel = 'Diferença (Medido − Referência)',
  height = 260,
}: {
  data: Array<{ x: number; y: number }>;
  dBar?: number;
  loaLower?: number;
  loaUpper?: number;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 24, bottom: 12, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" dataKey="x" {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis type="number" dataKey="y" {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        <ReferenceLine y={0} stroke="#cbd5e1" />
        <ReferenceLine y={dBar} stroke="#0f766e" strokeWidth={2} label={{ value: `Viés (d̄): ${dBar.toFixed(3)}`, fill: '#0f766e', fontSize: 10, position: 'right' }} />
        <ReferenceLine y={loaUpper} stroke="#e11d48" strokeDasharray="4 4" label={{ value: `+1.96s: ${loaUpper.toFixed(3)}`, fill: '#e11d48', fontSize: 10, position: 'right' }} />
        <ReferenceLine y={loaLower} stroke="#e11d48" strokeDasharray="4 4" label={{ value: `-1.96s: ${loaLower.toFixed(3)}`, fill: '#e11d48', fontSize: 10, position: 'right' }} />
        <Scatter data={data} fill="#0284c7" fillOpacity={0.75} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** 6. Gráficos de Mandel h e k com Limites Críticos de 5% e 1% */
export function MandelConsistencyPlotChart({
  data: explicitData,
  chart,
  statKey: explicitStatKey,
  crit05: explicitCrit05,
  crit01: explicitCrit01,
  bilateral: explicitBilateral,
  xLabel: explicitXLabel,
  yLabel: explicitYLabel,
  height = 250,
}: {
  data?: Array<{ lab: string; [key: string]: any }>;
  chart?: AnalysisChart | null;
  statKey?: string;
  crit05?: number;
  crit01?: number;
  bilateral?: boolean;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  const data = explicitData ?? ((chart?.data as any) ?? []);
  const statKey = explicitStatKey ?? (chart?.meta?.statKey as string | undefined) ?? 'h';
  const crit05 = explicitCrit05 ?? (chart?.meta?.crit05 as number | undefined) ?? 2;
  const crit01 = explicitCrit01 ?? (chart?.meta?.crit01 as number | undefined) ?? 2.5;
  const bilateral = explicitBilateral ?? (chart?.meta?.bilateral as boolean | undefined) ?? true;
  const xLabel = explicitXLabel ?? chart?.xLabel ?? 'Laboratório / Analista';
  const yLabel = explicitYLabel ?? chart?.yLabel ?? 'Estatística';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 24, bottom: 12, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="lab" {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        <ReferenceLine y={crit05} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: `5%: ${crit05.toFixed(2)}`, fill: '#b45309', fontSize: 10, position: 'right' }} />
        <ReferenceLine y={crit01} stroke="#e11d48" strokeDasharray="4 4" label={{ value: `1%: ${crit01.toFixed(2)}`, fill: '#be123c', fontSize: 10, position: 'right' }} />
        {bilateral ? (
          <>
            <ReferenceLine y={-crit05} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: `-5%: -${crit05.toFixed(2)}`, fill: '#b45309', fontSize: 10, position: 'right' }} />
            <ReferenceLine y={-crit01} stroke="#e11d48" strokeDasharray="4 4" label={{ value: `-1%: -${crit01.toFixed(2)}`, fill: '#be123c', fontSize: 10, position: 'right' }} />
          </>
        ) : null}
        <Bar dataKey={statKey} radius={[4, 4, 0, 0]} name={statKey}>
          {data.map((entry: any, idx: number) => {
            const val = Math.abs(Number(entry[statKey]));
            const isOutlier = val > crit01;
            const isStraggler = !isOutlier && val > crit05;
            return <Cell key={`mandel-${idx}`} fill={isOutlier ? '#e11d48' : isStraggler ? '#f59e0b' : '#0f766e'} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 7. Perfil de Exatidão β-Expectation (SFSTP / USP <1210>) */
export function AccuracyProfilePlotChart({
  data,
  acceptanceLimit = 15,
  xLabel = 'Nível de Concentração',
  yLabel = 'Erro Relativo (%)',
  height = 260,
}: {
  data: Array<{ nivel: string; vies: number; itInferior: number; itSuperior: number }>;
  acceptanceLimit?: number;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 24, bottom: 12, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="nivel" {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis domain={[-acceptanceLimit * 1.4, acceptanceLimit * 1.4]} {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="#cbd5e1" />
        <ReferenceLine y={acceptanceLimit} stroke="#e11d48" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: `+λ (+${acceptanceLimit}%)`, fill: '#be123c', fontSize: 10, position: 'right' }} />
        <ReferenceLine y={-acceptanceLimit} stroke="#e11d48" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: `-λ (-${acceptanceLimit}%)`, fill: '#be123c', fontSize: 10, position: 'right' }} />
        <Line type="monotone" dataKey="itSuperior" stroke="#d97706" strokeWidth={2} strokeDasharray="3 3" dot={{ r: 3 }} name="Limite Sup. β-Expectation" />
        <Line type="monotone" dataKey="vies" stroke="#0f766e" strokeWidth={2.5} dot={{ r: 4 }} name="Viés Relativo Médio (%)" />
        <Line type="monotone" dataKey="itInferior" stroke="#d97706" strokeWidth={2} strokeDasharray="3 3" dot={{ r: 3 }} name="Limite Inf. β-Expectation" />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 8. Gráfico de Pareto (Robustez Youden/Lenth e Incerteza GUM) */
export function ParetoPlotChart({
  data,
  xKey,
  yKey,
  cutoffLine,
  cutoffLabel = 'Limite Crítico',
  xLabel = 'Fator / Fonte',
  yLabel = 'Magnitude',
  height = 250,
}: {
  data: Array<Record<string, any>>;
  xKey: string;
  yKey: string;
  cutoffLine?: number;
  cutoffLabel?: string;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 24, bottom: 12, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey={xKey} {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        {cutoffLine !== undefined ? (
          <ReferenceLine y={cutoffLine} stroke="#e11d48" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: `${cutoffLabel}: ${cutoffLine.toFixed(2)}`, fill: '#be123c', fontSize: 10, position: 'right' }} />
        ) : null}
        <Bar dataKey={yKey} fill="#0f766e" radius={[4, 4, 0, 0]} name={yLabel}>
          {data.map((entry, idx) => {
            const isSignificant = cutoffLine !== undefined && Math.abs(Number(entry[yKey])) > cutoffLine;
            return <Cell key={`bar-${idx}`} fill={isSignificant ? '#e11d48' : '#0f766e'} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 9. Curva de Densidade de Conformidade com Zonas de Aceitação e Banda de Guarda */
export function ConformityDensityChartPlot({
  data,
  result,
  value: explicitValue,
  lsl: explicitLsl,
  usl: explicitUsl,
  effectiveLower: explicitEffectiveLower,
  effectiveUpper: explicitEffectiveUpper,
  xLabel = 'Mensurando',
  yLabel = 'Densidade',
  height = 260,
}: {
  data: Array<{ x: number; density: number; postDensity?: number }>;
  result?: ConformityResult | null;
  value?: number;
  lsl?: number | null;
  usl?: number | null;
  effectiveLower?: number | null;
  effectiveUpper?: number | null;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  const value = explicitValue ?? result?.value;
  const lsl = explicitLsl !== undefined ? explicitLsl : result?.lsl;
  const usl = explicitUsl !== undefined ? explicitUsl : result?.usl;
  const effectiveLower = explicitEffectiveLower !== undefined ? explicitEffectiveLower : result?.effectiveLower;
  const effectiveUpper = explicitEffectiveUpper !== undefined ? explicitEffectiveUpper : result?.effectiveUpper;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 12, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" dataKey="x" domain={['auto', 'auto']} {...axis} label={{ value: xLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#64748b' }} />
        <YAxis {...axis} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {effectiveLower !== null && effectiveUpper !== null && effectiveLower !== undefined && effectiveUpper !== undefined ? (
          <ReferenceArea x1={effectiveLower} x2={effectiveUpper} fill="#10b981" fillOpacity={0.12} />
        ) : null}
        {lsl !== null && lsl !== undefined ? (
          <ReferenceLine x={lsl} stroke="#e11d48" strokeWidth={1.5} label={{ value: `LSL (${lsl})`, fill: '#be123c', fontSize: 10, position: 'insideTopLeft' }} />
        ) : null}
        {usl !== null && usl !== undefined ? (
          <ReferenceLine x={usl} stroke="#e11d48" strokeWidth={1.5} label={{ value: `USL (${usl})`, fill: '#be123c', fontSize: 10, position: 'insideTopRight' }} />
        ) : null}
        {effectiveLower !== null && effectiveLower !== undefined && effectiveLower !== lsl ? (
          <ReferenceLine x={effectiveLower} stroke="#0f766e" strokeDasharray="3 3" label={{ value: `LSL+w`, fill: '#0f766e', fontSize: 10 }} />
        ) : null}
        {effectiveUpper !== null && effectiveUpper !== undefined && effectiveUpper !== usl ? (
          <ReferenceLine x={effectiveUpper} stroke="#0f766e" strokeDasharray="3 3" label={{ value: `USL-w`, fill: '#0f766e', fontSize: 10 }} />
        ) : null}
        {value !== undefined ? (
          <ReferenceLine x={value} stroke="#0284c7" strokeWidth={2} label={{ value: `x (${value})`, fill: '#0284c7', fontSize: 10 }} />
        ) : null}
        <Area type="monotone" dataKey="density" fill="#0f766e" fillOpacity={0.3} stroke="#0f766e" strokeWidth={2} name="N(x, u²)" />
        {data.some((d) => d.postDensity !== undefined) ? (
          <Line type="monotone" dataKey="postDensity" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={false} name="Posterior N(μ_post, u_post²)" />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
