/**
 * Utilitários internos da análise: leitura de níveis, métricas com veredito e
 * parâmetros sem avaliação. As definições de métricas vêm do perfil ativo, de
 * modo que o motor não contém catálogo analítico hard-coded.
 */

import type { AcceptanceCriterion, Measurement, Verdict } from '../lib/types';
import type { ParameterDef } from '../profiles/types';
import { criterionText, evaluateParameter } from '../lib/criteria';
import { mean } from './descriptive';
import type { AnalysisMetric, ParameterAnalysis } from './analysis-types';

export function numericLevel(level: string): number | null {
  const cleaned = level.replace(',', '.').replace(/[^\d.+-eE]/g, '');
  if (!cleaned) return null;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

export function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function pooledWithinVariance(groups: number[][]): { variance: number; df: number } {
  let ss = 0;
  let df = 0;
  for (const g of groups) {
    if (g.length < 2) continue;
    const m = mean(g);
    for (const v of g) ss += (v - m) ** 2;
    df += g.length - 1;
  }
  return { variance: df > 0 ? ss / df : NaN, df };
}

export function withinGroupResiduals(measurements: Measurement[]): number[] {
  const groups = new Map<string, number[]>();
  for (const m of measurements) {
    if (m.value === null) continue;
    const key = m.level || m.sample || 'geral';
    const list = groups.get(key) ?? [];
    list.push(m.value);
    groups.set(key, list);
  }
  const residuals: number[] = [];
  for (const [, values] of groups) {
    if (values.length < 2) continue;
    const m = mean(values);
    for (const v of values) residuals.push(v - m);
  }
  return residuals;
}

export function buildMetric(
  parameter: ParameterDef,
  key: string,
  value: number | null,
  criteria: AcceptanceCriterion[],
  formula?: string,
  reference?: string,
): AnalysisMetric {
  const def = parameter.metrics.find((d) => d.key === key);
  const criterion = criteria.find((c) => c.metric === key);
  const verdict: Verdict = criterion
    ? value === null || !Number.isFinite(value)
      ? 'not_evaluated'
      : criterion.operator === '>='
        ? value >= criterion.limit
          ? 'pass'
          : 'fail'
        : criterion.operator === '<='
          ? value <= criterion.limit
            ? 'pass'
            : 'fail'
          : value >= Math.min(criterion.limit, criterion.limit2 ?? criterion.limit) &&
              value <= Math.max(criterion.limit, criterion.limit2 ?? criterion.limit)
            ? 'pass'
            : 'fail'
    : 'not_evaluated';
  return {
    key,
    label: def?.label ?? key,
    value,
    unit: def?.unit ?? '',
    verdict,
    criterionText: criterion ? criterionText(criterion) : 'Sem critério cadastrado',
    formula,
    reference,
  };
}

export function parameterSummary(
  label: string,
  verdict: Verdict,
  reason: string,
): string {
  if (verdict === 'pass') return `${label}: atende aos critérios cadastrados. ${reason}`;
  if (verdict === 'fail') return `${label}: não atende aos critérios. ${reason}`;
  if (verdict === 'warning') return `${label}: avaliação parcial. ${reason}`;
  return `${label}: não avaliado. ${reason}`;
}

export function emptyParameter(
  parameter: ParameterDef,
  n: number,
  reason: string,
  notes: string[] = [],
): ParameterAnalysis {
  return {
    key: parameter.key,
    label: parameter.label,
    n,
    verdict: 'not_evaluated',
    summary: `${parameter.label}: não avaliado. ${reason}`,
    metrics: [],
    rawMetrics: {},
    tables: [],
    charts: [],
    warnings: [],
    notes,
    reference: parameter.reference,
    results: {},
  };
}

export function referenceOf(m: Measurement): number | null {
  if (
    m.referenceValue !== null &&
    m.referenceValue !== undefined &&
    Number.isFinite(m.referenceValue)
  ) {
    return m.referenceValue;
  }
  if (
    m.refValue !== null &&
    m.refValue !== undefined &&
    Number.isFinite(m.refValue)
  ) {
    return m.refValue;
  }
  return numericLevel(m.level);
}

export function accuracyPairsFrom(
  measurements: Measurement[],
): Array<{ measured: number; reference: number }> {
  return measurements
    .filter((m) => m.value !== null && referenceOf(m) !== null)
    .map((m) => ({ measured: m.value!, reference: referenceOf(m)! }));
}

/** Reexportado para módulos que precisam avaliar um conjunto de métricas. */
export { evaluateParameter };
