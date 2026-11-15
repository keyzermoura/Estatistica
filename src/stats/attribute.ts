/**
 * Concordância para dados de atributo (categorias).
 *
 * Coeficientes implementados:
 *  - Cohen: κ = (p_o − p_e)/(1 − p_e) para dois avaliadores, com erro-padrão
 *    de Fleiss, Cohen & Everitt (1969) na forma do pacote R `irr::kappa2`.
 *  - Fleiss: κ = (P̄ − p_e)/(1 − p_e) para dois ou mais avaliadores, com
 *    erro-padrão analítico quando o número de avaliadores é constante e não há
 *    ponderação; nos demais casos, erro-padrão por jackknife delete-one.
 *  - Kappa ponderado (pesos lineares ou quadráticos) para categorias ordinais,
 *    tanto em Cohen quanto em Fleiss.
 *
 * O estudo completo calcula concordância interavaliadores, intra-avaliador
 * (entre réplicas), de cada avaliador com a referência conhecida, eficácia,
 * taxa de falso aceite (FAR) e de falso rejeite (FRR), com intervalos de
 * Wilson. O veredito usa limites editáveis de κ (0,75 conforme e 0,40 atenção
 * por padrão); Landis & Koch (1977) é registrado apenas como orientação.
 *
 * Decisões explícitas:
 *  - `p_e = 1` (todas as classificações na mesma categoria) torna κ
 *    indefinido: o valor é nulo, o veredito é não avaliado e há alerta.
 *  - O kappa interavaliadores e o kappa com a referência usam a primeira
 *    réplica (ou a menor réplica disponível, com alerta). A eficácia, FAR e FRR
 *    usam todas as réplicas; o kappa intra-avaliador usa todas as réplicas.
 *  - Nenhuma observação é removida silenciosamente: dados ausentes são
 *    contados e registrados.
 *
 * Referências:
 *  - Cohen, J. (1960). A coefficient of agreement for nominal scales.
 *    Educational and Psychological Measurement, 20, 37–46.
 *  - Fleiss, J. L. (1971). Measuring nominal scale agreement among many raters.
 *    Psychological Bulletin, 76(5), 378–382.
 *  - Fleiss, J. L., Cohen, J. & Everitt, B. S. (1969). Large sample standard
 *    errors of kappa and weighted kappa. Psychological Bulletin, 72, 323–327.
 *  - Landis, J. R. & Koch, G. G. (1977). The measurement of observer agreement
 *    for categorical data. Biometrics, 33, 159–174 (orientação, não norma).
 *  - AIAG (2010). Measurement Systems Analysis Reference Manual, 4. ed.
 *    (attribute agreement analysis).
 *  - R package `irr` 0.84.1 (`kappa2`, `kappam.fleiss`) e documentação do
 *    `sklearn.metrics.cohen_kappa_score`, usados como referência de teste.
 */

import type { Verdict } from '../lib/types';
import type { AnalysisChart, AnalysisMetric, AnalysisTable } from './analysis-types';
import { ciProportion } from './descriptive';
import { fmt, normalCdf, normalInv } from './distributions';

const REFERENCE =
  'Cohen (1960); Fleiss (1971); Fleiss, Cohen & Everitt (1969); Landis & Koch (1977); AIAG MSA 4th ed.; irr 0.84.1; scikit-learn';

const LANDIS_KOCH =
  'Landis & Koch (1977): < 0,00 ruim; 0,00–0,20 leve; 0,21–0,40 razoável; 0,41–0,60 moderada; 0,61–0,80 substancial; 0,81–1,00 quase perfeita — orientação, não norma.';

export type AttributeWeight = 'none' | 'linear' | 'quadratic';

export interface AttributeAgreementCriteria {
  /** κ ≥ kappaAccept é conforme. */
  kappaAccept: number;
  /** κ ≥ kappaWarning e < kappaAccept é atenção; abaixo é não conforme. */
  kappaWarning: number;
  /** Percentual mínimo de itens com referência conhecida. */
  referenceCoverageMinimum: number;
  /** Eficácia mínima (proporção de acertos); nulo = sem critério. */
  effectivenessMinimum: number | null;
  /** FAR máxima (proporção); nulo = sem critério. */
  farMaximum: number | null;
  /** FRR máxima (proporção); nulo = sem critério. */
  frrMaximum: number | null;
}

export const DEFAULT_ATTRIBUTE_AGREEMENT_CRITERIA: Readonly<AttributeAgreementCriteria> =
  Object.freeze({
    kappaAccept: 0.75,
    kappaWarning: 0.4,
    referenceCoverageMinimum: 100,
    effectivenessMinimum: null,
    farMaximum: null,
    frrMaximum: null,
  });

export interface KappaOptions {
  /** Ordem das categorias; obrigatória no kappa ponderado. */
  categories?: readonly string[];
  /** Pesos: nenhum (nominal), linear ou quadrático (ordinal). */
  weight?: AttributeWeight;
  /** Confiança dos intervalos; padrão 0,95. */
  confidence?: number;
}

export interface KappaResult {
  method: 'cohen' | 'fleiss';
  defined: boolean;
  weight: AttributeWeight;
  categories: string[];
  /** Itens (sujeitos) usados. */
  subjects: number;
  /** Total de classificações usadas. */
  ratings: number;
  /** Avaliadores por item; em Fleiss com m variável, é o maior m. */
  raters: number;
  ratersVariable: boolean;
  /** Concordância observada (ou ponderada). */
  po: number | null;
  /** Concordância esperada ao acaso (ou ponderada). */
  pe: number | null;
  kappa: number | null;
  se: number | null;
  seMethod: 'analytic' | 'jackknife' | null;
  z: number | null;
  pValue: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  /** Itens/observações excluídos por dados faltantes. */
  missing: number;
  warnings: string[];
}

export interface AttributeObservation {
  item: string;
  rater: string;
  category: string | null | undefined;
  /** Réplica da avaliação; ausente = 1. */
  replicate?: number | null;
  /** Categoria de referência conhecida do item. */
  reference?: string | null;
}

export interface AttributeStudyInput {
  observations: ReadonlyArray<AttributeObservation>;
  /** Referências por item, quando não repetidas em cada observação. */
  references?: Readonly<Record<string, string>>;
}

export interface AttributeStudyOptions extends KappaOptions {
  criteria?: Partial<AttributeAgreementCriteria>;
  /** Categorias consideradas aceitação para FAR/FRR. */
  conformingCategories?: readonly string[];
  /** Réplica usada no kappa interavaliadores e com a referência; padrão 1. */
  interRaterTrial?: number;
}

export interface PairwiseAgreementResult {
  raterA: string;
  raterB: string;
  kappa: KappaResult;
}

export interface IntraRaterResult {
  rater: string;
  items: number;
  replicates: number;
  kappa: KappaResult;
  verdict: Verdict;
  metrics: AnalysisMetric[];
  warnings: string[];
}

export interface RaterReferenceResult {
  rater: string;
  items: number;
  trials: number;
  kappa: KappaResult;
  correct: number;
  effectiveness: number | null;
  effectivenessCi: [number, number] | null;
  falseAccepts: number | null;
  falseRejects: number | null;
  referenceAccepts: number | null;
  referenceRejects: number | null;
  falseAcceptRate: number | null;
  falseAcceptCi: [number, number] | null;
  falseRejectRate: number | null;
  falseRejectCi: [number, number] | null;
  /** Linhas = categoria do avaliador; colunas = categoria de referência. */
  confusion: number[][];
  verdict: Verdict;
  metrics: AnalysisMetric[];
  warnings: string[];
}

export interface AttributeStudyResult {
  n: number;
  items: number;
  raters: number;
  replicates: number;
  missing: number;
  categories: string[];
  weight: AttributeWeight;
  confidence: number;
  criteria: AttributeAgreementCriteria;
  interRater: KappaResult;
  pairwise: PairwiseAgreementResult[];
  intraRater: IntraRaterResult[];
  vsReference: RaterReferenceResult[];
  referenceCoveragePct: number;
  metrics: AnalysisMetric[];
  rawMetrics: Record<string, number | null>;
  tables: AnalysisTable[];
  charts: AnalysisChart[];
  warnings: string[];
  notes: string[];
  summary: string;
  verdict: Verdict;
  method: string;
  reference: string;
}

interface NormalizedOptions {
  weight: AttributeWeight;
  confidence: number;
  criteria: AttributeAgreementCriteria;
  conformingCategories: string[] | null;
  interRaterTrial: number;
}

