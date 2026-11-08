/**
 * Tendência por nível de referência e linearidade do instrumento (AIAG).
 *
 * A tendência em cada nível é `bias_i = x̄_i − ref_i`, testada com
 * `t = bias_i/EP`, em que `EP = s/√n` ou, opcionalmente,
 * `EP = √(s²/n + u_ref²)`. A linearidade ajusta `bias = a + b·ref` por mínimos
 * quadrados (reutilizando `regression.ts`) e calcula
 * `linearidade = |b|·variação do processo` e `%linearidade = 100·|b|`.
 *
 * Referências:
 *  - AIAG (2010). Measurement Systems Analysis Reference Manual, 4. ed.,
 *    capítulo de bias e linearidade.
 *  - ISO 5725-4:2020 (tendência e exatidão).
 *  - Montgomery & Runger (2021), Applied Statistics and Probability for
 *    Engineers, cap. 9 (testes t e intervalos de confiança).
 *  - GUM/JCGM 100:2008 (propagação da incerteza-padrão da referência).
 *  - SPC for Excel (2021). The Calculations Behind a Gage Linearity Study —
 *    exemplo AIAG de 5 peças × 10 réplicas usado nos testes.
 */

import type { Verdict } from '../lib/types';
import type { AnalysisChart, AnalysisMetric, AnalysisTable } from './analysis-types';
import { biasTestWithReferenceUncertainty } from './bias';
import { mean, sd } from './descriptive';
import { fmt, tInv } from './distributions';
import { linearRegression, type RegressionResult } from './regression';

const REFERENCE =
  'AIAG MSA 4th ed. (bias e linearidade); ISO 5725-4:2020; Montgomery & Runger, cap. 9';

export interface GageBiasLevelInput {
  /** Valor de referência do padrão, na mesma unidade das medições. */
  reference: number;
  /** Réplicas medidas nesse nível, em ordem de execução. */
  values: ReadonlyArray<number | null | undefined>;
  /**
   * Incerteza-padrão da referência (`u_ref`). Quando ausente, usa-se zero.
   * Não informe a incerteza expandida: divida-a pelo fator de abrangência.
   */
  referenceUncertainty?: number;
  /** Graus de liberdade de `u_ref`; se ausente, usa-se ν = n − 1. */
  referenceDof?: number | null;
  /** Rótulo opcional do nível (por exemplo, "Padrão 1"). */
  label?: string;
}

export interface GageBiasLinearityInput {
  levels: ReadonlyArray<GageBiasLevelInput>;
  /** Tolerância T = USL − LSL; usada para a tendência relativa a T. */
  tolerance?: number | null;
  /** Variação do processo (6σ), usada na linearidade absoluta. */
  processVariation?: number | null;
  /** Início da faixa de uso, para verificar a cobertura dos níveis. */
  rangeMin?: number | null;
  /** Fim da faixa de uso, para verificar a cobertura dos níveis. */
  rangeMax?: number | null;
}

/** Limites editáveis do estudo; os padrões seguem a orientação AIAG. */
export interface GageBiasLinearityCriteria {
  /** |tendência|/T ≤ biasPctAccept é conforme. */
  biasPctAccept: number;
  /** |tendência|/T > biasPctAccept e ≤ biasPctWarning é atenção. */
  biasPctWarning: number;
  /** %linearidade ≤ linearityPctAccept é conforme. */
  linearityPctAccept: number;
  /** %linearidade > linearityPctAccept e ≤ linearityPctWarning é atenção. */
  linearityPctWarning: number;
  /** Mínimo de níveis de referência para um estudo de linearidade. */
  minLevels: number;
  /** Mínimo de réplicas por nível. */
  minReplicates: number;
}

export const DEFAULT_GAGE_BIAS_LINEARITY_CRITERIA: Readonly<GageBiasLinearityCriteria> =
  Object.freeze({
    biasPctAccept: 5,
    biasPctWarning: 10,
    linearityPctAccept: 5,
    linearityPctWarning: 10,
    minLevels: 5,
    minReplicates: 3,
  });

export interface GageBiasLinearityOptions {
  /** Nível de significância dos testes t; padrão 0,05. */
  alpha?: number;
  /** Confiança dos intervalos; padrão 0,95. */
  confidence?: number;
  /** Limites editáveis; os ausentes recebem os padrões. */
  criteria?: Partial<GageBiasLinearityCriteria>;
  /** Unidade das medições, apenas para exibição. */
  unit?: string;
}

