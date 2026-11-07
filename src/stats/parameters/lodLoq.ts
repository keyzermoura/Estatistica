/**
 * Limites de detecção e quantificação — módulo do perfil analítico.
 *
 * Prioriza brancos independentes; na ausência deles usa a curva de calibração.
 * O critério de aceitação é sempre cadastrado pelo laboratório.
 *
 * Referências: ISO 8466-1:2021; ISO 11843-2; IUPAC (1997); ICH Q2(R2).
 */

import type { AcceptanceCriterion, Measurement } from '../../lib/types';
import type { AnalysisModule, ParameterAnalysis } from '../analysis-types';
import { buildMetric, emptyParameter, numericLevel, parameterSummary } from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';
import { lodLoqFromBlanks, lodLoqFromRegression } from '../regression';
import type { ParameterDef } from '../../profiles/types';

function estimateLod(
  parameter: ParameterDef,
  measurements: Measurement[],
  criteria: AcceptanceCriterion[],
): ParameterAnalysis {
  const blanks = measurements.filter((m) => {
    const lvl = m.level.toLowerCase();
    return m.value !== null && (lvl.includes('branco') || lvl.includes('blank') || numericLevel(m.level) === 0);
  });
  if (blanks.length >= 3) {
    const result = lodLoqFromBlanks(blanks.map((m) => m.value!));
    const rawMetrics = { lod: result.lod, loq: result.loq };
    const metrics = [
      buildMetric(parameter, 'lod', result.lod, criteria, 'LD = média_branco + 3·s', result.reference),
      buildMetric(parameter, 'loq', result.loq, criteria, 'LQ = média_branco + 10·s', result.reference),
    ];
    const verdict = evaluateParameter(parameter.key, rawMetrics, criteria).verdict;
    return {
      key: parameter.key,
      label: parameter.label,
      n: blanks.length,
      verdict,
      summary: parameterSummary(
        parameter.label,
        verdict,
        `LD = ${result.lod.toPrecision(4)}; LQ = ${result.loq.toPrecision(4)} (${blanks.length} brancos).`,
      ),
      metrics,
      rawMetrics,
      tables: [],
      charts: [],
      warnings: result.caveats,
      notes: ['Estimativa a partir de brancos independentes.'],
      reference: result.reference,
      results: { lodLoq: result, approach: 'blank' },
    };
  }
  const points = measurements
    .filter((m) => m.value !== null && numericLevel(m.level) !== null)
    .map((m) => ({ x: numericLevel(m.level)!, y: m.value! }));
  if (points.length >= 3) {
    const result = lodLoqFromRegression(points);
    const rawMetrics = { lod: result.lod, loq: result.loq };
    const metrics = [
      buildMetric(parameter, 'lod', result.lod, criteria, 'LD = 3,3·s_yx/b', result.reference),
      buildMetric(parameter, 'loq', result.loq, criteria, 'LQ = 10·s_yx/b', result.reference),
    ];
    const verdict = evaluateParameter(parameter.key, rawMetrics, criteria).verdict;
    return {
      key: parameter.key,
      label: parameter.label,
      n: points.length,
      verdict,
      summary: parameterSummary(
        parameter.label,
        verdict,
        `LD = ${result.lod.toPrecision(4)}; LQ = ${result.loq.toPrecision(4)} pela curva.`,
      ),
      metrics,
      rawMetrics,
      tables: [],
      charts: [],
      warnings: result.caveats,
      notes: [],
      reference: result.reference,
      results: { lodLoq: result, approach: 'calibration' },
    };
  }
  return emptyParameter(
    parameter,
    points.length || blanks.length,
    'Informe brancos (≥ 3) ou uma curva com níveis numéricos (≥ 3 pontos).',
  );
}

export const lodLoqAnalysis: AnalysisModule = ({ parameter, criteria, context }) =>
  estimateLod(parameter, context.used, criteria);
