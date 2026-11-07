/**
 * Homogeneidade de variâncias.
 *
 * Referências:
 *  - Bartlett (1937), Proc. Roy. Soc. A 160:268–282.
 *  - Levene (1960); Brown & Forsythe (1974), JASA 69:364–367.
 *  - ISO 5725-2:2019 (precisão interlaboratorial).
 */

import { mean, median, sd } from './descriptive';
import { chi2Cdf, fCdf } from './distributions';

export interface HomogeneityResult {
  statistic: number;
  df1: number;
  df2: number;
  pValue: number;
  alpha: number;
  homogeneous: boolean;
  method: string;
  reference: string;
  interpretation: string;
  warnings: string[];
  groupVariances: number[];
  groupSizes: number[];
}

function validGroups(groups: number[][]): number[][] {
  return groups.filter((g) => g.length >= 2);
}

/** Teste F para igualdade de duas variâncias. */
export function fTestVarianceRatio(
  a: number[],
  b: number[],
  alpha = 0.05,
  sides: 1 | 2 = 2,
): HomogeneityResult {
  const v1 = sd(a) ** 2;
  const v2 = sd(b) ** 2;
  const df1 = a.length - 1;
  const df2 = b.length - 1;
  if (!(v1 > 0) || !(v2 > 0) || df1 < 1 || df2 < 1) {
    return {
      statistic: NaN,
      df1,
      df2,
      pValue: NaN,
      alpha,
      homogeneous: false,
      method: 'Teste F de razão de variâncias',
      reference: 'Montgomery & Runger, cap. 9',
      interpretation: 'Não foi possível calcular: grupos com variância nula ou n < 2.',
      warnings: ['Dados insuficientes.'],
      groupVariances: [v1, v2],
      groupSizes: [a.length, b.length],
    };
  }
  const f = v1 / v2;
  const p =
    sides === 2
      ? Math.min(1, 2 * Math.min(fCdf(f, df1, df2), 1 - fCdf(f, df1, df2)))
      : 1 - fCdf(f, df1, df2);
  return {
    statistic: f,
    df1,
    df2,
    pValue: p,
    alpha,
    homogeneous: p >= alpha,
    method: 'Teste F de razão de variâncias',
    reference: 'Montgomery & Runger, cap. 9; ISO 5725-2',
    interpretation:
      p >= alpha
        ? `Não se rejeita a igualdade das variâncias (F = ${f.toFixed(3)}, p = ${p.toFixed(4)}).`
        : `Rejeita-se a igualdade das variâncias (F = ${f.toFixed(3)}, p = ${p.toFixed(4)}).`,
    warnings: ['Sensível à não normalidade; prefira Levene quando houver dúvida.'],
    groupVariances: [v1, v2],
    groupSizes: [a.length, b.length],
  };
}

/** Bartlett: χ² = [(N−k)ln(s²p) − Σ(ni−1)ln(s²i)] / C. */
export function bartlettTest(groups: number[][], alpha = 0.05): HomogeneityResult {
  const gs = validGroups(groups);
  const k = gs.length;
  const sizes = gs.map((g) => g.length);
  const variances = gs.map((g) => sd(g) ** 2);
  const warnings: string[] = [];
  if (k < 2 || variances.some((v) => !(v > 0))) {
    return {
      statistic: NaN,
      df1: Math.max(0, k - 1),
      df2: 0,
      pValue: NaN,
      alpha,
      homogeneous: false,
      method: 'Bartlett',
      reference: 'Bartlett (1937); Montgomery & Runger, cap. 9',
      interpretation: 'Não foi possível calcular: são necessários ≥ 2 grupos com variância positiva.',
      warnings: ['Dados insuficientes ou variância nula.'],
      groupVariances: variances,
      groupSizes: sizes,
    };
  }
  const N = sizes.reduce((a, b) => a + b, 0);
  const dfs = sizes.map((n) => n - 1);
  const poolDf = N - k;
  const pooled = dfs.reduce((acc, df, i) => acc + df * variances[i], 0) / poolDf;
  let num = poolDf * Math.log(pooled);
  for (let i = 0; i < k; i++) num -= dfs[i] * Math.log(variances[i]);
  const c =
    1 +
    (1 / (3 * (k - 1))) *
      (dfs.reduce((acc, df) => acc + 1 / df, 0) - 1 / poolDf);
  const chi2 = num / c;
  const p = Math.min(1, Math.max(0, 1 - chi2Cdf(chi2, k - 1)));
  if (sizes.some((n) => n < 5)) warnings.push('Grupos pequenos: Bartlett é sensível à não normalidade.');
  return {
    statistic: chi2,
    df1: k - 1,
    df2: poolDf,
    pValue: p,
    alpha,
    homogeneous: p >= alpha,
    method: 'Bartlett',
    reference: 'Bartlett (1937), Proc. Roy. Soc. A 160; Montgomery & Runger, cap. 9',
    interpretation:
      p >= alpha
        ? `Não se rejeita a homogeneidade (χ² = ${chi2.toFixed(3)}, p = ${p.toFixed(4)}).`
        : `Rejeita-se a homogeneidade (χ² = ${chi2.toFixed(3)}, p = ${p.toFixed(4)}).`,
    warnings,
    groupVariances: variances,
    groupSizes: sizes,
  };
}

