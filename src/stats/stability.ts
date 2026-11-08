/**
 * Estabilidade do sistema de medição: cartas I-MR e X̄-R, regras de alarme e
 * verificação da resolução.
 *
 * Cartas implementadas:
 *  - I-MR: LC = x̄; LIC/LSC = x̄ ± 2,66·MR̄; carta MR com LC = MR̄ e
 *    LSC = 3,267·MR̄.
 *  - X̄-R: constantes A2, D3 e D4 tabeladas para subgrupos de 2 a 10
 *    (ASTM MNL 7). LC = x̄̄; LIC/LSC = x̄̄ ± A2·R̄; carta R com LC = R̄,
 *    LIC = D3·R̄ e LSC = D4·R̄.
 *
 * Regras de alarme (aplicadas às duas cartas, sem excluir pontos):
 *  - 1 ponto fora dos limites de controle;
 *  - 8 pontos consecutivos do mesmo lado da linha central;
 *  - 6 pontos consecutivos em tendência (crescente ou decrescente).
 *
 * A resolução é comparada com 10% de T (tolerância) ou de σ_total. Quando não
 * informada, é inferida pela menor diferença positiva entre valores distintos.
 * Também é registrado o número de categorias distintas de dados e de
 * amplitudes.
 *
 * Referências:
 *  - ASTM MNL 7, Manual on Presentation of Data and Control Chart Analysis,
 *    tabela de constantes para cartas X̄-R (2 ≤ n ≤ 10).
 *  - Montgomery & Runger (2021), Applied Statistics and Probability for
 *    Engineers, cap. 6 (cartas de controle por variáveis).
 *  - ISO 7870-2:2013 (cartas de controle — Shewhart).
 *  - Nelson (1984), The Shewhart control chart — tests for special causes.
 *  - AIAG MSA 4th ed. (resolução e estabilidade do sistema de medição).
 */

import type { Verdict } from '../lib/types';
import type { AnalysisChart, AnalysisMetric, AnalysisTable } from './analysis-types';
import { mean, sd } from './descriptive';
import { fmt } from './distributions';

const REFERENCE =
  'ASTM MNL 7 (constantes X̄-R); ISO 7870-2:2013; Montgomery & Runger, cap. 6; Nelson (1984)';

export interface XbarRConstant {
  /** Tamanho do subgrupo. */
  n: number;
  /** Constante para os limites da média: x̄̄ ± A2·R̄. */
  A2: number;
  /** Constante para o limite inferior da amplitude: D3·R̄. */
  D3: number;
  /** Constante para o limite superior da amplitude: D4·R̄. */
  D4: number;
}

/** Constantes ASTM MNL 7 para cartas X̄-R com subgrupos de 2 a 10. */
export const XBAR_R_CONSTANTS: Readonly<Record<number, XbarRConstant>> = Object.freeze({
  2: { n: 2, A2: 1.88, D3: 0, D4: 3.267 },
  3: { n: 3, A2: 1.023, D3: 0, D4: 2.574 },
  4: { n: 4, A2: 0.729, D3: 0, D4: 2.282 },
  5: { n: 5, A2: 0.577, D3: 0, D4: 2.114 },
  6: { n: 6, A2: 0.483, D3: 0, D4: 2.004 },
  7: { n: 7, A2: 0.419, D3: 0.076, D4: 1.924 },
  8: { n: 8, A2: 0.373, D3: 0.136, D4: 1.864 },
  9: { n: 9, A2: 0.337, D3: 0.184, D4: 1.816 },
  10: { n: 10, A2: 0.308, D3: 0.223, D4: 1.777 },
});

/** Constantes da carta I-MR: 3/d2 ≈ 2,66 e D4 da amplitude móvel = 3,267. */
export const IMR_CONSTANTS = Object.freeze({
  d2: 1.128,
  e2: 2.66,
  d4mr: 3.267,
});

export interface StabilityCriteria {
  /** Número máximo de alarmes para considerar a carta estável. */
  maxAlarms: number;
  /** Resolução máxima como percentual de T ou de σ_total. */
  maxResolutionPct: number;
  /** Comprimento da sequência do mesmo lado da linha central. */
  sameSideRun: number;
  /** Comprimento da sequência em tendência. */
  trendRun: number;
}

export const DEFAULT_STABILITY_CRITERIA: Readonly<StabilityCriteria> = Object.freeze({
  maxAlarms: 0,
  maxResolutionPct: 10,
  sameSideRun: 8,
  trendRun: 6,
});

export interface StabilityInput {
  /** Observações individuais em ordem cronológica (carta I-MR). */
  values?: ReadonlyArray<number | null | undefined>;
  /** Subgrupos racionais em ordem cronológica (carta X̄-R). */
  subgroups?: ReadonlyArray<ReadonlyArray<number | null | undefined>>;
  /** Tamanho do subgrupo ao agrupar `values` consecutivamente; 1 = I-MR. */
  subgroupSize?: number;
}

