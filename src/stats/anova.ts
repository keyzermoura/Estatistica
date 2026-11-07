/**
 * ANOVA e componentes de variância.
 *
 * Referências:
 *  - Montgomery, Design and Analysis of Experiments, 10. ed., caps. 3–13.
 *  - ISO 5725-2:2019, cláusulas 5–7 (modelo aleatório de dois fatores).
 *  - Searle, Casella & McCulloch (1992), Variance Components.
 *  - Welch (1951), Biometrika 38:330–336.
 */

import { mean, sd } from './descriptive';
import { fCdf } from './distributions';

export interface AnovaRow {
  source: string;
  df: number;
  ss: number;
  ms: number | null;
  f: number | null;
  p: number | null;
  eta2?: number | null;
}

export interface AnovaResult {
  rows: AnovaRow[];
  totalSs: number;
  dfError: number;
  msError: number | null;
  balanced: boolean;
  alpha: number;
  method: string;
  reference: string;
  interpretation: string;
  warnings: string[];
}

export interface GroupInput {
  name: string;
  values: number[];
}

function pFromF(f: number | null, df1: number, df2: number): number | null {
  if (f === null || !Number.isFinite(f) || df1 <= 0 || df2 <= 0) return null;
  return Math.min(1, Math.max(0, 1 - fCdf(f, df1, df2)));
}

/** ANOVA de um fator (grupos independentes, balanceada ou não). */
export function anovaOneWay(groups: GroupInput[], alpha = 0.05): AnovaResult {
  const valid = groups.filter((g) => g.values.length > 0);
  const k = valid.length;
  const N = valid.reduce((acc, g) => acc + g.values.length, 0);
  if (k < 2 || N <= k) {
    return {
      rows: [],
      totalSs: NaN,
      dfError: 0,
      msError: null,
      balanced: false,
      alpha,
      method: 'ANOVA de um fator',
      reference: 'Montgomery, cap. 3',
      interpretation: 'São necessários pelo menos dois grupos com observações.',
      warnings: ['Dados insuficientes para ANOVA.'],
    };
  }
  const grand = mean(valid.flatMap((g) => g.values));
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of valid) {
    const m = mean(g.values);
    ssBetween += g.values.length * (m - grand) ** 2;
    for (const v of g.values) ssWithin += (v - m) ** 2;
  }
  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const f = msWithin > 0 ? msBetween / msWithin : null;
  const p = pFromF(f, dfBetween, dfWithin);
  const total = ssBetween + ssWithin;
  const sizes = valid.map((g) => g.values.length);
  const balanced = sizes.every((n) => n === sizes[0]);
  const rows: AnovaRow[] = [
    {
      source: 'Entre grupos',
      df: dfBetween,
      ss: ssBetween,
      ms: msBetween,
      f,
      p,
      eta2: total > 0 ? ssBetween / total : null,
    },
    {
      source: 'Dentro dos grupos (erro)',
      df: dfWithin,
      ss: ssWithin,
      ms: msWithin,
      f: null,
      p: null,
    },
    {
      source: 'Total',
      df: N - 1,
      ss: total,
      ms: null,
      f: null,
      p: null,
    },
  ];
  const warnings: string[] = [];
  if (!balanced) warnings.push('Grupos desbalanceados: a decomposição é válida, mas o poder é afetado.');
  if (valid.some((g) => g.values.length < 2)) warnings.push('Grupos com n < 2 impedem estimar a variância interna.');
  return {
    rows,
    totalSs: total,
    dfError: dfWithin,
    msError: msWithin,
    balanced,
    alpha,
    method: balanced ? 'ANOVA de um fator balanceada' : 'ANOVA de um fator desbalanceada',
    reference: 'Montgomery (2020), cap. 3; ISO 5725-2:2019, cláusula 5',
    interpretation:
      p === null
        ? 'Não foi possível calcular o teste F.'
        : p < alpha
          ? `Há diferença significativa entre as médias (F = ${f?.toFixed(3)}, p = ${p.toFixed(4)} < ${alpha}).`
          : `Não há evidência de diferença entre as médias (F = ${f?.toFixed(3)}, p = ${p.toFixed(4)} ≥ ${alpha}).`,
    warnings,
  };
}

