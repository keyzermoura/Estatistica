/**
 * ANOVA aninhada, Gage R&R para ensaio destrutivo e homogeneidade de lote.
 *
 * Modelo de três níveis balanceado:
 *   y_ijk = μ + A_i + B_j(i) + e_k(ij)
 * com A_i ~ N(0, σ²_A), B_j(i) ~ N(0, σ²_B(A)) e e_k(ij) ~ N(0, σ²_e).
 * Componentes pelo método dos momentos:
 *   σ²_e    = MS_E
 *   σ²_B(A) = max(0, (MS_B(A) − MS_E)/n)
 *   σ²_A    = max(0, (MS_A − MS_B(A))/(b·n))
 *
 * Em ensaio destrutivo cada réplica é um corpo de prova distinto. A
 * repetibilidade, portanto, inclui a variação entre corpos de prova e a
 * validade do estudo depende da homogeneidade do lote. O componente entre
 * amostras é separado como variação de amostragem e não entra em σ²_GRR.
 *
 * Com b = 1 (Operador > Réplica) o modelo de dois níveis é delegado ao
 * ISO 5725-2 (`iso5725Analysis`), pois σ²_B(A) não é separável de σ²_e.
 *
 * Referências:
 *  - Montgomery, D. C. (2020). Design and Analysis of Experiments, 10. ed.,
 *    cap. 14 (modelos aninhados e componentes de variância).
 *  - ISO 5725-2:2019, cláusulas 5–7 (modelo aleatório de dois níveis).
 *  - AIAG (2010). Measurement Systems Analysis Reference Manual, 4. ed.
 *  - Satterthwaite, F. E. (1946). An approximate distribution of estimates of
 *    variance components. Biometrics Bulletin, 2(6), 110–114.
 *  - Cochran, W. G. (1941). The distribution of the largest of a set of
 *    estimated variances as a fraction of their total. Annals of Eugenics,
 *    11(1), 47–52.
 *  - Wilrich, P.-T. (2010). Critical values of the Cochran test. Allgemeines
 *    Statistisches Archiv (aproximação conservadora do valor crítico).
 *  - Searle, S. R., Casella, G. & McCulloch, C. E. (1992). Variance
 *    Components. Wiley.
 */

import type { Verdict } from '../lib/types';
import type { AnalysisChart, AnalysisTable } from './analysis-types';
import { anovaOneWay, type AnovaResult, type AnovaRow } from './anova';
import { mean, sd } from './descriptive';
import { fCdf, fInv, fmt } from './distributions';
import {
  DEFAULT_GAGERR_CRITERIA,
  chiSquareSdInterval,
  ratioPctInterval,
  satterthwaite,
  type GageRRConfidenceInterval,
  type GageRRCriteria,
} from './gagerr';
import { iso5725Analysis, type Iso5725Result } from './iso5725';

export const NESTED_DESTRUCTIVE_WARNING =
  'Ensaio destrutivo: a repetibilidade inclui a variação entre corpos de prova e a validade do estudo depende da homogeneidade do lote.';

const REFERENCE =
  'Montgomery (2020), cap. 14; ISO 5725-2:2019; AIAG (2010), MSA Reference Manual, 4. ed.; Satterthwaite (1946).';

const CI_REFERENCE =
  'Satterthwaite (1946); AIAG (2010), MSA Reference Manual, 4. ed.; Burdick, Borror & Montgomery (2003).';

const HOMOGENEITY_REFERENCE =
  'Montgomery (2020), cap. 3; Cochran (1941); Wilrich (2010); ISO 5725-2:2019.';

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function round6(value: number | null | undefined): number | null {
  if (!finite(value)) return null;
  const result = Number(value.toFixed(6));
  return Object.is(result, -0) ? 0 : result;
}

function safeSqrt(value: number): number {
  return value > 0 ? Math.sqrt(value) : 0;
}

function pFromF(f: number | null, df1: number, df2: number): number | null {
  if (f === null || df1 <= 0 || df2 <= 0) return null;
  if (f === Infinity) return 0;
  if (!Number.isFinite(f)) return null;
  if (f <= 0) return 1;
  const p = 1 - fCdf(f, df1, df2);
  return Math.min(1, Math.max(0, p));
}

function verdictLabel(verdict: Verdict): string {
  if (verdict === 'pass') return 'conforme';
  if (verdict === 'fail') return 'não conforme';
  if (verdict === 'warning') return 'atenção';
  return 'não avaliado';
}

function classifyMax(value: number | null, accept: number, warning: number): Verdict {
  if (value === null || !Number.isFinite(value)) return 'not_evaluated';
  if (value <= accept) return 'pass';
  if (value <= warning) return 'warning';
  return 'fail';
}

function classifyMin(value: number | null, minimum: number): Verdict {
  if (value === null || !Number.isFinite(value)) return 'not_evaluated';
  return value >= minimum ? 'pass' : 'fail';
}

function maxCriterionText(label: string, accept: number, warning: number): string {
  return `${label} ≤ ${fmt(accept)}% conforme; > ${fmt(accept)}% e ≤ ${fmt(warning)}% atenção; > ${fmt(warning)}% não conforme`;
}

function formatP(p: number | null): string | number {
  if (p === null || !Number.isFinite(p)) return '—';
  if (p < 1e-12) return '< 1e-12';
  return Number(p.toFixed(6));
}

function normalizeCriteria(criteria: Partial<GageRRCriteria> | undefined): GageRRCriteria {
  const normalized: GageRRCriteria = {
    grrAccept: criteria?.grrAccept ?? DEFAULT_GAGERR_CRITERIA.grrAccept,
    grrWarning: criteria?.grrWarning ?? DEFAULT_GAGERR_CRITERIA.grrWarning,
    ptAccept: criteria?.ptAccept ?? DEFAULT_GAGERR_CRITERIA.ptAccept,
    ptWarning: criteria?.ptWarning ?? DEFAULT_GAGERR_CRITERIA.ptWarning,
    ndcMin: criteria?.ndcMin ?? DEFAULT_GAGERR_CRITERIA.ndcMin,
  };
  for (const [label, value] of [
    ['%GRR conforme', normalized.grrAccept],
    ['%GRR atenção', normalized.grrWarning],
    ['%P/T conforme', normalized.ptAccept],
    ['%P/T atenção', normalized.ptWarning],
    ['ndc mínimo', normalized.ndcMin],
  ] as Array<[string, number]>) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`O limite de ${label} deve ser um número não negativo.`);
    }
  }
  if (normalized.grrWarning < normalized.grrAccept) {
    throw new Error('O limite de atenção de %GRR deve ser maior ou igual ao limite conforme.');
  }
  if (normalized.ptWarning < normalized.ptAccept) {
    throw new Error('O limite de atenção de %P/T deve ser maior ou igual ao limite conforme.');
  }
  if (normalized.ndcMin <= 0) {
    throw new Error('O ndc mínimo deve ser positivo.');
  }
  return normalized;
}

/* ------------------------------------------------------------------ */
/* ANOVA aninhada                                                      */
/* ------------------------------------------------------------------ */

export interface NestedObservation {
  operator: string;
  sample: string;
  replicate: number;
  value: number;
}

export interface NestedAnovaOptions {
  /** Nível de significância dos testes F; padrão 0,05. */
  alpha?: number;
}

export interface NestedVarianceComponent {
  key: 'repeatability' | 'sample' | 'operator';
  label: string;
  variance: number;
  standardDeviation: number;
  /** Estimativa antes do truncamento em zero. */
  rawVariance: number;
  truncated: boolean;
  /** Graus de liberdade efetivos (Satterthwaite), quando aplicável. */
  df: number | null;
  formula: string;
}

export interface NestedAnovaResult {
  rows: AnovaRow[];
  totalSs: number;
  operators: number;
  samplesPerOperator: number;
  replicates: number;
  n: number;
  balanced: boolean;
  alpha: number;
  dfA: number;
  dfBA: number;
  dfE: number;
  msA: number;
  msBA: number | null;
  msE: number;
  fA: number | null;
  fBA: number | null;
  pA: number | null;
  pBA: number | null;
  components: {
    repeatability: NestedVarianceComponent;
    sample: NestedVarianceComponent;
    operator: NestedVarianceComponent;
    totalVariance: number;
    totalSd: number;
  };
  /** Verdadeiro quando b = 1 e o modelo foi delegado ao ISO 5725-2. */
  twoLevel: boolean;
  /** Resultado do ISO 5725-2 no caso de dois níveis; nulo em três níveis. */
  iso5725: Iso5725Result | null;
  method: string;
  reference: string;
  interpretation: string;
  warnings: string[];
}