export interface GageBiasLevelResult {
  reference: number;
  label: string;
  n: number;
  missing: number;
  mean: number;
  sd: number;
  sem: number;
  bias: number;
  /** 100·bias/T; nulo quando T não é informado. */
  biasPctT: number | null;
  /** 100·bias/|referência|; nulo quando a referência é zero. */
  biasPctRef: number | null;
  t: number;
  df: number;
  pValue: number;
  ciLow: number;
  ciHigh: number;
  referenceUncertainty: number;
  significant: boolean;
  verdict: Verdict;
  metrics: AnalysisMetric[];
  warnings: string[];
}

export interface GageBiasLinearityResult {
  n: number;
  levelCount: number;
  replicatesMin: number;
  replicatesMax: number;
  missing: number;
  tolerance: number | null;
  processVariation: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
  unit: string;
  alpha: number;
  confidence: number;
  criteria: GageBiasLinearityCriteria;
  levels: GageBiasLevelResult[];
  regression: RegressionResult;
  /** |b|·VP; nulo quando a variação do processo não é informada. */
  linearity: number | null;
  /** 100·|b| = 100·linearidade/VP. */
  linearityPct: number | null;
  /** 100·linearidade/T; nulo quando T não é informado. */
  linearityPctT: number | null;
  maxBiasPctT: number | null;
  designAdequate: boolean;
  coveragePct: number | null;
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

function overallVerdict(metrics: AnalysisMetric[]): Verdict {
  const evaluated = metrics.filter((metric) => metric.verdict !== 'not_evaluated');
  if (evaluated.length === 0) return 'not_evaluated';
  if (evaluated.some((metric) => metric.verdict === 'fail')) return 'fail';
  if (evaluated.some((metric) => metric.verdict === 'warning')) return 'warning';
  if (evaluated.every((metric) => metric.verdict === 'pass')) return 'pass';
  return 'not_evaluated';
}

function formatP(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return '—';
  if (p < 1e-12) return '< 1e-12';
  return fmt(p, 6);
}

function normalizeCriteria(
  partial: Partial<GageBiasLinearityCriteria> | undefined,
): GageBiasLinearityCriteria {
  const criteria: GageBiasLinearityCriteria = {
    ...DEFAULT_GAGE_BIAS_LINEARITY_CRITERIA,
    ...(partial ?? {}),
  };
  const pctKeys: Array<keyof Pick<
    GageBiasLinearityCriteria,
    'biasPctAccept' | 'biasPctWarning' | 'linearityPctAccept' | 'linearityPctWarning'
  >> = ['biasPctAccept', 'biasPctWarning', 'linearityPctAccept', 'linearityPctWarning'];
  for (const key of pctKeys) {
    const value = criteria[key];
    if (!(value >= 0) || !Number.isFinite(value)) {
      throw new Error(`O critério ${key} deve ser um número não negativo.`);
    }
  }
  if (criteria.biasPctWarning < criteria.biasPctAccept) {
    throw new Error('O limite de atenção da tendência deve ser maior ou igual ao limite conforme.');
  }
  if (criteria.linearityPctWarning < criteria.linearityPctAccept) {
    throw new Error('O limite de atenção da linearidade deve ser maior ou igual ao limite conforme.');
  }
  if (!(criteria.minLevels >= 1) || !Number.isFinite(criteria.minLevels)) {
    throw new Error('O número mínimo de níveis deve ser positivo.');
  }
  if (!(criteria.minReplicates >= 1) || !Number.isFinite(criteria.minReplicates)) {
    throw new Error('O número mínimo de réplicas por nível deve ser positivo.');
  }
  return criteria;
}

function validateOptions(options: GageBiasLinearityOptions): {
  alpha: number;
  confidence: number;
  criteria: GageBiasLinearityCriteria;
  unit: string;
} {
  const alpha = options.alpha ?? 0.05;
  const confidence = options.confidence ?? 0.95;
  if (!(alpha > 0 && alpha < 1) || !Number.isFinite(alpha)) {
    throw new Error('O nível de significância α deve estar entre 0 e 1 (ex.: 0,05).');
  }
  if (!(confidence > 0 && confidence < 1) || !Number.isFinite(confidence)) {
    throw new Error('A confiança deve estar entre 0 e 1 (ex.: 0,95).');
  }
  return {
    alpha,
    confidence,
    criteria: normalizeCriteria(options.criteria),
    unit: options.unit ?? '',
  };
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

function extractValues(
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
      throw new Error(`Valor inválido no nível ${label}: ${String(value)}.`);
    }
    out.push(value);
  }
  if (out.length === 0) {
    throw new Error(`O nível ${label} não possui medições válidas.`);
  }
  return { values: out, missing };
}

