/**
 * Gage R&R cruzado por ANOVA (método dos momentos).
 *
 * Modelo aleatório de dois fatores cruzados com interação:
 *   y_ijk = μ + P_i + O_j + (PO)_ij + e_ijk
 * com P_i ~ N(0, σ²_peça), O_j ~ N(0, σ²_oper), (PO)_ij ~ N(0, σ²_inter)
 * e e_ijk ~ N(0, σ²_rep).
 *
 * O teste da interação usa F = MS_PO/MS_E. Quando p > limiar (padrão 0,25),
 * o modelo sem interação é adotado e SS_PO é agregada ao erro. Componentes
 * negativos são truncados em zero e sinalizados. Os intervalos de confiança
 * usam a aproximação de Satterthwaite para os graus de liberdade efetivos.
 *
 * Referências:
 *  - AIAG (2010). Measurement Systems Analysis Reference Manual, 4. ed.,
 *    seção de estudos Gage R&R cruzados.
 *  - Montgomery, D. C. (2020). Design and Analysis of Experiments, 10. ed.,
 *    cap. 13 (modelos aleatórios e componentes de variância).
 *  - Burdick, R. K., Borror, C. M. & Montgomery, D. C. (2003). A review of
 *    methods for measurement systems capability analysis. Journal of Quality
 *    Technology, 35(4), 342–354.
 *  - Satterthwaite, F. E. (1946). An approximate distribution of estimates of
 *    variance components. Biometrics Bulletin, 2(6), 110–114.
 *  - ISO 22514-7:2021 — capability of measurement processes.
 */

import type { Verdict } from '../lib/types';
import type { AnalysisChart, AnalysisTable } from './analysis-types';
import { mean, sd } from './descriptive';
import { chi2Inv, fCdf, fInv, fmt } from './distributions';

export type GageRRValue = number | null | undefined;
export type GageRRMatrix = ReadonlyArray<ReadonlyArray<ReadonlyArray<GageRRValue>>>;

/**
 * Entrada do estudo. `y[parte][operador][réplica]`; valores nulos ou ausentes
 * representam dados faltantes. `tolerance` é T = USL − LSL; quando ausente,
 * %P/T fica não avaliado. `k` é o multiplicador de %P/T (padrão 6).
 */
export interface GageRRInput {
  y: GageRRMatrix;
  tolerance?: number | null;
  k?: number;
  partLabels?: readonly string[];
  operatorLabels?: readonly string[];
}

/** Limites editáveis de aceitação. Podem vir de um perfil de método. */
export interface GageRRCriteria {
  /** %GRR ≤ grrAccept é conforme. */
  grrAccept: number;
  /** %GRR > grrAccept e ≤ grrWarning é atenção. */
  grrWarning: number;
  /** %P/T ≤ ptAccept é conforme. */
  ptAccept: number;
  /** %P/T > ptAccept e ≤ ptWarning é atenção. */
  ptWarning: number;
  /** ndc mínimo para conformidade. */
  ndcMin: number;
}

export const DEFAULT_GAGERR_CRITERIA: Readonly<GageRRCriteria> = Object.freeze({
  grrAccept: 10,
  grrWarning: 30,
  ptAccept: 10,
  ptWarning: 30,
  ndcMin: 5,
});

export const DEFAULT_GAGERR_INTERACTION_THRESHOLD = 0.25;

export type GageRRModel = 'with_interaction' | 'without_interaction';
export type GageRRModelOption = 'auto' | GageRRModel;

export interface GageRROptions {
  /** Nível de confiança dos ICs; padrão 0,95. */
  confidence?: number;
  /** p acima do qual o modelo sem interação é adotado; padrão 0,25. */
  interactionThreshold?: number;
  /** Limites editáveis; os ausentes recebem os padrões AIAG. */
  criteria?: Partial<GageRRCriteria>;
  /** Fixa o modelo; o padrão `auto` decide pelo teste de interação. */
  model?: GageRRModelOption;
  /** Unidade das medições, apenas para exibição. */
  unit?: string;
}

export interface GageRRAnovaRow {
  source: string;
  df: number;
  ss: number;
  ms: number | null;
  f: number | null;
  p: number | null;
}

export interface GageRRAnovaTables {
  /** ANOVA completa com interação. */
  full: GageRRAnovaRow[];
  /** ANOVA do modelo reduzido (SS_PO + SS_E). */
  reduced: GageRRAnovaRow[] | null;
  selected: GageRRModel;
}

export interface GageRRInteraction {
  f: number | null;
  df1: number;
  df2: number;
  p: number | null;
  threshold: number;
  significant: boolean | null;
  model: GageRRModel;
  decision: string;
}

export interface GageRRConfidenceInterval {
  lower: number;
  upper: number;
  /** Graus de liberdade efetivos (Satterthwaite). */
  df: number;
  /** Segundo conjunto de gl para intervalos de razão de variâncias. */
  df2?: number;
  confidence: number;
  method: string;
}

export interface GageRRComponent {
  key: 'repeatability' | 'interaction' | 'operator' | 'part' | 'grr' | 'total';
  label: string;
  variance: number;
  standardDeviation: number;
  /** 100·variância/total (soma 100%). */
  contributionPct: number | null;
  /** 100·desvio/total (não soma 100%). */
  studyVariationPct: number | null;
  /** Variância antes do truncamento em zero. */
  rawVariance: number | null;
  truncated: boolean;
  /** Interação agregada ao erro no modelo reduzido. */
  pooled: boolean;
  formula: string;
  criterionText: string;
  verdict: Verdict;
  /** IC para o desvio-padrão do componente, quando estimável. */
  interval: GageRRConfidenceInterval | null;
}

