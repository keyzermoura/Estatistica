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
import { fmt, normalCdf, normalPdf } from './distributions';
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
  /** Média a priori do processo/lote μ₀ para risco global bayesiano (JCGM 106 §7 e §9.5). */
  priorMean?: number | null;
  /** Desvio-padrão a priori σ₀ > 0 para risco global bayesiano (JCGM 106 §7 e §9.5). */
  priorStd?: number | null;
}

export interface BayesianConformityInput {
  /** Limite inferior de tolerância (nulo se unilateral superior). */
  lsl?: number | null;
  /** Limite superior de tolerância (nulo se unilateral inferior). */
  usl?: number | null;
  /** Incerteza-padrão da medição u_m ≥ 0. */
  standardUncertainty: number;
  /** Média a priori do processo/lote μ₀. */
  priorMean: number;
  /** Desvio-padrão a priori do processo/lote σ₀ > 0. */
  priorStd: number;
  /** Banda de guarda w ≥ 0 aplicada ao intervalo de aceitação (padrão 0). */
  guardBand?: number;
  /** Valor medido observado x para atualização conjugada Normal–Normal (opcional). */
  measuredValue?: number | null;
}

export interface BayesianConformityResult {
  priorMean: number;
  priorStd: number;
  priorConformProbability: number;
  acceptanceProbability: number;
  globalConsumerRisk: number;
  globalProducerRisk: number;
  /** Risco condicional do consumidor dado aceite: P(Y ∉ T | X ∈ A) = R_C / P(X ∈ A). */
  conditionalConsumerRisk: number | null;
  /** Risco condicional do produtor dada rejeição: P(Y ∈ T | X ∉ A) = R_P / P(X ∉ A). */
  conditionalProducerRisk: number | null;
  posteriorMean: number | null;
  posteriorStd: number | null;
  posteriorConformProbability: number | null;
  posteriorFalseAcceptRisk: number | null;
  posteriorFalseRejectRisk: number | null;
  method: string;
  reference: string;
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
  bayesianRisks?: BayesianConformityResult;
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

function simpsonIntegrate(fn: (x: number) => number, a: number, b: number, nSub = 400): number {
  if (!(b > a)) return 0;
  const n = nSub % 2 === 0 ? nSub : nSub + 1;
  const h = (b - a) / n;
  let sum = fn(a) + fn(b);
  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    sum += (i % 2 === 1 ? 4 : 2) * fn(x);
  }
  return ((b - a) / (3 * n)) * sum;
}

/**
 * Avaliação bayesiana conjugada Normal–Normal e riscos globais de consumidor
 * (R_C) e produtor (R_P) conforme JCGM 106:2012 (Seções 7.2 e 9.5, Eq. 19–20).
 *
 * Prior: Y ~ N(μ₀, σ₀²); Verossimilhança: X | Y = y ~ N(y, u_m²).
 * Posterior: Y | X = x ~ N(μ_post, u_post²).
 * R_C = ∫_{y ∉ T} f₀(y)·P(X ∈ A | Y = y) dy;
 * R_P = ∫_{y ∈ T} f₀(y)·[1 − P(X ∈ A | Y = y)] dy.
 */
