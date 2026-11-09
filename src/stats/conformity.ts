/**
 * Regra de decisão de conformidade, banda de guarda e riscos associados.
 *
 * Entrada: valor medido `x`, incerteza-padrão `u`, fator de abrangência `k`
 * (`U = k·u`), limites `LSL`/`USL` (um ou ambos) e a regra escolhida.
 *
 * Regras implementadas:
 *  1. Aceitação simples (`w = 0`): conforme se `LSL ≤ x ≤ USL` (ou o limite
 *     unilateral informado); não conforme fora.
 *  2. Banda de guarda (`w = r·U`, `r` editável, padrão 1): zona de aceitação
 *     `[LSL + w, USL − w]`, zona de rejeição fora de `[LSL − w, USL + w]` e
 *     zona intermediária indeterminada.
 *  3. Probabilidade de conformidade sob normalidade:
 *     `P = Φ((USL − x)/u) − Φ((LSL − x)/u)`, com limiar de decisão editável.
 *
 * Riscos específicos (condicionais ao valor medido):
 *
 * ```
 * P(conformidade | x) = ∫_{LSL}^{USL} φ(t; x, u) dt
 * risco de falso aceite  = 1 − P(conformidade | x)   (se a decisão for aceitar)
 * risco de falso rejeite = P(conformidade | x)       (se a decisão for rejeitar)
 * ```
 *
 * Como não há distribuição prévia do valor verdadeiro, calcula-se o risco
 * específico (JCGM 106:2012), não o risco global. O risco global exigiria uma
 * distribuição a priori do mensurando e não é estimado aqui.
 *
 * Métricas relativas à tolerância:
 *
 * ```
 * T = USL − LSL
 * %P/T   = 100·U/T
 * U/T    = U/T
 * TUR/TAR = T/(2U)
 * ```
 *
 * Alertas editáveis: `TUR < 4`, `U > T/4`, `%P/T > 10%` e banda de guarda
 * maior que `T/2` (zona de aceitação vazia). O caso `u = 0` é aceito como
 * limite: `P ∈ {0, 1}`, os riscos tornam-se degenerados e `TUR` não é definido.
 *
 * Decisão de três estados: `conform` → veredito `pass`, `nonconform` → `fail`,
 * `indeterminate` → `warning`. Sem dados válidos, o veredito é `not_evaluated`.
 * Nenhum valor é removido ou arredondado automaticamente.
 *
 * Referências:
 *  - JCGM 106:2012. Evaluation of measurement data — The role of measurement
 *    uncertainty in conformity assessment.
 *  - ILAC-G8:09/2019. Guidelines on decision rules and statements of conformity.
 *  - ISO/IEC 17025:2017, 7.8.2.1 (declaração de conformidade e regra de decisão).
 *  - ISO 14253-1:2017 (verificação por medição e bandas de guarda).
 */

import type { Verdict } from '../lib/types';
import type { AnalysisMetric, AnalysisTable } from './analysis-types';
import { fmt, normalCdf } from './distributions';
import {
  DEFAULT_TOLERANCE_CRITERIA,
  toleranceMetrics,
  type ToleranceMetrics,
} from '../lib/criteria';

const REFERENCE =
  'JCGM 106:2012; ILAC-G8:09/2019; ISO/IEC 17025:2017, 7.8.2.1; ISO 14253-1:2017';

export type ConformityRule =
  | 'simple_acceptance'
  | 'guard_band'
  | 'probability';

export type ConformityDecision = 'conform' | 'nonconform' | 'indeterminate';

export const CONFORMITY_RULE_LABELS: Record<ConformityRule, string> = {
  simple_acceptance: 'Aceitação simples (w = 0)',
  guard_band: 'Banda de guarda (w = r·U)',
  probability: 'Probabilidade de conformidade (normal)',
};

export const CONFORMITY_DECISION_LABELS: Record<ConformityDecision, string> = {
  conform: 'conforme',
  nonconform: 'não conforme',
  indeterminate: 'indeterminado',
};

export interface ConformityInput {
  /** Valor medido x, na unidade do mensurando. */
  value: number;
  /** Incerteza-padrão u do valor medido; u ≥ 0. */
  standardUncertainty: number;
  /** Fator de abrangência k; padrão 2. U = k·u. */
  coverageFactor?: number;
  /** Limite inferior de tolerância; nulo/ausente em tolerância unilateral. */
  lsl?: number | null;
  /** Limite superior de tolerância; nulo/ausente em tolerância unilateral. */
  usl?: number | null;
  /** Regra de decisão; padrão `simple_acceptance`. */
  rule?: ConformityRule;
  /** Atalho para r em w = r·U; sobrepõe `criteria.guardBandFactor`. */
  guardBandFactor?: number;
  /** Atalho para o limiar de probabilidade; sobrepõe `criteria.probabilityThreshold`. */
  probabilityThreshold?: number;
}

