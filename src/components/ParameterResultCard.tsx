import type { ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { ParameterAnalysis } from '../stats/analysis';
import { fmt } from '../stats/distributions';
import { BarSeriesChart, ResidualPlot, ScatterPlot } from './charts';
import { Card, CardBody, CardHeader, VerdictBadge } from './ui';

function chartFor(
  chart: ParameterAnalysis['charts'][number],
  compact?: boolean,
): ReactNode {
  const height = compact ? 190 : 240;
  if (chart.kind === 'scatter' || chart.kind === 'line' || chart.kind === 'residual') {
    const data = chart.data
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!data.length) return null;
    return chart.kind === 'residual' ? (
      <ResidualPlot data={data} xLabel={chart.xLabel} yLabel={chart.yLabel} height={height} />
    ) : (
      <ScatterPlot data={data} xLabel={chart.xLabel} yLabel={chart.yLabel} height={height} line={chart.kind === 'line'} />
    );
  }
  if (chart.kind === 'bar') {
    const first = chart.data[0] ?? {};
    const xKey = Object.keys(first).find((key) => typeof first[key] === 'string') ?? 'name';
    const yKey = Object.keys(first).find((key) => typeof first[key] === 'number') ?? 'value';
    const data = chart.data
      .map((row) => ({ [xKey]: String(row[xKey] ?? ''), [yKey]: Number(row[yKey] ?? 0) }))
      .filter((row) => Number.isFinite(Number(row[yKey])));
    if (!data.length) return null;
    return (
      <BarSeriesChart
        data={data}
        xKey={xKey}
        yKey={yKey}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        height={height}
      />
    );
  }
  return null;
}

export function ParameterResultCard({
  analysis,
  compact,
}: {
  analysis: ParameterAnalysis;
  compact?: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {analysis.label}
            <VerdictBadge verdict={analysis.verdict} />
          </span>
        }
        description={`n efetivo = ${analysis.n} · ${analysis.reference}`}
        icon={<Info className="h-4 w-4" />}
      />
      <CardBody className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-600 dark:text-ink-300">{analysis.summary}</p>

        {analysis.metrics.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Métrica</th>
                  <th>Fórmula</th>
                  <th className="text-right">Valor</th>
                  <th>Critério</th>
                  <th>Veredito</th>
                </tr>
              </thead>
              <tbody>
                {analysis.metrics.map((metric) => (
                  <tr key={metric.key}>
                    <td className="font-medium text-ink-800 dark:text-ink-100">{metric.label}</td>
                    <td className="max-w-[260px] font-mono text-[11px] leading-relaxed text-ink-500">
                      {metric.formula || '—'}
                    </td>
                    <td className="whitespace-nowrap text-right font-mono text-xs">
                      {metric.value === null || !Number.isFinite(metric.value)
                        ? '—'
                        : `${fmt(metric.value)}${metric.unit ? ` ${metric.unit}` : ''}`}
                    </td>
                    <td className="text-xs text-ink-500">{metric.criterionText}</td>
                    <td>
                      <VerdictBadge verdict={metric.verdict} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-ink-300 px-3 py-3 text-xs text-ink-500 dark:border-ink-700">
            Nenhuma métrica pôde ser calculada com os dados atuais. O resultado permanece “não avaliado”.
          </p>
        )}

        {analysis.tables.map((table) => (
          <div key={table.title}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{table.title}</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className={typeof cell === 'number' ? 'font-mono text-xs' : ''}>
                          {typeof cell === 'number' ? fmt(cell) : cell || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {table.note ? <p className="mt-1 text-[11px] text-ink-400">{table.note}</p> : null}
          </div>
        ))}

        {analysis.charts.length ? (
          <div className={compact ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3 lg:grid-cols-2'}>
            {analysis.charts.slice(0, 2).map((chart) => {
              const rendered = chartFor(chart, compact);
              return rendered ? (
                <div key={chart.title} className="rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                  <p className="mb-1 text-xs font-semibold text-ink-700 dark:text-ink-200">{chart.title}</p>
                  {rendered}
                </div>
              ) : null;
            })}
          </div>
        ) : null}

        {analysis.notes.length || analysis.warnings.length ? (
          <div className="space-y-1.5 text-xs">
            {analysis.notes.map((note) => (
              <p key={note} className="rounded-lg bg-ink-50 px-3 py-2 text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">
                {note}
              </p>
            ))}
            {analysis.warnings.map((warning) => (
              <p key={warning} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
