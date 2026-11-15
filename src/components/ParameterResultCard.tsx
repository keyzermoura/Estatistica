import { useState, type ReactNode } from 'react';
import { AlertTriangle, HelpCircle, Info } from 'lucide-react';
import type { ParameterAnalysis } from '../stats/analysis';
import { fmt } from '../stats/distributions';
import { ExplainableDecisionDrawer, type ExplainableDecisionData } from './ExplainableDecisionDrawer';
import {
  AccuracyProfilePlotChart,
  BarSeriesChart,
  BlandAltmanPlotChart,
  ConformityDensityChartPlot,
  HistogramWithNormalCurveChart,
  InteractionPlot,
  MandelConsistencyPlotChart,
  NormalProbabilityPlotChart,
  ParetoPlotChart,
  ResidualPlot,
  ScatterPlot,
  ShewhartControlChartPlot,
} from './charts';
import { Card, CardBody, CardHeader, VerdictBadge } from './ui';

function chartFor(
  chart: ParameterAnalysis['charts'][number],
  compact?: boolean,
): ReactNode {
  const height = compact ? 200 : 250;

  if (chart.kind === 'histogram') {
    return (
      <HistogramWithNormalCurveChart
        data={chart.data as any}
        mean={chart.meta?.mean as number | undefined}
        sd={chart.meta?.sd as number | undefined}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        height={height}
      />
    );
  }

  if (chart.kind === 'qq') {
    return (
      <NormalProbabilityPlotChart
        data={chart.data as any}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        height={height}
      />
    );
  }

  if (chart.kind === 'control') {
    return (
      <ShewhartControlChartPlot
        data={chart.data as any}
        center={chart.meta?.center as number | undefined}
        lcl={chart.meta?.lcl as number | undefined}
        ucl={chart.meta?.ucl as number | undefined}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        height={height}
      />
    );
  }

  if (chart.kind === 'bland_altman') {
    const data = chart.data
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    return (
      <BlandAltmanPlotChart
        data={data}
        dBar={chart.meta?.dBar as number | undefined}
        loaLower={chart.meta?.loaLower as number | undefined}
        loaUpper={chart.meta?.loaUpper as number | undefined}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        height={height}
      />
    );
  }

  if (chart.kind === 'mandel') {
    return (
      <MandelConsistencyPlotChart
        data={chart.data as any}
        statKey={(chart.meta?.statKey as string) ?? 'h'}
        crit05={chart.meta?.crit05 as number | undefined}
        crit01={chart.meta?.crit01 as number | undefined}
        bilateral={chart.meta?.bilateral as boolean | undefined}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        height={height}
      />
    );
  }

  if (chart.kind === 'interaction') {
    return (
      <InteractionPlot
        data={chart.data as any}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        height={height}
      />
    );
  }

  if (chart.kind === 'pareto') {
    const first = chart.data[0] ?? {};
    const xKey = Object.keys(first).find((k) => typeof first[k] === 'string') ?? 'fator';
    const yKey = Object.keys(first).find((k) => typeof first[k] === 'number') ?? 'efeito';
    return (
      <ParetoPlotChart
        data={chart.data as any}
        xKey={xKey}
        yKey={yKey}
        cutoffLine={chart.meta?.youdenCrit as number | undefined}
        cutoffLabel="Youden d_crit"
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        height={height}
      />
    );
  }

  if (chart.kind === 'density') {
    return (
      <ConformityDensityChartPlot
        data={chart.data as any}
        value={chart.meta?.value as number | undefined}
        lsl={chart.meta?.lsl as number | null | undefined}
        usl={chart.meta?.usl as number | null | undefined}
        effectiveLower={chart.meta?.effectiveLower as number | null | undefined}
        effectiveUpper={chart.meta?.effectiveUpper as number | null | undefined}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        height={height}
      />
    );
  }

  if (chart.kind === 'line') {
    const first = chart.data[0] ?? {};
    if (first.ponto !== undefined) {
      return (
        <ShewhartControlChartPlot
          data={chart.data as any}
          center={chart.meta?.center as number | undefined}
          lcl={chart.meta?.lcl as number | undefined}
          ucl={chart.meta?.ucl as number | undefined}
          xLabel={chart.xLabel}
          yLabel={chart.yLabel}
          height={height}
        />
      );
    }
    if (first.part !== undefined && first.operator !== undefined) {
      return (
        <InteractionPlot
          data={chart.data as any}
          xLabel={chart.xLabel}
          yLabel={chart.yLabel}
          height={height}
        />
      );
    }
    if (first.itInferior !== undefined) {
      return (
        <AccuracyProfilePlotChart
          data={chart.data as any}
          acceptanceLimit={chart.meta?.acceptanceLimit as number | undefined}
          xLabel={chart.xLabel}
          yLabel={chart.yLabel}
          height={height}
        />
      );
    }
  }

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
    if (first.part !== undefined && first.operator !== undefined && first.range !== undefined) {
      return (
        <InteractionPlot
          data={chart.data as any}
          xLabel={chart.xLabel}
          yLabel="Amplitude"
          height={height}
        />
      );
    }
    if (chart.meta?.youdenCrit !== undefined) {
      const xKey = Object.keys(first).find((key) => typeof first[key] === 'string') ?? 'fator';
      const yKey = Object.keys(first).find((key) => typeof first[key] === 'number') ?? 'efeito';
      return (
        <ParetoPlotChart
          data={chart.data as any}
          xKey={xKey}
          yKey={yKey}
          cutoffLine={chart.meta?.youdenCrit as number | undefined}
          cutoffLabel="Limite Youden"
          xLabel={chart.xLabel}
          yLabel={chart.yLabel}
          height={height}
        />
      );
    }
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
  const [selectedDecision, setSelectedDecision] = useState<ExplainableDecisionData | null>(null);

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
                  <th className="w-9 text-center" title="Demonstração da decisão"></th>
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
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDecision({
                            title: metric.label,
                            parameterLabel: analysis.label,
                            verdict: metric.verdict,
                            formulaText: metric.formula || undefined,
                            observedValueText:
                              metric.value !== null && Number.isFinite(metric.value)
                                ? `${fmt(metric.value)}${metric.unit ? ` ${metric.unit}` : ''}`
                                : 'Não apurado',
                            criterionText: metric.criterionText || 'Critério não configurado',
                            stepByStepText: [
                              `Valor apurado: ${fmt(metric.value)}${metric.unit ? ` ${metric.unit}` : ''}`,
                              `Critério exigido: ${metric.criterionText || '—'}`,
                              `Veredito: ${
                                metric.verdict === 'pass'
                                  ? 'Conforme (Aprovado)'
                                  : metric.verdict === 'fail'
                                    ? 'Não conforme (Reprovado)'
                                    : metric.verdict === 'warning'
                                      ? 'Atenção (Marginal)'
                                      : 'Não avaliado'
                              }`,
                            ],
                            normativeReference: analysis.reference || 'Eurachem / ISO / Normas aplicáveis',
                            interpretationText:
                              metric.verdict === 'pass'
                                ? `A métrica '${metric.label}' atende rigorosamente ao critério estabelecido (${metric.criterionText}).`
                                : metric.verdict === 'fail'
                                  ? `A métrica '${metric.label}' ultrapassou o limiar de aceitação (${metric.criterionText}). Recomenda-se investigação técnica de desvio ou reensaio.`
                                  : metric.verdict === 'warning'
                                    ? `A métrica '${metric.label}' encontra-se em faixa de atenção em relação ao critério cadastrado (${metric.criterionText}).`
                                    : `A métrica '${metric.label}' não pôde ser avaliada devido a ausência de critério numérico ou dados insuficientes na coleta.`,
                          })
                        }
                        className="rounded-lg p-1 text-ink-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950/50 dark:hover:text-brand-300 transition"
                        title="Ver demonstração da decisão"
                        aria-label={`Demonstração de ${metric.label}`}
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
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
            {analysis.charts.map((chart) => {
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
      <ExplainableDecisionDrawer
        isOpen={Boolean(selectedDecision)}
        onClose={() => setSelectedDecision(null)}
        data={selectedDecision}
      />
    </Card>
  );
}