export function computeBayesianConformityRisks(
  input: BayesianConformityInput,
): BayesianConformityResult {
  const lower = normalizeLimit(input.lsl, 'LSL');
  const upper = normalizeLimit(input.usl, 'USL');
  if (lower === null && upper === null) {
    throw new Error('Informe pelo menos um limite de tolerância (LSL ou USL).');
  }
  if (lower !== null && upper !== null && !(lower < upper)) {
    throw new Error('A tolerância bilateral exige LSL < USL.');
  }
  if (!Number.isFinite(input.standardUncertainty) || input.standardUncertainty < 0) {
    throw new Error('A incerteza-padrão u_m deve ser um número não negativo.');
  }
  if (!Number.isFinite(input.priorMean)) {
    throw new Error('A média a priori μ₀ deve ser um número finito.');
  }
  if (!Number.isFinite(input.priorStd) || !(input.priorStd > 0)) {
    throw new Error('O desvio-padrão a priori σ₀ deve ser positivo.');
  }
  const guardBand = input.guardBand ?? 0;
  if (!Number.isFinite(guardBand) || guardBand < 0) {
    throw new Error('A banda de guarda w deve ser um número não negativo.');
  }
  const measured = input.measuredValue;
  if (measured !== null && measured !== undefined && !Number.isFinite(measured)) {
    throw new Error('O valor medido x deve ser um número finito.');
  }

  const uM = input.standardUncertainty;
  const mu0 = input.priorMean;
  const s0 = input.priorStd;
  const acceptLower = lower !== null ? lower + guardBand : null;
  const acceptUpper = upper !== null ? upper - guardBand : null;
  const emptyAcceptance =
    acceptLower !== null && acceptUpper !== null && !(acceptLower < acceptUpper);

  const acceptGivenY = (y: number): number => {
    if (emptyAcceptance) {
      if (acceptLower !== null && acceptUpper !== null && acceptLower === acceptUpper && uM === 0) {
        return y === acceptLower ? 1 : 0;
      }
      return 0;
    }
    return probabilityOfConformity(y, uM, acceptLower, acceptUpper);
  };

  const priorConformProbability = probabilityOfConformity(mu0, s0, lower, upper);
  const acceptanceProbability = emptyAcceptance
    ? 0
    : probabilityOfConformity(mu0, Math.hypot(s0, uM), acceptLower, acceptUpper);

  const tailLo = mu0 - 8 * s0;
  const tailHi = mu0 + 8 * s0;

  let globalConsumerRisk = 0;
  if (lower !== null && lower > tailLo) {
    globalConsumerRisk += simpsonIntegrate(
      (y) => normalPdf(y, mu0, s0) * acceptGivenY(y),
      tailLo,
      lower,
      400,
    );
  }
  if (upper !== null && upper < tailHi) {
    globalConsumerRisk += simpsonIntegrate(
      (y) => normalPdf(y, mu0, s0) * acceptGivenY(y),
      upper,
      tailHi,
      400,
    );
  }
  globalConsumerRisk = Math.min(1, Math.max(0, globalConsumerRisk));

  const confLo = lower !== null ? Math.max(lower, tailLo) : tailLo;
  const confHi = upper !== null ? Math.min(upper, tailHi) : tailHi;
  const globalProducerRisk =
    confHi > confLo
      ? Math.min(
          1,
          Math.max(
            0,
            simpsonIntegrate(
              (y) => normalPdf(y, mu0, s0) * (1 - acceptGivenY(y)),
              confLo,
              confHi,
              400,
            ),
          ),
        )
      : 0;

  const conditionalConsumerRisk =
    acceptanceProbability > 0
      ? Math.min(1, globalConsumerRisk / acceptanceProbability)
      : null;
  const rejectionProbability = 1 - acceptanceProbability;
  const conditionalProducerRisk =
    rejectionProbability > 0
      ? Math.min(1, globalProducerRisk / rejectionProbability)
      : null;

  let posteriorMean: number | null = null;
  let posteriorStd: number | null = null;
  let posteriorConformProbability: number | null = null;
  let posteriorFalseAcceptRisk: number | null = null;
  let posteriorFalseRejectRisk: number | null = null;

  if (measured !== null && measured !== undefined) {
    if (uM === 0) {
      posteriorMean = measured;
      posteriorStd = 0;
    } else {
      const var0 = s0 * s0;
      const varM = uM * uM;
      posteriorMean = (varM * mu0 + var0 * measured) / (var0 + varM);
      posteriorStd = (s0 * uM) / Math.sqrt(var0 + varM);
    }
    posteriorConformProbability = probabilityOfConformity(
      posteriorMean,
      posteriorStd,
      lower,
      upper,
    );
    posteriorFalseAcceptRisk = Math.min(1, Math.max(0, 1 - posteriorConformProbability));
    posteriorFalseRejectRisk = posteriorConformProbability;
  }

  return {
    priorMean: mu0,
    priorStd: s0,
    priorConformProbability,
    acceptanceProbability,
    globalConsumerRisk,
    globalProducerRisk,
    conditionalConsumerRisk,
    conditionalProducerRisk,
    posteriorMean,
    posteriorStd,
    posteriorConformProbability,
    posteriorFalseAcceptRisk,
    posteriorFalseRejectRisk,
    method:
      'Atualização bayesiana conjugada Normal–Normal e riscos globais R_C/R_P por quadratura de Simpson em [μ₀ − 8σ₀, μ₀ + 8σ₀]',
    reference: 'JCGM 106:2012, Seções 7.2 e 9.5 (Eq. 19–22)',
  };
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

  let bayesianRisks: BayesianConformityResult | undefined;
  const hasPriorMean = input.priorMean !== null && input.priorMean !== undefined;
  const hasPriorStd = input.priorStd !== null && input.priorStd !== undefined;
  if (hasPriorMean !== hasPriorStd) {
    throw new Error('Informe ambos priorMean (μ₀) e priorStd (σ₀ > 0) para análise bayesiana JCGM 106.');
  }
  if (hasPriorMean && hasPriorStd) {
    bayesianRisks = computeBayesianConformityRisks({
      lsl,
      usl,
      standardUncertainty,
      priorMean: input.priorMean!,
      priorStd: input.priorStd!,
      guardBand: rule === 'probability' ? 0 : guardBand,
      measuredValue: value,
    });
  }

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
    ...(bayesianRisks
      ? {
          bayesian_global_consumer_risk: bayesianRisks.globalConsumerRisk,
          bayesian_global_producer_risk: bayesianRisks.globalProducerRisk,
          bayesian_posterior_mean: bayesianRisks.posteriorMean,
          bayesian_posterior_std: bayesianRisks.posteriorStd,
          bayesian_posterior_conformity: bayesianRisks.posteriorConformProbability,
        }
      : {}),
  };

  const finalTables: AnalysisTable[] = bayesianRisks
    ? [
        decisionTable,
        riskTable,
        {
          title: 'Riscos globais e posterior bayesiano (JCGM 106 §7 e §9.5)',
          columns: ['Grandeza', 'Valor', 'Interpretação'],
          rows: [
            ['Prior N(μ₀, σ₀²)', `μ₀ = ${fmt(bayesianRisks.priorMean)}, σ₀ = ${fmt(bayesianRisks.priorStd)}`, 'Distribuição prévia do processo/lote.'],
            ['Posterior μ_post', fmt(bayesianRisks.posteriorMean), 'Média conjugada dada a medição x.'],
            ['Posterior u_post', fmt(bayesianRisks.posteriorStd), 'Incerteza-padrão a posteriori.'],
            ['Conformidade posterior', fmt(bayesianRisks.posteriorConformProbability), 'P(Y ∈ T | X = x) conjugada Normal–Normal.'],
            ['Risco global do consumidor (R_C)', fmt(bayesianRisks.globalConsumerRisk), 'P(Y ∉ T e X ∈ A) (JCGM 106 Eq. 19).'],
            ['Risco global do produtor (R_P)', fmt(bayesianRisks.globalProducerRisk), 'P(Y ∈ T e X ∉ A) (JCGM 106 Eq. 20).'],
          ],
          note:
            rule === 'probability'
              ? 'Na regra de probabilidade, R_C e R_P usam intervalo de aceitação nominal [LSL, USL] (w = 0).'
              : `Calculado com banda de guarda w = ${fmt(guardBand)}.`,
        },
      ]
    : [decisionTable, riskTable];

  const finalNotes = bayesianRisks
    ? [
        ...notes,
        `Análise bayesiana JCGM 106: R_C global = ${fmt(bayesianRisks.globalConsumerRisk)}; R_P global = ${fmt(bayesianRisks.globalProducerRisk)}; P_post = ${fmt(bayesianRisks.posteriorConformProbability)}.`,
      ]
    : notes;

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
    notes: finalNotes,
    metrics,
    rawMetrics,
    tables: finalTables,
    summary,
    method:
      'Regra de decisão de conformidade (aceitação simples, banda de guarda ou probabilidade normal)',
    reference: REFERENCE,
    report,
    ...(bayesianRisks ? { bayesianRisks } : {}),
  };
}