export interface GageRRMetric {
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

export interface GageRRResult {
  n: number;
  nEff: number;
  missing: number;
  parts: number;
  operators: number;
  replicates: number;
  cells: number;
  balanced: boolean;
  rEff: number;
  tolerance: number | null;
  k: number;
  confidence: number;
  interactionThreshold: number;
  model: GageRRModel;
  anova: GageRRAnovaTables;
  interaction: GageRRInteraction;
  components: GageRRComponent[];
  metrics: GageRRMetric[];
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
  method: string;
  reference: string;
}

interface GageRRCell {
  part: number;
  operator: number;
  values: number[];
  n: number;
  mean: number | null;
  sd: number | null;
  range: number | null;
  withinSs: number;
}

interface GageRRData {
  parts: number;
  operators: number;
  replicates: number;
  cells: GageRRCell[][];
  n: number;
  missing: number;
  kCells: number;
  balanced: boolean;
  rEff: number;
  partCounts: number[];
  operatorCounts: number[];
  partMeans: number[];
  operatorMeans: number[];
  grandMean: number;
  partLabels: string[];
  operatorLabels: string[];
}

interface AnovaCore {
  parts: number;
  operators: number;
  n: number;
  kCells: number;
  rEff: number;
  balanced: boolean;
  ssP: number;
  ssO: number;
  ssPO: number;
  ssE: number;
  ssTotal: number;
  dfP: number;
  dfO: number;
  dfPO: number;
  dfE: number;
  dfTotal: number;
  msP: number;
  msO: number;
  msPO: number;
  msE: number;
  fP: number | null;
  fO: number | null;
  fPO: number | null;
  pP: number | null;
  pO: number | null;
  pPO: number | null;
}

interface ReducedAnova {
  ssError: number;
  dfError: number;
  msError: number;
  fP: number | null;
  fO: number | null;
  pP: number | null;
  pO: number | null;
}

interface ComponentDraft {
  key: GageRRComponent['key'];
  label: string;
  variance: number;
  rawVariance: number | null;
  truncated: boolean;
  pooled: boolean;
  formula: string;
  df: number | null;
}

interface ComponentModel {
  components: GageRRComponent[];
  grrVariance: number;
  partVariance: number;
  totalVariance: number;
  grrDf: number | null;
  partDf: number | null;
}

const REFERENCE =
  'AIAG (2010), MSA Reference Manual, 4. ed.; Montgomery (2020), cap. 13; Burdick, Borror & Montgomery (2003); Satterthwaite (1946).';

const CI_REFERENCE =
  'Satterthwaite (1946); AIAG (2010), MSA Reference Manual, 4. ed.; Burdick, Borror & Montgomery (2003).';

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

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return numerator === 0 ? 0 : Infinity;
  return numerator / denominator;
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

function cellLabel(partLabel: string, operatorLabel: string): string {
  return `${partLabel} × ${operatorLabel}`;
}

function extractData(input: GageRRInput): GageRRData {
  const y = input.y;
  if (!Array.isArray(y) || y.length < 2) {
    throw new Error('Gage R&R requer pelo menos 2 peças (y[parte][operador][réplica]).');
  }
  const parts = y.length;
  const firstPart = y[0];
  const operators = firstPart ? firstPart.length : 0;
  if (operators < 2) {
    throw new Error('Gage R&R cruzado requer pelo menos 2 operadores.');
  }
  const firstOperator = firstPart?.[0];
  const replicates = firstOperator ? firstOperator.length : 0;
  if (replicates < 2) {
    throw new Error(
      'Gage R&R requer pelo menos 2 réplicas por combinação peça × operador; r = 1 não permite estimar a repetibilidade.',
    );
  }
  for (let i = 0; i < parts; i++) {
    if (y[i].length !== operators) {
      throw new Error(
        `Formato inválido: a peça ${i + 1} deve ter ${operators} operadores, mas tem ${y[i].length}.`,
      );
    }
    for (let j = 0; j < operators; j++) {
      if (y[i][j].length !== replicates) {
        throw new Error(
          `Formato inválido: y[${i}][${j}] deve ter ${replicates} réplicas, mas tem ${y[i][j].length}.`,
        );
      }
    }
  }

  const partLabels = input.partLabels
    ? [...input.partLabels]
    : Array.from({ length: parts }, (_, i) => `Peça ${i + 1}`);
  const operatorLabels = input.operatorLabels
    ? [...input.operatorLabels]
    : Array.from({ length: operators }, (_, j) => `Operador ${j + 1}`);
  if (partLabels.length !== parts) {
    throw new Error(`partLabels deve ter ${parts} rótulos.`);
  }
  if (operatorLabels.length !== operators) {
    throw new Error(`operatorLabels deve ter ${operators} rótulos.`);
  }

  const cells: GageRRCell[][] = [];
  const partCounts = new Array<number>(parts).fill(0);
  const operatorCounts = new Array<number>(operators).fill(0);
  let n = 0;
  let missing = 0;
  let kCells = 0;
  let maxCellN = 0;

  for (let i = 0; i < parts; i++) {
    const row: GageRRCell[] = [];
    for (let j = 0; j < operators; j++) {
      const raw = y[i][j];
      const values: number[] = [];
      for (let k = 0; k < replicates; k++) {
        const value = raw[k];
        if (value === null || value === undefined) {
          missing++;
          continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(
            `Valor inválido em y[${i}][${j}][${k}]: ${String(value)}. Use número, null ou ausente.`,
          );
        }
        values.push(value);
      }
      const cellN = values.length;
      const cellMean = cellN ? mean(values) : null;
      let withinSs = 0;
      if (cellMean !== null) {
        for (const value of values) withinSs += (value - cellMean) ** 2;
      }
      const cellSd = cellN >= 2 ? sd(values) : null;
      const range = cellN
        ? Math.max(...values) - Math.min(...values)
        : null;
      row.push({
        part: i,
        operator: j,
        values,
        n: cellN,
        mean: cellMean,
        sd: cellSd,
        range,
        withinSs,
      });
      n += cellN;
      partCounts[i] += cellN;
      operatorCounts[j] += cellN;
      if (cellN > 0) kCells++;
      if (cellN > maxCellN) maxCellN = cellN;
    }
    cells.push(row);
  }

  if (maxCellN < 2) {
    throw new Error(
      'Gage R&R requer pelo menos 2 réplicas válidas em alguma combinação peça × operador; r = 1 não permite estimar a repetibilidade.',
    );
  }
  for (let i = 0; i < parts; i++) {
    if (partCounts[i] === 0) {
      throw new Error(`${partLabels[i]} não possui nenhuma observação válida.`);
    }
  }
  for (let j = 0; j < operators; j++) {
    if (operatorCounts[j] === 0) {
      throw new Error(`${operatorLabels[j]} não possui nenhuma observação válida.`);
    }
  }
  if (n === 0 || kCells === 0) {
    throw new Error('Nenhuma observação válida para o estudo de Gage R&R.');
  }

  const balanced = cells.every((row) => row.every((cell) => cell.n === replicates));
  const grandSum = cells.reduce(
    (sum, row) => sum + row.reduce((rowSum, cell) => rowSum + (cell.mean ?? 0) * cell.n, 0),
    0,
  );
  const grandMean = grandSum / n;
  const partMeans = cells.map((row) => {
    const total = row.reduce((sum, cell) => sum + (cell.mean ?? 0) * cell.n, 0);
    return total / partCounts[row[0].part];
  });
  const operatorMeans = Array.from({ length: operators }, (_, j) => {
    let total = 0;
    for (let i = 0; i < parts; i++) total += (cells[i][j].mean ?? 0) * cells[i][j].n;
    return total / operatorCounts[j];
  });

  return {
    parts,
    operators,
    replicates,
    cells,
    n,
    missing,
    kCells,
    balanced,
    rEff: n / kCells,
    partCounts,
    operatorCounts,
    partMeans,
    operatorMeans,
    grandMean,
    partLabels,
    operatorLabels,
  };
}

function balancedAnova(data: GageRRData): AnovaCore {
  const { parts, operators, replicates, grandMean } = data;
  let ssP = 0;
  let ssO = 0;
  let ssPO = 0;
  let ssE = 0;
  for (let i = 0; i < parts; i++) {
    ssP += operators * replicates * (data.partMeans[i] - grandMean) ** 2;
  }
  for (let j = 0; j < operators; j++) {
    ssO += parts * replicates * (data.operatorMeans[j] - grandMean) ** 2;
  }
  for (let i = 0; i < parts; i++) {
    for (let j = 0; j < operators; j++) {
      const cell = data.cells[i][j];
      const interaction = (cell.mean ?? grandMean) - data.partMeans[i] - data.operatorMeans[j] + grandMean;
      ssPO += replicates * interaction * interaction;
      ssE += cell.withinSs;
    }
  }
  const ssTotal = ssP + ssO + ssPO + ssE;
  const dfP = parts - 1;
  const dfO = operators - 1;
  const dfPO = (parts - 1) * (operators - 1);
  const dfE = parts * operators * (replicates - 1);
  const dfTotal = data.n - 1;
  const msP = ssP / dfP;
  const msO = ssO / dfO;
  const msPO = ssPO / dfPO;
  const msE = ssE / dfE;
  const fP = ratio(msP, msPO);
  const fO = ratio(msO, msPO);
  const fPO = ratio(msPO, msE);
  return {
    parts,
    operators,
    n: data.n,
    kCells: data.kCells,
    rEff: data.rEff,
    balanced: true,
    ssP,
    ssO,
    ssPO,
    ssE,
    ssTotal,
    dfP,
    dfO,
    dfPO,
    dfE,
    dfTotal,
    msP,
    msO,
    msPO,
    msE,
    fP,
    fO,
    fPO,
    pP: pFromF(fP, dfP, dfPO),
    pO: pFromF(fO, dfO, dfPO),
    pPO: pFromF(fPO, dfPO, dfE),
  };
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = matrix.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error(
        'Dados faltantes impedem estimar o modelo aditivo; complete as células vazias ou remova peças/operadores sem observações.',
      );
    }
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
    }
    const diagonal = a[col][col];
    for (let row = col + 1; row < size; row++) {
      const factor = a[row][col] / diagonal;
      if (factor === 0) continue;
      for (let k = col; k <= size; k++) {
        a[row][k] -= factor * a[col][k];
      }
    }
  }
  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    let value = a[row][size];
    for (let col = row + 1; col < size; col++) {
      value -= a[row][col] * solution[col];
    }
    solution[row] = value / a[row][row];
  }
  return solution;
}

