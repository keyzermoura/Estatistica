/**
 * Linearidade — módulo do perfil analítico.
 *
 * Ajusta a reta por mínimos quadrados e expõe R², falta de ajuste e
 * significância do declive. O veredito usa apenas critérios cadastrados.
 *
 * Referências: ISO 8466-1:2021; ICH Q2(R2); Draper & Smith (1998).
 */

import type { AnalysisModule } from '../analysis-types';
import { buildMetric, emptyParameter, parameterSummary } from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';

export const linearityAnalysis: AnalysisModule = ({ parameter, criteria, context }) => {
  const regression = context.regression;
  if (!regression) {
    return emptyParameter(
      parameter,
      context.used.length,
      'Use pelo menos 3 níveis numéricos com réplicas para ajustar a reta.',
    );
  }
  const raw = {
    r2: regression.r2,
    lackOfFitP: regression.lackOfFit?.p ?? null,
    slopeP: regression.slopeP,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: regression.n,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `R² = ${regression.r2.toFixed(5)}; y = ${regression.intercept.toPrecision(4)} + ${regression.slope.toPrecision(4)}·x; s_yx = ${regression.syx.toPrecision(4)}.`,
    ),
    metrics: [
      buildMetric(parameter, 'r2', regression.r2, criteria, 'R² = 1 − SS_res/SS_tot', regression.reference),
      buildMetric(parameter, 'lackOfFitP', regression.lackOfFit?.p ?? null, criteria, 'Falta de ajuste: F = MS_lof/MS_pure', regression.reference),
      buildMetric(parameter, 'slopeP', regression.slopeP, criteria, 'p do declive (t)', regression.reference),
    ],
    rawMetrics: raw,
    tables: [
      {
        title: 'Ajuste da regressão',
        columns: ['Parâmetro', 'Valor', 'EP', 'IC 95%', 'p'],
        rows: [
          ['Declive (b)', regression.slope, regression.slopeSe, `${regression.slopeCi[0].toPrecision(4)} a ${regression.slopeCi[1].toPrecision(4)}`, regression.slopeP],
          ['Intercepto (a)', regression.intercept, regression.interceptSe, `${regression.interceptCi[0].toPrecision(4)} a ${regression.interceptCi[1].toPrecision(4)}`, regression.interceptP],
          ['s_yx', regression.syx, '', '', ''],
          ['R²', regression.r2, '', '', ''],
        ],
      },
    ],
    charts: [
      {
        kind: 'scatter',
        title: 'Curva de calibração',
        xLabel: 'Nível / concentração',
        yLabel: 'Resposta',
        data: context.regressionPoints.map((p) => ({ x: p.x, y: p.y })),
      },
      {
        kind: 'residual',
        title: 'Resíduos vs. ajustado',
        xLabel: 'Ajustado',
        yLabel: 'Resíduo',
        data: regression.residuals.map((r) => ({ x: r.fitted, y: r.residual })),
      },
    ],
    warnings: regression.warnings,
    notes: [
      regression.lackOfFit
        ? `Falta de ajuste: F = ${regression.lackOfFit.f.toFixed(3)}, p = ${regression.lackOfFit.p.toFixed(4)}.`
        : 'Sem réplicas por nível, não foi possível testar falta de ajuste.',
    ],
    reference: 'ISO 8466-1:2021; ICH Q2(R2); Draper & Smith (1998)',
    results: { regression },
  };
};