export interface TargetUncertaintyInput {
  lsl?: number | null;
  usl?: number | null;
  /** Fração mássica C (adimensional, ex.: 1e-6 para 1 ppm) para Horwitz–Thompson. */
  massFraction?: number | null;
  /** Fator de abrangência k (padrão = 2). */
  coverageFactor?: number;
  /** Incerteza expandida atual obtida (opcional). */
  currentExpandedUncertainty?: number | null;
}

export interface TargetUncertaintyResult {
  tolerance: number | null;
  coverageFactor: number;
  uTargetSpecModerate: number | null;
  expandedTargetSpecModerate: number | null;
  uTargetSpecStrict: number | null;
  expandedTargetSpecStrict: number | null;
  horwitzRsdPct: number | null;
  horwitzSigma: number | null;
  recommendedExpandedTarget: number | null;
  meetsModerateSpec: boolean | null;
  meetsStrictSpec: boolean | null;
  method: string;
  reference: string;
}

/**
 * Calculadora de Incerteza-Alvo (U^tg) baseada em limites de especificação
 * (U^tg ≤ T/4 moderada; U^tg ≤ T/8 rigorosa com TUR ≥ 4) e na função empírica
 * de Horwitz–Thompson para fração mássica.
 *
 * Referência: EURACHEM / CITAC Guide — Setting Target Measurement Uncertainty (2015).
 */