interface NormalizedObservation {
  item: string;
  rater: string;
  category: string;
  replicate: number;
  reference: string | null;
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function verdictLabel(verdict: Verdict): string {
  if (verdict === 'pass') return 'conforme';
  if (verdict === 'fail') return 'não conforme';
  if (verdict === 'warning') return 'atenção';
  return 'não avaliado';
}

function overallVerdict(metrics: AnalysisMetric[]): Verdict {
  const evaluated = metrics.filter((metric) => metric.verdict !== 'not_evaluated');
  if (evaluated.length === 0) return 'not_evaluated';
  if (evaluated.some((metric) => metric.verdict === 'fail')) return 'fail';
  if (evaluated.some((metric) => metric.verdict === 'warning')) return 'warning';
  return 'pass';
}

function normalizeCategory(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeCriteria(
  partial: Partial<AttributeAgreementCriteria> | undefined,
): AttributeAgreementCriteria {
  const criteria: AttributeAgreementCriteria = {
    ...DEFAULT_ATTRIBUTE_AGREEMENT_CRITERIA,
    ...(partial ?? {}),
  };
  if (
    !Number.isFinite(criteria.kappaAccept) ||
    criteria.kappaAccept < -1 ||
    criteria.kappaAccept > 1
  ) {
    throw new Error('O limite conforme de κ deve estar entre −1 e 1.');
  }
  if (
    !Number.isFinite(criteria.kappaWarning) ||
    criteria.kappaWarning < -1 ||
    criteria.kappaWarning > 1
  ) {
    throw new Error('O limite de atenção de κ deve estar entre −1 e 1.');
  }
  if (criteria.kappaWarning > criteria.kappaAccept) {
    throw new Error('O limite de atenção de κ deve ser menor ou igual ao limite conforme.');
  }
  if (
    !Number.isFinite(criteria.referenceCoverageMinimum) ||
    criteria.referenceCoverageMinimum < 0 ||
    criteria.referenceCoverageMinimum > 100
  ) {
    throw new Error('A cobertura mínima de referência deve estar entre 0 e 100%.');
  }
  const limits: Array<[number | null, string]> = [
    [criteria.effectivenessMinimum, 'eficácia mínima'],
    [criteria.farMaximum, 'FAR máxima'],
    [criteria.frrMaximum, 'FRR máxima'],
  ];
  for (const [value, label] of limits) {
    if (value === null) continue;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`A ${label} deve estar entre 0 e 1 (proporção) ou ser nula.`);
    }
  }
  return criteria;
}

function validateConfidence(confidence: number | undefined): number {
  const value = confidence ?? 0.95;
  if (!Number.isFinite(value) || !(value > 0 && value < 1)) {
    throw new Error('A confiança deve estar entre 0 e 1 (ex.: 0,95).');
  }
  return value;
}

function validateWeight(weight: AttributeWeight | undefined): AttributeWeight {
  const value = weight ?? 'none';
  if (value !== 'none' && value !== 'linear' && value !== 'quadratic') {
    throw new Error('Peso inválido: use "none", "linear" ou "quadratic".');
  }
  return value;
}

function prepareCategories(
  observed: Iterable<string>,
  supplied: readonly string[] | undefined,
  weight: AttributeWeight,
): string[] {
  const observedSet = new Set(observed);
  if (supplied !== undefined) {
    const list = supplied.map((category) => category.trim());
    if (list.some((category) => category.length === 0)) {
      throw new Error('A lista de categorias não pode conter itens vazios.');
    }
    const unique = new Set(list);
    if (unique.size !== list.length) {
      throw new Error('A lista de categorias contém duplicatas.');
    }
    if (weight !== 'none' && list.length < 2) {
      throw new Error('O kappa ponderado requer pelo menos duas categorias ordenadas.');
    }
    for (const category of observedSet) {
      if (!unique.has(category)) {
        throw new Error(
          `A categoria "${category}" não está na lista de categorias informada.`,
        );
      }
    }
    return list;
  }
  if (weight !== 'none') {
    throw new Error(
      'O kappa ponderado exige a ordem das categorias no campo `categories`.',
    );
  }
  return [...observedSet].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function weightMatrix(k: number, weight: AttributeWeight): number[][] {
  if (weight !== 'none' && k < 2) {
    throw new Error('O kappa ponderado requer pelo menos duas categorias.');
  }
  return Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => {
      if (weight === 'none') return i === j ? 1 : 0;
      if (weight === 'linear') return 1 - Math.abs(i - j) / (k - 1);
      return 1 - ((i - j) / (k - 1)) ** 2;
    }),
  );
}

function makeKappaResult(args: {
  method: 'cohen' | 'fleiss';
  defined: boolean;
  weight: AttributeWeight;
  categories: string[];
  subjects: number;
  ratings: number;
  raters: number;
  ratersVariable: boolean;
  po: number | null;
  pe: number | null;
  kappa: number | null;
  se: number | null;
  seMethod: 'analytic' | 'jackknife' | null;
  confidence: number;
  missing: number;
  warnings: string[];
}): KappaResult {
  const kappa = args.kappa;
  const se = args.se !== null && Number.isFinite(args.se) ? args.se : null;
  let z: number | null = null;
  let pValue: number | null = null;
  let ciLow: number | null = null;
  let ciHigh: number | null = null;

  if (kappa !== null && Number.isFinite(kappa) && se !== null) {
    if (se === 0) {
      z = kappa === 0 ? 0 : kappa > 0 ? Infinity : -Infinity;
      pValue = kappa === 0 ? 1 : 0;
      ciLow = kappa;
      ciHigh = kappa;
    } else {
      z = kappa / se;
      pValue = 2 * (1 - normalCdf(Math.abs(z)));
      const zCrit =
        Math.abs(args.confidence - 0.95) < 1e-12
          ? 1.959963984540054
          : normalInv(0.5 + args.confidence / 2);
      ciLow = Math.max(-1, kappa - zCrit * se);
      ciHigh = Math.min(1, kappa + zCrit * se);
    }
  }

  return {
    method: args.method,
    defined: args.defined,
    weight: args.weight,
    categories: args.categories,
    subjects: args.subjects,
    ratings: args.ratings,
    raters: args.raters,
    ratersVariable: args.ratersVariable,
    po: args.po,
    pe: args.pe,
    kappa,
    se,
    seMethod: args.seMethod,
    z,
    pValue,
    ciLow,
    ciHigh,
    missing: args.missing,
    warnings: args.warnings,
  };
}

function undefinedKappa(args: {
  method: 'cohen' | 'fleiss';
  weight: AttributeWeight;
  categories: string[];
  subjects: number;
  ratings: number;
  raters: number;
  ratersVariable: boolean;
  po: number | null;
  pe: number | null;
  confidence: number;
  missing: number;
  warnings: string[];
}): KappaResult {
  return makeKappaResult({
    ...args,
    defined: false,
    kappa: null,
    se: null,
    seMethod: null,
  });
}

function cohenFromTable(
  table: number[][],
  categories: string[],
  weight: AttributeWeight,
  confidence: number,
  missing: number,
  subjects: number,
): KappaResult {
  const k = categories.length;
  const n = subjects;
  if (n <= 0) {
    throw new Error('O kappa de Cohen requer pelo menos um par de classificações válido.');
  }
  const weights = weightMatrix(k, weight);
  const rowTotals = table.map((row) => sum(row));
  const colTotals = Array.from({ length: k }, (_, j) =>
    sum(table.map((row) => row[j])),
  );
  const expected = table.map((row, i) =>
    row.map((_, j) => (rowTotals[i] * colTotals[j]) / n),
  );

  let observedSum = 0;
  let expectedSum = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      observedSum += weights[i][j] * table[i][j];
      expectedSum += weights[i][j] * expected[i][j];
    }
  }
  const po = observedSum / n;
  const pe = expectedSum / n;
  const warnings: string[] = [];

  if (!(1 - pe > 1e-15)) {
    warnings.push(
      'p_e = 1: todas as classificações estão na mesma categoria; κ é indefinido e não pode ser avaliado.',
    );
    return undefinedKappa({
      method: 'cohen',
      weight,
      categories,
      subjects: n,
      ratings: 2 * n,
      raters: 2,
      ratersVariable: false,
      po,
      pe,
      confidence,
      missing,
      warnings,
    });
  }

  const kappa = (po - pe) / (1 - pe);

  // Variância de Fleiss, Cohen & Everitt (1969), na parametrização de
  // `irr::kappa2`: var.matrix = (e_ij/n)·[w_ij − (w.i_i + w.j_j)]².
  const wi = Array.from({ length: k }, (_, i) =>
    sum(colTotals.map((column, j) => (column / n) * weights[i][j])),
  );
  const wj = Array.from({ length: k }, (_, i) =>
    sum(rowTotals.map((row, j) => weights[i][j] * (row / n))),
  );
  let varianceSum = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const term = weights[i][j] - (wi[i] + wj[j]);
      varianceSum += (expected[i][j] / n) * term * term;
    }
  }
  const variance = Math.max(
    0,
    (varianceSum - pe * pe) / (n * (1 - pe) * (1 - pe)),
  );
  const se = Math.sqrt(variance);

  return makeKappaResult({
    method: 'cohen',
    defined: true,
    weight,
    categories,
    subjects: n,
    ratings: 2 * n,
    raters: 2,
    ratersVariable: false,
    po,
    pe,
    kappa,
    se,
    seMethod: 'analytic',
    confidence,
    missing,
    warnings,
  });
}