interface NestedGrouping {
  operatorLabels: string[];
  values: Map<string, Map<string, number[]>>;
}

function groupNested(observations: NestedObservation[]): NestedGrouping {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error('A ANOVA aninhada requer observações no formato { operador, amostra, réplica, valor }.');
  }
  const values = new Map<string, Map<string, number[]>>();
  for (const observation of observations) {
    if (!observation || typeof observation !== 'object') {
      throw new Error('Observação aninhada inválida.');
    }
    const operator = String(observation.operator ?? '').trim();
    const sample = String(observation.sample ?? '').trim();
    if (!operator) throw new Error('Cada observação aninhada deve informar o operador.');
    if (!sample) throw new Error('Cada observação aninhada deve informar a amostra.');
    if (typeof observation.value !== 'number' || !Number.isFinite(observation.value)) {
      throw new Error(`Valor inválido para ${operator} / ${sample}: ${String(observation.value)}.`);
    }
    let samples = values.get(operator);
    if (!samples) {
      samples = new Map<string, number[]>();
      values.set(operator, samples);
    }
    const list = samples.get(sample) ?? [];
    list.push(observation.value);
    samples.set(sample, list);
  }
  if (values.size < 2) {
    throw new Error('A ANOVA aninhada requer pelo menos 2 operadores.');
  }
  const operatorLabels = [...values.keys()];
  const sampleCounts = operatorLabels.map((operator) => values.get(operator)!.size);
  const samplesPerOperator = sampleCounts[0];
  if (sampleCounts.some((count) => count !== samplesPerOperator)) {
    throw new Error(
      'Delineamento aninhado desbalanceado: todos os operadores devem ter o mesmo número de amostras.',
    );
  }
  const firstOperator = operatorLabels[0];
  const firstSample = [...values.get(firstOperator)!.values()][0];
  const replicates = firstSample.length;
  if (replicates < 2) {
    throw new Error('A ANOVA aninhada requer pelo menos 2 réplicas por amostra.');
  }
  for (const operator of operatorLabels) {
    for (const [sample, list] of values.get(operator)!) {
      if (list.length !== replicates) {
        throw new Error(
          `Delineamento aninhado desbalanceado: ${operator} / ${sample} tem ${list.length} réplicas; esperado ${replicates}.`,
        );
      }
    }
  }
  return { operatorLabels, values };
}

function buildNestedComponent(
  key: NestedVarianceComponent['key'],
  label: string,
  rawVariance: number,
  df: number | null,
  formula: string,
): NestedVarianceComponent {
  const variance = Math.max(0, rawVariance);
  return {
    key,
    label,
    variance,
    standardDeviation: safeSqrt(variance),
    rawVariance,
    truncated: rawVariance < 0,
    df,
    formula,
  };
}

function twoLevelNested(
  grouping: NestedGrouping,
  observations: NestedObservation[],
  alpha: number,
): NestedAnovaResult {
  const { operatorLabels, values } = grouping;
  const replicates = [...values.get(operatorLabels[0])!.values()][0].length;
  const operators = operatorLabels.length;
  const isoRows = observations.map((observation) => ({
    lab: String(observation.operator).trim(),
    level: 'único',
    replicate: observation.replicate,
    value: observation.value,
  }));
  const iso = iso5725Analysis(isoRows);
  const level = iso.levels[0];
  if (!level) {
    throw new Error('Não foi possível obter o nível ISO 5725-2 para o modelo de dois níveis.');
  }
  const dfA = operators - 1;
  const dfE = operators * (replicates - 1);
  const msA = level.msBetween;
  const msE = level.msWithin;
  const rawOperator = (msA - msE) / replicates;
  const fA = msE > 0 ? msA / msE : null;
  const pA = pFromF(fA, dfA, dfE);
  const totalSs = msA * dfA + msE * dfE;
  const operatorDf =
    rawOperator > 0
      ? satterthwaite([
          { ms: msA, coefficient: 1 / replicates, df: dfA },
          { ms: msE, coefficient: -1 / replicates, df: dfE },
        ])
      : null;
  const repeatability = buildNestedComponent(
    'repeatability',
    'Repetibilidade (σ²_e)',
    level.sr * level.sr,
    dfE,
    'σ²_e = MS_E',
  );
  const sample = buildNestedComponent(
    'sample',
    'Amostra(operador) (σ²_B(A))',
    0,
    null,
    'σ²_B(A) não estimável com b = 1 (modelo de dois níveis)',
  );
  const operator = buildNestedComponent(
    'operator',
    'Operador (σ²_A)',
    rawOperator,
    operatorDf,
    'σ²_A = max(0, (MS_A − MS_E)/n)',
  );
  const totalVariance = repeatability.variance + sample.variance + operator.variance;
  const rows: AnovaRow[] = [
    {
      source: 'Operador (A)',
      df: dfA,
      ss: msA * dfA,
      ms: msA,
      f: fA,
      p: pA,
      eta2: totalSs > 0 ? (msA * dfA) / totalSs : null,
    },
    {
      source: 'Erro (réplica)',
      df: dfE,
      ss: msE * dfE,
      ms: msE,
      f: null,
      p: null,
    },
    {
      source: 'Total',
      df: dfA + dfE,
      ss: totalSs,
      ms: null,
      f: null,
      p: null,
    },
  ];
  const warnings = iso.warnings.filter((warning) => !/laborat[oó]rio/i.test(warning));
  warnings.push(
    'Com b = 1, σ²_B(A) não é separável da repetibilidade; o modelo de dois níveis do ISO 5725-2 foi usado e a componente de amostragem foi fixada em zero (não estimável).',
  );
  const interpretation =
    pA === null
      ? 'Não foi possível testar o efeito de operador; modelo de dois níveis delegado ao ISO 5725-2.'
      : pA < alpha
        ? `Há evidência de efeito de operador (F = ${fmt(fA)}, p = ${fmt(pA)} < ${fmt(alpha)}). Modelo de dois níveis delegado ao ISO 5725-2.`
        : `Não há evidência de efeito de operador (F = ${fmt(fA)}, p = ${fmt(pA)} ≥ ${fmt(alpha)}). Modelo de dois níveis delegado ao ISO 5725-2.`;
  return {
    rows,
    totalSs,
    operators,
    samplesPerOperator: 1,
    replicates,
    n: operators * replicates,
    balanced: level.balanced,
    alpha,
    dfA,
    dfBA: 0,
    dfE,
    msA,
    msBA: null,
    msE,
    fA,
    fBA: null,
    pA,
    pBA: null,
    components: {
      repeatability,
      sample,
      operator,
      totalVariance,
      totalSd: safeSqrt(totalVariance),
    },
    twoLevel: true,
    iso5725: iso,
    method: 'ANOVA aninhada de dois níveis (Operador > Réplica), delegada ao ISO 5725-2',
    reference: 'ISO 5725-2:2019, cláusulas 5–7; Montgomery (2020), cap. 14',
    interpretation,
    warnings,
  };
}

/**
 * ANOVA aninhada balanceada de três níveis (Operador > Amostra(Operador) > Réplica).
 * Com b = 1 delega ao modelo de dois níveis do ISO 5725-2.
 */