function unbalancedAnova(data: GageRRData): AnovaCore {
  const { parts, operators, kCells, n } = data;
  if (kCells < parts + operators - 1) {
    throw new Error(
      'Dados insuficientes para separar peça, operador e interação; complete o delineamento.',
    );
  }
  let ssCells = 0;
  let ssE = 0;
  let ssP = 0;
  for (let i = 0; i < parts; i++) {
    for (let j = 0; j < operators; j++) {
      const cell = data.cells[i][j];
      if (!cell.n || cell.mean === null) continue;
      ssCells += cell.n * (cell.mean - data.grandMean) ** 2;
      ssE += cell.withinSs;
      ssP += cell.n * (data.partMeans[i] - data.grandMean) ** 2;
    }
  }

  // Modelo aditivo ponderado (peça + operador) por mínimos quadrados.
  const parameterCount = 1 + (parts - 1) + (operators - 1);
  const xtx = Array.from({ length: parameterCount }, () =>
    new Array<number>(parameterCount).fill(0),
  );
  const xty = new Array<number>(parameterCount).fill(0);
  for (let i = 0; i < parts; i++) {
    for (let j = 0; j < operators; j++) {
      const cell = data.cells[i][j];
      if (!cell.n || cell.mean === null) continue;
      const x = new Array<number>(parameterCount).fill(0);
      x[0] = 1;
      if (i > 0) x[1 + (i - 1)] = 1;
      if (j > 0) x[1 + (parts - 1) + (j - 1)] = 1;
      for (let a = 0; a < parameterCount; a++) {
        if (x[a] === 0) continue;
        xty[a] += cell.n * x[a] * cell.mean;
        for (let b = 0; b < parameterCount; b++) {
          if (x[b] === 0) continue;
          xtx[a][b] += cell.n * x[a] * x[b];
        }
      }
    }
  }
  const beta = solveLinearSystem(xtx, xty);
  let ssMain = 0;
  for (let i = 0; i < parts; i++) {
    for (let j = 0; j < operators; j++) {
      const cell = data.cells[i][j];
      if (!cell.n || cell.mean === null) continue;
      let fitted = beta[0];
      if (i > 0) fitted += beta[1 + (i - 1)];
      if (j > 0) fitted += beta[1 + (parts - 1) + (j - 1)];
      ssMain += cell.n * (fitted - data.grandMean) ** 2;
    }
  }
  const ssO = Math.max(0, ssMain - ssP);
  const ssPO = Math.max(0, ssCells - ssMain);
  const ssTotal = ssP + ssO + ssPO + ssE;
  const dfP = parts - 1;
  const dfO = operators - 1;
  const dfPO = kCells - parts - operators + 1;
  const dfE = n - kCells;
  if (dfPO <= 0 || dfE <= 0) {
    throw new Error(
      'Dados insuficientes para estimar os graus de liberdade da interação ou do erro; complete o delineamento.',
    );
  }
  const msP = ssP / dfP;
  const msO = ssO / dfO;
  const msPO = ssPO / dfPO;
  const msE = ssE / dfE;
  const fP = ratio(msP, msPO);
  const fO = ratio(msO, msPO);
  const fPO = ratio(msPO, msE);
  return {
    parts,
    operators,
    n,
    kCells,
    rEff: data.rEff,
    balanced: false,
    ssP,
    ssO,
    ssPO,
    ssE,
    ssTotal,
    dfP,
    dfO,
    dfPO,
    dfE,
    dfTotal: n - 1,
    msP,
    msO,
    msPO,
    msE,
    fP,
    fO,
    fPO,
    pP: pFromF(fP, dfP, dfPO),
    pO: pFromF(fO, dfO, dfPO),
    pPO: pFromF(fPO, dfPO, dfE),
  };
}