/** Kappa de Cohen entre dois avaliadores, com EP e IC. */
export function cohenKappa(
  first: ReadonlyArray<string | null | undefined>,
  second: ReadonlyArray<string | null | undefined>,
  options: KappaOptions = {},
): KappaResult {
  if (first.length !== second.length) {
    throw new Error('As duas listas do kappa de Cohen devem ter o mesmo comprimento.');
  }
  const weight = validateWeight(options.weight);
  const confidence = validateConfidence(options.confidence);
  const pairs: Array<[string, string]> = [];
  let missing = 0;
  for (let index = 0; index < first.length; index++) {
    const a = normalizeCategory(first[index]);
    const b = normalizeCategory(second[index]);
    if (a === null || b === null) {
      missing += 1;
      continue;
    }
    pairs.push([a, b]);
  }
  if (pairs.length === 0) {
    throw new Error('O kappa de Cohen requer pelo menos um par de classificações válido.');
  }
  const observed = pairs.flat();
  const categories = prepareCategories(observed, options.categories, weight);
  const indexOf = new Map(categories.map((category, index) => [category, index]));
  const table = categories.map(() => categories.map(() => 0));
  for (const [a, b] of pairs) {
    table[indexOf.get(a)!][indexOf.get(b)!] += 1;
  }
  return cohenFromTable(
    table,
    categories,
    weight,
    confidence,
    missing,
    pairs.length,
  );
}

function fleissPointEstimate(
  counts: ReadonlyArray<ReadonlyArray<number>>,
  weights: number[][],
  k: number,
): { pbar: number; pe: number; pj: number[] } | null {
  if (counts.length === 0) return null;
  const totals = new Array<number>(k).fill(0);
  let totalRatings = 0;
  let pbar = 0;
  for (const row of counts) {
    const m = sum(row);
    if (m < 2) continue;
    let weightedPairs = 0;
    for (let i = 0; i < k; i++) {
      if (row[i] === 0) continue;
      for (let j = 0; j < k; j++) {
        weightedPairs += weights[i][j] * row[i] * row[j];
      }
    }
    pbar += (weightedPairs - m) / (m * (m - 1));
    for (let j = 0; j < k; j++) totals[j] += row[j];
    totalRatings += m;
  }
  if (totalRatings === 0) return null;
  pbar /= counts.length;
  const pj = totals.map((total) => total / totalRatings);
  let pe = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      pe += weights[i][j] * pj[i] * pj[j];
    }
  }
  return { pbar, pe, pj };
}

function fleissAnalyticVariance(
  pj: number[],
  subjects: number,
  raters: number,
): number {
  const p = pj;
  const q = p.map((value) => 1 - value);
  const sumPq = p.reduce((acc, value, index) => acc + value * q[index], 0);
  const correction = p.reduce(
    (acc, value, index) => acc + value * q[index] * (q[index] - value),
    0,
  );
  const denominator = sumPq * sumPq * (subjects * raters * (raters - 1));
  if (!(denominator > 0)) return NaN;
  return (2 * (sumPq * sumPq - correction)) / denominator;
}

function fleissJackknifeSe(
  counts: ReadonlyArray<ReadonlyArray<number>>,
  weights: number[][],
  k: number,
  weight: AttributeWeight,
): number | null {
  const n = counts.length;
  if (n < 3) return null;
  const estimates: number[] = [];
  for (let index = 0; index < n; index++) {
    const subset = counts.filter((_, rowIndex) => rowIndex !== index);
    const estimate = fleissPointEstimate(subset, weights, k);
    if (estimate === null) return null;
    if (!(1 - estimate.pe > 1e-15)) return null;
    estimates.push((estimate.pbar - estimate.pe) / (1 - estimate.pe));
  }
  const center = sum(estimates) / n;
  const variance =
    ((n - 1) / n) *
    estimates.reduce((acc, estimate) => acc + (estimate - center) ** 2, 0);
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Kappa de Fleiss a partir de uma matriz de contagens (itens × categorias).
 * Itens com menos de dois avaliadores são ignorados com alerta.
 */
export function fleissKappaFromCounts(
  counts: ReadonlyArray<ReadonlyArray<number>>,
  options: KappaOptions = {},
): KappaResult {
  if (!counts || counts.length === 0) {
    throw new Error('O kappa de Fleiss requer pelo menos uma linha de contagens.');
  }
  const k = counts[0].length;
  if (k === 0) {
    throw new Error('A matriz de contagens do kappa de Fleiss não pode ser vazia.');
  }
  for (const [rowIndex, row] of counts.entries()) {
    if (row.length !== k) {
      throw new Error(
        `A linha ${rowIndex + 1} da matriz de contagens tem ${row.length} categorias; esperado ${k}.`,
      );
    }
    for (const value of row) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(
          'As contagens do kappa de Fleiss devem ser inteiros não negativos.',
        );
      }
    }
  }

  const weight = validateWeight(options.weight);
  const confidence = validateConfidence(options.confidence);
  let categories: string[];
  if (options.categories !== undefined) {
    categories = prepareCategories([], options.categories, weight);
    if (categories.length !== k) {
      throw new Error(
        `A lista de categorias tem ${categories.length} itens; a matriz de contagens tem ${k} colunas.`,
      );
    }
  } else {
    if (weight !== 'none') {
      throw new Error(
        'O kappa ponderado de Fleiss exige a ordem das categorias no campo `categories`.',
      );
    }
    categories = Array.from({ length: k }, (_, index) => `Categoria ${index + 1}`);
  }

  const warnings: string[] = [];
  const valid: number[][] = [];
  for (const [rowIndex, row] of counts.entries()) {
    const m = sum(row);
    if (m < 2) {
      warnings.push(
        `Item ${rowIndex + 1}: ${m} avaliador(es); são necessários pelo menos 2 para o kappa de Fleiss. Item ignorado.`,
      );
      continue;
    }
    valid.push([...row]);
  }
  if (valid.length === 0) {
    return undefinedKappa({
      method: 'fleiss',
      weight,
      categories,
      subjects: 0,
      ratings: 0,
      raters: 0,
      ratersVariable: false,
      po: null,
      pe: null,
      confidence,
      missing: counts.length,
      warnings: [
        ...warnings,
        'Nenhum item possui pelo menos dois avaliadores; κ de Fleiss indefinido.',
      ],
    });
  }

  const mValues = valid.map((row) => sum(row));
  const ratersVariable = new Set(mValues).size > 1;
  const maxRaters = Math.max(...mValues);
  const weights = weightMatrix(k, weight);
  const estimate = fleissPointEstimate(valid, weights, k);
  if (estimate === null) {
    return undefinedKappa({
      method: 'fleiss',
      weight,
      categories,
      subjects: valid.length,
      ratings: sum(mValues),
      raters: maxRaters,
      ratersVariable,
      po: null,
      pe: null,
      confidence,
      missing: counts.length - valid.length,
      warnings: [...warnings, 'Não foi possível estimar o kappa de Fleiss.'],
    });
  }

  const { pbar, pe, pj } = estimate;
  if (!(1 - pe > 1e-15)) {
    warnings.push(
      'p_e = 1: todas as classificações estão na mesma categoria; κ de Fleiss é indefinido e não pode ser avaliado.',
    );
    return undefinedKappa({
      method: 'fleiss',
      weight,
      categories,
      subjects: valid.length,
      ratings: sum(mValues),
      raters: maxRaters,
      ratersVariable,
      po: pbar,
      pe,
      confidence,
      missing: counts.length - valid.length,
      warnings,
    });
  }

  const kappa = (pbar - pe) / (1 - pe);
  let se: number | null = null;
  let seMethod: 'analytic' | 'jackknife' | null = null;
  if (weight === 'none' && !ratersVariable) {
    const variance = fleissAnalyticVariance(pj, valid.length, maxRaters);
    if (Number.isFinite(variance)) {
      se = Math.sqrt(Math.max(0, variance));
      seMethod = 'analytic';
    }
  }
  if (se === null) {
    se = fleissJackknifeSe(valid, weights, k, weight);
    seMethod = se === null ? null : 'jackknife';
    if (se === null) {
      warnings.push(
        'Erro-padrão de Fleiss indisponível: o jackknife requer pelo menos 3 itens completos. O IC não foi calculado.',
      );
    } else if (ratersVariable) {
      warnings.push(
        'O número de avaliadores varia entre itens; o erro-padrão foi estimado por jackknife delete-one.',
      );
    } else if (weight !== 'none') {
      warnings.push(
        'Kappa ponderado: não há fórmula analítica fechada para o erro-padrão; foi usado jackknife delete-one.',
      );
    }
  }

  return makeKappaResult({
    method: 'fleiss',
    defined: true,
    weight,
    categories,
    subjects: valid.length,
    ratings: sum(mValues),
    raters: maxRaters,
    ratersVariable,
    po: pbar,
    pe,
    kappa,
    se,
    seMethod,
    confidence,
    missing: counts.length - valid.length,
    warnings,
  });
}