/** ANOVA de Welch, robusta à heterogeneidade de variâncias (um fator). */
export function welchAnova(groups: GroupInput[], alpha = 0.05): AnovaResult {
  const valid = groups.filter((g) => g.values.length >= 2);
  const k = valid.length;
  if (k < 2) {
    return {
      rows: [],
      totalSs: NaN,
      dfError: 0,
      msError: null,
      balanced: false,
      alpha,
      method: 'ANOVA de Welch',
      reference: 'Welch (1951); Montgomery, cap. 3',
      interpretation: 'São necessários pelo menos dois grupos com n ≥ 2.',
      warnings: ['Dados insuficientes.'],
    };
  }
  const sizes = valid.map((g) => g.values.length);
  const variances = valid.map((g) => sd(g.values) ** 2);
  if (variances.some((v) => !(v > 0))) {
    return {
      rows: [],
      totalSs: NaN,
      dfError: 0,
      msError: null,
      balanced: false,
      alpha,
      method: 'ANOVA de Welch',
      reference: 'Welch (1951)',
      interpretation: 'Variância nula em algum grupo; use ANOVA clássica ou verifique os dados.',
      warnings: ['Variância nula.'],
    };
  }
  const w = sizes.map((n, i) => n / variances[i]);
  const W = w.reduce((a, b) => a + b, 0);
  const means = valid.map((g) => mean(g.values));
  const mw = w.reduce((acc, wi, i) => acc + wi * means[i], 0) / W;
  const A = w.reduce((acc, wi, i) => acc + wi * (means[i] - mw) ** 2, 0) / (k - 1);
  let bsum = 0;
  for (let i = 0; i < k; i++) {
    bsum += ((1 - w[i] / W) ** 2) / (sizes[i] - 1);
  }
  const B = 1 + (2 * (k - 2) / (k * k - 1)) * bsum;
  const f = A / B;
  const df1 = k - 1;
  const df2 = (k * k - 1) / (3 * bsum);
  const p = pFromF(f, df1, df2);
  return {
    rows: [
      {
        source: 'Entre grupos (Welch)',
        df: df1,
        ss: A * df1,
        ms: A,
        f,
        p,
      },
      {
        source: 'Resíduo (Welch)',
        df: df2,
        ss: NaN,
        ms: NaN,
        f: null,
        p: null,
      },
    ],
    totalSs: NaN,
    dfError: df2,
    msError: NaN,
    balanced: sizes.every((n) => n === sizes[0]),
    alpha,
    method: 'ANOVA de Welch (variâncias desiguais)',
    reference: 'Welch (1951), Biometrika 38; Montgomery, cap. 3',
    interpretation:
      p !== null && p < alpha
        ? `Há diferença significativa entre as médias (F = ${f.toFixed(3)}, p = ${p.toFixed(4)}).`
        : `Não há evidência de diferença entre as médias (F = ${f.toFixed(3)}, p = ${p?.toFixed(4)}).`,
    warnings: ['Alternativa recomendada quando Levene/Bartlett rejeitam homogeneidade.'],
  };
}

export interface TwoWayInputRow {
  a: string;
  b: string;
  value: number;
}

export interface VarianceComponents {
  repeatability: number;
  betweenA: number;
  betweenB: number;
  interaction: number;
  total: number;
  percentRepeatability: number;
  percentBetweenA: number;
  percentBetweenB: number;
  percentInteraction: number;
  method: string;
  reference: string;
  warnings: string[];
}