export interface StabilityOptions {
  criteria?: Partial<StabilityCriteria>;
  /** Tolerância T = USL − LSL, usada na verificação da resolução. */
  tolerance?: number | null;
  /** σ_total informado; se ausente, é estimado dos dados. */
  sigmaTotal?: number | null;
  /** Resolução informada; se ausente, é inferida dos dados. */
  resolution?: number | null;
  /** Rótulos dos pontos individuais (mesmo comprimento de `values`). */
  labels?: readonly string[];
  /** Rótulos dos subgrupos (mesmo comprimento de `subgroups`). */
  subgroupLabels?: readonly string[];
  /** Unidade das medições, apenas para exibição. */
  unit?: string;
}

export type StabilityChartKey = 'individual' | 'moving_range' | 'xbar' | 'range';
export type StabilityRule = 'out_of_limits' | 'same_side' | 'trend';

export interface StabilityPoint {
  /** Posição 1-based na carta. */
  index: number;
  label: string;
  value: number;
  center: number;
  lcl: number;
  ucl: number;
  outOfLimits: boolean;
}

export interface StabilityAlarm {
  chart: StabilityChartKey;
  chartLabel: string;
  rule: StabilityRule;
  ruleLabel: string;
  /** Índice 1-based do último ponto do alarme. */
  index: number;
  /** Todos os índices 1-based envolvidos no alarme. */
  indices: number[];
  value: number;
  center: number;
  lcl: number;
  ucl: number;
  description: string;
}

export interface StabilityControlChart {
  key: StabilityChartKey;
  label: string;
  points: StabilityPoint[];
  center: number;
  lcl: number;
  ucl: number;
  formula: string;
  alarms: StabilityAlarm[];
}

export interface StabilityResolution {
  resolution: number | null;
  inferred: boolean;
  referenceKind: 'tolerance' | 'sigma_total' | null;
  referenceValue: number | null;
  ratioPct: number | null;
  distinctValues: number;
  distinctRangeValues: number;
  criterionText: string;
  verdict: Verdict;
  warnings: string[];
}

export interface StabilityResult {
  n: number;
  mode: 'I-MR' | 'Xbar-R';
  subgroupSize: number;
  subgroupCount: number;
  controlCharts: StabilityControlChart[];
  alarms: StabilityAlarm[];
  metrics: AnalysisMetric[];
  resolution: StabilityResolution;
  distinctValues: number;
  distinctRangeValues: number;
  sigmaWithin: number | null;
  sigmaTotal: number | null;
  sigmaTotalEstimated: boolean;
  tolerance: number | null;
  unit: string;
  criteria: StabilityCriteria;
  tables: AnalysisTable[];
  charts: AnalysisChart[];
  warnings: string[];
  notes: string[];
  summary: string;
  verdict: Verdict;
  method: string;
  reference: string;
}

function verdictLabel(verdict: Verdict): string {
  if (verdict === 'pass') return 'conforme';
  if (verdict === 'fail') return 'não conforme';
  if (verdict === 'warning') return 'atenção';
  return 'não avaliado';
}

function classifyMax(value: number | null, maximum: number): Verdict {
  if (value === null || !Number.isFinite(value)) return 'not_evaluated';
  return value <= maximum ? 'pass' : 'fail';
}

function overallVerdict(metrics: AnalysisMetric[]): Verdict {
  const evaluated = metrics.filter((metric) => metric.verdict !== 'not_evaluated');
  if (evaluated.length === 0) return 'not_evaluated';
  if (evaluated.some((metric) => metric.verdict === 'fail')) return 'fail';
  if (evaluated.some((metric) => metric.verdict === 'warning')) return 'warning';
  if (evaluated.every((metric) => metric.verdict === 'pass')) return 'pass';
  return 'not_evaluated';
}

function normalizeCriteria(
  partial: Partial<StabilityCriteria> | undefined,
): StabilityCriteria {
  const criteria: StabilityCriteria = { ...DEFAULT_STABILITY_CRITERIA, ...(partial ?? {}) };
  if (!(criteria.maxAlarms >= 0) || !Number.isFinite(criteria.maxAlarms)) {
    throw new Error('O número máximo de alarmes deve ser um número não negativo.');
  }
  if (!(criteria.maxResolutionPct > 0) || !Number.isFinite(criteria.maxResolutionPct)) {
    throw new Error('O limite de resolução deve ser um percentual positivo.');
  }
  if (!(criteria.sameSideRun >= 2) || !Number.isFinite(criteria.sameSideRun)) {
    throw new Error('O comprimento da sequência do mesmo lado deve ser ≥ 2.');
  }
  if (!(criteria.trendRun >= 2) || !Number.isFinite(criteria.trendRun)) {
    throw new Error('O comprimento da sequência em tendência deve ser ≥ 2.');
  }
  return criteria;
}

function validatePositiveOrNull(
  value: number | null | undefined,
  label: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new Error(`A ${label} deve ser um número positivo.`);
  }
  return value;
}