/**
 * Kappa de Fleiss a partir de classificações (itens × avaliadores). Itens com
 * qualquer avaliação ausente são excluídos por lista, como em `irr`.
 */
export function fleissKappa(
  ratings: ReadonlyArray<ReadonlyArray<string | null | undefined>>,
  options: KappaOptions = {},
): KappaResult {
  if (!ratings || ratings.length === 0) {
    throw new Error('O kappa de Fleiss requer pelo menos um item avaliado.');
  }
  const columns = ratings[0].length;
  if (columns === 0) {
    throw new Error('O kappa de Fleiss requer pelo menos um avaliador.');
  }
  const weight = validateWeight(options.weight);
  const validRows: string[][] = [];
  let missing = 0;
  for (const [rowIndex, row] of ratings.entries()) {
    if (row.length !== columns) {
      throw new Error(
        `O item ${rowIndex + 1} tem ${row.length} avaliações; esperado ${columns}.`,
      );
    }
    const normalized = row.map((value) => normalizeCategory(value));
    if (normalized.some((value) => value === null)) {
      missing += 1;
      continue;
    }
    validRows.push(normalized as string[]);
  }
  if (validRows.length === 0) {
    throw new Error(
      'O kappa de Fleiss requer pelo menos um item com todas as avaliações preenchidas.',
    );
  }
  const observed = validRows.flat();
  const categories = prepareCategories(observed, options.categories, weight);
  const indexOf = new Map(categories.map((category, index) => [category, index]));
  const counts = validRows.map((row) => {
    const rowCounts = new Array<number>(categories.length).fill(0);
    for (const category of row) rowCounts[indexOf.get(category)!] += 1;
    return rowCounts;
  });
  const result = fleissKappaFromCounts(counts, {
    categories,
    weight,
    confidence: options.confidence,
  });
  if (missing > 0) {
    result.missing += missing;
    result.warnings.push(
      `${missing} item(ns) excluído(s) por avaliação ausente (análise por lista).`,
    );
  }
  return result;
}

function normalizeConformingCategories(
  supplied: readonly string[] | undefined,
  categories: string[],
): string[] | null {
  if (supplied === undefined) {
    return inferConformingCategories(categories);
  }
  const cleaned = supplied.map((category) => category.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new Error('Informe ao menos uma categoria de aceitação ou omita o campo.');
  }
  const unique = [...new Set(cleaned)];
  for (const category of unique) {
    if (!categories.includes(category)) {
      throw new Error(
        `A categoria de aceitação "${category}" não está entre as categorias do estudo.`,
      );
    }
  }
  return unique;
}

function normalizedLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const ACCEPT_LABELS = new Set([
  'conforme',
  'conformes',
  'aprovado',
  'aprovada',
  'aprovados',
  'aprovadas',
  'passa',
  'pass',
  'aceito',
  'aceite',
  'aceitos',
  'aceites',
  'ok',
  'sim',
  'yes',
  'true',
  'verdadeiro',
  '1',
  'atende',
]);

const REJECT_LABELS = new Set([
  'nao conforme',
  'nao conformes',
  'reprovado',
  'reprovada',
  'reprovados',
  'reprovadas',
  'falha',
  'falhas',
  'fail',
  'rejeitado',
  'rejeitada',
  'rejeitados',
  'rejeitadas',
  'nao passa',
  'nao',
  'no',
  'false',
  'falso',
  '0',
  'nao atende',
]);

function inferConformingCategories(categories: string[]): string[] | null {
  if (categories.length !== 2) return null;
  const accepted = categories.filter((category) =>
    ACCEPT_LABELS.has(normalizedLabel(category)),
  );
  const rejected = categories.filter((category) =>
    REJECT_LABELS.has(normalizedLabel(category)),
  );
  if (accepted.length === 1 && rejected.length === 1 && accepted[0] !== rejected[0]) {
    return accepted;
  }
  return null;
}

function normalizeOptions(options: AttributeStudyOptions): NormalizedOptions {
  const weight = validateWeight(options.weight);
  const criteria = normalizeCriteria(options.criteria);
  const interRaterTrial = options.interRaterTrial ?? 1;
  if (!Number.isInteger(interRaterTrial) || interRaterTrial < 1) {
    throw new Error('A réplica do kappa interavaliadores deve ser um inteiro positivo.');
  }
  return {
    weight,
    confidence: validateConfidence(options.confidence),
    criteria,
    conformingCategories: null,
    interRaterTrial,
  };
}

function kappaCriterionText(criteria: AttributeAgreementCriteria): string {
  return `κ ≥ ${fmt(criteria.kappaAccept)} conforme; ${fmt(criteria.kappaWarning)} ≤ κ < ${fmt(criteria.kappaAccept)} atenção; κ < ${fmt(criteria.kappaWarning)} não conforme (limiares editáveis; Landis & Koch é orientação)`;
}

function kappaVerdict(
  result: KappaResult,
  criteria: AttributeAgreementCriteria,
): Verdict {
  if (!result.defined || result.kappa === null || !Number.isFinite(result.kappa)) {
    return 'not_evaluated';
  }
  if (result.kappa >= criteria.kappaAccept) return 'pass';
  if (result.kappa >= criteria.kappaWarning) return 'warning';
  return 'fail';
}

function kappaMetric(
  key: string,
  label: string,
  result: KappaResult,
  criteria: AttributeAgreementCriteria,
): AnalysisMetric {
  return {
    key,
    label,
    value: result.kappa,
    unit: '',
    verdict: kappaVerdict(result, criteria),
    criterionText: kappaCriterionText(criteria),
    formula:
      result.weight === 'none'
        ? 'κ = (p_o − p_e)/(1 − p_e)'
        : 'κ_w = (P̄_w − p_e,w)/(1 − p_e,w), com pesos lineares/quadráticos',
    reference: REFERENCE,
  };
}

function proportionMetric(args: {
  key: string;
  label: string;
  value: number | null;
  ci: [number, number] | null;
  unit: string;
  criterionText: string;
  verdict: Verdict;
  formula: string;
}): AnalysisMetric {
  return {
    key: args.key,
    label:
      args.ci === null
        ? args.label
        : `${args.label} (IC: ${fmt(args.ci[0])}–${fmt(args.ci[1])})`,
    value: args.value,
    unit: args.unit,
    verdict: args.verdict,
    criterionText: args.criterionText,
    formula: args.formula,
    reference: REFERENCE,
  };
}

function proportionVerdict(
  value: number | null,
  minimum: number | null,
  maximum: number | null,
): Verdict {
  if (value === null || !Number.isFinite(value)) return 'not_evaluated';
  if (minimum !== null) return value >= minimum ? 'pass' : 'fail';
  if (maximum !== null) return value <= maximum ? 'pass' : 'fail';
  return 'not_evaluated';
}

function asCi(result: [number, number]): [number, number] | null {
  return Number.isFinite(result[0]) && Number.isFinite(result[1]) ? result : null;
}

function slugKey(prefix: string, index: number): string {
  return `${prefix}_${index + 1}`;
}

export interface QualitativeDiagnosticMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  sensitivity: number | null;
  sensitivityCi: [number, number] | null;
  specificity: number | null;
  specificityCi: [number, number] | null;
  lrPositive: number | null;
  lrNegative: number | null;
  ppv: number | null;
  npv: number | null;
  youdenJ: number | null;
  prevalence: number;
  confidence: number;
  reference: string;
}