function buildReducedAnova(anova: AnovaCore): ReducedAnova {
  const ssError = anova.ssPO + anova.ssE;
  const dfError = anova.dfPO + anova.dfE;
  const msError = ssError / dfError;
  const fP = ratio(anova.msP, msError);
  const fO = ratio(anova.msO, msError);
  return {
    ssError,
    dfError,
    msError,
    fP,
    fO,
    pP: pFromF(fP, anova.dfP, dfError),
    pO: pFromF(fO, anova.dfO, dfError),
  };
}

function satterthwaite(
  terms: Array<{ ms: number; coefficient: number; df: number }>,
): number | null {
  let estimate = 0;
  let denominator = 0;
  for (const term of terms) {
    if (!(term.df > 0) || !Number.isFinite(term.ms)) return null;
    const contribution = term.coefficient * term.ms;
    estimate += contribution;
    denominator += (contribution * contribution) / term.df;
  }
  if (!(estimate > 0) || !(denominator > 0)) return null;
  return (estimate * estimate) / denominator;
}

function chiSquareSdInterval(
  variance: number,
  df: number | null,
  confidence: number,
): GageRRConfidenceInterval | null {
  if (!(variance > 0) || df === null || !(df > 0)) return null;
  const alpha = 1 - confidence;
  const lowerVariance = (df * variance) / chi2Inv(1 - alpha / 2, df);
  const upperVariance = (df * variance) / chi2Inv(alpha / 2, df);
  if (!Number.isFinite(lowerVariance) || !Number.isFinite(upperVariance)) return null;
  const lower = safeSqrt(lowerVariance);
  const upper = safeSqrt(Math.max(lowerVariance, upperVariance));
  return {
    lower,
    upper,
    df,
    confidence,
    method: 'Satterthwaite (χ²)',
  };
}

function ratioPctInterval(
  grrVariance: number,
  partVariance: number,
  dfGrr: number | null,
  dfPart: number | null,
  confidence: number,
): GageRRConfidenceInterval | null {
  if (
    !(grrVariance > 0) ||
    !(partVariance > 0) ||
    dfGrr === null ||
    dfPart === null ||
    !(dfGrr > 0) ||
    !(dfPart > 0)
  ) {
    return null;
  }
  const alpha = 1 - confidence;
  const fHigh = fInv(1 - alpha / 2, dfGrr, dfPart);
  const fLow = fInv(alpha / 2, dfGrr, dfPart);
  if (!Number.isFinite(fHigh) || !Number.isFinite(fLow) || fHigh <= 0 || fLow <= 0) {
    return null;
  }
  const varianceRatio = grrVariance / partVariance;
  const ratioLow = varianceRatio / fHigh;
  const ratioHigh = varianceRatio / fLow;
  const thetaLow = ratioLow / (1 + ratioLow);
  const thetaHigh = ratioHigh / (1 + ratioHigh);
  const lower = 100 * safeSqrt(thetaLow);
  const upper = 100 * safeSqrt(thetaHigh);
  return {
    lower: Math.min(lower, upper),
    upper: Math.max(lower, upper),
    df: dfGrr,
    df2: dfPart,
    confidence,
    method: 'Satterthwaite (razão F)',
  };
}