function filterValues(
  values: ReadonlyArray<number | null | undefined>,
  label: string,
): { values: number[]; missing: number } {
  const out: number[] = [];
  let missing = 0;
  for (const value of values) {
    if (value === null || value === undefined) {
      missing += 1;
      continue;
    }
    if (!Number.isFinite(value)) {
      throw new Error(`Valor inválido em ${label}: ${String(value)}.`);
    }
    out.push(value);
  }
  return { values: out, missing };
}

function inferResolution(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length < 2) return null;
  let best = Infinity;
  for (let i = 1; i < unique.length; i += 1) {
    const diff = unique[i] - unique[i - 1];
    if (diff > 0 && diff < best) best = diff;
  }
  return Number.isFinite(best) ? best : null;
}

function pointLabel(index: number, labels: readonly string[] | undefined): string {
  const label = labels?.[index - 1];
  return label && label.trim() ? label.trim() : `Ponto ${index}`;
}

function detectAlarms(
  chart: StabilityChartKey,
  chartLabel: string,
  values: number[],
  center: number,
  lcl: number,
  ucl: number,
  criteria: StabilityCriteria,
): StabilityAlarm[] {
  const alarms: StabilityAlarm[] = [];

  values.forEach((value, i) => {
    if (Number.isFinite(lcl) && value < lcl) {
      alarms.push({
        chart,
        chartLabel,
        rule: 'out_of_limits',
        ruleLabel: 'Ponto fora dos limites',
        index: i + 1,
        indices: [i + 1],
        value,
        center,
        lcl,
        ucl,
        description: `Ponto ${i + 1} (${fmt(value)}) abaixo do LIC (${fmt(lcl)}).`,
      });
    } else if (Number.isFinite(ucl) && value > ucl) {
      alarms.push({
        chart,
        chartLabel,
        rule: 'out_of_limits',
        ruleLabel: 'Ponto fora dos limites',
        index: i + 1,
        indices: [i + 1],
        value,
        center,
        lcl,
        ucl,
        description: `Ponto ${i + 1} (${fmt(value)}) acima do LSC (${fmt(ucl)}).`,
      });
    }
  });

  let side: 0 | 1 | -1 = 0;
  let run: number[] = [];
  values.forEach((value, i) => {
    const current: 0 | 1 | -1 = value > center ? 1 : value < center ? -1 : 0;
    if (current === 0 || current !== side) {
      side = current;
      run = current === 0 ? [] : [i];
    } else {
      run.push(i);
    }
    if (run.length >= criteria.sameSideRun) {
      const indices = run.map((index) => index + 1);
      alarms.push({
        chart,
        chartLabel,
        rule: 'same_side',
        ruleLabel: `${criteria.sameSideRun} consecutivos do mesmo lado`,
        index: i + 1,
        indices,
        value,
        center,
        lcl,
        ucl,
        description: `${indices.length} pontos consecutivos ${current > 0 ? 'acima' : 'abaixo'} da LC (${fmt(center)}): pontos ${indices.join(', ')}.`,
      });
      run = [];
      side = 0;
    }
  });

  let direction: 0 | 1 | -1 = 0;
  let trendRun: number[] = values.length > 0 ? [0] : [];
  values.forEach((value, i) => {
    if (i === 0) return;
    const delta = value - values[i - 1];
    const current: 0 | 1 | -1 = delta > 0 ? 1 : delta < 0 ? -1 : 0;
    if (current === 0) {
      direction = 0;
      trendRun = [];
    } else if (direction === 0) {
      direction = current;
      trendRun = [i - 1, i];
    } else if (current === direction) {
      trendRun.push(i);
    } else {
      direction = current;
      trendRun = [i - 1, i];
    }
    if (trendRun.length >= criteria.trendRun) {
      const indices = trendRun.map((index) => index + 1);
      alarms.push({
        chart,
        chartLabel,
        rule: 'trend',
        ruleLabel: `${criteria.trendRun} em tendência`,
        index: i + 1,
        indices,
        value,
        center,
        lcl,
        ucl,
        description: `${indices.length} pontos consecutivos em tendência ${direction > 0 ? 'crescente' : 'decrescente'}: pontos ${indices.join(', ')}.`,
      });
      trendRun = [];
      direction = 0;
    }
  });

  return alarms;
}

function buildPoints(
  values: number[],
  center: number,
  lcl: number,
  ucl: number,
  labels: readonly string[] | undefined,
  offset = 0,
): StabilityPoint[] {
  return values.map((value, index) => {
    const position = index + 1 + offset;
    return {
      index: position,
      label: pointLabel(position, labels),
      value,
      center,
      lcl,
      ucl,
      outOfLimits:
        (Number.isFinite(lcl) && value < lcl) ||
        (Number.isFinite(ucl) && value > ucl),
    };
  });
}

