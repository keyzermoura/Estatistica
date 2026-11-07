/**
 * Avaliação de critérios de aceitação.
 *
 * Um resultado só é exibido como conforme/não conforme quando existe critério
 * cadastrado. Caso contrário, o veredito é "não avaliado" — nunca se inventa
 * um limite.
 *
 * As definições de métricas e os critérios sugeridos pertencem ao perfil de
 * método (src/profiles). Este módulo permanece genérico.
 */

import type {
  AcceptanceCriterion,
  ParamKey,
  Verdict,
} from './types';
import type { MetricDefinition } from '../profiles/types';
import { fmt } from '../stats/distributions';

export function makeCriterion(
  parameter: ParamKey,
  definition: MetricDefinition,
  id: string,
): AcceptanceCriterion {
  return {
    id,
    parameter,
    metric: definition.key,
    operator: definition.suggested?.operator ?? '<=',
    limit: definition.suggested?.limit ?? 0,
    limit2: definition.suggested?.limit2,
    unit: definition.unit,
    note: '',
  };
}

export function criterionText(criterion: AcceptanceCriterion): string {
  if (criterion.operator === 'between') {
    return `entre ${fmt(criterion.limit)} e ${fmt(criterion.limit2 ?? criterion.limit)}${criterion.unit ? ` ${criterion.unit}` : ''}`;
  }
  return `${criterion.operator === '>=' ? '≥' : '≤'} ${fmt(criterion.limit)}${criterion.unit ? ` ${criterion.unit}` : ''}`;
}

export function evaluateCriterion(
  value: number | null | undefined,
  criterion: AcceptanceCriterion,
): { verdict: Verdict; text: string } {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { verdict: 'not_evaluated', text: 'Sem resultado numérico.' };
  }
  let pass = false;
  if (criterion.operator === '>=') pass = value >= criterion.limit;
  else if (criterion.operator === '<=') pass = value <= criterion.limit;
  else if (criterion.operator === 'between') {
    const hi = criterion.limit2 ?? criterion.limit;
    const low = Math.min(criterion.limit, hi);
    const high = Math.max(criterion.limit, hi);
    pass = value >= low && value <= high;
  }
  return {
    verdict: pass ? 'pass' : 'fail',
    text: `${fmt(value)} ${criterionText(criterion)}`,
  };
}

export function evaluateParameter(
  parameter: ParamKey,
  metrics: Record<string, number | null | undefined>,
  criteria: AcceptanceCriterion[],
): {
  verdict: Verdict;
  evaluated: number;
  passed: number;
  failed: number;
  details: Array<{ criterion: AcceptanceCriterion; value: number | null; verdict: Verdict; text: string }>;
} {
  const applicable = criteria.filter((c) => c.parameter === parameter);
  const details = applicable.map((criterion) => {
    const value = metrics[criterion.metric] ?? null;
    const result = evaluateCriterion(value, criterion);
    return { criterion, value, verdict: result.verdict, text: result.text };
  });
  const evaluated = details.filter((d) => d.verdict !== 'not_evaluated').length;
  const passed = details.filter((d) => d.verdict === 'pass').length;
  const failed = details.filter((d) => d.verdict === 'fail').length;
  const verdict: Verdict =
    evaluated === 0 ? 'not_evaluated' : failed > 0 ? 'fail' : passed === evaluated ? 'pass' : 'warning';
  return { verdict, evaluated, passed, failed, details };
}