function leveneCore(groups: number[][], center: 'mean' | 'median', alpha: number): HomogeneityResult {
  const gs = validGroups(groups);
  const k = gs.length;
  if (k < 2) {
    return {
      statistic: NaN,
      df1: 0,
      df2: 0,
      pValue: NaN,
      alpha,
      homogeneous: false,
      method: 'Levene',
      reference: 'Levene (1960); Brown & Forsythe (1974)',
      interpretation: 'São necessários pelo menos dois grupos com n ≥ 2.',
      warnings: ['Dados insuficientes.'],
      groupVariances: [],
      groupSizes: [],
    };
  }
  const z = gs.map((g) => {
    const c = center === 'mean' ? mean(g) : median(g);
    return g.map((v) => Math.abs(v - c));
  });
  const all = z.flat();
  const grand = mean(all);
  const N = all.length;
  let ssb = 0;
  let ssw = 0;
  z.forEach((group) => {
    const m = mean(group);
    for (const v of group) ssw += (v - m) ** 2;
    ssb += group.length * (m - grand) ** 2;
  });
  const df1 = k - 1;
  const df2 = N - k;
  const f = df2 > 0 ? (ssb / df1) / (ssw / df2) : NaN;
  const p = Number.isFinite(f) ? Math.min(1, Math.max(0, 1 - fCdf(f, df1, df2))) : NaN;
  return {
    statistic: f,
    df1,
    df2,
    pValue: p,
    alpha,
    homogeneous: Number.isFinite(p) ? p >= alpha : false,
    method:
      center === 'median'
        ? 'Levene (centrado na mediana, Brown-Forsythe)'
        : 'Levene (centrado na média)',
    reference: 'Levene (1960); Brown & Forsythe (1974), JASA 69',
    interpretation: Number.isFinite(p)
      ? p >= alpha
        ? `Não se rejeita a homogeneidade (F = ${f.toFixed(3)}, p = ${p.toFixed(4)}).`
        : `Rejeita-se a homogeneidade (F = ${f.toFixed(3)}, p = ${p.toFixed(4)}).`
      : 'Não foi possível calcular.',
    warnings: center === 'mean' ? ['Para dados assimétricos, use a versão centrada na mediana.'] : [],
    groupVariances: gs.map((g) => sd(g) ** 2),
    groupSizes: gs.map((g) => g.length),
  };
}

export function leveneTest(groups: number[][], alpha = 0.05): HomogeneityResult {
  return leveneCore(groups, 'mean', alpha);
}

export function brownForsytheTest(groups: number[][], alpha = 0.05): HomogeneityResult {
  return leveneCore(groups, 'median', alpha);
}

/** Bateria de homogeneidade: Levene é o teste de decisão. */
export function homogeneitySuite(
  groups: number[][],
  alpha = 0.05,
): {
  primary: HomogeneityResult;
  levene: HomogeneityResult;
  brownForsythe: HomogeneityResult;
  bartlett: HomogeneityResult;
  conclusion: string;
} {
  const levene = leveneTest(groups, alpha);
  const bf = brownForsytheTest(groups, alpha);
  const bartlett = bartlettTest(groups, alpha);
  const conclusion = !Number.isFinite(levene.pValue)
    ? 'Não foi possível avaliar a homogeneidade.'
    : levene.homogeneous
      ? 'Levene não indica heterogeneidade; o pressuposto de variâncias iguais é razoável.'
      : 'Levene indica heterogeneidade; considere transformação, modelo ponderado ou teste robusto (Welch).';
  return { primary: levene, levene, brownForsythe: bf, bartlett, conclusion };
}