function chartData(chart: StabilityControlChart): AnalysisChart {
  const alarmed = new Set<number>();
  for (const alarm of chart.alarms) {
    for (const index of alarm.indices) alarmed.add(index);
  }
  return {
    kind: 'line',
    title: chart.label,
    xLabel: 'Ponto',
    yLabel: 'Valor',
    data: chart.points.map((point) => ({
      ponto: point.index,
      rotulo: point.label,
      valor: point.value,
      lc: point.center,
      lic: point.lcl,
      lsc: point.ucl,
      alarme: alarmed.has(point.index) ? 'sim' : 'não',
    })),
  };
}

function pointsTable(chart: StabilityControlChart): AnalysisTable {
  const rulesByPoint = new Map<number, string[]>();
  for (const alarm of chart.alarms) {
    for (const index of alarm.indices) {
      const list = rulesByPoint.get(index) ?? [];
      list.push(alarm.ruleLabel);
      rulesByPoint.set(index, list);
    }
  }
  return {
    title: `Pontos e alarmes — ${chart.label}`,
    columns: ['Ponto', 'Rótulo', 'Valor', 'LC', 'LIC', 'LSC', 'Alarme'],
    rows: chart.points.map((point) => [
      point.index,
      point.label,
      fmt(point.value),
      fmt(point.center),
      fmt(point.lcl),
      fmt(point.ucl),
      rulesByPoint.get(point.index)?.join('; ') ?? '—',
    ]),
    note: 'Todos os pontos são mantidos na carta e na tabela; nenhum é excluído.',
  };
}

function alarmTable(alarms: StabilityAlarm[]): AnalysisTable {
  return {
    title: 'Alarmes registrados',
    columns: ['Carta', 'Regra', 'Pontos', 'Valor', 'LC', 'LIC', 'LSC', 'Descrição'],
    rows:
      alarms.length === 0
        ? [['—', '—', '—', '—', '—', '—', '—', 'Nenhum alarme detectado.']]
        : alarms.map((alarm) => [
            alarm.chartLabel,
            alarm.ruleLabel,
            alarm.indices.join(', '),
            fmt(alarm.value),
            fmt(alarm.center),
            fmt(alarm.lcl),
            fmt(alarm.ucl),
            alarm.description,
          ]),
  };
}