/** Limites editáveis da regra e dos alertas. */
export interface ConformityCriteria {
  /** r em w = r·U (apenas na regra de banda de guarda); padrão 1. */
  guardBandFactor: number;
  /** P(conformidade) mínima para aceitar na regra de probabilidade; padrão 0,95. */
  probabilityThreshold: number;
  /** Alerta quando TUR/TAR < turMinimum; padrão 4. */
  turMinimum: number;
  /** Alerta quando U/T > maxUOverT; padrão 0,25 (U > T/4). */
  maxUOverT: number;
  /** Alerta quando %P/T > maxPctPT; padrão 10%. */
  maxPctPT: number;
}

export const DEFAULT_CONFORMITY_CRITERIA: Readonly<ConformityCriteria> =
  Object.freeze({
    guardBandFactor: 1,
    probabilityThreshold: 0.95,
    turMinimum: DEFAULT_TOLERANCE_CRITERIA.turMinimum,
    maxUOverT: 0.25,
    maxPctPT: DEFAULT_TOLERANCE_CRITERIA.pctPTMaximum,
  });

export interface ConformityOptions {
  /** Limites editáveis; os ausentes recebem os padrões. */
  criteria?: Partial<ConformityCriteria>;
  /** Unidade do mensurando, apenas para exibição. */
  unit?: string;
}

/** Bloco pronto para a seção de conformidade do relatório. */
export interface ConformityReportView {
  rule: ConformityRule;
  ruleLabel: string;
  value: number;
  standardUncertainty: number;
  coverageFactor: number;
  expandedUncertainty: number;
  lsl: number | null;
  usl: number | null;
  tolerance: number | null;
  guardBand: number;
  guardBandFactor: number;
  effectiveLower: number | null;
  effectiveUpper: number | null;
  rejectionLower: number | null;
  rejectionUpper: number | null;
  probabilityConform: number | null;
  probabilityThreshold: number;
  tur: number | null;
  decision: ConformityDecision;
  decisionLabel: string;
  verdict: Verdict;
  criteriaText: string;
  summary: string;
  alerts: string[];
  reference: string;
}

export interface ConformityResult {
  rule: ConformityRule;
  ruleLabel: string;
  decision: ConformityDecision;
  decisionLabel: string;
  verdict: Verdict;
  value: number;
  standardUncertainty: number;
  coverageFactor: number;
  expandedUncertainty: number;
  lsl: number | null;
  usl: number | null;
  tolerance: number | null;
  guardBand: number;
  guardBandFactor: number;
  effectiveLower: number | null;
  effectiveUpper: number | null;
  rejectionLower: number | null;
  rejectionUpper: number | null;
  probabilityConform: number | null;
  probabilityThreshold: number;
  falseAcceptRisk: number | null;
  falseRejectRisk: number | null;
  applicableRisk: number | null;
  applicableRiskType: 'false_accept' | 'false_reject' | null;
  tur: number | null;
  uOverT: number | null;
  pctPT: number | null;
  criteria: ConformityCriteria;
  criteriaText: string;
  alerts: string[];
  warnings: string[];
  notes: string[];
  metrics: AnalysisMetric[];
  rawMetrics: Record<string, number | null>;
  tables: AnalysisTable[];
  summary: string;
  method: string;
  reference: string;
  report: ConformityReportView;
}

function decisionVerdict(decision: ConformityDecision): Verdict {
  if (decision === 'conform') return 'pass';
  if (decision === 'nonconform') return 'fail';
  return 'warning';
}

function verdictLabel(verdict: Verdict): string {
  if (verdict === 'pass') return 'conforme';
  if (verdict === 'fail') return 'não conforme';
  if (verdict === 'warning') return 'atenção';
  return 'não avaliado';
}

function normalizeLimit(
  value: number | null | undefined,
  label: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) {
    throw new Error(`O ${label} deve ser um número finito.`);
  }
  return value;
}

function validateRule(rule: ConformityRule | undefined): ConformityRule {
  const value = rule ?? 'simple_acceptance';
  if (
    value !== 'simple_acceptance' &&
    value !== 'guard_band' &&
    value !== 'probability'
  ) {
    throw new Error(
      'Regra de conformidade inválida: use "simple_acceptance", "guard_band" ou "probability".',
    );
  }
  return value;
}