function buildComponents(
  anova: AnovaCore,
  reduced: ReducedAnova,
  useReduced: boolean,
  confidence: number,
): ComponentModel {
  const { parts, operators, rEff } = anova;
  const rLabel = anova.balanced ? 'r' : 'r_eff';
  let repVariance: number;
  let repDf: number;
  let intRaw: number | null;
  let intVariance: number;
  let intDf: number | null;
  let opRaw: number;
  let partRaw: number;
  let opDf: number | null;
  let partDf: number | null;
  let grrDf: number | null;

  if (useReduced) {
    repVariance = reduced.msError;
    repDf = reduced.dfError;
    intRaw = null;
    intVariance = 0;
    intDf = null;
    opRaw = (anova.msO - reduced.msError) / (parts * rEff);
    partRaw = (anova.msP - reduced.msError) / (operators * rEff);
    opDf = satterthwaite([
      { ms: anova.msO, coefficient: 1 / (parts * rEff), df: anova.dfO },
      { ms: reduced.msError, coefficient: -1 / (parts * rEff), df: reduced.dfError },
    ]);
    partDf = satterthwaite([
      { ms: anova.msP, coefficient: 1 / (operators * rEff), df: anova.dfP },
      { ms: reduced.msError, coefficient: -1 / (operators * rEff), df: reduced.dfError },
    ]);
    grrDf = satterthwaite([
      { ms: reduced.msError, coefficient: 1 - 1 / (parts * rEff), df: reduced.dfError },
      { ms: anova.msO, coefficient: 1 / (parts * rEff), df: anova.dfO },
    ]);
  } else {
    repVariance = anova.msE;
    repDf = anova.dfE;
    intRaw = (anova.msPO - anova.msE) / rEff;
    intVariance = Math.max(0, intRaw);
    intDf = satterthwaite([
      { ms: anova.msPO, coefficient: 1 / rEff, df: anova.dfPO },
      { ms: anova.msE, coefficient: -1 / rEff, df: anova.dfE },
    ]);
    opRaw = (anova.msO - anova.msPO) / (parts * rEff);
    partRaw = (anova.msP - anova.msPO) / (operators * rEff);
    opDf = satterthwaite([
      { ms: anova.msO, coefficient: 1 / (parts * rEff), df: anova.dfO },
      { ms: anova.msPO, coefficient: -1 / (parts * rEff), df: anova.dfPO },
    ]);
    partDf = satterthwaite([
      { ms: anova.msP, coefficient: 1 / (operators * rEff), df: anova.dfP },
      { ms: anova.msPO, coefficient: -1 / (operators * rEff), df: anova.dfPO },
    ]);
    grrDf = satterthwaite([
      { ms: anova.msE, coefficient: 1 - 1 / rEff, df: anova.dfE },
      {
        ms: anova.msPO,
        coefficient: 1 / rEff - 1 / (parts * rEff),
        df: anova.dfPO,
      },
      { ms: anova.msO, coefficient: 1 / (parts * rEff), df: anova.dfO },
    ]);
  }

  const opVariance = Math.max(0, opRaw);
  const partVariance = Math.max(0, partRaw);
  const grrVariance = repVariance + opVariance + intVariance;
  const totalVariance = grrVariance + partVariance;

  const drafts: ComponentDraft[] = [
    {
      key: 'repeatability',
      label: 'Repetibilidade (σ²_rep)',
      variance: repVariance,
      rawVariance: repVariance,
      truncated: false,
      pooled: false,
      formula: useReduced ? 'σ²_rep = MS_E,red' : 'σ²_rep = MS_E',
      df: repDf,
    },
    {
      key: 'interaction',
      label: 'Interação peça × operador (σ²_inter)',
      variance: intVariance,
      rawVariance: intRaw,
      truncated: intRaw !== null && intRaw < 0,
      pooled: useReduced,
      formula: useReduced
        ? 'σ²_inter = 0 (SS_PO agregado ao erro)'
        : `σ²_inter = max(0, (MS_PO − MS_E)/${rLabel})`,
      df: intDf,
    },
    {
      key: 'operator',
      label: 'Reprodutibilidade (σ²_oper)',
      variance: opVariance,
      rawVariance: opRaw,
      truncated: opRaw < 0,
      pooled: false,
      formula: useReduced
        ? `σ²_oper = max(0, (MS_O − MS_E,red)/(p·${rLabel}))`
        : `σ²_oper = max(0, (MS_O − MS_PO)/(p·${rLabel}))`,
      df: opDf,
    },
    {
      key: 'part',
      label: 'Peça (σ²_peça)',
      variance: partVariance,
      rawVariance: partRaw,
      truncated: partRaw < 0,
      pooled: false,
      formula: useReduced
        ? `σ²_peça = max(0, (MS_P − MS_E,red)/(o·${rLabel}))`
        : `σ²_peça = max(0, (MS_P − MS_PO)/(o·${rLabel}))`,
      df: partDf,
    },
    {
      key: 'grr',
      label: 'Gage R&R (σ²_GRR)',
      variance: grrVariance,
      rawVariance: grrVariance,
      truncated: false,
      pooled: false,
      formula: 'σ²_GRR = σ²_rep + σ²_oper + σ²_inter',
      df: grrDf,
    },
    {
      key: 'total',
      label: 'Total (σ²_total)',
      variance: totalVariance,
      rawVariance: totalVariance,
      truncated: false,
      pooled: false,
      formula: 'σ²_total = σ²_GRR + σ²_peça',
      df: null,
    },
  ];

  const totalSd = safeSqrt(totalVariance);
  const components: GageRRComponent[] = drafts.map((draft) => {
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
      pooled: draft.pooled,
      formula: draft.formula,
      criterionText: 'Sem critério cadastrado; componente descritivo.',
      verdict: 'not_evaluated',
      interval: chiSquareSdInterval(draft.variance, draft.df, confidence),
    };
  });

  return {
    components,
    grrVariance,
    partVariance,
    totalVariance,
    grrDf,
    partDf,
  };
}

