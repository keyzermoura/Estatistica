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

/**
 * Métricas relativas à tolerância compartilhadas pelos perfis.
 *
 * `%P/T` e `U/T` medem a incerteza expandida em relação à largura de
 * tolerância; `TUR/TAR` é a razão de tolerância pela incerteza expandida
 * (convenção `T/(2U)`). Elas são aditivas: nenhuma métrica analítica existente
 * é alterada. A distinção em relação ao `%P/T` do Gage R&R (baseado em
 * `6·σ_GRR`) está registrada em `docs/FORMULAS.md`.
 */
export interface ToleranceMetricsInput {
  /** Limite inferior de tolerância; nulo quando não se aplica. */
  lsl: number | null | undefined;
  /** Limite superior de tolerância; nulo quando não se aplica. */
  usl: number | null | undefined;
  /** Incerteza expandida U = k·u; nulo quando indisponível. */
  expandedUncertainty: number | null | undefined;
}

export interface ToleranceMetrics {
  /** T = USL − LSL; nulo quando a tolerância não é bilateral. */
  tolerance: number | null;
  /** %P/T = 100·U/T; nulo quando T ou U não estão disponíveis. */
  pctPT: number | null;
  /** U/T; nulo quando T ou U não estão disponíveis. */
  uOverT: number | null;
  /** TUR/TAR = T/(2U); nulo quando T não existe ou U = 0. */
  tur: number | null;
}

/** Limiares sugeridos (editáveis) para as métricas relativas à tolerância. */
export const DEFAULT_TOLERANCE_CRITERIA = Object.freeze({
  /** %P/T máximo sugerido. */
  pctPTMaximum: 10,
  /** U/T máximo sugerido (equivalente a %P/T = 10%). */
  uOverTMaximum: 0.1,
  /** TUR/TAR mínimo sugerido, na convenção T/(2U). */
  turMinimum: 4,
});

/**
 * Definições das métricas relativas à tolerância para uso nos perfis.
 * O perfil decide a quais parâmetros elas se aplicam e pode editar os limites.
 */
export const TOLERANCE_METRIC_DEFINITIONS: ReadonlyArray<MetricDefinition> = [
  {
    key: 'pct_pt',
    label: '%P/T (U/T)',
    unit: '%',
    suggested: {
      operator: '<=',
      limit: DEFAULT_TOLERANCE_CRITERIA.pctPTMaximum,
      unit: '%',
    },
  },
  {
    key: 'u_over_t',
    label: 'U/T',
    unit: '',
    suggested: {
      operator: '<=',
      limit: DEFAULT_TOLERANCE_CRITERIA.uOverTMaximum,
      unit: '',
    },
  },
  {
    key: 'tur',
    label: 'TUR/TAR',
    unit: '',
    suggested: {
      operator: '>=',
      limit: DEFAULT_TOLERANCE_CRITERIA.turMinimum,
      unit: '',
    },
  },
];

function finiteOrNull(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) {
    throw new Error(`A ${label} deve ser um número finito ou nula.`);
  }
  return value;
}

/**
 * Calcula `T`, `%P/T`, `U/T` e `TUR/TAR`. Quando falta um dos limites (tolerância
 * unilateral) ou a incerteza, as métricas que dependem do dado ausente ficam
 * nulas — nunca se inventa denominador. `U = 0` é um caso limite válido:
 * `%P/T = U/T = 0`, mas `TUR/TAR` é indefinido (divisão por zero) e fica nulo.
 */
export function toleranceMetrics(input: ToleranceMetricsInput): ToleranceMetrics {
  const lsl = finiteOrNull(input.lsl, 'LSL');
  const usl = finiteOrNull(input.usl, 'USL');
  if (lsl !== null && usl !== null && !(lsl < usl)) {
    throw new Error('A tolerância bilateral exige LSL < USL.');
  }
  const expanded = finiteOrNull(input.expandedUncertainty, 'incerteza expandida U');
  if (expanded !== null && expanded < 0) {
    throw new Error('A incerteza expandida U não pode ser negativa.');
  }

  const tolerance = lsl !== null && usl !== null ? usl - lsl : null;
  if (tolerance === null || expanded === null) {
    return { tolerance, pctPT: null, uOverT: null, tur: null };
  }

  const uOverT = expanded / tolerance;
  return {
    tolerance,
    pctPT: 100 * uOverT,
    uOverT,
    tur: expanded > 0 ? tolerance / (2 * expanded) : null,
  };
}

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
  if (
    criterion.operator === '>=' &&
    criterion.limit2 !== undefined &&
    Number.isFinite(criterion.limit2) &&
    criterion.limit2 < criterion.limit
  ) {
    return `≥ ${fmt(criterion.limit)} conforme; ${fmt(criterion.limit2)} ≤ valor < ${fmt(criterion.limit)} atenção${criterion.unit ? ` (${criterion.unit})` : ''}`;
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