function normalizeCriteria(
  input: ConformityInput,
  partial: Partial<ConformityCriteria> | undefined,
): ConformityCriteria {
  const criteria: ConformityCriteria = {
    ...DEFAULT_CONFORMITY_CRITERIA,
    ...(partial ?? {}),
  };
  if (input.guardBandFactor !== undefined) {
    criteria.guardBandFactor = input.guardBandFactor;
  }
  if (input.probabilityThreshold !== undefined) {
    criteria.probabilityThreshold = input.probabilityThreshold;
  }

  if (!Number.isFinite(criteria.guardBandFactor) || criteria.guardBandFactor < 0) {
    throw new Error('O fator r da banda de guarda deve ser um número não negativo.');
  }
  if (
    !Number.isFinite(criteria.probabilityThreshold) ||
    !(criteria.probabilityThreshold > 0 && criteria.probabilityThreshold <= 1)
  ) {
    throw new Error('O limiar de probabilidade deve estar entre 0 (exclusivo) e 1.');
  }
  if (!Number.isFinite(criteria.turMinimum) || !(criteria.turMinimum > 0)) {
    throw new Error('O limiar mínimo de TUR/TAR deve ser positivo.');
  }
  if (!Number.isFinite(criteria.maxUOverT) || !(criteria.maxUOverT > 0)) {
    throw new Error('O limiar U/T do alerta deve ser positivo.');
  }
  if (!Number.isFinite(criteria.maxPctPT) || !(criteria.maxPctPT > 0)) {
    throw new Error('O limiar %P/T do alerta deve ser positivo.');
  }
  return criteria;
}

/**
 * Probabilidade de conformidade condicional ao valor medido, sob
 * `X_verdadeiro ~ N(x, u²)`. Aceita tolerância bilateral ou unilateral.
 * Para `u = 0`, a distribuição é degenerada e `P ∈ {0, 1}` (limites fechados).
 */
export function probabilityOfConformity(
  value: number,
  standardUncertainty: number,
  lsl: number | null | undefined,
  usl: number | null | undefined,
): number {
  if (!Number.isFinite(value)) {
    throw new Error('O valor medido x deve ser um número finito.');
  }
  if (!Number.isFinite(standardUncertainty) || standardUncertainty < 0) {
    throw new Error('A incerteza-padrão u deve ser um número não negativo.');
  }
  const lower = normalizeLimit(lsl, 'LSL');
  const upper = normalizeLimit(usl, 'USL');
  if (lower === null && upper === null) {
    throw new Error('Informe pelo menos um limite de tolerância (LSL ou USL).');
  }
  if (lower !== null && upper !== null && !(lower < upper)) {
    throw new Error('A tolerância bilateral exige LSL < USL.');
  }

  if (standardUncertainty === 0) {
    const aboveLower = lower === null || value >= lower;
    const belowUpper = upper === null || value <= upper;
    return aboveLower && belowUpper ? 1 : 0;
  }

  const upperProbability =
    upper === null ? 1 : normalCdf((upper - value) / standardUncertainty);
  const lowerProbability =
    lower === null ? 0 : normalCdf((lower - value) / standardUncertainty);
  return Math.min(1, Math.max(0, upperProbability - lowerProbability));
}

function probabilityFormula(lsl: number | null, usl: number | null): string {
  if (lsl !== null && usl !== null) {
    return 'P = Φ((USL − x)/u) − Φ((LSL − x)/u)';
  }
  if (usl !== null) return 'P = Φ((USL − x)/u)';
  return 'P = 1 − Φ((LSL − x)/u) = Φ((x − LSL)/u)';
}

function buildCriteriaText(args: {
  rule: ConformityRule;
  lsl: number | null;
  usl: number | null;
  guardBand: number;
  guardBandFactor: number;
  probabilityThreshold: number;
}): string {
  const { rule, lsl, usl, guardBand, guardBandFactor, probabilityThreshold } =
    args;
  if (rule === 'simple_acceptance') {
    if (lsl !== null && usl !== null) {
      return `Conforme se LSL ≤ x ≤ USL (LSL = ${fmt(lsl)}, USL = ${fmt(usl)}); não conforme fora desse intervalo.`;
    }
    if (lsl !== null) {
      return `Conforme se x ≥ LSL (LSL = ${fmt(lsl)}); não conforme abaixo do limite.`;
    }
    return `Conforme se x ≤ USL (USL = ${fmt(usl)}); não conforme acima do limite.`;
  }
  if (rule === 'guard_band') {
    if (lsl !== null && usl !== null) {
      return `Conforme se LSL + w ≤ x ≤ USL − w; não conforme se x < LSL − w ou x > USL + w; indeterminado nos demais casos. w = ${fmt(guardBand)} = ${fmt(guardBandFactor)}·U.`;
    }
    if (lsl !== null) {
      return `Conforme se x ≥ LSL + w; não conforme se x < LSL − w; indeterminado entre LSL − w e LSL + w. w = ${fmt(guardBand)} = ${fmt(guardBandFactor)}·U.`;
    }
    return `Conforme se x ≤ USL − w; não conforme se x > USL + w; indeterminado entre USL − w e USL + w. w = ${fmt(guardBand)} = ${fmt(guardBandFactor)}·U.`;
  }
  return `Conforme se P ≥ ${fmt(probabilityThreshold)}; ${probabilityFormula(lsl, usl)} (limiar editável).`;
}