function buildFullRows(anova: AnovaCore): GageRRAnovaRow[] {
  return [
    {
      source: 'Peça',
      df: anova.dfP,
      ss: anova.ssP,
      ms: anova.msP,
      f: anova.fP,
      p: anova.pP,
    },
    {
      source: 'Operador',
      df: anova.dfO,
      ss: anova.ssO,
      ms: anova.msO,
      f: anova.fO,
      p: anova.pO,
    },
    {
      source: 'Peça × Operador',
      df: anova.dfPO,
      ss: anova.ssPO,
      ms: anova.msPO,
      f: anova.fPO,
      p: anova.pPO,
    },
    {
      source: 'Repetibilidade (erro)',
      df: anova.dfE,
      ss: anova.ssE,
      ms: anova.msE,
      f: null,
      p: null,
    },
    {
      source: 'Total',
      df: anova.dfTotal,
      ss: anova.ssTotal,
      ms: null,
      f: null,
      p: null,
    },
  ];
}

function buildReducedRows(anova: AnovaCore, reduced: ReducedAnova): GageRRAnovaRow[] {
  return [
    {
      source: 'Peça',
      df: anova.dfP,
      ss: anova.ssP,
      ms: anova.msP,
      f: reduced.fP,
      p: reduced.pP,
    },
    {
      source: 'Operador',
      df: anova.dfO,
      ss: anova.ssO,
      ms: anova.msO,
      f: reduced.fO,
      p: reduced.pO,
    },
    {
      source: 'Erro (peça × operador + repetibilidade)',
      df: reduced.dfError,
      ss: reduced.ssError,
      ms: reduced.msError,
      f: null,
      p: null,
    },
    {
      source: 'Total',
      df: anova.dfTotal,
      ss: anova.ssTotal,
      ms: null,
      f: null,
      p: null,
    },
  ];
}

function anovaTable(title: string, rows: GageRRAnovaRow[], note: string): AnalysisTable {
  return {
    title,
    columns: ['Fonte', 'gl', 'SS', 'MS', 'F', 'p'],
    rows: rows.map((row) => [
      row.source,
      row.df,
      round6(row.ss) ?? '—',
      round6(row.ms) ?? '—',
      round6(row.f) ?? '—',
      formatP(row.p),
    ]),
    note,
  };
}

function cellTable(data: GageRRData): AnalysisTable {
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < data.parts; i++) {
    for (let j = 0; j < data.operators; j++) {
      const cell = data.cells[i][j];
      rows.push([
        data.partLabels[i],
        data.operatorLabels[j],
        cell.n,
        round6(cell.mean) ?? '—',
        round6(cell.sd) ?? '—',
        round6(cell.range) ?? '—',
      ]);
    }
  }
  return {
    title: 'Médias e amplitudes por peça × operador',
    columns: ['Peça', 'Operador', 'n', 'Média', 'Desvio-padrão', 'Amplitude'],
    rows,
    note: 'Desvio-padrão amostral (n − 1); amplitude = máximo − mínimo.',
  };
}

function componentTable(components: GageRRComponent[]): AnalysisTable {
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
        : component.pooled
          ? 'agregado ao erro'
          : '—',
    ]),
    note: '% contribuição = 100·variância/total; % variação do estudo = 100·desvio/total. A segunda coluna não soma 100%.',
  };
}

function intervalTable(
  components: GageRRComponent[],
  intervals: GageRRResult['intervals'],
  metrics: GageRRMetric[],
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
    note: `IC de σ_GRR por χ²; IC de %GRR pela razão de variâncias GRR/peça com quantis F. ${CI_REFERENCE}`,
  };
}

function buildCharts(data: GageRRData): AnalysisChart[] {
  const means: AnalysisChart = {
    kind: 'line',
    title: 'Médias por peça × operador',
    xLabel: 'Peça',
    yLabel: 'Média',
    data: [],
  };
  const ranges: AnalysisChart = {
    kind: 'bar',
    title: 'Amplitude por peça × operador',
    xLabel: 'Peça',
    yLabel: 'Amplitude',
    data: [],
  };
  for (let i = 0; i < data.parts; i++) {
    for (let j = 0; j < data.operators; j++) {
      const cell = data.cells[i][j];
      const label = cellLabel(data.partLabels[i], data.operatorLabels[j]);
      means.data.push({
        part: data.partLabels[i],
        operator: data.operatorLabels[j],
        cell: label,
        mean: round6(cell.mean),
        n: cell.n,
      });
      ranges.data.push({
        part: data.partLabels[i],
        operator: data.operatorLabels[j],
        cell: label,
        range: round6(cell.range),
        n: cell.n,
      });
    }
  }
  return [means, ranges];
}

function buildSummary(metrics: GageRRMetric[], tolerance: number | null, verdict: Verdict): string {
  const grr = metrics.find((metric) => metric.key === 'grr_pct');
  const pt = metrics.find((metric) => metric.key === 'pt_pct');
  const ndc = metrics.find((metric) => metric.key === 'ndc');
  const grrText = grr && grr.value !== null
    ? `${fmt(grr.value)}% (${verdictLabel(grr.verdict)})`
    : 'não avaliado';
  const ptText = tolerance === null
    ? 'não avaliado (T não informado)'
    : pt && pt.value !== null
      ? `${fmt(pt.value)}% (${verdictLabel(pt.verdict)})`
      : 'não avaliado';
  const ndcText = ndc && ndc.value !== null
    ? `${fmt(ndc.value)} (${verdictLabel(ndc.verdict)})`
    : 'não avaliado';
  return `Gage R&R: %GRR = ${grrText}; %P/T = ${ptText}; ndc = ${ndcText}. Veredito global: ${verdictLabel(verdict)}.`;
}