export function computeTargetUncertainty(
  input: TargetUncertaintyInput,
): TargetUncertaintyResult {
  const k =
    input.coverageFactor !== undefined &&
    Number.isFinite(input.coverageFactor) &&
    input.coverageFactor > 0
      ? input.coverageFactor
      : 2;
  const lsl =
    input.lsl !== null && input.lsl !== undefined && Number.isFinite(input.lsl)
      ? input.lsl
      : null;
  const usl =
    input.usl !== null && input.usl !== undefined && Number.isFinite(input.usl)
      ? input.usl
      : null;
  const tolerance = lsl !== null && usl !== null && usl > lsl ? usl - lsl : null;

  const uTargetSpecModerate = tolerance !== null ? tolerance / 8 : null;
  const expandedTargetSpecModerate =
    uTargetSpecModerate !== null ? k * uTargetSpecModerate : null;
  const uTargetSpecStrict = tolerance !== null ? tolerance / 16 : null;
  const expandedTargetSpecStrict =
    uTargetSpecStrict !== null ? k * uTargetSpecStrict : null;

  let horwitzSigma: number | null = null;
  let horwitzRsdPct: number | null = null;
  const c = input.massFraction;
  if (c !== null && c !== undefined && Number.isFinite(c) && c > 0) {
    if (c < 1.2e-7) {
      horwitzSigma = 0.22 * c;
    } else if (c <= 0.138) {
      horwitzSigma = 0.02 * Math.pow(c, 0.8495);
    } else {
      horwitzSigma = 0.01 * Math.pow(c, 0.5);
    }
    horwitzRsdPct = (100 * horwitzSigma) / c;
  }

  const currentU =
    input.currentExpandedUncertainty !== null &&
    input.currentExpandedUncertainty !== undefined &&
    Number.isFinite(input.currentExpandedUncertainty) &&
    input.currentExpandedUncertainty >= 0
      ? input.currentExpandedUncertainty
      : null;

  const meetsModerateSpec =
    currentU !== null && expandedTargetSpecModerate !== null
      ? currentU <= expandedTargetSpecModerate
      : null;
  const meetsStrictSpec =
    currentU !== null && expandedTargetSpecStrict !== null
      ? currentU <= expandedTargetSpecStrict
      : null;

  const recommendedExpandedTarget =
    expandedTargetSpecStrict ??
    (horwitzSigma !== null ? k * horwitzSigma : null);

  return {
    tolerance,
    coverageFactor: k,
    uTargetSpecModerate,
    expandedTargetSpecModerate,
    uTargetSpecStrict,
    expandedTargetSpecStrict,
    horwitzRsdPct,
    horwitzSigma,
    recommendedExpandedTarget,
    meetsModerateSpec,
    meetsStrictSpec,
    method:
      'Incerteza-alvo por tolerância (T/4 e T/8, k = 2) e/ou Horwitz–Thompson (Eurachem 2015)',
    reference:
      'EURACHEM / CITAC Guide — Setting Target Measurement Uncertainty (2015); Thompson (2000)',
  };
}

/**
 * Gera pontos de densidade da curva normal da medição e do posterior bayesiano (quando presente)
 * sobrepostos à tolerância (LSL/USL) e à banda de guarda (w).
 */
export function buildConformityDensityData(
  result: ConformityResult,
  pointsCount = 80,
): Array<{ x: number; density: number; postDensity?: number }> {
  const x = result.value;
  const u = result.standardUncertainty;
  if (!Number.isFinite(x) || !(u > 0)) return [];

  let minRange = x - 3.5 * u;
  let maxRange = x + 3.5 * u;
  if (result.lsl !== null && Number.isFinite(result.lsl)) {
    minRange = Math.min(minRange, result.lsl - 0.5 * u);
  }
  if (result.usl !== null && Number.isFinite(result.usl)) {
    maxRange = Math.max(maxRange, result.usl + 0.5 * u);
  }
  if (result.bayesianRisks?.posteriorMean && result.bayesianRisks?.posteriorStd) {
    minRange = Math.min(minRange, result.bayesianRisks.posteriorMean - 3.5 * result.bayesianRisks.posteriorStd);
    maxRange = Math.max(maxRange, result.bayesianRisks.posteriorMean + 3.5 * result.bayesianRisks.posteriorStd);
  }

  const step = (maxRange - minRange) / Math.max(20, pointsCount);
  const data: Array<{ x: number; density: number; postDensity?: number }> = [];

  for (let i = 0; i <= pointsCount; i++) {
    const t = minRange + i * step;
    const density = normalPdf(t, x, u);
    let postDensity: number | undefined;
    if (
      result.bayesianRisks?.posteriorMean &&
      result.bayesianRisks?.posteriorStd &&
      result.bayesianRisks.posteriorStd > 0
    ) {
      postDensity = normalPdf(t, result.bayesianRisks.posteriorMean, result.bayesianRisks.posteriorStd);
    }
    data.push({
      x: Number(t.toFixed(4)),
      density: Number(density.toFixed(5)),
      ...(postDensity !== undefined ? { postDensity: Number(postDensity.toFixed(5)) } : {}),
    });
  }

  return data;
}