function describeLimits(args: {
  rule: ConformityRule;
  lsl: number | null;
  usl: number | null;
  effectiveLower: number | null;
  effectiveUpper: number | null;
  rejectionLower: number | null;
  rejectionUpper: number | null;
  unit: string;
}): string {
  const suffix = args.unit ? ` ${args.unit}` : '';
  const point = (value: number | null) => (value === null ? '—' : `${fmt(value)}${suffix}`);
  if (args.rule === 'probability') {
    if (args.lsl !== null && args.usl !== null) {
      return `limites de especificação [${point(args.lsl)}; ${point(args.usl)}]`;
    }
    return args.lsl !== null
      ? `limite de especificação LSL = ${point(args.lsl)}`
      : `limite de especificação USL = ${point(args.usl)}`;
  }
  if (args.rule === 'simple_acceptance') {
    return `limites efetivos [${point(args.effectiveLower)}; ${point(args.effectiveUpper)}]`;
  }
  return `limites efetivos [${point(args.effectiveLower)}; ${point(args.effectiveUpper)}]; rejeição fora de [${point(args.rejectionLower)}; ${point(args.rejectionUpper)}]`;
}

function metric(
  args: Omit<AnalysisMetric, 'reference'> & { reference?: string },
): AnalysisMetric {
  return { ...args, reference: args.reference ?? REFERENCE };
}

