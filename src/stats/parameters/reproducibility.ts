/**
 * Reprodutibilidade — módulo do perfil analítico.
 *
 * Usa a decomposição ISO 5725-2 entre laboratórios e réplicas. Sem pelo menos
 * dois laboratórios o parâmetro fica não avaliado.
 *
 * Referências: ISO 5725-1:2023; ISO 5725-2:2019; ISO/IEC 17025:2017, 7.2.2.
 */

import type { AnalysisModule } from '../analysis-types';
import { buildMetric, emptyParameter, parameterSummary } from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';

export const reproducibilityAnalysis: AnalysisModule = ({ parameter, criteria, context }) => {
  const iso5725 = context.iso5725;
  if (!iso5725) {
    return emptyParameter(
      parameter,
      context.used.length,
      'São necessários pelo menos 2 laboratórios (use a coluna analista/laboratório ou o desenho ISO 5725).',
    );
  }
  const raw = {
    cvR: iso5725.pooled.cvReproducibility,
    sR: iso5725.pooled.sR,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: iso5725.pooled.p * iso5725.pooled.n * iso5725.pooled.q,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `s_R = ${iso5725.pooled.sR.toPrecision(4)}; CV_R = ${iso5725.pooled.cvReproducibility?.toFixed(2) ?? '—'}%; R = ${iso5725.pooled.reproducibilityLimit.toPrecision(4)}.`,
    ),
    metrics: [
      buildMetric(parameter, 'cvR', iso5725.pooled.cvReproducibility, criteria, 'CV_R = 100·s_R/média', iso5725.reference),
      buildMetric(parameter, 'sR', iso5725.pooled.sR, criteria, 's_R = √(s_r² + s_L²)', iso5725.reference),
    ],
    rawMetrics: raw,
    tables: [
      {
        title: 'ISO 5725-2 — precisão por nível',
        columns: ['Nível', 'p', 'n', 's_r', 's_L', 's_R', 'r', 'R'],
        rows: iso5725.levels.map((l) => [l.level, l.p, l.n, l.sr, l.sL, l.sR, l.repeatabilityLimit, l.reproducibilityLimit]),
      },
    ],
    charts: [],
    warnings: iso5725.warnings,
    notes: [iso5725.interpretation],
    reference: iso5725.reference,
    results: { iso5725 },
  };
};