/** ANOVA de dois fatores cruzados (balanceada) e componentes de variância. */
export function anovaTwoWay(
  data: TwoWayInputRow[],
  alpha = 0.05,
): AnovaResult & { components: VarianceComponents | null } {
  const aLevels = [...new Set(data.map((d) => d.a))];
  const bLevels = [...new Set(data.map((d) => d.b))];
  const cells = new Map<string, number[]>();
  for (const d of data) {
    const key = `${d.a}\u0000${d.b}`;
    const list = cells.get(key) ?? [];
    list.push(d.value);
    cells.set(key, list);
  }
  const cellSizes = [...cells.values()].map((v) => v.length);
  const n = cellSizes.length ? Math.min(...cellSizes) : 0;
  const balanced = cellSizes.length === aLevels.length * bLevels.length && cellSizes.every((s) => s === n);
  if (aLevels.length < 2 || bLevels.length < 2 || n < 1) {
    return {
      rows: [],
      totalSs: NaN,
      dfError: 0,
      msError: null,
      balanced: false,
      alpha,
      method: 'ANOVA de dois fatores',
      reference: 'Montgomery, cap. 5',
      interpretation: 'São necessários dois fatores com pelo menos dois níveis e células não vazias.',
      warnings: ['Dados insuficientes.'],
      components: null,
    };
  }
  const grand = mean(data.map((d) => d.value));
  const meanA = new Map(aLevels.map((a) => [a, mean(data.filter((d) => d.a === a).map((d) => d.value))]));
  const meanB = new Map(bLevels.map((b) => [b, mean(data.filter((d) => d.b === b).map((d) => d.value))]));
  const cellMeans = new Map<string, number>();
  for (const [key, vals] of cells) cellMeans.set(key, mean(vals));
  const bN = bLevels.length;
  const aN = aLevels.length;
  let ssa = 0;
  let ssb = 0;
  let ssab = 0;
  let sse = 0;
  for (const a of aLevels) {
    ssa += bN * n * (meanA.get(a)! - grand) ** 2;
  }
  for (const b of bLevels) {
    ssb += aN * n * (meanB.get(b)! - grand) ** 2;
  }
  for (const a of aLevels) {
    for (const b of bLevels) {
      const cm = cellMeans.get(`${a}\u0000${b}`);
      if (cm === undefined) continue;
      const effect = cm - meanA.get(a)! - meanB.get(b)! + grand;
      ssab += n * effect * effect;
      const vals = cells.get(`${a}\u0000${b}`) ?? [];
      for (const v of vals) sse += (v - cm) ** 2;
    }
  }
  const dfA = aN - 1;
  const dfB = bN - 1;
  const dfAB = dfA * dfB;
  const dfE = data.length - aN * bN * n;
  const msA = ssa / dfA;
  const msB = ssb / dfB;
  const msAB = ssab / dfAB;
  const msE = dfE > 0 ? sse / dfE : NaN;
  const fA = msE > 0 ? msA / msE : null;
  const fB = msE > 0 ? msB / msE : null;
  const fAB = msE > 0 ? msAB / msE : null;
  const warnings: string[] = [];
  if (!balanced) warnings.push('Delineamento desbalanceado: a decomposição apresentada é aproximada; use modelo misto/REML.');
  if (dfE < 1) warnings.push('Sem graus de liberdade residuais: não é possível testar efeitos.');
  const total = ssa + ssb + ssab + sse;
  const rows: AnovaRow[] = [
    { source: 'Fator A', df: dfA, ss: ssa, ms: msA, f: fA, p: pFromF(fA, dfA, dfE), eta2: total ? ssa / total : null },
    { source: 'Fator B', df: dfB, ss: ssb, ms: msB, f: fB, p: pFromF(fB, dfB, dfE), eta2: total ? ssb / total : null },
    { source: 'A × B', df: dfAB, ss: ssab, ms: msAB, f: fAB, p: pFromF(fAB, dfAB, dfE), eta2: total ? ssab / total : null },
    { source: 'Erro', df: dfE, ss: sse, ms: msE, f: null, p: null },
    { source: 'Total', df: data.length - 1, ss: total, ms: null, f: null, p: null },
  ];
  let components: VarianceComponents | null = null;
  if (balanced && dfE > 0 && n > 0) {
    const s2e = msE;
    const s2ab = Math.max(0, (msAB - msE) / n);
    const s2a = Math.max(0, (msA - msAB) / (bN * n));
    const s2b = Math.max(0, (msB - msAB) / (aN * n));
    const sum = s2e + s2ab + s2a + s2b;
    components = {
      repeatability: s2e,
      betweenA: s2a,
      betweenB: s2b,
      interaction: s2ab,
      total: sum,
      percentRepeatability: sum > 0 ? (100 * s2e) / sum : 0,
      percentBetweenA: sum > 0 ? (100 * s2a) / sum : 0,
      percentBetweenB: sum > 0 ? (100 * s2b) / sum : 0,
      percentInteraction: sum > 0 ? (100 * s2ab) / sum : 0,
      method: 'Componentes de variância por momentos (ANOVA)',
      reference: 'ISO 5725-2:2019; Searle, Casella & McCulloch (1992)',
      warnings: balanced
        ? ['Componentes negativos foram truncados em zero.']
        : ['Aproximação para desenho desbalanceado.'],
    };
  }
  return {
    rows,
    totalSs: total,
    dfError: dfE,
    msError: Number.isFinite(msE) ? msE : null,
    balanced,
    alpha,
    method: balanced ? 'ANOVA de dois fatores cruzados balanceada' : 'ANOVA de dois fatores (aproximação)',
    reference: 'Montgomery (2020), cap. 5; ISO 5725-2:2019, cláusula 5',
    interpretation:
      fAB !== null && pFromF(fAB, dfAB, dfE) !== null && pFromF(fAB, dfAB, dfE)! < alpha
        ? 'Há interação significativa entre os fatores; interprete os efeitos principais com cautela.'
        : fA !== null && pFromF(fA, dfA, dfE)! < alpha
          ? 'O fator A apresenta efeito significativo.'
          : fB !== null && pFromF(fB, dfB, dfE)! < alpha
            ? 'O fator B apresenta efeito significativo.'
            : 'Não há efeitos significativos detectados nos fatores avaliados.',
    warnings,
    components,
  };
}