/** Executa a regra de decisão de conformidade e calcula riscos e métricas. */
export function conformityDecision(
  input: ConformityInput,
  options: ConformityOptions = {},
): ConformityResult {
  if (!input || typeof input !== 'object') {
    throw new Error('A avaliação de conformidade requer um valor medido e uma incerteza.');
  }
  if (!Number.isFinite(input.value)) {
    throw new Error('O valor medido x deve ser um número finito.');
  }
  if (
    !Number.isFinite(input.standardUncertainty) ||
    input.standardUncertainty < 0
  ) {
    throw new Error('A incerteza-padrão u deve ser um número não negativo.');
  }
  const coverageFactor = input.coverageFactor ?? 2;
  if (!Number.isFinite(coverageFactor) || !(coverageFactor > 0)) {
    throw new Error('O fator de abrangência k deve ser positivo.');
  }

  const rule = validateRule(input.rule);
  const lsl = normalizeLimit(input.lsl, 'LSL');
  const usl = normalizeLimit(input.usl, 'USL');
  if (lsl === null && usl === null) {
    throw new Error('Informe pelo menos um limite de tolerância (LSL ou USL).');
  }
  if (lsl !== null && usl !== null && !(lsl < usl)) {
    throw new Error('A tolerância bilateral exige LSL < USL.');
  }

  const criteria = normalizeCriteria(input, options.criteria);
  const unit = options.unit?.trim() ?? '';
  const value = input.value;
  const standardUncertainty = input.standardUncertainty;
  const expandedUncertainty = coverageFactor * standardUncertainty;
  const guardBandFactor = rule === 'guard_band' ? criteria.guardBandFactor : 0;
  const guardBand = guardBandFactor * expandedUncertainty;
  const probabilityConform = probabilityOfConformity(
    value,
    standardUncertainty,
    lsl,
    usl,
  );
  const tolerance: ToleranceMetrics = toleranceMetrics({
    lsl,
    usl,
    expandedUncertainty,
  });

  let effectiveLower: number | null = null;
  let effectiveUpper: number | null = null;
  let rejectionLower: number | null = null;
  let rejectionUpper: number | null = null;
  let decision: ConformityDecision;

  if (rule === 'simple_acceptance') {
    effectiveLower = lsl;
    effectiveUpper = usl;
    rejectionLower = lsl;
    rejectionUpper = usl;
    const accepted =
      (lsl === null || value >= lsl) && (usl === null || value <= usl);
    decision = accepted ? 'conform' : 'nonconform';
  } else if (rule === 'guard_band') {
    effectiveLower = lsl === null ? null : lsl + guardBand;
    effectiveUpper = usl === null ? null : usl - guardBand;
    rejectionLower = lsl === null ? null : lsl - guardBand;
    rejectionUpper = usl === null ? null : usl + guardBand;
    const accepted =
      (effectiveLower === null || value >= effectiveLower) &&
      (effectiveUpper === null || value <= effectiveUpper);
    const rejected =
      (rejectionLower !== null && value < rejectionLower) ||
      (rejectionUpper !== null && value > rejectionUpper);
    decision = accepted ? 'conform' : rejected ? 'nonconform' : 'indeterminate';
  } else {
    decision =
      probabilityConform >= criteria.probabilityThreshold
        ? 'conform'
        : 'nonconform';
  }

  const decisionLabel = CONFORMITY_DECISION_LABELS[decision];
  const verdict = decisionVerdict(decision);
  const falseAcceptRisk = Math.min(1, Math.max(0, 1 - probabilityConform));
  const falseRejectRisk = probabilityConform;
  let applicableRisk: number | null = null;
  let applicableRiskType: 'false_accept' | 'false_reject' | null = null;
  if (decision === 'conform') {
    applicableRisk = falseAcceptRisk;
    applicableRiskType = 'false_accept';
  } else if (decision === 'nonconform') {
    applicableRisk = falseRejectRisk;
    applicableRiskType = 'false_reject';
  }

  const criteriaText = buildCriteriaText({
    rule,
    lsl,
    usl,
    guardBand,
    guardBandFactor,
    probabilityThreshold: criteria.probabilityThreshold,
  });

  const warnings = new Set<string>();
  if (standardUncertainty === 0) {
    warnings.add(
      'u = 0: incerteza-padrão nula; os riscos de falso aceite/rejeite são degenerados (0 ou 1) e TUR/TAR não é definido.',
    );
  }
  if (tolerance.tur !== null && tolerance.tur < criteria.turMinimum) {
    warnings.add(
      `TUR/TAR = ${fmt(tolerance.tur)} < ${fmt(criteria.turMinimum)}: a incerteza expandida é alta em relação à tolerância.`,
    );
  }
  if (tolerance.uOverT !== null && tolerance.uOverT > criteria.maxUOverT) {
    warnings.add(
      `U/T = ${fmt(tolerance.uOverT)} > ${fmt(criteria.maxUOverT)}: a incerteza expandida supera o limite de alerta em relação a T.`,
    );
  }
  if (tolerance.pctPT !== null && tolerance.pctPT > criteria.maxPctPT) {
    warnings.add(
      `%P/T = ${fmt(tolerance.pctPT)}% > ${fmt(criteria.maxPctPT)}%: a incerteza expandida supera o limite de alerta em relação a T.`,
    );
  }
  if (rule === 'guard_band' && lsl !== null && usl !== null) {
    const halfTolerance = (usl - lsl) / 2;
    if (guardBand > halfTolerance) {
      warnings.add(
        `A banda de guarda w = ${fmt(guardBand)} é maior que T/2 = ${fmt(halfTolerance)}: a zona de aceitação é vazia e nenhuma aceitação é possível.`,
      );
    }
    if (guardBand > usl - lsl) {
      warnings.add(
        `A banda de guarda w = ${fmt(guardBand)} excede a tolerância T = ${fmt(usl - lsl)}; o critério é inviável.`,
      );
    }
  }
  if (rule === 'guard_band' && guardBand === 0) {
    warnings.add(
      'A banda de guarda é nula (w = 0); a regra coincide com a aceitação simples.',
    );
  }
  const boundaryValues = [
    lsl,
    usl,
    effectiveLower,
    effectiveUpper,
    rejectionLower,
    rejectionUpper,
  ].filter((boundary): boundary is number => boundary !== null);
  if (boundaryValues.some((boundary) => value === boundary)) {
    warnings.add(
      'O valor medido coincide com um limite de decisão; a decisão segue intervalos fechados e é sensível à incerteza e ao arredondamento.',
    );
  }

  const limitsDescription = describeLimits({
    rule,
    lsl,
    usl,
    effectiveLower,
    effectiveUpper,
    rejectionLower,
    rejectionUpper,
    unit,
  });
  const riskDescription =
    decision === 'conform'
      ? `risco específico de falso aceite = ${fmt(falseAcceptRisk)}`
      : decision === 'nonconform'
        ? `risco específico de falso rejeite = ${fmt(falseRejectRisk)}`
        : `riscos condicionais: falso aceite = ${fmt(falseAcceptRisk)} se aceito; falso rejeite = ${fmt(falseRejectRisk)} se rejeitado`;
  const summary = `Conformidade — ${CONFORMITY_RULE_LABELS[rule]}: x = ${fmt(value)}${unit ? ` ${unit}` : ''}; U = ${fmt(expandedUncertainty)}${unit ? ` ${unit}` : ''} (k = ${fmt(coverageFactor)}); ${limitsDescription}; P(conformidade | x) = ${fmt(probabilityConform)}; ${riskDescription}. Veredito: ${decisionLabel}.`;

  const notes = [
    'A probabilidade de conformidade é condicional ao valor medido: X_verdadeiro ~ N(x, u²).',
    'Riscos específicos de falso aceite e de falso rejeite são condicionais ao valor medido; o risco global exigiria uma distribuição prévia do valor verdadeiro, que não é informada.',
    'A aceitação simples não protege contra a incerteza; a banda de guarda desloca os limites de decisão em w = r·U.',
    'O TUR/TAR adota a convenção T/(2U); o limiar de alerta é editável e não é uma norma.',
    'Na regra de probabilidade, o limiar de decisão é editável; P ≥ limiar aceita e P < limiar rejeita.',
    'Nenhum valor é removido, arredondado ou corrigido automaticamente.',
    'O resultado registra a regra, os limites efetivos, a incerteza expandida e o fator de abrangência para a declaração de conformidade.',
  ];
  if (lsl === null || usl === null) {
    notes.push(
      'Tolerância unilateral: TUR/TAR, %P/T e U/T não são calculados por falta de uma largura bilateral T.',
    );
  }

  const effectiveLowerMetric = metric({
    key: 'effective_lower',
    label: 'Limite inferior efetivo',
    value: effectiveLower,
    unit,
    verdict: 'not_evaluated',
    criterionText:
      rule === 'probability'
        ? 'Não aplicável à regra de probabilidade; a decisão usa P ≥ limiar.'
        : lsl === null
          ? 'LSL não informado (tolerância unilateral superior).'
          : rule === 'guard_band'
            ? `LSL + w = ${fmt(lsl)} + ${fmt(guardBand)}`
            : `LSL = ${fmt(lsl)}`,
    formula:
      rule === 'guard_band'
        ? 'limite efetivo inferior = LSL + w'
        : 'limite efetivo inferior = LSL',
  });
  const effectiveUpperMetric = metric({
    key: 'effective_upper',
    label: 'Limite superior efetivo',
    value: effectiveUpper,
    unit,
    verdict: 'not_evaluated',
    criterionText:
      rule === 'probability'
        ? 'Não aplicável à regra de probabilidade; a decisão usa P ≥ limiar.'
        : usl === null
          ? 'USL não informado (tolerância unilateral inferior).'
          : rule === 'guard_band'
            ? `USL − w = ${fmt(usl)} − ${fmt(guardBand)}`
            : `USL = ${fmt(usl)}`,
    formula:
      rule === 'guard_band'
        ? 'limite efetivo superior = USL − w'
        : 'limite efetivo superior = USL',
  });

  const metrics: AnalysisMetric[] = [
    metric({
      key: 'conformity',
      label: `Conformidade — ${CONFORMITY_RULE_LABELS[rule]}`,
      value,
      unit,
      verdict,
      criterionText: criteriaText,
      formula: 'x (valor medido) confrontado com a regra de decisão',
    }),
    metric({
      key: 'expanded_uncertainty',
      label: 'Incerteza expandida U',
      value: expandedUncertainty,
      unit,
      verdict: 'not_evaluated',
      criterionText: `U = k·u, com k = ${fmt(coverageFactor)} (fator de abrangência editável)`,
      formula: 'U = k·u',
    }),
    metric({
      key: 'guard_band',
      label: 'Banda de guarda w',
      value: guardBand,
      unit,
      verdict: 'not_evaluated',
      criterionText:
        rule === 'guard_band'
          ? `w = r·U, com r = ${fmt(guardBandFactor)} (editável)`
          : 'Não utilizada nesta regra (w = 0).',
      formula: 'w = r·U',
    }),
    effectiveLowerMetric,
    effectiveUpperMetric,
    metric({
      key: 'probability_conformity',
      label: 'Probabilidade de conformidade P',
      value: probabilityConform,
      unit: '',
      verdict:
        rule === 'probability'
          ? probabilityConform >= criteria.probabilityThreshold
            ? 'pass'
            : 'fail'
          : 'not_evaluated',
      criterionText:
        rule === 'probability'
          ? `P ≥ ${fmt(criteria.probabilityThreshold)} (limiar editável)`
          : 'Descritivo; a decisão usa a regra selecionada.',
      formula: probabilityFormula(lsl, usl),
    }),
    metric({
      key: 'false_accept_risk',
      label: 'Risco específico de falso aceite',
      value: falseAcceptRisk,
      unit: '',
      verdict: 'not_evaluated',
      criterionText: 'Informativo; sem limite de risco cadastrado.',
      formula: 'P_falso aceite = 1 − P(conformidade | x)',
    }),
    metric({
      key: 'false_reject_risk',
      label: 'Risco específico de falso rejeite',
      value: falseRejectRisk,
      unit: '',
      verdict: 'not_evaluated',
      criterionText: 'Informativo; sem limite de risco cadastrado.',
      formula: 'P_falso rejeite = P(conformidade | x)',
    }),
    metric({
      key: 'tolerance',
      label: 'Tolerância T',
      value: tolerance.tolerance,
      unit,
      verdict: 'not_evaluated',
      criterionText:
        tolerance.tolerance === null
          ? 'Tolerância bilateral não informada.'
          : 'T = USL − LSL',
      formula: 'T = USL − LSL',
    }),
    metric({
      key: 'tur',
      label: 'TUR/TAR (tolerância / incerteza)',
      value: tolerance.tur,
      unit: '',
      verdict:
        tolerance.tur === null
          ? 'not_evaluated'
          : tolerance.tur >= criteria.turMinimum
            ? 'pass'
            : 'warning',
      criterionText:
        tolerance.tur === null
          ? 'T ou U indisponível; TUR/TAR não avaliado.'
          : `TUR/TAR ≥ ${fmt(criteria.turMinimum)} (alerta; limiar editável)`,
      formula: 'TUR/TAR = T/(2U)',
    }),
    metric({
      key: 'u_over_t',
      label: 'U/T',
      value: tolerance.uOverT,
      unit: '',
      verdict:
        tolerance.uOverT === null
          ? 'not_evaluated'
          : tolerance.uOverT <= criteria.maxUOverT
            ? 'pass'
            : 'warning',
      criterionText:
        tolerance.uOverT === null
          ? 'T ou U indisponível; U/T não avaliado.'
          : `U/T ≤ ${fmt(criteria.maxUOverT)} (alerta; limiar editável)`,
      formula: 'U/T',
    }),
    metric({
      key: 'pct_pt',
      label: '%P/T (U/T)',
      value: tolerance.pctPT,
      unit: '%',
      verdict:
        tolerance.pctPT === null
          ? 'not_evaluated'
          : tolerance.pctPT <= criteria.maxPctPT
            ? 'pass'
            : 'warning',
      criterionText:
        tolerance.pctPT === null
          ? 'T ou U indisponível; %P/T não avaliado.'
          : `%P/T ≤ ${fmt(criteria.maxPctPT)}% (alerta; limiar editável)`,
      formula: '%P/T = 100·U/T',
    }),
  ];

  const decisionTable: AnalysisTable = {
    title: 'Regra de decisão e limites efetivos',
    columns: ['Item', 'Valor', 'Observação'],
    rows: [
      ['Regra', CONFORMITY_RULE_LABELS[rule], criteriaText],
      ['Valor medido x', `${fmt(value)}${unit ? ` ${unit}` : ''}`, 'Valor informado; não é corrigido automaticamente.'],
      ['Incerteza-padrão u', `${fmt(standardUncertainty)}${unit ? ` ${unit}` : ''}`, 'Incerteza informada para o valor medido.'],
      ['Fator de abrangência k', fmt(coverageFactor), 'Editável; U = k·u.'],
      ['Incerteza expandida U', `${fmt(expandedUncertainty)}${unit ? ` ${unit}` : ''}`, 'U = k·u.'],
      ['LSL', lsl === null ? '—' : `${fmt(lsl)}${unit ? ` ${unit}` : ''}`, 'Limite inferior de especificação.'],
      ['USL', usl === null ? '—' : `${fmt(usl)}${unit ? ` ${unit}` : ''}`, 'Limite superior de especificação.'],
      ['Tolerância T', tolerance.tolerance === null ? '—' : `${fmt(tolerance.tolerance)}${unit ? ` ${unit}` : ''}`, 'T = USL − LSL.'],
      ['Banda de guarda w', `${fmt(guardBand)}${unit ? ` ${unit}` : ''}`, `w = r·U, r = ${fmt(guardBandFactor)}.`],
      ['Limite efetivo inferior', effectiveLower === null ? '—' : `${fmt(effectiveLower)}${unit ? ` ${unit}` : ''}`, rule === 'probability' ? 'Não aplicável.' : 'Início da zona de aceitação.'],
      ['Limite efetivo superior', effectiveUpper === null ? '—' : `${fmt(effectiveUpper)}${unit ? ` ${unit}` : ''}`, rule === 'probability' ? 'Não aplicável.' : 'Fim da zona de aceitação.'],
      ['Probabilidade de conformidade P', fmt(probabilityConform), probabilityFormula(lsl, usl)],
      ['Limiar de probabilidade', rule === 'probability' ? fmt(criteria.probabilityThreshold) : '—', 'Usado apenas na regra de probabilidade.'],
      ['Veredito', decisionLabel, criteriaText],
    ],
    note:
      'Limites fechados: x exatamente no limite de aceitação é conforme; x exatamente no limite externo da zona de guarda é indeterminado.',
  };

  const riskRows = metrics
    .filter((item) =>
      [
        'probability_conformity',
        'false_accept_risk',
        'false_reject_risk',
        'tur',
        'u_over_t',
        'pct_pt',
      ].includes(item.key),
    )
    .map((item) => [
      item.label,
      item.formula ?? '—',
      `${fmt(item.value)}${item.unit ? ` ${item.unit}` : ''}`,
      item.criterionText,
      verdictLabel(item.verdict),
    ]);
  const riskTable: AnalysisTable = {
    title: 'Riscos e métricas relativas à tolerância',
    columns: ['Métrica', 'Fórmula', 'Valor', 'Critério', 'Veredito'],
    rows: riskRows,
    note:
      'Riscos específicos condicionais ao valor medido. TUR/TAR = T/(2U); %P/T = 100·U/T; U/T = U/T.',
  };

  const rawMetrics: Record<string, number | null> = {
    value,
    standard_uncertainty: standardUncertainty,
    coverage_factor: coverageFactor,
    expanded_uncertainty: expandedUncertainty,
    lsl,
    usl,
    tolerance: tolerance.tolerance,
    guard_band: guardBand,
    guard_band_factor: guardBandFactor,
    effective_lower: effectiveLower,
    effective_upper: effectiveUpper,
    rejection_lower: rejectionLower,
    rejection_upper: rejectionUpper,
    probability_conformity: probabilityConform,
    probability_threshold: criteria.probabilityThreshold,
    false_accept_risk: falseAcceptRisk,
    false_reject_risk: falseRejectRisk,
    applicable_risk: applicableRisk,
    tur: tolerance.tur,
    u_over_t: tolerance.uOverT,
    pct_pt: tolerance.pctPT,
  };

  const report: ConformityReportView = {
    rule,
    ruleLabel: CONFORMITY_RULE_LABELS[rule],
    value,
    standardUncertainty,
    coverageFactor,
    expandedUncertainty,
    lsl,
    usl,
    tolerance: tolerance.tolerance,
    guardBand,
    guardBandFactor,
    effectiveLower,
    effectiveUpper,
    rejectionLower,
    rejectionUpper,
    probabilityConform,
    probabilityThreshold: criteria.probabilityThreshold,
    tur: tolerance.tur,
    decision,
    decisionLabel,
    verdict,
    criteriaText,
    summary,
    alerts: [...warnings],
    reference: REFERENCE,
  };

  return {
    rule,
    ruleLabel: CONFORMITY_RULE_LABELS[rule],
    decision,
    decisionLabel,
    verdict,
    value,
    standardUncertainty,
    coverageFactor,
    expandedUncertainty,
    lsl,
    usl,
    tolerance: tolerance.tolerance,
    guardBand,
    guardBandFactor,
    effectiveLower,
    effectiveUpper,
    rejectionLower,
    rejectionUpper,
    probabilityConform,
    probabilityThreshold: criteria.probabilityThreshold,
    falseAcceptRisk,
    falseRejectRisk,
    applicableRisk,
    applicableRiskType,
    tur: tolerance.tur,
    uOverT: tolerance.uOverT,
    pctPT: tolerance.pctPT,
    criteria,
    criteriaText,
    alerts: [...warnings],
    warnings: [...warnings],
    notes,
    metrics,
    rawMetrics,
    tables: [decisionTable, riskTable],
    summary,
    method:
      'Regra de decisão de conformidade (aceitação simples, banda de guarda ou probabilidade normal)',
    reference: REFERENCE,
    report,
  };
}