function overallVerdict(metrics: GageRRMetric[]): Verdict {
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

/**
 * Executa o estudo Gage R&R cruzado por ANOVA.
 *
 * A entrada é `y[parte][operador][réplica]`. Dados faltantes são tratados por
 * análise por lista; o resultado registra n efetivo, r_eff e alerta de
 * aproximação dos componentes. r = 1 lança erro com mensagem explícita.
 */
export function gageRRAnalysis(
  input: GageRRInput,
  options: GageRROptions = {},
): GageRRResult {
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
  const interactionThreshold =
    options.interactionThreshold ?? DEFAULT_GAGERR_INTERACTION_THRESHOLD;
  if (!(interactionThreshold >= 0 && interactionThreshold <= 1)) {
    throw new Error('O limiar de interação deve estar entre 0 e 1 (ex.: 0,25).');
  }
  const criteria: GageRRCriteria = {
    grrAccept: options.criteria?.grrAccept ?? DEFAULT_GAGERR_CRITERIA.grrAccept,
    grrWarning: options.criteria?.grrWarning ?? DEFAULT_GAGERR_CRITERIA.grrWarning,
    ptAccept: options.criteria?.ptAccept ?? DEFAULT_GAGERR_CRITERIA.ptAccept,
    ptWarning: options.criteria?.ptWarning ?? DEFAULT_GAGERR_CRITERIA.ptWarning,
    ndcMin: options.criteria?.ndcMin ?? DEFAULT_GAGERR_CRITERIA.ndcMin,
  };
  for (const [label, value] of [
    ['%GRR conforme', criteria.grrAccept],
    ['%GRR atenção', criteria.grrWarning],
    ['%P/T conforme', criteria.ptAccept],
    ['%P/T atenção', criteria.ptWarning],
    ['ndc mínimo', criteria.ndcMin],
  ] as Array<[string, number]>) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`O limite de ${label} deve ser um número não negativo.`);
    }
  }
  if (criteria.grrWarning < criteria.grrAccept) {
    throw new Error('O limite de atenção de %GRR deve ser maior ou igual ao limite conforme.');
  }
  if (criteria.ptWarning < criteria.ptAccept) {
    throw new Error('O limite de atenção de %P/T deve ser maior ou igual ao limite conforme.');
  }
  if (criteria.ndcMin <= 0) {
    throw new Error('O ndc mínimo deve ser positivo.');
  }
  if (
    options.model !== undefined &&
    options.model !== 'auto' &&
    options.model !== 'with_interaction' &&
    options.model !== 'without_interaction'
  ) {
    throw new Error('Modelo inválido: use "auto", "with_interaction" ou "without_interaction".');
  }

  const data = extractData(input);
  const anova = data.balanced ? balancedAnova(data) : unbalancedAnova(data);
  const reduced = buildReducedAnova(anova);

  const significant =
    anova.pPO === null ? null : anova.pPO <= interactionThreshold;
  const autoModel: GageRRModel =
    significant === true ? 'with_interaction' : 'without_interaction';
  let model: GageRRModel;
  if (options.model === 'with_interaction') {
    model = 'with_interaction';
  } else if (options.model === 'without_interaction') {
    model = 'without_interaction';
  } else {
    model = autoModel;
  }
  const useReduced = model === 'without_interaction';
  const explicitModel = options.model !== undefined && options.model !== 'auto';

  const testText =
    significant === null
      ? 'Teste de interação indisponível.'
      : significant
        ? `Interação peça × operador significativa (F = ${fmt(anova.fPO)}, gl = ${anova.dfPO}, ${anova.dfE}, p = ${fmt(anova.pPO)} ≤ ${fmt(interactionThreshold)}).`
        : `Interação peça × operador não significativa (F = ${fmt(anova.fPO)}, gl = ${anova.dfPO}, ${anova.dfE}, p = ${fmt(anova.pPO)} > ${fmt(interactionThreshold)}).`;
  const modelText = useReduced
    ? 'sem interação (SS_PO agregada ao erro)'
    : 'com interação';
  const decision = explicitModel
    ? `${testText} Modelo fixado manualmente em ${modelText}.`
    : `${testText} Modelo ${modelText} adotado${significant === null ? ' por indisponibilidade do teste' : ''}.`;
  const interaction: GageRRInteraction = {
    f: anova.fPO,
    df1: anova.dfPO,
    df2: anova.dfE,
    p: anova.pPO,
    threshold: interactionThreshold,
    significant,
    model,
    decision,
  };

  const componentModel = buildComponents(anova, reduced, useReduced, confidence);
  const components = componentModel.components;
  const sigmaGrr = safeSqrt(componentModel.grrVariance);
  const totalSd = safeSqrt(componentModel.totalVariance);
  const grrPct =
    componentModel.totalVariance > 0 ? (100 * sigmaGrr) / totalSd : null;
  const ptPct = tolerance !== null ? (100 * k * sigmaGrr) / tolerance : null;
  const ndc =
    componentModel.grrVariance > 0
      ? componentModel.partVariance > 0
        ? Math.floor((1.41 * safeSqrt(componentModel.partVariance)) / sigmaGrr)
        : 0
      : null;

  const intervals = {
    sigmaGrr: chiSquareSdInterval(
      componentModel.grrVariance,
      componentModel.grrDf,
      confidence,
    ),
    grrPct: ratioPctInterval(
      componentModel.grrVariance,
      componentModel.partVariance,
      componentModel.grrDf,
      componentModel.partDf,
      confidence,
    ),
    ptPct:
      tolerance !== null && componentModel.grrVariance > 0 && componentModel.grrDf !== null
        ? (() => {
            const base = chiSquareSdInterval(
              componentModel.grrVariance,
              componentModel.grrDf,
              confidence,
            );
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
  const ptVerdict = tolerance === null ? 'not_evaluated' : classifyMax(ptPct, criteria.ptAccept, criteria.ptWarning);
  const ndcVerdict = classifyMin(ndc, criteria.ndcMin);
  const unit = options.unit ?? '';

  const sigmaMetric: GageRRMetric = {
    key: 'sigma_grr',
    label: 'Desvio-padrão do Gage R&R (σ_GRR)',
    value: componentModel.grrVariance > 0 ? sigmaGrr : componentModel.grrVariance === 0 ? 0 : null,
    unit,
    formula: 'σ_GRR = √(σ²_rep + σ²_oper + σ²_inter)',
    criterionText: 'Sem critério direto; avaliado por %GRR e %P/T.',
    verdict: 'not_evaluated',
    interval: intervals.sigmaGrr,
    reference: CI_REFERENCE,
  };
  const grrMetric: GageRRMetric = {
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
  const ptMetric: GageRRMetric = {
    key: 'pt_pct',
    label: '%P/T (variação vs. tolerância)',
    value: ptPct,
    unit: '%',
    formula: '%P/T = 100·k·σ_GRR/T, com T = USL − LSL',
    criterionText:
      tolerance === null ? `${ptCriterion} (T não informado)` : ptCriterion,
    verdict: ptVerdict,
    interval: intervals.ptPct,
    reference: REFERENCE,
  };
  const ndcMetric: GageRRMetric = {
    key: 'ndc',
    label: 'Número de categorias distintas (ndc)',
    value: ndc,
    unit: '',
    formula: 'ndc = floor(1,41·σ_peça/σ_GRR)',
    criterionText: `ndc ≥ ${fmt(criteria.ndcMin)}`,
    verdict: ndcVerdict,
    interval: null,
    reference: REFERENCE,
  };
  const metrics: GageRRMetric[] = [sigmaMetric, grrMetric, ptMetric, ndcMetric];
  const verdict = overallVerdict(metrics);

  const warnings: string[] = [];
  const notes: string[] = [];
  if (!data.balanced) {
    warnings.push(
      `Dados faltantes ou desbalanceados: ${data.missing} observação(ões) ausente(s). Análise por lista com n efetivo = ${data.n} e r_eff = ${fmt(data.rEff)}.`,
    );
    notes.push(
      'Desenho desbalanceado: somas de quadrados sequenciais (peça → operador → interação) e componentes de variância aproximados por r_eff = n/células.',
    );
  }
  if (data.rEff < 2) {
    warnings.push('r_eff < 2: a estimativa de repetibilidade e os componentes devem ser interpretados com cautela.');
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
  if (componentModel.totalVariance <= 0) {
    warnings.push('Variância total nula; %GRR, %P/T e ndc não definidos.');
  } else if (componentModel.grrVariance <= 0) {
    warnings.push('σ_GRR = 0; ndc não definido (tende ao infinito) e IC de %GRR não estimável.');
  } else if (componentModel.partVariance <= 0) {
    warnings.push('σ_peça = 0; ndc = 0 e IC de %GRR não estimável.');
  } else if (intervals.grrPct === null) {
    warnings.push('Intervalo de %GRR não estimável com os graus de liberdade disponíveis.');
  }
  if (anova.pPO === null) {
    warnings.push('Teste de interação indisponível; modelo sem interação adotado.');
  }

  notes.push(interaction.decision);
  notes.push('Componentes estimados pelo método dos momentos; valores negativos são truncados em zero e sinalizados.');
  notes.push('ICs por Satterthwaite para σ_GRR e %GRR; o IC de %GRR usa a razão de variâncias GRR/peça e quantis F.');
  notes.push('Premissas: modelo aleatório cruzado, peças e operadores amostrados da população, resíduos normais e independentes.');
  if (explicitModel) {
    notes.push('O modelo foi fixado manualmente nas opções; o teste de interação permanece registrado para auditoria.');
  }

  const fullRows = buildFullRows(anova);
  const reducedRows = buildReducedRows(anova, reduced);
  const anovaTables: GageRRAnovaTables = {
    full: fullRows,
    reduced: reducedRows,
    selected: model,
  };
  const tables: AnalysisTable[] = [
    anovaTable(
      'ANOVA completa (modelo com interação)',
      fullRows,
      data.balanced
        ? 'Modelo balanceado de dois fatores cruzados com interação.'
        : 'Desenho desbalanceado: SS sequenciais (peça → operador → interação) e análise por lista.',
    ),
    anovaTable(
      'ANOVA do modelo reduzido (SS_PO agregada ao erro)',
      reducedRows,
      'Usada quando a interação não é significativa ou quando o modelo é fixado sem interação.',
    ),
    cellTable(data),
    componentTable(components),
    intervalTable(components, intervals, metrics),
  ];

  const rawMetrics: Record<string, number | null> = {
    sigma_grr: sigmaMetric.value,
    grr_pct: grrPct,
    pt_pct: ptPct,
    ndc,
    variance_repeatability: components.find((component) => component.key === 'repeatability')?.variance ?? null,
    variance_interaction: components.find((component) => component.key === 'interaction')?.variance ?? null,
    variance_operator: components.find((component) => component.key === 'operator')?.variance ?? null,
    variance_part: componentModel.partVariance,
    variance_grr: componentModel.grrVariance,
    variance_total: componentModel.totalVariance,
    contribution_grr:
      componentModel.totalVariance > 0
        ? (100 * componentModel.grrVariance) / componentModel.totalVariance
        : null,
    contribution_part:
      componentModel.totalVariance > 0
        ? (100 * componentModel.partVariance) / componentModel.totalVariance
        : null,
    df_grr: componentModel.grrDf,
    df_part: componentModel.partDf,
    n_eff: data.n,
    r_eff: data.rEff,
    tolerance,
    k,
  };

  return {
    n: data.n,
    nEff: data.n,
    missing: data.missing,
    parts: data.parts,
    operators: data.operators,
    replicates: data.replicates,
    cells: data.kCells,
    balanced: data.balanced,
    rEff: data.rEff,
    tolerance,
    k,
    confidence,
    interactionThreshold,
    model,
    anova: anovaTables,
    interaction,
    components,
    metrics,
    rawMetrics,
    intervals,
    ndc,
    tables,
    charts: buildCharts(data),
    warnings,
    notes,
    summary: buildSummary(metrics, tolerance, verdict),
    verdict,
    criteria,
    method: useReduced
      ? 'ANOVA de dois fatores cruzados sem interação (SS_PO agregada ao erro)'
      : 'ANOVA de dois fatores cruzados com interação',
    reference: REFERENCE,
  };
}