/**
 * Métricas diagnósticas qualitativas com intervalos de Wilson e razões de
 * verossimilhança bayesianas (LR+, LR−) segundo o guia Eurachem Qualitative
 * Chemical Analysis (2021).
 */
export function computeQualitativeDiagnosticMetrics(
  tp: number,
  fp: number,
  fn: number,
  tn: number,
  prevalence = 0.5,
  confidence = 0.95,
): QualitativeDiagnosticMetrics {
  const posTotal = tp + fn;
  const negTotal = tn + fp;
  const sensitivity = posTotal > 0 ? tp / posTotal : null;
  const sensitivityCi =
    posTotal > 0 ? asCi(ciProportion(tp, posTotal, confidence)) : null;
  const specificity = negTotal > 0 ? tn / negTotal : null;
  const specificityCi =
    negTotal > 0 ? asCi(ciProportion(tn, negTotal, confidence)) : null;

  let lrPositive: number | null = null;
  let lrNegative: number | null = null;
  if (posTotal > 0 && negTotal > 0 && sensitivity !== null && specificity !== null) {
    const seH = (tp + 0.5) / (posTotal + 1);
    const spH = (tn + 0.5) / (negTotal + 1);
    lrPositive =
      1 - specificity > 0 ? sensitivity / (1 - specificity) : seH / (1 - spH);
    lrNegative =
      specificity > 0 ? (1 - sensitivity) / specificity : (1 - seH) / spH;
  }

  let ppv: number | null = null;
  let npv: number | null = null;
  const p = Math.min(1, Math.max(0, prevalence));
  if (sensitivity !== null && specificity !== null) {
    const pPos = sensitivity * p + (1 - specificity) * (1 - p);
    const pNeg = specificity * (1 - p) + (1 - sensitivity) * p;
    ppv = pPos > 0 ? (sensitivity * p) / pPos : null;
    npv = pNeg > 0 ? (specificity * (1 - p)) / pNeg : null;
  }

  const youdenJ =
    sensitivity !== null && specificity !== null
      ? sensitivity + specificity - 1
      : null;

  return {
    tp,
    fp,
    fn,
    tn,
    sensitivity,
    sensitivityCi,
    specificity,
    specificityCi,
    lrPositive,
    lrNegative,
    ppv,
    npv,
    youdenJ,
    prevalence: p,
    confidence,
    reference:
      'EURACHEM / CITAC Guide — Assessment of Performance and Uncertainty in Qualitative Chemical Analysis (2021)',
  };
}

function firstTrialMap(
  observations: NormalizedObservation[],
  trial: number,
): {
  map: Map<string, Map<string, NormalizedObservation>>;
  fallback: number;
} {
  const grouped = new Map<string, Map<string, NormalizedObservation[]>>();
  for (const observation of observations) {
    let byRater = grouped.get(observation.item);
    if (!byRater) {
      byRater = new Map();
      grouped.set(observation.item, byRater);
    }
    const list = byRater.get(observation.rater) ?? [];
    list.push(observation);
    byRater.set(observation.rater, list);
  }
  const map = new Map<string, Map<string, NormalizedObservation>>();
  let fallback = 0;
  for (const [item, byRater] of grouped) {
    const selected = new Map<string, NormalizedObservation>();
    for (const [rater, list] of byRater) {
      const exact = list.find((observation) => observation.replicate === trial);
      const chosen =
        exact ??
        list.slice().sort((a, b) => a.replicate - b.replicate)[0];
      if (!exact) fallback += 1;
      selected.set(rater, chosen);
    }
    map.set(item, selected);
  }
  return { map, fallback };
}

function addKappaWarnings(target: Set<string>, result: KappaResult): void {
  for (const warning of result.warnings) target.add(warning);
}

/**
 * Executa o estudo de concordância de atributo: interavaliadores,
 * intra-avaliador, referência, eficácia, FAR e FRR.
 */