export function anovaNested(
  observations: NestedObservation[],
  options: NestedAnovaOptions = {},
): NestedAnovaResult {
  const alpha = options.alpha ?? 0.05;
  if (!(alpha > 0 && alpha < 1)) {
    throw new Error('O nível de significância α deve estar entre 0 e 1 (ex.: 0,05).');
  }
  const grouping = groupNested(observations);
  const { operatorLabels, values } = grouping;
  const operators = operatorLabels.length;
  const samplesPerOperator = values.get(operatorLabels[0])!.size;
  const replicates = [...values.get(operatorLabels[0])!.values()][0].length;
  if (samplesPerOperator === 1) {
    return twoLevelNested(grouping, observations, alpha);
  }

  const grandMean = mean(observations.map((observation) => observation.value));
  const operatorMeans = new Map<string, number>();
  for (const operator of operatorLabels) {
    const operatorValues = [...values.get(operator)!.values()].flat();
    operatorMeans.set(operator, mean(operatorValues));
  }
  const sampleMeans = new Map<string, Map<string, number>>();
  for (const operator of operatorLabels) {
    const samples = values.get(operator)!;
    const means = new Map<string, number>();
    for (const [sample, list] of samples) means.set(sample, mean(list));
    sampleMeans.set(operator, means);
  }

  let ssA = 0;
  let ssBA = 0;
  let ssE = 0;
  for (const operator of operatorLabels) {
    ssA += samplesPerOperator * replicates * (operatorMeans.get(operator)! - grandMean) ** 2;
    const samples = values.get(operator)!;
    for (const [sample, list] of samples) {
      const sampleMean = sampleMeans.get(operator)!.get(sample)!;
      ssBA += replicates * (sampleMean - operatorMeans.get(operator)!) ** 2;
      for (const value of list) ssE += (value - sampleMean) ** 2;
    }
  }
  const totalSs = ssA + ssBA + ssE;
  const dfA = operators - 1;
  const dfBA = operators * (samplesPerOperator - 1);
  const dfE = operators * samplesPerOperator * (replicates - 1);
  const msA = ssA / dfA;
  const msBA = ssBA / dfBA;
  const msE = ssE / dfE;
  const fA = msBA > 0 ? msA / msBA : null;
  const fBA = msE > 0 ? msBA / msE : null;
  const pA = pFromF(fA, dfA, dfBA);
  const pBA = pFromF(fBA, dfBA, dfE);

  const rawE = msE;
  const rawBA = (msBA - msE) / replicates;
  const rawA = (msA - msBA) / (samplesPerOperator * replicates);
  const sampleDf =
    rawBA > 0
      ? satterthwaite([
          { ms: msBA, coefficient: 1 / replicates, df: dfBA },
          { ms: msE, coefficient: -1 / replicates, df: dfE },
        ])
      : null;
  const operatorDf =
    rawA > 0
      ? satterthwaite([
          {
            ms: msA,
            coefficient: 1 / (samplesPerOperator * replicates),
            df: dfA,
          },
          {
            ms: msBA,
            coefficient: -1 / (samplesPerOperator * replicates),
            df: dfBA,
          },
        ])
      : null;

  const repeatability = buildNestedComponent(
    'repeatability',
    'Repetibilidade (σ²_e)',
    rawE,
    dfE,
    'σ²_e = MS_E',
  );
  const sample = buildNestedComponent(
    'sample',
    'Amostra(operador) (σ²_B(A))',
    rawBA,
    sampleDf,
    'σ²_B(A) = max(0, (MS_B(A) − MS_E)/n)',
  );
  const operator = buildNestedComponent(
    'operator',
    'Operador (σ²_A)',
    rawA,
    operatorDf,
    'σ²_A = max(0, (MS_A − MS_B(A))/(b·n))',
  );
  const totalVariance = repeatability.variance + sample.variance + operator.variance;
  const warnings: string[] = [];
  const truncated = [sample, operator].filter((component) => component.truncated);
  if (truncated.length) {
    warnings.push(
      `Componente(s) negativo(s) truncado(s) em zero: ${truncated.map((component) => component.label).join(', ')}.`,
    );
  }
  if (dfE < 1) warnings.push('Sem graus de liberdade residuais: não é possível estimar a repetibilidade.');
  if (dfBA < 1) warnings.push('Sem graus de liberdade para amostra(operador).');
  if (replicates < 3) {
    warnings.push('Menos de 3 réplicas por amostra: a repetibilidade é estimada com poucos graus de liberdade.');
  }

  const rows: AnovaRow[] = [
    {
      source: 'Operador (A)',
      df: dfA,
      ss: ssA,
      ms: msA,
      f: fA,
      p: pA,
      eta2: totalSs > 0 ? ssA / totalSs : null,
    },
    {
      source: 'Amostra(Operador) (B(A))',
      df: dfBA,
      ss: ssBA,
      ms: msBA,
      f: fBA,
      p: pBA,
      eta2: totalSs > 0 ? ssBA / totalSs : null,
    },
    {
      source: 'Erro (réplica)',
      df: dfE,
      ss: ssE,
      ms: msE,
      f: null,
      p: null,
    },
    {
      source: 'Total',
      df: dfA + dfBA + dfE,
      ss: totalSs,
      ms: null,
      f: null,
      p: null,
    },
  ];

  const interpretations: string[] = [];
  if (pA !== null) {
    interpretations.push(
      pA < alpha
        ? `Efeito de operador significativo (F = ${fmt(fA)}, p = ${fmt(pA)} < ${fmt(alpha)}).`
        : `Sem evidência de efeito de operador (F = ${fmt(fA)}, p = ${fmt(pA)} ≥ ${fmt(alpha)}).`,
    );
  }
  if (pBA !== null) {
    interpretations.push(
      pBA < alpha
        ? `Efeito de amostra(operador) significativo (F = ${fmt(fBA)}, p = ${fmt(pBA)} < ${fmt(alpha)}); há variação de amostragem.`
        : `Sem evidência de efeito de amostra(operador) (F = ${fmt(fBA)}, p = ${fmt(pBA)} ≥ ${fmt(alpha)}).`,
    );
  }

  return {
    rows,
    totalSs,
    operators,
    samplesPerOperator,
    replicates,
    n: operators * samplesPerOperator * replicates,
    balanced: true,
    alpha,
    dfA,
    dfBA,
    dfE,
    msA,
    msBA,
    msE,
    fA,
    fBA,
    pA,
    pBA,
    components: {
      repeatability,
      sample,
      operator,
      totalVariance,
      totalSd: safeSqrt(totalVariance),
    },
    twoLevel: false,
    iso5725: null,
    method: 'ANOVA aninhada balanceada de três níveis (Operador > Amostra(Operador) > Réplica)',
    reference: REFERENCE,
    interpretation: interpretations.join(' '),
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Homogeneidade do lote                                               */
/* ------------------------------------------------------------------ */

export interface HomogeneityCheckOptions {
  labels?: readonly string[];
  /** Nível de significância; padrão 0,05. */
  alpha?: number;
  /** Justificativa registrada para prosseguir quando a homogeneidade é rejeitada. */
  justification?: string | null;
  /**
   * Limite máximo descritivo para a razão de variâncias máxima/mínima.
   * Quando omitido, usa o teste F com correção de Bonferroni.
   */
  maxVarianceRatio?: number | null;
}

export interface CochranCheck {
  statistic: number | null;
  critical: number | null;
  df: number;
  groups: number;
  rejected: boolean | null;
  pValue: number | null;
  formula: string;
  criterionText: string;
  reference: string;
  note: string;
}

export interface VarianceRatioCheck {
  statistic: number | null;
  critical: number | null;
  df1: number;
  df2: number;
  maxGroup: number | null;
  minGroup: number | null;
  pValue: number | null;
  alphaAdjusted: number;
  rejected: boolean | null;
  formula: string;
  criterionText: string;
  reference: string;
  note: string;
}

export interface HomogeneityCheckResult {
  labels: string[];
  sizes: number[];
  groupMeans: number[];
  groupVariances: number[];
  anova: AnovaResult;
  cochran: CochranCheck;
  varianceRatio: VarianceRatioCheck;
  homogeneous: boolean | null;
  verdict: Verdict;
  justificationRequired: boolean;
  justification: string | null;
  justified: boolean;
  alpha: number;
  criterionText: string;
  interpretation: string;
  warnings: string[];
  table: AnalysisTable;
}

function emptyCochran(alpha: number, groups: number, reason: string): CochranCheck {
  return {
    statistic: null,
    critical: null,
    df: 0,
    groups,
    rejected: null,
    pValue: null,
    formula: 'C = s²_máx / Σs²_i; C_crítico ≈ 1/[1 + (k−1)·F_{α/k}(ν,ν)]',
    criterionText: `C ≤ C_crítico; não avaliado (${reason}).`,
    reference: HOMOGENEITY_REFERENCE,
    note: reason,
  };
}

function emptyVarianceRatio(alpha: number, reason: string): VarianceRatioCheck {
  return {
    statistic: null,
    critical: null,
    df1: 0,
    df2: 0,
    maxGroup: null,
    minGroup: null,
    pValue: null,
    alphaAdjusted: alpha,
    rejected: null,
    formula: 'F = s²_máx / s²_mín',
    criterionText: `F ≤ F_crítico; não avaliado (${reason}).`,
    reference: HOMOGENEITY_REFERENCE,
    note: reason,
  };
}

/**
 * Verifica a homogeneidade de um lote a partir de grupos de observações
 * (por exemplo, amostras do mesmo lote). Combina:
 *  - ANOVA entre amostras (igualdade de médias);
 *  - teste de Cochran (variância máxima / soma das variâncias);
 *  - razão de variâncias máxima/mínima (F com correção de Bonferroni).
 *
 * Se a homogeneidade for rejeitada, `justificationRequired` é verdadeiro e
 * `justified` só será verdadeiro se uma justificativa não vazia for fornecida.
 */
export function homogeneityCheck(
  groups: number[][],
  options: HomogeneityCheckOptions = {},
): HomogeneityCheckResult {
  const alpha = options.alpha ?? 0.05;
  if (!(alpha > 0 && alpha < 1)) {
    throw new Error('O nível de significância α deve estar entre 0 e 1 (ex.: 0,05).');
  }
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error('A verificação de homogeneidade requer pelo menos dois grupos de observações.');
  }
  const labels = options.labels
    ? [...options.labels]
    : groups.map((_, index) => `Amostra ${index + 1}`);
  if (labels.length !== groups.length) {
    throw new Error(`labels deve ter ${groups.length} rótulos.`);
  }
  if (
    options.maxVarianceRatio !== undefined &&
    options.maxVarianceRatio !== null &&
    (!(options.maxVarianceRatio > 0) || !Number.isFinite(options.maxVarianceRatio))
  ) {
    throw new Error('O limite máximo da razão de variâncias deve ser um número positivo.');
  }

  const warnings: string[] = [];
  const cleaned: Array<{ label: string; values: number[] }> = [];
  groups.forEach((group, index) => {
    if (!Array.isArray(group)) {
      throw new Error(`O grupo ${labels[index]} deve ser uma lista de números.`);
    }
    const values: number[] = [];
    for (const value of group) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Valor inválido no grupo ${labels[index]}: ${String(value)}.`);
      }
      values.push(value);
    }
    if (values.length < 2) {
      warnings.push(`${labels[index]} tem menos de 2 observações e foi excluído da verificação.`);
      return;
    }
    cleaned.push({ label: labels[index], values });
  });

  const valid = cleaned;
  const sizes = valid.map((group) => group.values.length);
  const groupMeans = valid.map((group) => mean(group.values));
  const groupVariances = valid.map((group) => sd(group.values) ** 2);
  const anova = anovaOneWay(
    valid.map((group) => ({ name: group.label, values: group.values })),
    alpha,
  );

  const k = valid.length;
  const balanced = sizes.length > 1 && sizes.every((size) => size === sizes[0]);
  if (!balanced && sizes.length > 1) {
    warnings.push('Grupos com tamanhos diferentes: Cochran e razão de variâncias usam o menor n−1 de forma conservadora.');
  }
  if (sizes.some((size) => size < 3)) {
    warnings.push('Grupos com n < 3: os testes de homogeneidade têm poder baixo.');
  }
  if (k < 3) {
    warnings.push('Menos de 3 grupos: a avaliação de homogeneidade é limitada.');
  }

  let cochran = emptyCochran(alpha, k, 'dados insuficientes');
  let varianceRatio = emptyVarianceRatio(alpha, 'dados insuficientes');

  if (k >= 2) {
    const df = Math.min(...sizes) - 1;
    const varianceSum = groupVariances.reduce((sum, variance) => sum + variance, 0);
    if (df >= 1 && varianceSum > 0) {
      const maxVariance = Math.max(...groupVariances);
      const statistic = maxVariance / varianceSum;
      const critical = 1 / (1 + (k - 1) * fInv(alpha / k, df, df));
      const rejected = Number.isFinite(critical) ? statistic > critical : null;
      cochran = {
        statistic,
        critical: Number.isFinite(critical) ? critical : null,
        df,
        groups: k,
        rejected,
        pValue: null,
        formula: 'C = s²_máx / Σs²_i; C_crítico ≈ 1/[1 + (k−1)·F_{α/k}(ν,ν)]',
        criterionText:
          critical > 0
            ? `C ≤ ${fmt(critical)} conforme; C > ${fmt(critical)} não conforme`
            : 'C ≤ C_crítico; não avaliado',
        reference: HOMOGENEITY_REFERENCE,
        note:
          'Aproximação conservadora de Wilrich para o valor crítico; p não é reportado pelo teste de Cochran. Sensível à não normalidade.',
      };
      if (!balanced) {
        cochran.note += ' Tamanhos desiguais: usado ν = menor n−1.';
      }
    } else {
      cochran = emptyCochran(alpha, k, varianceSum === 0 ? 'todas as variâncias são nulas' : 'graus de liberdade insuficientes');
    }

    const pairs = (k * (k - 1)) / 2;
    const alphaAdjusted = alpha / pairs;
    const maxIndex = groupVariances.indexOf(Math.max(...groupVariances));
    const minIndex = groupVariances.indexOf(Math.min(...groupVariances));
    const maxVariance = groupVariances[maxIndex];
    const minVariance = groupVariances[minIndex];
    const df1 = sizes[maxIndex] - 1;
    const df2 = sizes[minIndex] - 1;
    if (maxVariance > 0 && df1 >= 1 && df2 >= 1) {
      const statistic = minVariance > 0 ? maxVariance / minVariance : Infinity;
      const pValue =
        statistic === Infinity
          ? 0
          : Math.min(1, 2 * Math.min(fCdf(statistic, df1, df2), 1 - fCdf(statistic, df1, df2)));
      if (options.maxVarianceRatio !== null && options.maxVarianceRatio !== undefined) {
        if (!(options.maxVarianceRatio > 0) || !Number.isFinite(options.maxVarianceRatio)) {
          throw new Error('O limite máximo da razão de variâncias deve ser um número positivo.');
        }
        varianceRatio = {
          statistic,
          critical: options.maxVarianceRatio,
          df1,
          df2,
          maxGroup: maxIndex + 1,
          minGroup: minIndex + 1,
          pValue,
          alphaAdjusted,
          rejected: statistic > options.maxVarianceRatio,
          formula: 'R = s²_máx / s²_mín',
          criterionText: `R ≤ ${fmt(options.maxVarianceRatio)} conforme; R > ${fmt(options.maxVarianceRatio)} não conforme`,
          reference: HOMOGENEITY_REFERENCE,
          note: 'Limite máximo de razão de variâncias definido pelo usuário.',
        };
      } else {
        const critical = fInv(1 - alphaAdjusted / 2, df1, df2);
        const rejected = statistic === Infinity ? true : pValue < alphaAdjusted;
        varianceRatio = {
          statistic,
          critical: Number.isFinite(critical) ? critical : null,
          df1,
          df2,
          maxGroup: maxIndex + 1,
          minGroup: minIndex + 1,
          pValue,
          alphaAdjusted,
          rejected: Number.isFinite(critical) ? rejected : null,
          formula: 'F = s²_máx / s²_mín',
          criterionText:
            critical > 0
              ? `F ≤ ${fmt(critical)} conforme (α ajustado = ${fmt(alphaAdjusted)}); F > ${fmt(critical)} não conforme`
              : 'F ≤ F_crítico; não avaliado',
          reference: HOMOGENEITY_REFERENCE,
          note:
            'Razão entre a maior e a menor variância, selecionadas após inspeção; correção de Bonferroni sobre todos os pares.',
        };
      }
    } else {
      varianceRatio = emptyVarianceRatio(alpha, 'variâncias ou graus de liberdade insuficientes');
    }
  }

  const anovaP = anova.rows[0]?.p ?? null;
  const anovaRejected = anovaP !== null ? anovaP < alpha : null;
  const decisions = [anovaRejected, cochran.rejected, varianceRatio.rejected];
  const anyRejected = decisions.some((decision) => decision === true);
  const allEvaluated = decisions.every((decision) => decision !== null);
  const homogeneous = anyRejected ? false : allEvaluated ? true : null;
  const justification = options.justification?.trim() ? options.justification.trim() : null;
  const justificationRequired = homogeneous === false;
  const justified = !justificationRequired || justification !== null;
  const verdict: Verdict =
    homogeneous === true ? 'pass' : homogeneous === false ? 'fail' : 'not_evaluated';

  if (homogeneous === false) {
    warnings.push(
      justification
        ? 'Homogeneidade do lote rejeitada; prosseguindo com justificativa registrada.'
        : 'Homogeneidade do lote rejeitada: é obrigatório registrar uma justificativa para prosseguir.',
    );
  }
  if (homogeneous === null) {
    warnings.push('Homogeneidade do lote não avaliada por falta de dados ou de um dos testes.');
  }

  const interpretation =
    homogeneous === true
      ? 'Não há evidência de heterogeneidade: ANOVA entre amostras, Cochran e razão de variâncias não rejeitam a homogeneidade do lote.'
      : homogeneous === false
        ? 'Há evidência de heterogeneidade do lote; a repetibilidade pode estar contaminada pela variação entre amostras/corpos de prova.'
        : 'Homogeneidade do lote não avaliada; interprete a repetibilidade com cautela.';

  const anovaCritical =
    anova.dfError > 0 && anova.rows.length > 0
      ? fInv(1 - alpha, anova.rows[0].df, anova.dfError)
      : null;
  const table: AnalysisTable = {
    title: 'Homogeneidade do lote',
    columns: ['Teste', 'Estatística', 'gl', 'Valor crítico', 'p', 'Decisão'],
    rows: [
      [
        'ANOVA entre amostras (médias)',
        round6(anova.rows[0]?.f ?? null) ?? '—',
        `${anova.rows[0]?.df ?? '—'} / ${anova.dfError || '—'}`,
        round6(anovaCritical) ?? '—',
        formatP(anovaP),
        anovaRejected === null ? 'não avaliado' : anovaRejected ? 'rejeita' : 'não rejeita',
      ],
      [
        'Cochran (variâncias)',
        round6(cochran.statistic) ?? '—',
        cochran.df || '—',
        round6(cochran.critical) ?? '—',
        '—',
        cochran.rejected === null ? 'não avaliado' : cochran.rejected ? 'rejeita' : 'não rejeita',
      ],
      [
        'Razão de variâncias máx/mín',
        round6(varianceRatio.statistic) ?? '—',
        `${varianceRatio.df1 || '—'} / ${varianceRatio.df2 || '—'}`,
        round6(varianceRatio.critical) ?? '—',
        formatP(varianceRatio.pValue),
        varianceRatio.rejected === null
          ? 'não avaliado'
          : varianceRatio.rejected
            ? 'rejeita'
            : 'não rejeita',
      ],
    ],
    note: `ANOVA: F = MS_entre/MS_dentro. Cochran: C = s²_máx/Σs²; C_crítico ≈ 1/[1+(k−1)·F_{α/k}(ν,ν)]. Razão: F = s²_máx/s²_mín com correção de Bonferroni. ${HOMOGENEITY_REFERENCE}`,
  };

  return {
    labels: valid.map((group) => group.label),
    sizes,
    groupMeans,
    groupVariances,
    anova,
    cochran,
    varianceRatio,
    homogeneous,
    verdict,
    justificationRequired,
    justification,
    justified,
    alpha,
    criterionText: `ANOVA p ≥ ${fmt(alpha)}, Cochran C ≤ C_crítico e razão de variâncias ≤ F_crítico`,
    interpretation,
    warnings: [...new Set(warnings)],
    table,
  };
}

/* ------------------------------------------------------------------ */
/* Gage R&R aninhado / destrutivo                                      */
/* ------------------------------------------------------------------ */

export type GageRRNestedValue = number | null | undefined;
export type GageRRNestedMatrix = ReadonlyArray<
  ReadonlyArray<ReadonlyArray<GageRRNestedValue>>
>;

export interface GageRRNestedInput {
  /** y[operador][amostra][réplica]; valores nulos não são aceitos. */
  y: GageRRNestedMatrix;
  tolerance?: number | null;
  k?: number;
  operatorLabels?: readonly string[];
  /** Rótulos das amostras por operador: sampleLabels[operador][amostra]. */
  sampleLabels?: ReadonlyArray<ReadonlyArray<string>>;
}

export interface NestedHomogeneityInput {
  groups: number[][];
  labels?: readonly string[];
  alpha?: number;
  justification?: string | null;
  maxVarianceRatio?: number | null;
}

export interface GageRRNestedOptions {
  /** Nível de confiança dos ICs; padrão 0,95. */
  confidence?: number;
  /** Nível de significância dos testes ANOVA/homogeneidade; padrão 0,05. */
  alpha?: number;
  /** Limites editáveis de aceitação. */
  criteria?: Partial<GageRRCriteria>;
  /** Unidade das medições, apenas para exibição. */
  unit?: string;
  /** Dados de homogeneidade do lote ou resultado já calculado. */
  homogeneity?: NestedHomogeneityInput | HomogeneityCheckResult | null;
}

export interface GageRRNestedComponent {
  key: 'repeatability' | 'sample' | 'operator' | 'grr' | 'total';
  label: string;
  variance: number;
  standardDeviation: number;
  contributionPct: number | null;
  studyVariationPct: number | null;
  rawVariance: number | null;
  truncated: boolean;
  /** Falso quando o componente não é separável (b = 1 para a amostra). */
  estimable: boolean;
  df: number | null;
  formula: string;
  criterionText: string;
  verdict: Verdict;
  interval: GageRRConfidenceInterval | null;
}

export interface GageRRNestedMetric {
  key: 'sigma_grr' | 'grr_pct' | 'pt_pct' | 'ndc';
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  criterionText: string;
  verdict: Verdict;
  interval: GageRRConfidenceInterval | null;
  reference: string;
}

export interface GageRRNestedResult {
  n: number;
  operators: number;
  samplesPerOperator: number;
  replicates: number;
  cells: number;
  balanced: boolean;
  tolerance: number | null;
  k: number;
  confidence: number;
  alpha: number;
  anova: NestedAnovaResult;
  components: GageRRNestedComponent[];
  metrics: GageRRNestedMetric[];
  rawMetrics: Record<string, number | null>;
  intervals: {
    sigmaGrr: GageRRConfidenceInterval | null;
    grrPct: GageRRConfidenceInterval | null;
    ptPct: GageRRConfidenceInterval | null;
  };
  ndc: number | null;
  tables: AnalysisTable[];
  charts: AnalysisChart[];
  warnings: string[];
  notes: string[];
  summary: string;
  verdict: Verdict;
  criteria: GageRRCriteria;
  destructiveWarning: string;
  homogeneity: HomogeneityCheckResult | null;
  justificationRequired: boolean;
  justification: string | null;
  justified: boolean;
  method: string;
  reference: string;
}

interface NestedData {
  operators: number;
  samplesPerOperator: number;
  replicates: number;
  operatorLabels: string[];
  sampleLabels: string[][];
  observations: NestedObservation[];
  cells: Array<{
    operator: string;
    sample: string;
    values: number[];
    mean: number;
    sd: number;
    range: number;
  }>;
}

function extractNestedMatrix(input: GageRRNestedInput): NestedData {
  const y = input.y;
  if (!Array.isArray(y) || y.length < 2) {
    throw new Error('Gage R&R aninhado requer pelo menos 2 operadores (y[operador][amostra][réplica]).');
  }
  const operators = y.length;
  const samplesPerOperator = y[0]?.length ?? 0;
  if (samplesPerOperator < 1) {
    throw new Error('Gage R&R aninhado requer pelo menos 1 amostra por operador.');
  }
  const replicates = y[0]?.[0]?.length ?? 0;
  if (replicates < 2) {
    throw new Error(
      'Gage R&R aninhado requer pelo menos 2 réplicas (corpos de prova) por amostra; r = 1 não permite estimar a repetibilidade.',
    );
  }
  const operatorLabels = input.operatorLabels
    ? [...input.operatorLabels]
    : Array.from({ length: operators }, (_, index) => `Operador ${index + 1}`);
  if (operatorLabels.length !== operators) {
    throw new Error(`operatorLabels deve ter ${operators} rótulos.`);
  }
  if (input.sampleLabels && input.sampleLabels.length !== operators) {
    throw new Error(`sampleLabels deve ter ${operators} listas (uma por operador).`);
  }
  const sampleLabels: string[][] = [];
  const observations: NestedObservation[] = [];
  const cells: NestedData['cells'] = [];

  for (let i = 0; i < operators; i++) {
    if (!Array.isArray(y[i]) || y[i].length !== samplesPerOperator) {
      throw new Error(
        `Formato inválido: o operador ${i + 1} deve ter ${samplesPerOperator} amostras, mas tem ${y[i]?.length ?? 0}.`,
      );
    }
    const labelsForOperator = input.sampleLabels
      ? [...input.sampleLabels[i]]
      : Array.from({ length: samplesPerOperator }, (_, index) => `A${index + 1}`);
    if (labelsForOperator.length !== samplesPerOperator) {
      throw new Error(`sampleLabels[${i}] deve ter ${samplesPerOperator} rótulos.`);
    }
    sampleLabels.push(labelsForOperator);
    for (let j = 0; j < samplesPerOperator; j++) {
      if (!Array.isArray(y[i][j]) || y[i][j].length !== replicates) {
        throw new Error(
          `Formato inválido: y[${i}][${j}] deve ter ${replicates} réplicas, mas tem ${y[i][j]?.length ?? 0}.`,
        );
      }
      const values: number[] = [];
      for (let k = 0; k < replicates; k++) {
        const value = y[i][j][k];
        if (value === null || value === undefined) {
          throw new Error(
            `Dados faltantes em y[${i}][${j}][${k}]: o delineamento aninhado destrutivo exige células completas.`,
          );
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`Valor inválido em y[${i}][${j}][${k}]: ${String(value)}.`);
        }
        values.push(value);
        observations.push({
          operator: operatorLabels[i],
          sample: labelsForOperator[j],
          replicate: k + 1,
          value,
        });
      }
      cells.push({
        operator: operatorLabels[i],
        sample: labelsForOperator[j],
        values,
        mean: mean(values),
        sd: sd(values),
        range: Math.max(...values) - Math.min(...values),
      });
    }
  }

  return {
    operators,
    samplesPerOperator,
    replicates,
    operatorLabels,
    sampleLabels,
    observations,
    cells,
  };
}

function nestedDegreesOfFreedom(anova: NestedAnovaResult): {
  sample: number | null;
  operator: number | null;
  grr: number | null;
} {
  const { replicates: n, samplesPerOperator: b, dfA, dfBA, dfE, msA, msBA, msE } = anova;
  if (anova.twoLevel || b === 1) {
    return {
      sample: null,
      operator:
        anova.components.operator.variance > 0
          ? satterthwaite([
              { ms: msA, coefficient: 1 / n, df: dfA },
              { ms: msE, coefficient: -1 / n, df: dfE },
            ])
          : null,
      grr:
        anova.components.repeatability.variance + anova.components.operator.variance > 0
          ? satterthwaite([
              { ms: msA, coefficient: 1 / n, df: dfA },
              { ms: msE, coefficient: 1 - 1 / n, df: dfE },
            ])
          : null,
    };
  }
  if (msBA === null) {
    return { sample: null, operator: null, grr: null };
  }
  return {
    sample:
      anova.components.sample.variance > 0
        ? satterthwaite([
            { ms: msBA, coefficient: 1 / n, df: dfBA },
            { ms: msE, coefficient: -1 / n, df: dfE },
          ])
        : null,
    operator:
      anova.components.operator.variance > 0
        ? satterthwaite([
            { ms: msA, coefficient: 1 / (b * n), df: dfA },
            { ms: msBA, coefficient: -1 / (b * n), df: dfBA },
          ])
        : null,
    grr:
      anova.components.repeatability.variance + anova.components.operator.variance > 0
        ? satterthwaite([
            { ms: msA, coefficient: 1 / (b * n), df: dfA },
            { ms: msE, coefficient: 1, df: dfE },
            { ms: msBA, coefficient: -1 / (b * n), df: dfBA },
          ])
        : null,
  };
}

function componentTable(components: GageRRNestedComponent[]): AnalysisTable {
  return {
    title: 'Componentes de variância e contribuições',
    columns: [
      'Componente',
      'Variância',
      'Desvio-padrão',
      '% contribuição',
      '% variação do estudo',
      'Fórmula',
      'Critério',
      'Veredito',
      'Observação',
    ],
    rows: components.map((component) => [
      component.label,
      round6(component.variance) ?? '—',
      round6(component.standardDeviation) ?? '—',
      round6(component.contributionPct) ?? '—',
      round6(component.studyVariationPct) ?? '—',
      component.formula,
      component.criterionText,
      verdictLabel(component.verdict),
      component.truncated
        ? 'truncado em zero'
        : !component.estimable
          ? 'não estimável'
          : '—',
    ]),
    note: '% contribuição = 100·variância/total; % variação do estudo = 100·desvio/total. A segunda coluna não soma 100%. Em ensaio destrutivo, a repetibilidade inclui a variação entre corpos de prova.',
  };
}

function intervalTable(
  components: GageRRNestedComponent[],
  intervals: GageRRNestedResult['intervals'],
  metrics: GageRRNestedMetric[],
): AnalysisTable {
  const rows: Array<Array<string | number>> = [];
  const grrSd = components.find((component) => component.key === 'grr')?.standardDeviation ?? null;
  const grrPct = metrics.find((metric) => metric.key === 'grr_pct')?.value ?? null;
  const ptPct = metrics.find((metric) => metric.key === 'pt_pct')?.value ?? null;
  if (intervals.sigmaGrr) {
    rows.push([
      'σ_GRR',
      round6(grrSd) ?? '—',
      round6(intervals.sigmaGrr.df) ?? '—',
      round6(intervals.sigmaGrr.lower) ?? '—',
      round6(intervals.sigmaGrr.upper) ?? '—',
      `${fmt(intervals.sigmaGrr.confidence * 100)}%`,
    ]);
  }
  if (intervals.grrPct) {
    rows.push([
      '%GRR',
      round6(grrPct) ?? '—',
      `${round6(intervals.grrPct.df) ?? '—'} / ${round6(intervals.grrPct.df2) ?? '—'}`,
      round6(intervals.grrPct.lower) ?? '—',
      round6(intervals.grrPct.upper) ?? '—',
      `${fmt(intervals.grrPct.confidence * 100)}%`,
    ]);
  }
  if (intervals.ptPct) {
    rows.push([
      '%P/T',
      round6(ptPct) ?? '—',
      round6(intervals.ptPct.df) ?? '—',
      round6(intervals.ptPct.lower) ?? '—',
      round6(intervals.ptPct.upper) ?? '—',
      `${fmt(intervals.ptPct.confidence * 100)}%`,
    ]);
  }
  return {
    title: 'Intervalos de confiança (Satterthwaite)',
    columns: ['Métrica', 'Estimativa', 'gl efetivos', 'IC inferior', 'IC superior', 'Confiança'],
    rows,
    note: `IC de σ_GRR por χ²; IC de %GRR pela razão de variâncias GRR/amostra com quantis F. ${CI_REFERENCE}`,
  };
}

function anovaTable(rows: AnovaRow[], twoLevel: boolean): AnalysisTable {
  return {
    title: twoLevel
      ? 'ANOVA aninhada de dois níveis (ISO 5725-2)'
      : 'ANOVA aninhada de três níveis',
    columns: ['Fonte', 'gl', 'SS', 'MS', 'F', 'p'],
    rows: rows.map((row) => [
      row.source,
      row.df,
      round6(row.ss) ?? '—',
      round6(row.ms) ?? '—',
      round6(row.f) ?? '—',
      formatP(row.p),
    ]),
    note: twoLevel
      ? 'Operador > Réplica: σ²_B(A) não é separável; resultado delegado ao ISO 5725-2.'
      : 'Operador > Amostra(Operador) > Réplica. F_A = MS_A/MS_B(A); F_B(A) = MS_B(A)/MS_E.',
  };
}

function sampleTable(data: NestedData): AnalysisTable {
  return {
    title: 'Resumo por operador e amostra',
    columns: ['Operador', 'Amostra', 'n', 'Média', 'Desvio-padrão', 'Amplitude'],
    rows: data.cells.map((cell) => [
      cell.operator,
      cell.sample,
      cell.values.length,
      round6(cell.mean) ?? '—',
      round6(cell.sd) ?? '—',
      round6(cell.range) ?? '—',
    ]),
    note: 'Desvio-padrão amostral (n − 1); amplitude = máximo − mínimo. Cada réplica é um corpo de prova distinto.',
  };
}

function buildCharts(data: NestedData): AnalysisChart[] {
  const means: AnalysisChart = {
    kind: 'line',
    title: 'Médias por operador × amostra',
    xLabel: 'Amostra',
    yLabel: 'Média',
    data: [],
  };
  const ranges: AnalysisChart = {
    kind: 'bar',
    title: 'Amplitude por operador × amostra',
    xLabel: 'Amostra',
    yLabel: 'Amplitude',
    data: [],
  };
  for (const cell of data.cells) {
    const label = `${cell.operator} × ${cell.sample}`;
    means.data.push({
      part: cell.sample,
      operator: cell.operator,
      cell: label,
      mean: round6(cell.mean),
      n: cell.values.length,
    });
    ranges.data.push({
      part: cell.sample,
      operator: cell.operator,
      cell: label,
      range: round6(cell.range),
      n: cell.values.length,
    });
  }
  return [means, ranges];
}

function overallVerdict(metrics: GageRRNestedMetric[]): Verdict {
  const primary = metrics.filter(
    (metric) => metric.key === 'grr_pct' || metric.key === 'pt_pct' || metric.key === 'ndc',
  );
  const evaluated = primary.filter((metric) => metric.verdict !== 'not_evaluated');
  if (evaluated.length === 0) return 'not_evaluated';
  if (evaluated.some((metric) => metric.verdict === 'fail')) return 'fail';
  if (evaluated.some((metric) => metric.verdict === 'warning')) return 'warning';
  if (evaluated.every((metric) => metric.verdict === 'pass')) return 'pass';
  return 'not_evaluated';
}

function buildSummary(
  metrics: GageRRNestedMetric[],
  tolerance: number | null,
  verdict: Verdict,
): string {
  const grr = metrics.find((metric) => metric.key === 'grr_pct');
  const pt = metrics.find((metric) => metric.key === 'pt_pct');
  const ndc = metrics.find((metric) => metric.key === 'ndc');
  const grrText =
    grr && grr.value !== null
      ? `${fmt(grr.value)}% (${verdictLabel(grr.verdict)})`
      : 'não avaliado';
  const ptText =
    tolerance === null
      ? 'não avaliado (T não informado)'
      : pt && pt.value !== null
        ? `${fmt(pt.value)}% (${verdictLabel(pt.verdict)})`
        : 'não avaliado';
  const ndcText =
    ndc && ndc.value !== null
      ? `${fmt(ndc.value)} (${verdictLabel(ndc.verdict)})`
      : 'não avaliado';
  return `Gage R&R aninhado: %GRR = ${grrText}; %P/T = ${ptText}; ndc = ${ndcText}. Veredito global: ${verdictLabel(verdict)}. ${NESTED_DESTRUCTIVE_WARNING}`;
}

/**
 * Executa o estudo Gage R&R aninhado para ensaio destrutivo.
 *
 * A entrada é `y[operador][amostra][réplica]`, com réplicas formadas por
 * corpos de prova distintos. σ²_GRR = σ²_e + σ²_A; a componente entre
 * amostras é reportada separadamente como variação de amostragem.
 */
export function gageRRNested(
  input: GageRRNestedInput,
  options: GageRRNestedOptions = {},
): GageRRNestedResult {
  const tolerance =
    input.tolerance === null || input.tolerance === undefined ? null : input.tolerance;
  if (tolerance !== null && (!Number.isFinite(tolerance) || tolerance <= 0)) {
    throw new Error('A tolerância T = USL − LSL deve ser um número positivo.');
  }
  const k = input.k ?? 6;
  if (!Number.isFinite(k) || k <= 0) {
    throw new Error('O multiplicador k de %P/T deve ser um número positivo.');
  }
  const confidence = options.confidence ?? 0.95;
  if (!(confidence > 0 && confidence < 1)) {
    throw new Error('A confiança deve estar entre 0 e 1 (ex.: 0,95).');
  }
  const alpha = options.alpha ?? 0.05;
  if (!(alpha > 0 && alpha < 1)) {
    throw new Error('O nível de significância α deve estar entre 0 e 1 (ex.: 0,05).');
  }
  const criteria = normalizeCriteria(options.criteria);
  const data = extractNestedMatrix(input);
  const anova = anovaNested(data.observations, { alpha });
  const dfs = nestedDegreesOfFreedom(anova);
  const repVariance = anova.components.repeatability.variance;
  const sampleVariance = anova.components.sample.variance;
  const operatorVariance = anova.components.operator.variance;
  const grrVariance = repVariance + operatorVariance;
  const totalVariance = grrVariance + sampleVariance;
  const totalSd = safeSqrt(totalVariance);
  const sigmaGrr = safeSqrt(grrVariance);
  const grrPct = totalVariance > 0 ? (100 * sigmaGrr) / totalSd : null;
  const ptPct = tolerance !== null ? (100 * k * sigmaGrr) / tolerance : null;
  const ndc =
    grrVariance > 0
      ? sampleVariance > 0
        ? Math.floor((1.41 * safeSqrt(sampleVariance)) / sigmaGrr)
        : 0
      : null;

  const sampleLabel = anova.twoLevel
    ? 'Amostra(operador) — não estimável (b = 1)'
    : 'Amostra(operador) — variação de amostragem (σ²_amostra)';
  const drafts: Array<{
    key: GageRRNestedComponent['key'];
    label: string;
    variance: number;
    rawVariance: number | null;
    truncated: boolean;
    estimable: boolean;
    df: number | null;
    formula: string;
  }> = [
    {
      key: 'repeatability',
      label: 'Repetibilidade (σ²_e)',
      variance: repVariance,
      rawVariance: repVariance,
      truncated: false,
      estimable: true,
      df: anova.dfE,
      formula: 'σ²_e = MS_E',
    },
    {
      key: 'sample',
      label: sampleLabel,
      variance: sampleVariance,
      rawVariance: anova.components.sample.rawVariance,
      truncated: anova.components.sample.truncated,
      estimable: !anova.twoLevel,
      df: dfs.sample,
      formula: anova.twoLevel
        ? 'σ²_amostra não estimável com b = 1'
        : 'σ²_amostra = max(0, (MS_B(A) − MS_E)/n)',
    },
    {
      key: 'operator',
      label: 'Reprodutibilidade (σ²_oper)',
      variance: operatorVariance,
      rawVariance: anova.components.operator.rawVariance,
      truncated: anova.components.operator.truncated,
      estimable: true,
      df: dfs.operator,
      formula: anova.twoLevel
        ? 'σ²_oper = max(0, (MS_A − MS_E)/n)'
        : 'σ²_oper = max(0, (MS_A − MS_B(A))/(b·n))',
    },
    {
      key: 'grr',
      label: 'Gage R&R (σ²_GRR)',
      variance: grrVariance,
      rawVariance: repVariance + anova.components.operator.rawVariance,
      truncated: repVariance + anova.components.operator.rawVariance < 0,
      estimable: true,
      df: dfs.grr,
      formula: 'σ²_GRR = σ²_e + σ²_oper',
    },
    {
      key: 'total',
      label: 'Total (σ²_total)',
      variance: totalVariance,
      rawVariance: totalVariance,
      truncated: false,
      estimable: true,
      df: null,
      formula: 'σ²_total = σ²_GRR + σ²_amostra',
    },
  ];

  const components: GageRRNestedComponent[] = drafts.map((draft) => {
    const standardDeviation = safeSqrt(draft.variance);
    return {
      key: draft.key,
      label: draft.label,
      variance: draft.variance,
      standardDeviation,
      contributionPct: totalVariance > 0 ? (100 * draft.variance) / totalVariance : null,
      studyVariationPct: totalSd > 0 ? (100 * standardDeviation) / totalSd : null,
      rawVariance: draft.rawVariance,
      truncated: draft.truncated,
      estimable: draft.estimable,
      df: draft.df,
      formula: draft.formula,
      criterionText: 'Sem critério cadastrado; componente descritivo.',
      verdict: 'not_evaluated',
      interval: chiSquareSdInterval(draft.variance, draft.df, confidence),
    };
  });

  const intervals = {
    sigmaGrr: chiSquareSdInterval(grrVariance, dfs.grr, confidence),
    grrPct: ratioPctInterval(grrVariance, sampleVariance, dfs.grr, dfs.sample, confidence),
    ptPct:
      tolerance !== null && grrVariance > 0
        ? (() => {
            const base = chiSquareSdInterval(grrVariance, dfs.grr, confidence);
            if (!base) return null;
            return {
              lower: (100 * k * base.lower) / tolerance,
              upper: (100 * k * base.upper) / tolerance,
              df: base.df,
              confidence,
              method: 'Satterthwaite (derivado de σ_GRR)',
            };
          })()
        : null,
  };

  const grrVerdict = classifyMax(grrPct, criteria.grrAccept, criteria.grrWarning);
  const ptVerdict =
    tolerance === null ? 'not_evaluated' : classifyMax(ptPct, criteria.ptAccept, criteria.ptWarning);
  const ndcVerdict = classifyMin(ndc, criteria.ndcMin);
  const unit = options.unit ?? '';
  const sigmaMetric: GageRRNestedMetric = {
    key: 'sigma_grr',
    label: 'Desvio-padrão do Gage R&R (σ_GRR)',
    value: grrVariance > 0 ? sigmaGrr : grrVariance === 0 ? 0 : null,
    unit,
    formula: 'σ_GRR = √(σ²_e + σ²_oper)',
    criterionText: 'Sem critério direto; avaliado por %GRR e %P/T.',
    verdict: 'not_evaluated',
    interval: intervals.sigmaGrr,
    reference: CI_REFERENCE,
  };
  const grrMetric: GageRRNestedMetric = {
    key: 'grr_pct',
    label: '%GRR (variação do estudo)',
    value: grrPct,
    unit: '%',
    formula: '%GRR = 100·σ_GRR/σ_total = 100·√(σ²_GRR/σ²_total)',
    criterionText: maxCriterionText('%GRR', criteria.grrAccept, criteria.grrWarning),
    verdict: grrVerdict,
    interval: intervals.grrPct,
    reference: REFERENCE,
  };
  const ptCriterion = maxCriterionText('%P/T', criteria.ptAccept, criteria.ptWarning);
  const ptMetric: GageRRNestedMetric = {
    key: 'pt_pct',
    label: '%P/T (variação vs. tolerância)',
    value: ptPct,
    unit: '%',
    formula: '%P/T = 100·k·σ_GRR/T, com T = USL − LSL',
    criterionText: tolerance === null ? `${ptCriterion} (T não informado)` : ptCriterion,
    verdict: ptVerdict,
    interval: intervals.ptPct,
    reference: REFERENCE,
  };
  const ndcMetric: GageRRNestedMetric = {
    key: 'ndc',
    label: 'Número de categorias distintas (ndc)',
    value: ndc,
    unit: '',
    formula: 'ndc = floor(1,41·σ_amostra/σ_GRR)',
    criterionText: `ndc ≥ ${fmt(criteria.ndcMin)}`,
    verdict: ndcVerdict,
    interval: null,
    reference: REFERENCE,
  };
  const metrics: GageRRNestedMetric[] = [sigmaMetric, grrMetric, ptMetric, ndcMetric];
  const verdict = overallVerdict(metrics);

  let homogeneity: HomogeneityCheckResult | null = null;
  if (options.homogeneity) {
    if ('groups' in options.homogeneity && Array.isArray(options.homogeneity.groups)) {
      homogeneity = homogeneityCheck(options.homogeneity.groups, {
        labels: options.homogeneity.labels,
        alpha: options.homogeneity.alpha ?? alpha,
        justification: options.homogeneity.justification,
        maxVarianceRatio: options.homogeneity.maxVarianceRatio,
      });
    } else {
      homogeneity = options.homogeneity as HomogeneityCheckResult;
    }
    if (homogeneity.homogeneous === false && !homogeneity.justified) {
      throw new Error(
        'Homogeneidade do lote rejeitada. Registre uma justificativa técnica na etapa Análise antes de prosseguir.',
      );
    }
  }

  const warnings: string[] = [NESTED_DESTRUCTIVE_WARNING];
  const notes: string[] = [];
  if (anova.twoLevel) {
    warnings.push(
      'Com b = 1, σ²_amostra não é estimável; o modelo de dois níveis do ISO 5725-2 foi usado e σ²_GRR = s_r² + s_L².',
    );
  }
  const truncated = components
    .filter((component) => component.truncated)
    .map((component) => component.label);
  if (truncated.length) {
    warnings.push(`Componente(s) negativo(s) truncado(s) em zero: ${truncated.join(', ')}.`);
  }
  if (tolerance === null) {
    warnings.push('%P/T não avaliado: T = USL − LSL não informado.');
  }
  if (totalVariance <= 0) {
    warnings.push('Variância total nula; %GRR, %P/T e ndc não definidos.');
  } else if (grrVariance <= 0) {
    warnings.push('σ_GRR = 0; ndc não definido (tende ao infinito) e IC de %GRR não estimável.');
  } else if (sampleVariance <= 0) {
    warnings.push('σ_amostra = 0; ndc = 0 e IC de %GRR não estimável.');
  } else if (intervals.grrPct === null) {
    warnings.push('Intervalo de %GRR não estimável com os graus de liberdade disponíveis.');
  }
  if (!homogeneity) {
    warnings.push(
      'Homogeneidade do lote não avaliada: informe os grupos de amostras do lote para verificar a validade da repetibilidade.',
    );
  } else if (homogeneity.homogeneous === false) {
    warnings.push(
      `Homogeneidade do lote rejeitada; justificativa registrada: ${homogeneity.justification ?? '—'}.`,
    );
  } else if (homogeneity.homogeneous === null) {
    warnings.push('Homogeneidade do lote não avaliada por dados insuficientes.');
  }

  notes.push('Modelo aninhado: Operador > Amostra(Operador) > Réplica; componentes estimados pelo método dos momentos.');
  notes.push('σ²_GRR = σ²_e + σ²_oper. A componente entre amostras é reportada separadamente como variação de amostragem e não compõe σ²_GRR.');
  notes.push('Em ensaio destrutivo cada réplica é um corpo de prova distinto; a repetibilidade inclui a variação entre corpos de prova.');
  notes.push('ICs por Satterthwaite para σ_GRR, %GRR e %P/T; o IC de %GRR usa a razão de variâncias GRR/amostra e quantis F.');
  notes.push('Premissas: delineamento balanceado, componentes aleatórios, resíduos normais e independentes, amostras homogêneas dentro do lote.');
  if (homogeneity) {
    notes.push(`Homogeneidade do lote: ${homogeneity.interpretation}`);
  }

  const tables: AnalysisTable[] = [
    anovaTable(anova.rows, anova.twoLevel),
    sampleTable(data),
    componentTable(components),
    intervalTable(components, intervals, metrics),
  ];
  if (homogeneity) tables.push(homogeneity.table);

  const rawMetrics: Record<string, number | null> = {
    sigma_grr: sigmaMetric.value,
    grr_pct: grrPct,
    pt_pct: ptPct,
    ndc,
    variance_repeatability: repVariance,
    variance_sample: sampleVariance,
    variance_operator: operatorVariance,
    variance_grr: grrVariance,
    variance_total: totalVariance,
    contribution_grr: totalVariance > 0 ? (100 * grrVariance) / totalVariance : null,
    contribution_sample: totalVariance > 0 ? (100 * sampleVariance) / totalVariance : null,
    contribution_operator: totalVariance > 0 ? (100 * operatorVariance) / totalVariance : null,
    df_grr: dfs.grr,
    df_sample: dfs.sample,
    df_operator: dfs.operator,
    n_eff: anova.n,
    tolerance,
    k,
    homogeneity_rejected:
      homogeneity === null || homogeneity.homogeneous === null
        ? null
        : homogeneity.homogeneous
          ? 0
          : 1,
    homogeneity_justified: homogeneity === null ? null : homogeneity.justified ? 1 : 0,
  };

  return {
    n: anova.n,
    operators: data.operators,
    samplesPerOperator: data.samplesPerOperator,
    replicates: data.replicates,
    cells: data.cells.length,
    balanced: anova.balanced,
    tolerance,
    k,
    confidence,
    alpha,
    anova,
    components,
    metrics,
    rawMetrics,
    intervals,
    ndc,
    tables,
    charts: buildCharts(data),
    warnings: [...new Set(warnings)],
    notes,
    summary: buildSummary(metrics, tolerance, verdict),
    verdict,
    criteria,
    destructiveWarning: NESTED_DESTRUCTIVE_WARNING,
    homogeneity,
    justificationRequired: homogeneity?.justificationRequired ?? false,
    justification: homogeneity?.justification ?? null,
    justified: homogeneity ? homogeneity.justified : true,
    method: anova.method,
    reference: REFERENCE,
  };
}

/** Alias compatível com o nome usado na especificação do Prompt 4. */
export const gagerrNested = gageRRNested;
