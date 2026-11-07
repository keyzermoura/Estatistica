import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
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