export function attributeAgreementStudy(
  input: AttributeStudyInput,
  options: AttributeStudyOptions = {},
): AttributeStudyResult {
  const normalizedOptions = normalizeOptions(options);
  const { weight, confidence, criteria } = normalizedOptions;
  if (!input || !Array.isArray(input.observations)) {
    throw new Error('O estudo de concordância requer uma lista de observações.');
  }

  const referenceMap = new Map<string, string>();
  const putReference = (item: string, raw: string | null | undefined) => {
    const key = String(item ?? '').trim();
    const category = normalizeCategory(raw);
    if (category === null) return;
    const existing = referenceMap.get(key);
    if (existing !== undefined && existing !== category) {
      throw new Error(
        `Referência conflitante para o item "${key}": "${existing}" e "${category}".`,
      );
    }
    referenceMap.set(key, category);
  };
  for (const [item, category] of Object.entries(input.references ?? {})) {
    putReference(item, category);
  }
  for (const observation of input.observations) {
    if (observation.reference !== undefined && observation.reference !== null) {
      putReference(observation.item, observation.reference);
    }
  }

  const observations: NormalizedObservation[] = [];
  const seen = new Set<string>();
  let missing = 0;
  for (const raw of input.observations) {
    const item = String(raw.item ?? '').trim();
    const rater = String(raw.rater ?? '').trim();
    if (!item || !rater) {
      throw new Error('Cada observação deve informar item e avaliador não vazios.');
    }
    const replicate = raw.replicate ?? 1;
    if (!Number.isInteger(replicate) || replicate < 1) {
      throw new Error(
        `A réplica do item "${item}" e avaliador "${rater}" deve ser um inteiro positivo.`,
      );
    }
    const category = normalizeCategory(raw.category);
    if (category === null) {
      missing += 1;
      continue;
    }
    const key = `${item}\u0000${rater}\u0000${replicate}`;
    if (seen.has(key)) {
      throw new Error(
        `Observação duplicada para o item "${item}", avaliador "${rater}" e réplica ${replicate}.`,
      );
    }
    seen.add(key);
    observations.push({
      item,
      rater,
      category,
      replicate,
      reference: referenceMap.get(item) ?? null,
    });
  }
  if (observations.length === 0) {
    throw new Error('O estudo de concordância não possui observações válidas.');
  }

  const items = [...new Set(observations.map((observation) => observation.item))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR'),
  );
  const raters = [...new Set(observations.map((observation) => observation.rater))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR'),
  );
  const replicates = new Set(
    observations.map((observation) => observation.replicate),
  ).size;
  const observedCategories = [
    ...observations.map((observation) => observation.category),
    ...referenceMap.values(),
  ];
  const categories = prepareCategories(
    observedCategories,
    options.categories,
    weight,
  );
  normalizedOptions.conformingCategories = normalizeConformingCategories(
    options.conformingCategories,
    categories,
  );

  const warnings = new Set<string>();
  const notes = [
    'κ corrige a concordância observada pela esperada ao acaso; ele não demonstra que a referência esteja correta.',
    'O kappa interavaliadores e o kappa com a referência usam a primeira réplica de cada item/avaliador; a eficácia, FAR e FRR usam todas as réplicas.',
    'A concordância intra-avaliador usa as réplicas comuns a todos os itens daquele avaliador; réplicas incompletas geram alerta.',
    LANDIS_KOCH,
    'Nenhuma observação é removida automaticamente; dados ausentes são contados e registrados.',
  ];
  if (weight !== 'none') {
    notes.push(
      `Kappa ponderado com pesos ${weight === 'linear' ? 'lineares' : 'quadráticos'} na ordem informada das categorias.`,
    );
  }

  // Matriz da primeira réplica: item → avaliador → observação.
  const first = firstTrialMap(observations, normalizedOptions.interRaterTrial);
  if (first.fallback > 0) {
    warnings.add(
      `${first.fallback} combinação(ões) item/avaliador não tinha a réplica ${normalizedOptions.interRaterTrial}; foi usada a menor réplica disponível.`,
    );
  }

  const completeItems = items.filter((item) =>
    raters.every((rater) => first.map.get(item)?.has(rater)),
  );
  const droppedComplete = items.length - completeItems.length;
  if (droppedComplete > 0) {
    warnings.add(
      `${droppedComplete} item(ns) sem avaliação de todos os avaliadores na primeira réplica; o kappa interavaliadores usou ${completeItems.length} item(ns) completos.`,
    );
  }

  let interRater: KappaResult;
  if (raters.length < 2) {
    interRater = undefinedKappa({
      method: 'fleiss',
      weight,
      categories,
      subjects: completeItems.length,
      ratings: 0,
      raters: raters.length,
      ratersVariable: false,
      po: null,
      pe: null,
      confidence,
      missing: droppedComplete,
      warnings: [
        'O kappa interavaliadores requer pelo menos dois avaliadores; ele não foi avaliado.',
      ],
    });
  } else if (completeItems.length === 0) {
    interRater = undefinedKappa({
      method: raters.length === 2 ? 'cohen' : 'fleiss',
      weight,
      categories,
      subjects: 0,
      ratings: 0,
      raters: raters.length,
      ratersVariable: false,
      po: null,
      pe: null,
      confidence,
      missing: droppedComplete,
      warnings: [
        'Nenhum item foi avaliado por todos os avaliadores na réplica selecionada; o kappa interavaliadores não foi avaliado.',
      ],
    });
  } else if (raters.length === 2) {
    const [raterA, raterB] = raters;
    const a = completeItems.map(
      (item) => first.map.get(item)!.get(raterA)!.category,
    );
    const b = completeItems.map(
      (item) => first.map.get(item)!.get(raterB)!.category,
    );
    interRater = cohenKappa(a, b, { categories, weight, confidence });
    interRater.missing += droppedComplete;
    if (droppedComplete > 0) {
      interRater.warnings.push(
        `${droppedComplete} item(ns) sem os dois avaliadores foram excluídos do kappa interavaliadores.`,
      );
    }
  } else {
    const rows = completeItems.map((item) =>
      raters.map((rater) => first.map.get(item)!.get(rater)!.category),
    );
    interRater = fleissKappa(rows, { categories, weight, confidence });
    interRater.missing += droppedComplete;
    if (droppedComplete > 0) {
      interRater.warnings.push(
        `${droppedComplete} item(ns) sem todos os avaliadores foram excluídos do kappa interavaliadores.`,
      );
    }
  }
  addKappaWarnings(warnings, interRater);

  const pairwise: PairwiseAgreementResult[] = [];
  for (let i = 0; i < raters.length; i++) {
    for (let j = i + 1; j < raters.length; j++) {
      const raterA = raters[i];
      const raterB = raters[j];
      const pairwiseItems = items.filter((item) => {
        const byRater = first.map.get(item);
        return byRater?.has(raterA) && byRater.has(raterB);
      });
      if (pairwiseItems.length === 0) continue;
      const a = pairwiseItems.map(
        (item) => first.map.get(item)!.get(raterA)!.category,
      );
      const b = pairwiseItems.map(
        (item) => first.map.get(item)!.get(raterB)!.category,
      );
      pairwise.push({
        raterA,
        raterB,
        kappa: cohenKappa(a, b, { categories, weight, confidence }),
      });
    }
  }

  // Concordância intra-avaliador: réplicas comuns a todos os itens do avaliador.
  const intraRater: IntraRaterResult[] = [];
  const groupedByRaterItem = new Map<string, Map<string, NormalizedObservation[]>>();
  for (const observation of observations) {
    let byItem = groupedByRaterItem.get(observation.rater);
    if (!byItem) {
      byItem = new Map();
      groupedByRaterItem.set(observation.rater, byItem);
    }
    const list = byItem.get(observation.item) ?? [];
    list.push(observation);
    byItem.set(observation.item, list);
  }
  for (const rater of raters) {
    const byItem = groupedByRaterItem.get(rater);
    if (!byItem) continue;
    const itemReplicates = [...byItem.entries()]
      .map(([item, list]) => ({
        item,
        replicates: [...new Set(list.map((observation) => observation.replicate))].sort(
          (a, b) => a - b,
        ),
      }))
      .filter((entry) => entry.replicates.length >= 2);
    if (itemReplicates.length === 0) {
      warnings.add(
        `Avaliador "${rater}": nenhum item possui pelo menos 2 réplicas; a concordância intra-avaliador não foi avaliada.`,
      );
      continue;
    }
    if (itemReplicates.length < byItem.size) {
      warnings.add(
        `Avaliador "${rater}": ${byItem.size - itemReplicates.length} item(ns) com menos de 2 réplicas foram excluídos da concordância intra-avaliador.`,
      );
    }
    let common = itemReplicates[0].replicates;
    for (const entry of itemReplicates.slice(1)) {
      common = common.filter((replicate) => entry.replicates.includes(replicate));
    }
    if (common.length < 2) {
      warnings.add(
        `Avaliador "${rater}": não há duas réplicas comuns a todos os itens; a concordância intra-avaliador não foi avaliada.`,
      );
      continue;
    }
    if (
      common.length <
      Math.max(...itemReplicates.map((entry) => entry.replicates.length))
    ) {
      warnings.add(
        `Avaliador "${rater}": a concordância intra-avaliador usou apenas as ${common.length} réplicas comuns a todos os itens.`,
      );
    }
    const rows = itemReplicates.map((entry) =>
      common.map(
        (replicate) =>
          byItem
            .get(entry.item)!
            .find((observation) => observation.replicate === replicate)!.category,
      ),
    );
    const result = fleissKappa(rows, { categories, weight, confidence });
    for (const warning of result.warnings) warnings.add(warning);
    const metrics = [
      kappaMetric(
        slugKey('kappa_intra', intraRater.length),
        `Kappa intra-avaliador — ${rater}`,
        result,
        criteria,
      ),
    ];
    intraRater.push({
      rater,
      items: itemReplicates.length,
      replicates: common.length,
      kappa: result,
      verdict: overallVerdict(metrics),
      metrics,
      warnings: result.warnings,
    });
  }

  // Concordância de cada avaliador com a referência.
  const vsReference: RaterReferenceResult[] = [];
  const itemsWithReference = items.filter((item) => referenceMap.has(item));
  if (itemsWithReference.length === 0) {
    warnings.add(
      'Nenhum item possui referência conhecida; concordância com a referência, eficácia, FAR e FRR não avaliadas.',
    );
  }
  if (
    referenceMap.size > 0 &&
    normalizedOptions.conformingCategories === null
  ) {
    warnings.add(
      'Não foi possível identificar a categoria de aceitação; informe `conformingCategories` para calcular FAR e FRR.',
    );
  }

  for (const rater of raters) {
    const trials = observations.filter(
      (observation) =>
        observation.rater === rater && referenceMap.has(observation.item),
    );
    if (trials.length === 0) continue;
    const kappaItems = itemsWithReference.filter((item) =>
      first.map.get(item)?.has(rater),
    );
    const referenceKappa =
      kappaItems.length > 0
        ? cohenKappa(
            kappaItems.map(
              (item) => first.map.get(item)!.get(rater)!.category,
            ),
            kappaItems.map((item) => referenceMap.get(item)!),
            { categories, weight, confidence },
          )
        : undefinedKappa({
            method: 'cohen',
            weight,
            categories,
            subjects: 0,
            ratings: 0,
            raters: 2,
            ratersVariable: false,
            po: null,
            pe: null,
            confidence,
            missing: 0,
            warnings: [
              `Avaliador "${rater}": sem classificação na réplica selecionada para os itens com referência.`,
            ],
          });

    const totalTrials = trials.length;
    const correct = trials.filter(
      (observation) => observation.category === referenceMap.get(observation.item),
    ).length;
    const effectiveness = correct / totalTrials;
    const effectivenessCi = asCi(ciProportion(correct, totalTrials, confidence));

    const conforming = normalizedOptions.conformingCategories;
    const referenceAccepts =
      conforming === null
        ? null
        : trials.filter((observation) =>
            conforming.includes(referenceMap.get(observation.item)!),
          ).length;
    const referenceRejects =
      referenceAccepts === null ? null : totalTrials - referenceAccepts;
    const falseAccepts =
      conforming === null
        ? null
        : trials.filter(
            (observation) =>
              !conforming.includes(referenceMap.get(observation.item)!) &&
              conforming.includes(observation.category),
          ).length;
    const falseRejects =
      conforming === null
        ? null
        : trials.filter(
            (observation) =>
              conforming.includes(referenceMap.get(observation.item)!) &&
              !conforming.includes(observation.category),
          ).length;
    const falseAcceptRate =
      falseAccepts === null || referenceRejects === null || referenceRejects === 0
        ? null
        : falseAccepts / referenceRejects;
    const falseRejectRate =
      falseRejects === null || referenceAccepts === null || referenceAccepts === 0
        ? null
        : falseRejects / referenceAccepts;
    const falseAcceptCi =
      falseAccepts === null || referenceRejects === null
        ? null
        : asCi(ciProportion(falseAccepts, referenceRejects, confidence));
    const falseRejectCi =
      falseRejects === null || referenceAccepts === null
        ? null
        : asCi(ciProportion(falseRejects, referenceAccepts, confidence));

    const confusion = categories.map(() => categories.map(() => 0));
    const categoryIndex = new Map(
      categories.map((category, index) => [category, index]),
    );
    for (const observation of trials) {
      confusion[categoryIndex.get(observation.category)!][
        categoryIndex.get(referenceMap.get(observation.item)!)!
      ] += 1;
    }

    const raterWarnings = new Set<string>(referenceKappa.warnings);
    if (conforming === null) {
      raterWarnings.add(
        `Avaliador "${rater}": FAR e FRR não calculadas por falta de mapeamento de aceitação.`,
      );
    }
    if (falseAcceptRate === null && conforming !== null) {
      raterWarnings.add(
        `Avaliador "${rater}": não há referências rejeitadas; FAR não calculada.`,
      );
    }
    if (falseRejectRate === null && conforming !== null) {
      raterWarnings.add(
        `Avaliador "${rater}": não há referências aceitas; FRR não calculada.`,
      );
    }

    const metrics: AnalysisMetric[] = [
      kappaMetric(
        slugKey('kappa_ref', vsReference.length),
        `Kappa com a referência — ${rater}`,
        referenceKappa,
        criteria,
      ),
      proportionMetric({
        key: slugKey('effectiveness', vsReference.length),
        label: `Eficácia — ${rater}`,
        value: effectiveness,
        ci: effectivenessCi,
        unit: '',
        criterionText:
          criteria.effectivenessMinimum === null
            ? 'Sem limite de eficácia cadastrado; não avaliado.'
            : `Eficácia ≥ ${fmt(criteria.effectivenessMinimum)}`,
        verdict: proportionVerdict(
          effectiveness,
          criteria.effectivenessMinimum,
          null,
        ),
        formula: 'eficácia = acertos/observações com referência',
      }),
      proportionMetric({
        key: slugKey('far', vsReference.length),
        label: `Taxa de falso aceite (FAR) — ${rater}`,
        value: falseAcceptRate,
        ci: falseAcceptCi,
        unit: '',
        criterionText:
          criteria.farMaximum === null
            ? 'Sem limite de FAR cadastrado; não avaliado.'
            : `FAR ≤ ${fmt(criteria.farMaximum)}`,
        verdict: proportionVerdict(
          falseAcceptRate,
          null,
          criteria.farMaximum,
        ),
        formula: 'FAR = falsos aceites/referências rejeitadas',
      }),
      proportionMetric({
        key: slugKey('frr', vsReference.length),
        label: `Taxa de falso rejeite (FRR) — ${rater}`,
        value: falseRejectRate,
        ci: falseRejectCi,
        unit: '',
        criterionText:
          criteria.frrMaximum === null
            ? 'Sem limite de FRR cadastrado; não avaliado.'
            : `FRR ≤ ${fmt(criteria.frrMaximum)}`,
        verdict: proportionVerdict(
          falseRejectRate,
          null,
          criteria.frrMaximum,
        ),
        formula: 'FRR = falsos rejeites/referências aceitas',
      }),
    ];

    vsReference.push({
      rater,
      items: kappaItems.length,
      trials: totalTrials,
      kappa: referenceKappa,
      correct,
      effectiveness,
      effectivenessCi,
      falseAccepts,
      falseRejects,
      referenceAccepts,
      referenceRejects,
      falseAcceptRate,
      falseAcceptCi,
      falseRejectRate,
      falseRejectCi,
      confusion,
      verdict: overallVerdict(metrics),
      metrics,
      warnings: [...raterWarnings],
    });
  }

  const referenceCoveragePct =
    items.length > 0 ? (100 * itemsWithReference.length) / items.length : 0;
  const coverageMetric: AnalysisMetric = {
    key: 'reference_coverage',
    label: 'Cobertura de referência conhecida',
    value: referenceCoveragePct,
    unit: '%',
    verdict:
      referenceCoveragePct >= criteria.referenceCoverageMinimum
        ? 'pass'
        : 'warning',
    criterionText: `≥ ${fmt(criteria.referenceCoverageMinimum)}% dos itens com referência conhecida`,
    formula: '100·itens com referência/itens',
    reference: REFERENCE,
  };

  const metrics: AnalysisMetric[] = [
    coverageMetric,
    kappaMetric('kappa_inter', 'Kappa interavaliadores', interRater, criteria),
  ];
  for (const result of intraRater) {
    metrics.push(...result.metrics);
  }
  for (const result of vsReference) {
    metrics.push(...result.metrics);
  }

  const substantive = metrics.filter(
    (metric) => metric.key !== 'reference_coverage',
  );
  let verdict = overallVerdict(substantive);
  if (verdict === 'pass' && coverageMetric.verdict === 'warning') {
    verdict = 'warning';
  }

  for (const result of intraRater) {
    for (const warning of result.warnings) warnings.add(warning);
  }
  for (const result of vsReference) {
    for (const warning of result.warnings) warnings.add(warning);
  }
  if (missing > 0) {
    warnings.add(
      `${missing} observação(ões) sem categoria válida foram ignoradas; o n efetivo é ${observations.length}.`,
    );
  }
  if (items.length < 3) {
    warnings.add(
      `O estudo tem ${items.length} item(ns); com menos de 3 itens o erro-padrão e o IC do kappa são instáveis.`,
    );
  }

  const designTable: AnalysisTable = {
    title: 'Resumo do estudo de concordância',
    columns: ['Indicador', 'Valor'],
    rows: [
      ['Itens avaliados', items.length],
      ['Avaliadores', raters.length],
      ['Réplicas (máximo de réplicas distintas)', replicates],
      ['Observações válidas', observations.length],
      ['Observações ausentes', missing],
      ['Itens com referência conhecida', itemsWithReference.length],
      ['Cobertura da referência (%)', fmt(referenceCoveragePct)],
      ['Categorias', categories.join(', ')],
      ['Peso do kappa', weight],
      ['Confiança', `${fmt(100 * confidence)}%`],
    ],
    note:
      'Os itens são avaliados com referência conhecida e podem incluir amostras limítrofes definidas no delineamento. Nenhuma observação é removida automaticamente.',
  };

  const pairwiseTable: AnalysisTable = {
    title: 'Concordância entre pares de avaliadores (primeira réplica)',
    columns: [
      'Avaliador A',
      'Avaliador B',
      'Itens',
      'p_o',
      'p_e',
      'κ',
      'EP',
      'z',
      'p',
      'IC inf.',
      'IC sup.',
      'Veredito',
    ],
    rows: pairwise.map((pair) => [
      pair.raterA,
      pair.raterB,
      pair.kappa.subjects,
      fmt(pair.kappa.po),
      fmt(pair.kappa.pe),
      fmt(pair.kappa.kappa),
      fmt(pair.kappa.se),
      fmt(pair.kappa.z),
      fmt(pair.kappa.pValue),
      fmt(pair.kappa.ciLow),
      fmt(pair.kappa.ciHigh),
      verdictLabel(kappaVerdict(pair.kappa, criteria)),
    ]),
    note: `${kappaCriterionText(criteria)}. EP de Cohen pela fórmula de Fleiss, Cohen & Everitt (1969); IC truncado em [−1, 1].`,
  };

  const intraTable: AnalysisTable = {
    title: 'Concordância intra-avaliador (réplicas)',
    columns: [
      'Avaliador',
      'Itens',
      'Réplicas',
      'p_o',
      'p_e',
      'κ',
      'EP',
      'z',
      'p',
      'IC inf.',
      'IC sup.',
      'Veredito',
    ],
    rows: intraRater.map((result) => [
      result.rater,
      result.items,
      result.replicates,
      fmt(result.kappa.po),
      fmt(result.kappa.pe),
      fmt(result.kappa.kappa),
      fmt(result.kappa.se),
      fmt(result.kappa.z),
      fmt(result.kappa.pValue),
      fmt(result.kappa.ciLow),
      fmt(result.kappa.ciHigh),
      verdictLabel(result.verdict),
    ]),
    note: `${kappaCriterionText(criteria)}. Fleiss com as réplicas como avaliadores; EP analítico quando o número de réplicas é constante e o peso é nominal, jackknife nos demais casos.`,
  };

  const referenceTable: AnalysisTable = {
    title: 'Concordância e eficácia de cada avaliador com a referência',
    columns: [
      'Avaliador',
      'Itens',
      'Observações',
      'κ',
      'EP',
      'IC inf.',
      'IC sup.',
      'Eficácia',
      'IC Wilson inf.',
      'IC Wilson sup.',
      'FAR',
      'FRR',
      'Veredito',
    ],
    rows: vsReference.map((result) => [
      result.rater,
      result.items,
      result.trials,
      fmt(result.kappa.kappa),
      fmt(result.kappa.se),
      fmt(result.kappa.ciLow),
      fmt(result.kappa.ciHigh),
      fmt(result.effectiveness),
      fmt(result.effectivenessCi?.[0] ?? null),
      fmt(result.effectivenessCi?.[1] ?? null),
      fmt(result.falseAcceptRate),
      fmt(result.falseRejectRate),
      verdictLabel(result.verdict),
    ]),
    note: `${kappaCriterionText(criteria)}. Eficácia = acertos/observações; FAR = falsos aceites/referências rejeitadas; FRR = falsos rejeites/referências aceitas; ICs de Wilson. O kappa usa a primeira réplica; eficácia/FAR/FRR usam todas as réplicas.`,
  };

  const confusionTables: AnalysisTable[] = vsReference.map((result) => ({
    title: `Matriz de concordância com a referência — ${result.rater}`,
    columns: ['Avaliador \\ Referência', ...categories, 'Total'],
    rows: categories.map((category, rowIndex) => [
      category,
      ...result.confusion[rowIndex],
      sum(result.confusion[rowIndex]),
    ]),
    note:
      'Contagem de todas as réplicas. Linhas = categoria atribuída pelo avaliador; colunas = categoria de referência.',
  }));

  const diagnosticRows: Array<Array<string | number>> = [];
  for (const result of vsReference) {
    if (
      result.referenceAccepts !== null &&
      result.referenceRejects !== null &&
      result.falseRejects !== null &&
      result.falseAccepts !== null &&
      result.trials > 0
    ) {
      const tp = result.referenceAccepts - result.falseRejects;
      const fn = result.falseRejects;
      const fp = result.falseAccepts;
      const tn = result.referenceRejects - result.falseAccepts;
      const prevalence = result.referenceAccepts / result.trials;
      const diag = computeQualitativeDiagnosticMetrics(
        tp,
        fp,
        fn,
        tn,
        prevalence,
        confidence,
      );
      const pctCi = (val: number | null, ci: [number, number] | null) =>
        val === null
          ? '—'
          : ci
            ? `${(val * 100).toFixed(1)}% [${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}%]`
            : `${(val * 100).toFixed(1)}%`;
      diagnosticRows.push([
        result.rater,
        pctCi(diag.sensitivity, diag.sensitivityCi),
        pctCi(diag.specificity, diag.specificityCi),
        diag.lrPositive !== null ? fmt(diag.lrPositive) : '—',
        diag.lrNegative !== null ? fmt(diag.lrNegative) : '—',
        diag.ppv !== null ? `${(diag.ppv * 100).toFixed(1)}%` : '—',
        diag.npv !== null ? `${(diag.npv * 100).toFixed(1)}%` : '—',
        diag.youdenJ !== null ? fmt(diag.youdenJ) : '—',
      ]);
    }
  }
  const diagnosticTables: AnalysisTable[] =
    diagnosticRows.length > 0
      ? [
          {
            title:
              'Desempenho Diagnóstico Qualitativo (Eurachem Qualitative Analysis 2021)',
            columns: [
              'Avaliador',
              'Sensibilidade (IC 95%)',
              'Especificidade (IC 95%)',
              'LR+',
              'LR−',
              'VPP',
              'VPN',
              'Índice de Youden (J)',
            ],
            rows: diagnosticRows,
            note:
              'Intervalos de confiança de Wilson Score (95%). LR+ = Se/(1−Sp); LR− = (1−Se)/Sp (com correção de Haldane 0,5 em contagens zero); VPP/VPN calculados na prevalência observada.',
          },
        ]
      : [];

  const kappaChartData: Array<Record<string, string | number | null>> = [];
  if (interRater.kappa !== null && Number.isFinite(interRater.kappa)) {
    kappaChartData.push({
      fonte: 'Interavaliadores',
      kappa: interRater.kappa,
    });
  }
  for (const result of intraRater) {
    if (result.kappa.kappa !== null && Number.isFinite(result.kappa.kappa)) {
      kappaChartData.push({
        fonte: `Intra — ${result.rater}`,
        kappa: result.kappa.kappa,
      });
    }
  }
  for (const result of vsReference) {
    if (result.kappa.kappa !== null && Number.isFinite(result.kappa.kappa)) {
      kappaChartData.push({
        fonte: `Referência — ${result.rater}`,
        kappa: result.kappa.kappa,
      });
    }
  }

  const effectivenessChartData: Array<Record<string, string | number | null>> =
    vsReference
      .filter(
        (result) =>
          result.effectiveness !== null && Number.isFinite(result.effectiveness),
      )
      .map((result) => ({
        avaliador: result.rater,
        eficacia: result.effectiveness,
      }));

  const charts: AnalysisChart[] = [];
  if (kappaChartData.length > 0) {
    charts.push({
      kind: 'bar',
      title: 'Kappa por fonte de concordância',
      xLabel: 'Fonte',
      yLabel: 'Kappa',
      data: kappaChartData,
    });
  }
  if (effectivenessChartData.length > 0) {
    charts.push({
      kind: 'bar',
      title: 'Eficácia por avaliador',
      xLabel: 'Avaliador',
      yLabel: 'Eficácia',
      data: effectivenessChartData,
    });
  }

  const intraValues = intraRater
    .map((result) => result.kappa.kappa)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const referenceValues = vsReference
    .map((result) => result.kappa.kappa)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const effectivenessValues = vsReference
    .map((result) => result.effectiveness)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const farValues = vsReference
    .map((result) => result.falseAcceptRate)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const frrValues = vsReference
    .map((result) => result.falseRejectRate)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const minOrNull = (values: number[]): number | null =>
    values.length ? Math.min(...values) : null;
  const maxOrNull = (values: number[]): number | null =>
    values.length ? Math.max(...values) : null;

  const rawMetrics: Record<string, number | null> = {
    items: items.length,
    raters: raters.length,
    replicates,
    observations: observations.length,
    missing,
    reference_items: itemsWithReference.length,
    reference_coverage_pct: referenceCoveragePct,
    inter_kappa: interRater.kappa,
    inter_se: interRater.se,
    inter_ci_low: interRater.ciLow,
    inter_ci_high: interRater.ciHigh,
    intra_kappa_min: minOrNull(intraValues),
    intra_kappa_max: maxOrNull(intraValues),
    reference_kappa_min: minOrNull(referenceValues),
    reference_kappa_max: maxOrNull(referenceValues),
    effectiveness_min: minOrNull(effectivenessValues),
    effectiveness_max: maxOrNull(effectivenessValues),
    far_max: maxOrNull(farValues),
    frr_max: maxOrNull(frrValues),
    kappa_accept: criteria.kappaAccept,
    kappa_warning: criteria.kappaWarning,
    confidence,
  };

  const interKappaText =
    interRater.kappa === null ? '—' : fmt(interRater.kappa);
  const intraText =
    intraValues.length === 0
      ? 'não avaliada'
      : `${fmt(minOrNull(intraValues))}–${fmt(maxOrNull(intraValues))}`;
  const referenceText =
    referenceValues.length === 0
      ? 'não avaliada'
      : `${fmt(minOrNull(referenceValues))}–${fmt(maxOrNull(referenceValues))}`;
  const effectivenessText =
    effectivenessValues.length === 0
      ? 'não avaliada'
      : `${fmt(minOrNull(effectivenessValues))}–${fmt(maxOrNull(effectivenessValues))}`;
  const summary = `Concordância de atributo: ${items.length} itens, ${raters.length} avaliadores e ${replicates} réplica(s); κ interavaliadores = ${interKappaText}; κ intra-avaliador = ${intraText}; κ com a referência = ${referenceText}; eficácia = ${effectivenessText}. Veredito global: ${verdictLabel(verdict)}.`;

  return {
    n: observations.length,
    items: items.length,
    raters: raters.length,
    replicates,
    missing,
    categories,
    weight,
    confidence,
    criteria,
    interRater,
    pairwise,
    intraRater,
    vsReference,
    referenceCoveragePct,
    metrics,
    rawMetrics,
    tables: [
      designTable,
      pairwiseTable,
      intraTable,
      referenceTable,
      ...confusionTables,
      ...diagnosticTables,
    ],
    charts,
    warnings: [...warnings],
    notes,
    summary,
    verdict,
    method:
      'Concordância de atributo: Cohen/Fleiss, kappa ponderado, intra-avaliador, referência, eficácia, FAR e FRR',
    reference: REFERENCE,
  };
}