function levelVerdict(metrics: AnalysisMetric[]): Verdict {
  const evaluated = metrics.filter((metric) => metric.verdict !== 'not_evaluated');
  if (evaluated.length === 0) return 'not_evaluated';
  if (evaluated.some((metric) => metric.verdict === 'fail')) return 'fail';
  if (evaluated.some((metric) => metric.verdict === 'warning')) return 'warning';
  if (evaluated.every((metric) => metric.verdict === 'pass')) return 'pass';
  return 'not_evaluated';
}

/** Executa o estudo de tendência por nível e linearidade AIAG. */
export function gageBiasLinearityStudy(
  input: GageBiasLinearityInput,
  options: GageBiasLinearityOptions = {},
): GageBiasLinearityResult {
  const { alpha, confidence, criteria, unit } = validateOptions(options);
  if (!input || !Array.isArray(input.levels) || input.levels.length === 0) {
    throw new Error(
      'O estudo de tendência/linearidade requer pelo menos um nível de referência.',
    );
  }
  const tolerance = validatePositiveOrNull(input.tolerance, 'tolerância T = USL − LSL');
  const processVariation = validatePositiveOrNull(
    input.processVariation,
    'variação do processo (6σ)',
  );
  const rangeMin =
    input.rangeMin === null || input.rangeMin === undefined ? null : input.rangeMin;
  const rangeMax =
    input.rangeMax === null || input.rangeMax === undefined ? null : input.rangeMax;
  if (rangeMin !== null && !Number.isFinite(rangeMin)) {
    throw new Error('O início da faixa de uso deve ser um número finito.');
  }
  if (rangeMax !== null && !Number.isFinite(rangeMax)) {
    throw new Error('O fim da faixa de uso deve ser um número finito.');
  }
  if (rangeMin !== null && rangeMax !== null && !(rangeMin < rangeMax)) {
    throw new Error('A faixa de uso exige rangeMin < rangeMax.');
  }

  const levels: GageBiasLevelResult[] = [];
  const regressionPoints: Array<{ x: number; y: number }> = [];
  let total = 0;
  let missing = 0;

  input.levels.forEach((rawLevel, index) => {
    const reference = rawLevel.reference;
    if (!Number.isFinite(reference)) {
      throw new Error(`A referência do nível ${index + 1} deve ser um número finito.`);
    }
    const label =
      rawLevel.label && rawLevel.label.trim()
        ? rawLevel.label.trim()
        : `Nível ${index + 1} (ref. ${fmt(reference)})`;
    const extracted = extractValues(rawLevel.values, label);
    const values = extracted.values;
    const n = values.length;
    const referenceUncertainty = rawLevel.referenceUncertainty ?? 0;
    if (!(referenceUncertainty >= 0) || !Number.isFinite(referenceUncertainty)) {
      throw new Error(
        `A incerteza-padrão da referência do nível ${label} deve ser um número não negativo.`,
      );
    }
    const referenceDof = rawLevel.referenceDof ?? null;
    if (
      referenceDof !== null &&
      (!(referenceDof > 0) || !Number.isFinite(referenceDof))
    ) {
      throw new Error(
        `Os graus de liberdade da referência do nível ${label} devem ser positivos.`,
      );
    }

    const m = mean(values);
    const s = n >= 2 ? sd(values) : NaN;
    const bias = m - reference;
    const test =
      n >= 2
        ? biasTestWithReferenceUncertainty(
            values,
            new Array<number>(n).fill(reference),
            alpha,
            confidence,
            referenceUncertainty,
            referenceDof,
          )
        : null;
    const pValue = test ? test.pValue : NaN;
    const significant = Number.isFinite(pValue) && pValue < alpha;
    const biasPctT = tolerance !== null ? (100 * bias) / tolerance : null;
    const biasPctRef = reference !== 0 ? (100 * bias) / Math.abs(reference) : null;
    const biasPctVerdict =
      biasPctT === null
        ? 'not_evaluated'
        : classifyMax(Math.abs(biasPctT), criteria.biasPctAccept, criteria.biasPctWarning);
    const pVerdict = Number.isFinite(pValue) ? classifyMin(pValue, alpha) : 'not_evaluated';

    const metrics: AnalysisMetric[] = [
      {
        key: 'bias',
        label: `Tendência em ${label}`,
        value: bias,
        unit,
        verdict: 'not_evaluated',
        criterionText: 'Descritivo; julgamento por |tendência|/T e pelo teste t.',
        formula: 'bias_i = x̄_i − ref_i',
        reference: REFERENCE,
      },
      {
        key: 'bias_pct_t',
        label: `Tendência relativa à tolerância em ${label}`,
        value: biasPctT,
        unit: '%',
        verdict: biasPctVerdict,
        criterionText:
          tolerance === null
            ? 'T não informado; tendência relativa a T não avaliada.'
            : maxCriterionText('|tendência|/T', criteria.biasPctAccept, criteria.biasPctWarning),
        formula: '100·bias_i/T',
        reference: REFERENCE,
      },
      {
        key: 'bias_p',
        label: `p do teste de tendência em ${label}`,
        value: Number.isFinite(pValue) ? pValue : null,
        unit: '',
        verdict: pVerdict,
        criterionText: `p ≥ ${fmt(alpha)} (sem evidência de tendência significativa)`,
        formula:
          referenceUncertainty > 0
            ? 't = bias_i/√(s²/n + u_ref²); p = 2·[1 − F_t(|t|, ν)]'
            : 't = bias_i/(s/√n); p = 2·[1 − F_t(|t|, ν)]',
        reference: REFERENCE,
      },
    ];

    const warnings = new Set<string>(test?.warnings ?? []);
    if (n < criteria.minReplicates) {
      warnings.add(
        `Nível ${label} tem ${n} réplica(s); o mínimo recomendado é ${criteria.minReplicates}.`,
      );
    }
    if (extracted.missing > 0) {
      warnings.add(`Nível ${label}: ${extracted.missing} medição(ões) ausente(s) ignorada(s).`);
    }
    if (referenceUncertainty > 0) {
      warnings.add(
        `Nível ${label}: incerteza-padrão da referência u_ref = ${fmt(referenceUncertainty)} incluída no erro-padrão.`,
      );
    }
    if (significant) {
      warnings.add(`Nível ${label}: tendência significativa (p = ${formatP(pValue)}).`);
    }
    if (biasPctT !== null && Math.abs(biasPctT) > criteria.biasPctWarning) {
      warnings.add(
        `Nível ${label}: |tendência|/T = ${fmt(Math.abs(biasPctT))}% acima do limite de atenção.`,
      );
    }

    const level: GageBiasLevelResult = {
      reference,
      label,
      n,
      missing: extracted.missing,
      mean: m,
      sd: s,
      sem: test ? test.sem : n >= 2 ? s / Math.sqrt(n) : NaN,
      bias,
      biasPctT,
      biasPctRef,
      t: test ? test.t : NaN,
      df: test ? test.df : n - 1,
      pValue,
      ciLow: test ? test.ciLow : NaN,
      ciHigh: test ? test.ciHigh : NaN,
      referenceUncertainty,
      significant,
      verdict: levelVerdict(metrics),
      metrics,
      warnings: [...warnings],
    };
    levels.push(level);
    total += n;
    missing += extracted.missing;

    for (const value of values) {
      regressionPoints.push({ x: reference, y: value - reference });
    }
  });

  const regression = linearRegression(regressionPoints, confidence, alpha);
  const slope = regression.n >= 3 ? regression.slope : NaN;
  const intercept = regression.n >= 3 ? regression.intercept : NaN;
  const slopeP = regression.n >= 3 ? regression.slopeP : NaN;
  const interceptP = regression.n >= 3 ? regression.interceptP : NaN;
  const linearity =
    Number.isFinite(slope) && processVariation !== null
      ? Math.abs(slope) * processVariation
      : null;
  const linearityPct = Number.isFinite(slope) ? 100 * Math.abs(slope) : null;
  const linearityPctT =
    linearity !== null && tolerance !== null ? (100 * linearity) / tolerance : null;
  const maxBiasPctT = tolerance === null
    ? null
    : levels.reduce<number | null>((acc, level) => {
        if (level.biasPctT === null) return acc;
        const value = Math.abs(level.biasPctT);
        return acc === null ? value : Math.max(acc, value);
      }, null);

  const linearityVerdict =
    linearityPct === null
      ? 'not_evaluated'
      : classifyMax(
          linearityPct,
          criteria.linearityPctAccept,
          criteria.linearityPctWarning,
        );
  const linearityAbsVerdict =
    linearity === null ? 'not_evaluated' : linearityVerdict;
  const linearityTVerdict =
    linearityPctT === null
      ? 'not_evaluated'
      : classifyMax(
          Math.abs(linearityPctT),
          criteria.linearityPctAccept,
          criteria.linearityPctWarning,
        );
  const slopeVerdict = Number.isFinite(slopeP) ? classifyMin(slopeP, alpha) : 'not_evaluated';
  const interceptVerdict = Number.isFinite(interceptP)
    ? classifyMin(interceptP, alpha)
    : 'not_evaluated';
  const biasVerdict =
    maxBiasPctT === null
      ? 'not_evaluated'
      : classifyMax(maxBiasPctT, criteria.biasPctAccept, criteria.biasPctWarning);

  const references = levels.map((level) => level.reference);
  const observedMin = references.length ? Math.min(...references) : NaN;
  const observedMax = references.length ? Math.max(...references) : NaN;
  const coveragePct =
    rangeMin !== null && rangeMax !== null && rangeMax > rangeMin
      ? (100 * (observedMax - observedMin)) / (rangeMax - rangeMin)
      : null;
  const coverageVerdict =
    coveragePct === null
      ? 'not_evaluated'
      : coveragePct >= 100
        ? 'pass'
        : 'warning';

  const levelCount = levels.length;
  const replicatesMin = levels.length
    ? Math.min(...levels.map((level) => level.n))
    : 0;
  const replicatesMax = levels.length
    ? Math.max(...levels.map((level) => level.n))
    : 0;
  const designAdequate =
    levelCount >= criteria.minLevels &&
    replicatesMin >= criteria.minReplicates &&
    (coveragePct === null || coveragePct >= 100);

  const designMetrics: AnalysisMetric[] = [
    {
      key: 'design_levels',
      label: 'Níveis de referência',
      value: levelCount,
      unit: '',
      verdict: levelCount >= criteria.minLevels ? 'pass' : 'warning',
      criterionText: `≥ ${fmt(criteria.minLevels)} níveis de referência`,
      formula: 'contagem de níveis distintos com medições',
      reference: REFERENCE,
    },
    {
      key: 'design_replicates',
      label: 'Réplicas mínimas por nível',
      value: replicatesMin,
      unit: '',
      verdict: replicatesMin >= criteria.minReplicates ? 'pass' : 'warning',
      criterionText: `≥ ${fmt(criteria.minReplicates)} réplicas por nível`,
      formula: 'mínimo de n entre os níveis',
      reference: REFERENCE,
    },
    {
      key: 'design_coverage',
      label: 'Cobertura da faixa de uso',
      value: coveragePct,
      unit: '%',
      verdict: coverageVerdict,
      criterionText:
        rangeMin === null || rangeMax === null
          ? 'Faixa de uso não informada; cobertura não avaliada.'
          : '≥ 100% da faixa [rangeMin, rangeMax]',
      formula: '100·(maior ref. − menor ref.)/(rangeMax − rangeMin)',
      reference: REFERENCE,
    },
  ];

  const metrics: AnalysisMetric[] = [
    ...designMetrics,
    {
      key: 'max_bias_pct_t',
      label: 'Maior |tendência| relativa à tolerância',
      value: maxBiasPctT,
      unit: '%',
      verdict: biasVerdict,
      criterionText:
        tolerance === null
          ? 'T não informado; tendência relativa a T não avaliada.'
          : maxCriterionText('|tendência|/T', criteria.biasPctAccept, criteria.biasPctWarning),
      formula: 'max_i |100·bias_i/T|',
      reference: REFERENCE,
    },
    {
      key: 'linearity_pct',
      label: '%Linearidade (AIAG)',
      value: linearityPct,
      unit: '%',
      verdict: linearityVerdict,
      criterionText: maxCriterionText(
        '%linearidade',
        criteria.linearityPctAccept,
        criteria.linearityPctWarning,
      ),
      formula: '%linearidade = 100·|b| = 100·linearidade/VP',
      reference: REFERENCE,
    },
    {
      key: 'linearity',
      label: 'Linearidade (|b|·VP)',
      value: linearity,
      unit,
      verdict: linearityAbsVerdict,
      criterionText:
        processVariation === null
          ? 'Variação do processo (VP) não informada; linearidade absoluta não avaliada.'
          : `Avaliada por %linearidade ≤ ${fmt(criteria.linearityPctAccept)}% (VP = ${fmt(processVariation)})`,
      formula: 'linearidade = |b|·VP, com VP = 6σ_processo',
      reference: REFERENCE,
    },
    {
      key: 'linearity_pct_t',
      label: 'Linearidade relativa à tolerância',
      value: linearityPctT,
      unit: '%',
      verdict: linearityTVerdict,
      criterionText:
        tolerance === null
          ? 'T não informado; linearidade relativa a T não avaliada.'
          : maxCriterionText(
              'linearidade/T',
              criteria.linearityPctAccept,
              criteria.linearityPctWarning,
            ),
      formula: '100·linearidade/T',
      reference: REFERENCE,
    },
    {
      key: 'slope_p',
      label: 'p do declive b (linearidade)',
      value: Number.isFinite(slopeP) ? slopeP : null,
      unit: '',
      verdict: slopeVerdict,
      criterionText: `p ≥ ${fmt(alpha)} (sem declive significativo)`,
      formula: 't_b = b/EP(b); p = 2·[1 − F_t(|t_b|, n−2)]',
      reference: REFERENCE,
    },
    {
      key: 'intercept_p',
      label: 'p do intercepto a',
      value: Number.isFinite(interceptP) ? interceptP : null,
      unit: '',
      verdict: interceptVerdict,
      criterionText: `p ≥ ${fmt(alpha)} (sem intercepto significativo)`,
      formula: 't_a = a/EP(a); p = 2·[1 − F_t(|t_a|, n−2)]',
      reference: REFERENCE,
    },
    {
      key: 'slope',
      label: 'Declive b (bias por unidade de referência)',
      value: Number.isFinite(slope) ? slope : null,
      unit: unit ? `${unit}/${unit}` : '',
      verdict: 'not_evaluated',
      criterionText: 'Descritivo; o julgamento usa %linearidade e o teste de b.',
      formula: 'b = S_xy/S_xx',
      reference: REFERENCE,
    },
    {
      key: 'intercept',
      label: 'Intercepto a (tendência na referência zero)',
      value: Number.isFinite(intercept) ? intercept : null,
      unit,
      verdict: 'not_evaluated',
      criterionText: 'Descritivo; o julgamento usa o teste de a.',
      formula: 'a = ȳ − b·x̄',
      reference: REFERENCE,
    },
    {
      key: 'r2',
      label: 'R² da regressão de tendência',
      value: regression.n >= 3 && Number.isFinite(regression.r2) ? regression.r2 : null,
      unit: '',
      verdict: 'not_evaluated',
      criterionText: 'Descritivo.',
      formula: 'R² = 1 − SS_res/SS_tot',
      reference: REFERENCE,
    },
    {
      key: 'syx',
      label: 'Desvio-padrão residual da linearidade',
      value: regression.n >= 3 && Number.isFinite(regression.syx) ? regression.syx : null,
      unit,
      verdict: 'not_evaluated',
      criterionText: 'Descritivo.',
      formula: 's_yx = √[Σe_i²/(n−2)]',
      reference: REFERENCE,
    },
  ];

  const verdict = overallVerdict(metrics);

  const warnings = new Set<string>();
  for (const level of levels) {
    for (const warning of level.warnings) warnings.add(warning);
  }
  if (levelCount < criteria.minLevels) {
    warnings.add(
      `O estudo tem ${levelCount} níveis; a AIAG recomenda pelo menos ${criteria.minLevels} níveis cobrindo a faixa.`,
    );
  }
  if (replicatesMin < criteria.minReplicates) {
    warnings.add(
      `O estudo tem níveis com ${replicatesMin} réplica(s); a AIAG recomenda pelo menos ${criteria.minReplicates}.`,
    );
  }
  if (rangeMin !== null && rangeMax !== null && coveragePct !== null && coveragePct < 100) {
    warnings.add(
      `Os níveis cobrem ${fmt(coveragePct)}% da faixa de uso [${fmt(rangeMin)}, ${fmt(rangeMax)}].`,
    );
  }
  if (tolerance === null) {
    warnings.add('T não informado: tendência e linearidade relativas a T não avaliadas.');
  }
  if (processVariation === null) {
    warnings.add(
      'Variação do processo (VP) não informada: a linearidade absoluta |b|·VP não foi calculada; %linearidade = 100·|b| continua disponível.',
    );
  }
  if (Number.isFinite(slopeP) && slopeP < alpha) {
    warnings.add(
      `Declive significativo (b = ${fmt(slope)}, p = ${formatP(slopeP)}): a tendência varia com a referência.`,
    );
  }
  if (Number.isFinite(interceptP) && interceptP < alpha) {
    warnings.add(
      `Intercepto significativo (a = ${fmt(intercept)}, p = ${formatP(interceptP)}): tendência não nula na referência zero.`,
    );
  }
  for (const warning of regression.warnings) warnings.add(warning);

  const notes = [
    'Linearidade AIAG: ajuste de bias = a + b·ref por mínimos quadrados; linearidade = |b|·VP; %linearidade = 100·|b|.',
    'O teste do declive verifica se a tendência muda ao longo da faixa; o teste do intercepto verifica tendência na referência zero.',
    'Cada nível deve ter pelo menos 3 réplicas e o estudo deve ter pelo menos 5 níveis cobrindo a faixa de uso (AIAG).',
    'Nenhum ponto é removido automaticamente; valores ausentes são registrados e ignorados por lista.',
    'u_ref é a incerteza-padrão da referência; quando informada, entra em EP = √(s²/n + u_ref²).',
  ];
  if (processVariation !== null) {
    notes.push(`Variação do processo informada: VP = ${fmt(processVariation)} (6σ).`);
  }

  const levelRows: Array<Array<string | number>> = levels.map((level) => [
    level.label,
    level.n,
    fmt(level.mean),
    fmt(level.bias),
    fmt(level.sd),
    fmt(level.sem),
    fmt(level.t),
    formatP(Number.isFinite(level.pValue) ? level.pValue : null),
    fmt(level.ciLow),
    fmt(level.ciHigh),
    level.biasPctT === null ? '—' : fmt(Math.abs(level.biasPctT)),
    verdictLabel(level.verdict),
  ]);
  const levelTable: AnalysisTable = {
    title: 'Tendência por nível de referência',
    columns: [
      'Nível',
      'n',
      'Média',
      'Tendência',
      's',
      'EP',
      't',
      'p',
      'IC inf.',
      'IC sup.',
      '|Tendência|/T (%)',
      'Veredito',
    ],
    rows: levelRows,
    note:
      'bias_i = x̄_i − ref_i; EP = s/√n ou √(s²/n + u_ref²); IC = bias_i ± t_{1−α/2,ν}·EP.',
  };

  const regressionTable: AnalysisTable = {
    title: 'Regressão da tendência sobre a referência (bias = a + b·ref)',
    columns: ['Termo', 'Estimativa', 'EP', 't', 'p', 'IC inf.', 'IC sup.', 'Veredito'],
    rows: [
      [
        'Intercepto (a)',
        fmt(regression.intercept),
        fmt(regression.interceptSe),
        fmt(regression.interceptT),
        formatP(Number.isFinite(regression.interceptP) ? regression.interceptP : null),
        fmt(regression.interceptCi[0]),
        fmt(regression.interceptCi[1]),
        verdictLabel(interceptVerdict),
      ],
      [
        'Declive (b)',
        fmt(regression.slope),
        fmt(regression.slopeSe),
        fmt(regression.slopeT),
        formatP(Number.isFinite(regression.slopeP) ? regression.slopeP : null),
        fmt(regression.slopeCi[0]),
        fmt(regression.slopeCi[1]),
        verdictLabel(slopeVerdict),
      ],
    ],
    note:
      'OLS com todos os pares (ref_i, bias_ij). t e p bilaterais com ν = n − 2; IC de 95% (configurável).',
  };

  const designTable: AnalysisTable = {
    title: 'Requisitos do estudo de linearidade',
    columns: ['Requisito', 'Valor', 'Critério', 'Veredito'],
    rows: [
      [
        'Níveis de referência',
        levelCount,
        `≥ ${fmt(criteria.minLevels)}`,
        verdictLabel(designMetrics[0].verdict),
      ],
      [
        'Réplicas mínimas por nível',
        replicatesMin,
        `≥ ${fmt(criteria.minReplicates)}`,
        verdictLabel(designMetrics[1].verdict),
      ],
      [
        'Cobertura da faixa de uso (%)',
        coveragePct === null ? '—' : fmt(coveragePct),
        '≥ 100%',
        verdictLabel(coverageVerdict),
      ],
      [
        'Total de medições válidas',
        total,
        '—',
        '—',
      ],
    ],
    note:
      'A faixa de uso só é verificada quando rangeMin e rangeMax são informados. Requisitos AIAG: ≥ 5 níveis e ≥ 3 réplicas por nível.',
  };

  const xValues = regressionPoints.map((point) => point.x);
  const xMean = xValues.length ? mean(xValues) : NaN;
  const sxx = xValues.reduce((acc, x) => acc + (x - xMean) ** 2, 0);
  const tCrit =
    regression.df > 0 ? tInv(1 - (1 - confidence) / 2, regression.df) : NaN;
  const chartData: Array<Record<string, string | number | null>> = regressionPoints.map(
    (point, index) => {
      const fitted =
        regression.n >= 3 ? regression.intercept + regression.slope * point.x : null;
      let ciLow: number | null = null;
      let ciHigh: number | null = null;
      if (
        fitted !== null &&
        Number.isFinite(regression.syx) &&
        sxx > 0 &&
        Number.isFinite(tCrit)
      ) {
        const se =
          regression.syx *
          Math.sqrt(1 / regression.n + (point.x - xMean) ** 2 / sxx);
        ciLow = fitted - tCrit * se;
        ciHigh = fitted + tCrit * se;
      }
      return {
        ponto: index + 1,
        referencia: point.x,
        bias: point.y,
        ajustado: fitted,
        ic_inferior: ciLow,
        ic_superior: ciHigh,
      };
    },
  );

  const charts: AnalysisChart[] = [
    {
      kind: 'scatter',
      title: 'Linearidade: tendência versus valor de referência',
      xLabel: 'Valor de referência',
      yLabel: `Tendência${unit ? ` (${unit})` : ''}`,
      data: chartData,
    },
  ];

  const summaryParts = [
    `${levelCount} níveis e ${total} medições`,
    maxBiasPctT === null
      ? 'tendência relativa a T não avaliada (T ausente)'
      : `maior |tendência|/T = ${fmt(maxBiasPctT)}%`,
    linearityPct === null
      ? '%linearidade não avaliada'
      : `%linearidade = ${fmt(linearityPct)}%`,
    linearity === null
      ? 'linearidade absoluta não avaliada (VP ausente)'
      : `linearidade = ${fmt(linearity)}${unit ? ` ${unit}` : ''}`,
    `p do declive = ${formatP(Number.isFinite(slopeP) ? slopeP : null)}`,
  ];
  const summary = `Tendência e linearidade: ${summaryParts.join('; ')}. Veredito global: ${verdictLabel(verdict)}.`;

  const rawMetrics: Record<string, number | null> = {
    levels: levelCount,
    replicates_min: replicatesMin,
    replicates_max: replicatesMax,
    n: total,
    missing,
    coverage_pct: coveragePct,
    max_bias_pct_t: maxBiasPctT,
    slope: Number.isFinite(slope) ? slope : null,
    intercept: Number.isFinite(intercept) ? intercept : null,
    slope_p: Number.isFinite(slopeP) ? slopeP : null,
    intercept_p: Number.isFinite(interceptP) ? interceptP : null,
    linearity,
    linearity_pct: linearityPct,
    linearity_pct_t: linearityPctT,
    r2: regression.n >= 3 && Number.isFinite(regression.r2) ? regression.r2 : null,
    syx: regression.n >= 3 && Number.isFinite(regression.syx) ? regression.syx : null,
    process_variation: processVariation,
    tolerance,
    alpha,
    confidence,
  };

  return {
    n: total,
    levelCount,
    replicatesMin,
    replicatesMax,
    missing,
    tolerance,
    processVariation,
    rangeMin,
    rangeMax,
    unit,
    alpha,
    confidence,
    criteria,
    levels,
    regression,
    linearity,
    linearityPct,
    linearityPctT,
    maxBiasPctT,
    designAdequate,
    coveragePct,
    metrics,
    rawMetrics,
    tables: [levelTable, regressionTable, designTable],
    charts,
    warnings: [...warnings],
    notes,
    summary,
    verdict,
    method: 'Tendência por nível e linearidade AIAG (regressão da tendência sobre a referência)',
    reference: REFERENCE,
  };
}