/** Executa o estudo de estabilidade e a verificação da resolução. */
export function stabilityStudy(
  input: StabilityInput,
  options: StabilityOptions = {},
): StabilityResult {
  const criteria = normalizeCriteria(options.criteria);
  const tolerance = validatePositiveOrNull(options.tolerance, 'tolerância T = USL − LSL');
  const providedSigmaTotal = validatePositiveOrNull(
    options.sigmaTotal,
    'σ_total informado',
  );
  const providedResolution = validatePositiveOrNull(
    options.resolution,
    'resolução informada',
  );
  const unit = options.unit ?? '';

  if (input.values !== undefined && input.subgroups !== undefined) {
    throw new Error('Informe values (I-MR/X̄-R sequencial) ou subgroups (X̄-R), não ambos.');
  }
  if (input.values === undefined && input.subgroups === undefined) {
    throw new Error('Informe values ou subgroups para o estudo de estabilidade.');
  }

  let mode: 'I-MR' | 'Xbar-R';
  let subgroupSize = 1;
  let subgroupCount = 0;
  let individualValues: number[] = [];
  let subgroupValues: number[][] = [];
  let labels = options.labels;
  let subgroupLabels = options.subgroupLabels;
  let missing = 0;
  const warnings = new Set<string>();

  if (input.subgroups !== undefined) {
    mode = 'Xbar-R';
    if (!Array.isArray(input.subgroups) || input.subgroups.length < 2) {
      throw new Error('A carta X̄-R requer pelo menos 2 subgrupos.');
    }
    subgroupValues = input.subgroups.map((group, index) => {
      const filtered = filterValues(group, `subgrupo ${index + 1}`);
      missing += filtered.missing;
      const values = filtered.values;
      if (values.length === 0) {
        throw new Error(`O subgrupo ${index + 1} não possui medições válidas.`);
      }
      return values;
    });
    subgroupSize = subgroupValues[0].length;
    if (subgroupSize < 2 || subgroupSize > 10) {
      throw new Error('A carta X̄-R exige subgrupos de 2 a 10 observações.');
    }
    if (subgroupValues.some((group) => group.length !== subgroupSize)) {
      throw new Error('Todos os subgrupos da carta X̄-R devem ter o mesmo tamanho.');
    }
    if (input.subgroupSize !== undefined && input.subgroupSize !== subgroupSize) {
      throw new Error(
        `subgroupSize = ${input.subgroupSize} não coincide com o tamanho observado (${subgroupSize}).`,
      );
    }
    subgroupCount = subgroupValues.length;
    individualValues = subgroupValues.flat();
    if (subgroupLabels !== undefined && subgroupLabels.length !== subgroupCount) {
      throw new Error(
        `subgroupLabels deve ter ${subgroupCount} rótulos (um por subgrupo).`,
      );
    }
  } else {
    const filtered = filterValues(input.values ?? [], 'values');
    individualValues = filtered.values;
    missing = filtered.missing;
    if (individualValues.length < 2) {
      throw new Error('A carta I-MR requer pelo menos 2 observações válidas.');
    }
    const requested = input.subgroupSize ?? 1;
    if (!(requested >= 1) || !Number.isFinite(requested) || !Number.isInteger(requested)) {
      throw new Error('subgroupSize deve ser um inteiro ≥ 1.');
    }
    if (requested > 10) {
      throw new Error('subgroupSize deve estar entre 2 e 10 para a carta X̄-R.');
    }
    if (requested === 1) {
      mode = 'I-MR';
      subgroupSize = 1;
      subgroupCount = individualValues.length;
      if (labels !== undefined && labels.length !== individualValues.length) {
        throw new Error(
          `labels deve ter ${individualValues.length} rótulos (um por observação).`,
        );
      }
    } else {
      mode = 'Xbar-R';
      subgroupSize = requested;
      const complete = Math.floor(individualValues.length / subgroupSize);
      if (complete < 2) {
        throw new Error(
          `Com ${individualValues.length} observações e subgrupos de ${subgroupSize}, não há 2 subgrupos completos.`,
        );
      }
      if (complete * subgroupSize !== individualValues.length) {
        warnings.add(
          `A última fração incompleta de ${individualValues.length % subgroupSize} observação(ões) foi descartada para manter subgrupos de tamanho ${subgroupSize}.`,
        );
      }
      subgroupValues = [];
      for (let i = 0; i < complete; i += 1) {
        subgroupValues.push(individualValues.slice(i * subgroupSize, (i + 1) * subgroupSize));
      }
      individualValues = subgroupValues.flat();
      subgroupCount = subgroupValues.length;
      if (subgroupLabels !== undefined && subgroupLabels.length !== subgroupCount) {
        throw new Error(
          `subgroupLabels deve ter ${subgroupCount} rótulos (um por subgrupo).`,
        );
      }
    }
  }

  const controlCharts: StabilityControlChart[] = [];
  let sigmaWithin: number | null = null;

  if (mode === 'I-MR') {
    const center = mean(individualValues);
    const movingRanges = individualValues.slice(1).map((value, index) =>
      Math.abs(value - individualValues[index]),
    );
    const mrBar = mean(movingRanges);
    sigmaWithin = mrBar / IMR_CONSTANTS.d2;
    const primaryLcl = center - IMR_CONSTANTS.e2 * mrBar;
    const primaryUcl = center + IMR_CONSTANTS.e2 * mrBar;
    const mrLcl = 0;
    const mrUcl = IMR_CONSTANTS.d4mr * mrBar;

    const primaryPoints = buildPoints(
      individualValues,
      center,
      primaryLcl,
      primaryUcl,
      labels,
    );
    const mrLabels = movingRanges.map((_, index) => `MR ${index + 2}`);
    const secondaryPoints = buildPoints(
      movingRanges,
      mrBar,
      mrLcl,
      mrUcl,
      mrLabels,
    );
    const primaryAlarms = detectAlarms(
      'individual',
      'Carta I (valores individuais)',
      individualValues,
      center,
      primaryLcl,
      primaryUcl,
      criteria,
    );
    const secondaryAlarms = detectAlarms(
      'moving_range',
      'Carta MR (amplitudes móveis)',
      movingRanges,
      mrBar,
      mrLcl,
      mrUcl,
      criteria,
    );
    controlCharts.push(
      {
        key: 'individual',
        label: 'Carta I (valores individuais)',
        points: primaryPoints,
        center,
        lcl: primaryLcl,
        ucl: primaryUcl,
        formula: 'LC = x̄; LIC/LSC = x̄ ± 2,66·MR̄',
        alarms: primaryAlarms,
      },
      {
        key: 'moving_range',
        label: 'Carta MR (amplitudes móveis)',
        points: secondaryPoints,
        center: mrBar,
        lcl: mrLcl,
        ucl: mrUcl,
        formula: 'LC = MR̄; LIC = 0; LSC = 3,267·MR̄',
        alarms: secondaryAlarms,
      },
    );
  } else {
    const constant = XBAR_R_CONSTANTS[subgroupSize];
    if (!constant) {
      throw new Error(`Não há constantes X̄-R para subgrupos de ${subgroupSize}.`);
    }
    const means = subgroupValues.map((group) => mean(group));
    const ranges = subgroupValues.map((group) => Math.max(...group) - Math.min(...group));
    const center = mean(means);
    const rBar = mean(ranges);
    const primaryLcl = center - constant.A2 * rBar;
    const primaryUcl = center + constant.A2 * rBar;
    const rangeLcl = constant.D3 * rBar;
    const rangeUcl = constant.D4 * rBar;
    const withinSquares = subgroupValues.map((group) => {
      const m = mean(group);
      return group.reduce((acc, value) => acc + (value - m) ** 2, 0);
    });
    const withinDf = subgroupValues.length * (subgroupSize - 1);
    sigmaWithin = withinDf > 0
      ? Math.sqrt(withinSquares.reduce((acc, ss) => acc + ss, 0) / withinDf)
      : null;

    const primaryPoints = buildPoints(
      means,
      center,
      primaryLcl,
      primaryUcl,
      subgroupLabels,
    );
    const rangeLabels = ranges.map((_, index) =>
      subgroupLabels?.[index]?.trim()
        ? `R ${subgroupLabels[index].trim()}`
        : `R ${index + 1}`,
    );
    const secondaryPoints = buildPoints(
      ranges,
      rBar,
      rangeLcl,
      rangeUcl,
      rangeLabels,
    );
    const primaryAlarms = detectAlarms(
      'xbar',
      'Carta X̄ (médias dos subgrupos)',
      means,
      center,
      primaryLcl,
      primaryUcl,
      criteria,
    );
    const secondaryAlarms = detectAlarms(
      'range',
      'Carta R (amplitudes dos subgrupos)',
      ranges,
      rBar,
      rangeLcl,
      rangeUcl,
      criteria,
    );
    controlCharts.push(
      {
        key: 'xbar',
        label: 'Carta X̄ (médias dos subgrupos)',
        points: primaryPoints,
        center,
        lcl: primaryLcl,
        ucl: primaryUcl,
        formula: `LC = x̄̄; LIC/LSC = x̄̄ ± ${fmt(constant.A2)}·R̄ (A2 para n = ${subgroupSize})`,
        alarms: primaryAlarms,
      },
      {
        key: 'range',
        label: 'Carta R (amplitudes dos subgrupos)',
        points: secondaryPoints,
        center: rBar,
        lcl: rangeLcl,
        ucl: rangeUcl,
        formula: `LC = R̄; LIC = ${fmt(constant.D3)}·R̄; LSC = ${fmt(constant.D4)}·R̄ (D3/D4 para n = ${subgroupSize})`,
        alarms: secondaryAlarms,
      },
    );
  }

  const alarms = controlCharts.flatMap((chart) => chart.alarms);
  const rangeChart = controlCharts.find(
    (chart) => chart.key === 'moving_range' || chart.key === 'range',
  );
  const rangeValues = rangeChart?.points.map((point) => point.value) ?? [];
  const distinctValues = new Set(individualValues).size;
  const distinctRangeValues = new Set(rangeValues).size;
  const outOfLimits = alarms.filter((alarm) => alarm.rule === 'out_of_limits').length;
  const sameSideAlarms = alarms.filter((alarm) => alarm.rule === 'same_side').length;
  const trendAlarms = alarms.filter((alarm) => alarm.rule === 'trend').length;

  const inferredResolution = providedResolution === null;
  const resolutionValue = providedResolution ?? inferResolution(individualValues);
  const effectiveSigmaTotal = providedSigmaTotal ?? (individualValues.length >= 2 ? sd(individualValues) : null);
  const sigmaTotalEstimated = providedSigmaTotal === null && effectiveSigmaTotal !== null;
  const referenceKind: 'tolerance' | 'sigma_total' | null =
    tolerance !== null ? 'tolerance' : effectiveSigmaTotal !== null ? 'sigma_total' : null;
  const referenceValue =
    referenceKind === 'tolerance'
      ? tolerance
      : referenceKind === 'sigma_total'
        ? effectiveSigmaTotal
        : null;
  const ratioPct =
    resolutionValue !== null && referenceValue !== null && referenceValue > 0
      ? (100 * resolutionValue) / referenceValue
      : null;
  const resolutionVerdict = classifyMax(ratioPct, criteria.maxResolutionPct);
  const resolutionWarnings: string[] = [];
  if (inferredResolution && resolutionValue !== null) {
    resolutionWarnings.push(
      `Resolução inferida pela menor diferença positiva entre valores distintos: ${fmt(resolutionValue)}.`,
    );
  }
  if (inferredResolution && resolutionValue === null) {
    resolutionWarnings.push(
      'Resolução não informada e não foi possível inferi-la (menos de 2 valores distintos).',
    );
  }
  if (sigmaTotalEstimated) {
    resolutionWarnings.push(
      'σ_total não informado; a verificação da resolução usou o desvio-padrão amostral de todas as observações.',
    );
  }
  if (referenceKind === null) {
    resolutionWarnings.push(
      'Sem T e sem σ_total, a verificação da resolução não pôde ser avaliada.',
    );
  }
  if (ratioPct !== null && ratioPct > criteria.maxResolutionPct) {
    resolutionWarnings.push(
      `Resolução = ${fmt(ratioPct)}% da referência, acima do limite de ${fmt(criteria.maxResolutionPct)}%.`,
    );
  }

  const resolution: StabilityResolution = {
    resolution: resolutionValue,
    inferred: inferredResolution,
    referenceKind,
    referenceValue,
    ratioPct,
    distinctValues,
    distinctRangeValues,
    criterionText:
      referenceKind === 'tolerance'
        ? `resolução/T ≤ ${fmt(criteria.maxResolutionPct)}%`
        : referenceKind === 'sigma_total'
          ? `resolução/σ_total ≤ ${fmt(criteria.maxResolutionPct)}%`
          : 'Sem T ou σ_total; resolução não avaliada.',
    verdict: resolutionVerdict,
    warnings: resolutionWarnings,
  };

  const metrics: AnalysisMetric[] = [
    {
      key: 'alarm_count',
      label: 'Número de alarmes nas cartas',
      value: alarms.length,
      unit: '',
      verdict: classifyMax(alarms.length, criteria.maxAlarms),
      criterionText: `≤ ${fmt(criteria.maxAlarms)} alarme(s)`,
      formula: 'contagem de alarmes das regras (1 fora, sequência do mesmo lado, tendência)',
      reference: REFERENCE,
    },
    {
      key: 'out_of_limits',
      label: 'Pontos fora dos limites de controle',
      value: outOfLimits,
      unit: '',
      verdict: 'not_evaluated',
      criterionText: 'Descritivo; contabilizado no total de alarmes.',
      formula: 'contagem de pontos com valor < LIC ou > LSC',
      reference: REFERENCE,
    },
    {
      key: 'same_side_alarms',
      label: 'Alarmes de sequência do mesmo lado',
      value: sameSideAlarms,
      unit: '',
      verdict: 'not_evaluated',
      criterionText: 'Descritivo; contabilizado no total de alarmes.',
      formula: `sequências de ${fmt(criteria.sameSideRun)} pontos do mesmo lado da LC`,
      reference: REFERENCE,
    },
    {
      key: 'trend_alarms',
      label: 'Alarmes de tendência',
      value: trendAlarms,
      unit: '',
      verdict: 'not_evaluated',
      criterionText: 'Descritivo; contabilizado no total de alarmes.',
      formula: `sequências de ${fmt(criteria.trendRun)} pontos monotônicos`,
      reference: REFERENCE,
    },
    {
      key: 'resolution_pct',
      label: 'Resolução relativa à referência',
      value: ratioPct,
      unit: '%',
      verdict: resolutionVerdict,
      criterionText: resolution.criterionText,
      formula: '100·resolução/T ou 100·resolução/σ_total',
      reference: 'AIAG MSA 4th ed.; ISO 14253-1; JCGM 100:2008',
    },
    {
      key: 'distinct_values',
      label: 'Categorias distintas de dados',
      value: distinctValues,
      unit: '',
      verdict: 'not_evaluated',
      criterionText: 'Descritivo.',
      formula: 'número de valores distintos observados',
      reference: REFERENCE,
    },
    {
      key: 'distinct_range_values',
      label: 'Categorias distintas na carta de amplitudes',
      value: distinctRangeValues,
      unit: '',
      verdict: 'not_evaluated',
      criterionText: 'Descritivo; valores distintos de MR ou R.',
      formula: 'número de amplitudes distintas observadas',
      reference: REFERENCE,
    },
    {
      key: 'sigma_within',
      label: 'Desvio-padrão dentro do subgrupo (curto prazo)',
      value: sigmaWithin,
      unit,
      verdict: 'not_evaluated',
      criterionText: 'Descritivo.',
      formula:
        mode === 'I-MR'
          ? 'σ_dentro = MR̄/1,128'
          : 'σ_dentro = √[Σ(n_i−1)·s_i²/Σ(n_i−1)]',
      reference: REFERENCE,
    },
  ];

  const verdict = overallVerdict(metrics);

  if (mode === 'I-MR' && individualValues.length < 20) {
    warnings.add(
      `A carta I-MR tem ${individualValues.length} pontos; recomenda-se pelo menos 20 para estimar a estabilidade.`,
    );
  }
  if (mode === 'Xbar-R' && subgroupCount < 20) {
    warnings.add(
      `A carta X̄-R tem ${subgroupCount} subgrupos; recomenda-se pelo menos 20 para estimar a estabilidade.`,
    );
  }
  if (missing > 0) {
    warnings.add(`${missing} valor(es) ausente(s) ignorado(s) na carta I-MR.`);
  }
  for (const warning of resolution.warnings) warnings.add(warning);
  if (outOfLimits > 0) {
    warnings.add(`${outOfLimits} ponto(s) fora dos limites de controle; nenhum ponto foi excluído.`);
  }
  if (sameSideAlarms > 0) {
    warnings.add(
      `${sameSideAlarms} sequência(s) do mesmo lado da linha central detectada(s).`,
    );
  }
  if (trendAlarms > 0) {
    warnings.add(`${trendAlarms} sequência(s) em tendência detectada(s).`);
  }

  const notes = [
    'As regras de alarme são aplicadas às cartas principal e secundária; todos os pontos permanecem nas tabelas e nos gráficos.',
    'I-MR: LIC/LSC = x̄ ± 2,66·MR̄ e LSC_MR = 3,267·MR̄. X̄-R: constantes A2, D3 e D4 tabeladas para n = 2…10.',
    'A resolução deve ser ≤ 10% de T (ou de σ_total); quando não informada, é inferida pela menor diferença positiva entre valores distintos.',
    'O número de categorias distintas de amplitudes é registrado como indicador da resolução efetiva da carta de amplitude.',
  ];
  if (sigmaTotalEstimated) {
    notes.push('σ_total foi estimado pelo desvio-padrão amostral de todas as observações.');
  }

  const chartParams: AnalysisTable = {
    title: 'Parâmetros das cartas de controle',
    columns: ['Carta', 'LC', 'LIC', 'LSC', 'Fórmula'],
    rows: controlCharts.map((chart) => [
      chart.label,
      fmt(chart.center),
      fmt(chart.lcl),
      fmt(chart.ucl),
      chart.formula,
    ]),
    note:
      mode === 'I-MR'
        ? 'Constantes I-MR: 2,66 para os limites da carta I e 3,267 para o LSC da carta MR.'
        : `Constantes X̄-R para n = ${subgroupSize}, conforme ASTM MNL 7.`,
  };

  const resolutionTable: AnalysisTable = {
    title: 'Verificação da resolução',
    columns: ['Item', 'Valor', 'Critério', 'Veredito'],
    rows: [
      [
        'Resolução',
        resolutionValue === null ? '—' : fmt(resolutionValue),
        inferredResolution ? 'inferida dos dados' : 'informada',
        '—',
      ],
      [
        'Referência da verificação',
        referenceKind === 'tolerance'
          ? `T = ${fmt(referenceValue)}`
          : referenceKind === 'sigma_total'
            ? `σ_total = ${fmt(referenceValue)}`
            : '—',
        referenceKind === 'tolerance'
          ? 'T (tolerância)'
          : referenceKind === 'sigma_total'
            ? sigmaTotalEstimated
              ? 'σ_total estimado'
              : 'σ_total informado'
            : '—',
        '—',
      ],
      [
        'Resolução/referência (%)',
        ratioPct === null ? '—' : fmt(ratioPct),
        `≤ ${fmt(criteria.maxResolutionPct)}%`,
        verdictLabel(resolutionVerdict),
      ],
      [
        'Categorias distintas de dados',
        distinctValues,
        '—',
        '—',
      ],
      [
        'Categorias distintas na carta de amplitudes',
        distinctRangeValues,
        '—',
        '—',
      ],
      [
        'σ_total',
        effectiveSigmaTotal === null ? '—' : fmt(effectiveSigmaTotal),
        sigmaTotalEstimated ? 'estimado dos dados' : 'informado',
        '—',
      ],
    ],
    note:
      'A resolução é aceitável quando ≤ 10% de T ou de σ_total (limite editável). O número de categorias distintas de amplitudes evita superestimar a capacidade de discriminação.',
  };

  const summary = `Estabilidade (${mode}): ${alarms.length} alarme(s), sendo ${outOfLimits} fora dos limites; resolução ${resolutionValue === null ? 'não determinada' : `${fmt(resolutionValue)} (${ratioPct === null ? '—' : `${fmt(ratioPct)}%`})`}; ${distinctRangeValues} categoria(s) distinta(s) na carta de amplitudes. Veredito global: ${verdictLabel(verdict)}.`;

  return {
    n: individualValues.length,
    mode,
    subgroupSize,
    subgroupCount,
    controlCharts,
    alarms,
    metrics,
    resolution,
    distinctValues,
    distinctRangeValues,
    sigmaWithin,
    sigmaTotal: effectiveSigmaTotal,
    sigmaTotalEstimated,
    tolerance,
    unit,
    criteria,
    tables: [
      chartParams,
      ...controlCharts.map(pointsTable),
      alarmTable(alarms),
      resolutionTable,
    ],
    charts: controlCharts.map(chartData),
    warnings: [...warnings],
    notes,
    summary,
    verdict,
    method: 'Cartas I-MR e X̄-R com regras de alarme (1 fora, sequência do mesmo lado e tendência)',
    reference: REFERENCE,
  };
}

/** Atalho para uma carta I-MR a partir de observações individuais. */
export function imrStudy(
  values: ReadonlyArray<number | null | undefined>,
  options: StabilityOptions = {},
): StabilityResult {
  return stabilityStudy({ values }, options);
}

/** Atalho para uma carta X̄-R a partir de subgrupos racionais. */
export function xbarRStudy(
  subgroups: ReadonlyArray<ReadonlyArray<number | null | undefined>>,
  options: StabilityOptions = {},
): StabilityResult {
  return stabilityStudy({ subgroups }, options);
}