/** Componentes de variância para um fator aleatório (grupos = níveis). */
export function varianceComponentsOneWay(groups: GroupInput[]): VarianceComponents {
  const valid = groups.filter((g) => g.values.length >= 2);
  const k = valid.length;
  const N = valid.reduce((acc, g) => acc + g.values.length, 0);
  if (k < 2 || N <= k) {
    return {
      repeatability: NaN,
      betweenA: NaN,
      betweenB: NaN,
      interaction: NaN,
      total: NaN,
      percentRepeatability: NaN,
      percentBetweenA: NaN,
      percentBetweenB: NaN,
      percentInteraction: NaN,
      method: 'Componentes de variância (um fator)',
      reference: 'ISO 5725-2; Searle et al. (1992)',
      warnings: ['Dados insuficientes.'],
    };
  }
  const grand = mean(valid.flatMap((g) => g.values));
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of valid) {
    const m = mean(g.values);
    ssBetween += g.values.length * (m - grand) ** 2;
    for (const v of g.values) ssWithin += (v - m) ** 2;
  }
  const dfB = k - 1;
  const dfW = N - k;
  const msB = ssBetween / dfB;
  const msW = ssWithin / dfW;
  const n0 = (N - valid.reduce((acc, g) => acc + g.values.length ** 2, 0) / N) / dfB;
  const s2w = msW;
  const s2b = Math.max(0, (msB - msW) / (n0 || 1));
  const total = s2w + s2b;
  return {
    repeatability: s2w,
    betweenA: s2b,
    betweenB: 0,
    interaction: 0,
    total,
    percentRepeatability: total > 0 ? (100 * s2w) / total : 0,
    percentBetweenA: total > 0 ? (100 * s2b) / total : 0,
    percentBetweenB: 0,
    percentInteraction: 0,
    method: 'Componentes de variância por momentos (ANOVA de um fator aleatório)',
    reference: 'ISO 5725-2:2019; Searle, Casella & McCulloch (1992)',
    warnings: [
      'Componente entre grupos truncado em zero quando negativo.',
      ...(valid.some((g) => g.values.length !== valid[0].values.length)
        ? ['Grupos desbalanceados: usado n0 de Satterthwaite.']
        : []),
    ],
  };
}
