/**
 * Testes de normalidade.
 *
 * Shapiro-Wilk implementado conforme Royston (1995), algoritmo AS R94, com
 * coeficientes para n = 3..5 e aproximação polinomial para n ≥ 6.
 * Referências:
 *  - Shapiro & Wilk (1965), Biometrika 52:591–611.
 *  - Royston (1995), Appl. Statist. 44:547–551.
 *  - Anderson & Darling (1954); Stephens (1986).
 *  - Jarque & Bera (1980).
 */

import { mean, sd } from './descriptive';
import { chi2Cdf, normalCdf, normalInv } from './distributions';

export interface NormalityResult {
  n: number;
  statistic: number;
  pValue: number;
  alpha: number;
  normal: boolean;
  method: string;
  reference: string;
  interpretation: string;
  warnings: string[];
}

function sorted(values: number[]): number[] {
  return values.slice().sort((a, b) => a - b);
}

/** Coeficientes de Shapiro-Wilk (Royston/AS R94). */
export function shapiroWilkCoefficients(n: number): number[] {
  if (n < 3) return [];
  if (n === 3) return [-Math.SQRT1_2, 0, Math.SQRT1_2];
  if (n === 4) return [-0.6872, -0.1677, 0.1677, 0.6872];
  if (n === 5) return [-0.6646, -0.2413, 0, 0.2413, 0.6646];
  const m = Array.from({ length: n }, (_, i) =>
    normalInv((i + 1 - 0.375) / (n + 0.25)),
  );
  const summ2 = m.reduce((a, b) => a + b * b, 0);
  const c = m.map((v) => v / Math.sqrt(summ2));
  const u = 1 / Math.sqrt(n);
  const aN =
    c[n - 1] +
    0.221157 * u -
    0.147981 * u ** 2 -
    2.07119 * u ** 3 +
    4.434685 * u ** 4 -
    2.706056 * u ** 5;
  const aNm1 =
    c[n - 2] +
    0.042981 * u -
    0.293762 * u ** 2 -
    1.752461 * u ** 3 +
    5.682633 * u ** 4 -
    3.582633 * u ** 5;
  const phi =
    (summ2 - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) /
    (1 - 2 * aN ** 2 - 2 * aNm1 ** 2);
  const a = new Array<number>(n);
  a[0] = -aN;
  a[1] = -aNm1;
  a[n - 1] = aN;
  a[n - 2] = aNm1;
  for (let i = 2; i < n - 2; i++) a[i] = m[i] / Math.sqrt(phi);
  return a;
}

/** p-valor de Shapiro-Wilk pela aproximação de Royston. */
function shapiroPValue(w: number, n: number): number {
  if (!(w > 0) || !(w <= 1)) return NaN;
  if (n === 3) {
    // Aproximação log-normal calibrada para o caso n = 3.
    const y = Math.log(1 - w);
    const mu = -0.69;
    const sigma = 0.74;
    return Math.min(1, Math.max(0, 1 - normalCdf((y - mu) / sigma)));
  }
  if (n <= 11) {
    const gamma = -2.273 + 0.459 * n;
    const mu = 0.544 - 0.39978 * n + 0.025054 * n ** 2 - 0.0006714 * n ** 3;
    const sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n ** 2 - 0.0020322 * n ** 3);
    const arg = gamma - Math.log(1 - w);
    if (!(arg > 0)) return 1;
    const y = -Math.log(arg);
    return Math.min(1, Math.max(0, 1 - normalCdf((y - mu) / sigma)));
  }
  const l = Math.log(n);
  const mu = -1.5861 - 0.31082 * l - 0.083751 * l ** 2 + 0.0038915 * l ** 3;
  const sigma = Math.exp(-0.4803 - 0.082676 * l + 0.0030302 * l ** 2);
  const y = Math.log(1 - w);
  return Math.min(1, Math.max(0, 1 - normalCdf((y - mu) / sigma)));
}

export function shapiroWilk(values: number[], alpha = 0.05): NormalityResult {
  const n = values.length;
  const x = sorted(values);
  if (n < 3) {
    return {
      n,
      statistic: NaN,
      pValue: NaN,
      alpha,
      normal: false,
      method: 'Shapiro-Wilk',
      reference: 'Shapiro & Wilk (1965); Royston (1995)',
      interpretation: 'São necessárias pelo menos 3 observações.',
      warnings: ['n insuficiente para o teste de normalidade.'],
    };
  }
  const m = mean(x);
  const ss = x.reduce((acc, v) => acc + (v - m) ** 2, 0);
  const warnings: string[] = [];
  if (!(ss > 0)) {
    return {
      n,
      statistic: 1,
      pValue: 1,
      alpha,
      normal: true,
      method: 'Shapiro-Wilk',
      reference: 'Shapiro & Wilk (1965); Royston (1995)',
      interpretation: 'Todos os valores são idênticos; não há evidência de não normalidade.',
      warnings: ['Variância nula: o teste não é informativo.'],
    };
  }
  const a = shapiroWilkCoefficients(n);
  let num = 0;
  for (let i = 0; i < n; i++) num += a[i] * x[i];
  const w = Math.min(1, (num * num) / ss);
  const p = shapiroPValue(w, n);
  if (n < 8) warnings.push('Amostra pequena: baixo poder para detectar desvios de normalidade.');
  if (n > 5000) warnings.push('Amostra muito grande: desvios triviais podem ser significativos.');
  return {
    n,
    statistic: w,
    pValue: p,
    alpha,
    normal: Number.isFinite(p) ? p >= alpha : false,
    method: 'Shapiro-Wilk',
    reference: 'Shapiro & Wilk (1965), Biometrika 52; Royston (1995), AS R94',
    interpretation:
      p >= alpha
        ? `Não se rejeita a normalidade (p = ${p.toFixed(4)} ≥ ${alpha}).`
        : `Rejeita-se a normalidade (p = ${p.toFixed(4)} < ${alpha}); considere transformação ou método não paramétrico.`,
    warnings,
  };
}

/** Anderson-Darling com média e desvio estimados (Stephens, 1986). */
export function andersonDarling(values: number[], alpha = 0.05): NormalityResult {
  const n = values.length;
  if (n < 8) {
    return {
      n,
      statistic: NaN,
      pValue: NaN,
      alpha,
      normal: false,
      method: 'Anderson-Darling',
      reference: 'Anderson & Darling (1954); Stephens (1986)',
      interpretation: 'Recomenda-se n ≥ 8 para o teste de Anderson-Darling.',
      warnings: ['n insuficiente.'],
    };
  }
  const x = sorted(values);
  const m = mean(x);
  const s = sd(x);
  if (!(s > 0)) {
    return {
      n,
      statistic: 0,
      pValue: 1,
      alpha,
      normal: true,
      method: 'Anderson-Darling',
      reference: 'Anderson & Darling (1954); Stephens (1986)',
      interpretation: 'Variância nula.',
      warnings: ['Variância nula: teste não informativo.'],
    };
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const fi = Math.min(1 - 1e-12, Math.max(1e-12, normalCdf((x[i] - m) / s)));
    const fj = Math.min(1 - 1e-12, Math.max(1e-12, normalCdf((x[n - 1 - i] - m) / s)));
    sum += (2 * (i + 1) - 1) * (Math.log(fi) + Math.log(1 - fj));
  }
  const a2 = -n - sum / n;
  const aStar = a2 * (1 + 0.75 / n + 2.25 / (n * n));
  let p: number;
  if (aStar >= 0.6) p = Math.exp(1.2937 - 5.709 * aStar + 0.0186 * aStar * aStar);
  else if (aStar > 0.34) p = Math.exp(0.9177 - 4.279 * aStar - 1.38 * aStar * aStar);
  else if (aStar > 0.2) p = 1 - Math.exp(-8.318 + 42.796 * aStar - 59.938 * aStar * aStar);
  else p = 1 - Math.exp(-13.436 + 101.14 * aStar - 223.73 * aStar * aStar);
  p = Math.min(1, Math.max(0, p));
  return {
    n,
    statistic: aStar,
    pValue: p,
    alpha,
    normal: p >= alpha,
    method: 'Anderson-Darling (média e σ estimados)',
    reference: 'Anderson & Darling (1954); Stephens (1986), Goodness-of-Fit Techniques',
    interpretation:
      p >= alpha
        ? `Não se rejeita a normalidade (A* = ${aStar.toFixed(4)}, p = ${p.toFixed(4)}).`
        : `Rejeita-se a normalidade (A* = ${aStar.toFixed(4)}, p = ${p.toFixed(4)}).`,
    warnings: [],
  };
}

/** Jarque-Bera (assintótico; adequado para n grande). */
export function jarqueBera(values: number[], alpha = 0.05): NormalityResult {
  const n = values.length;
  if (n < 8) {
    return {
      n,
      statistic: NaN,
      pValue: NaN,
      alpha,
      normal: false,
      method: 'Jarque-Bera',
      reference: 'Jarque & Bera (1980)',
      interpretation: 'Recomenda-se n ≥ 8.',
      warnings: ['n insuficiente.'],
    };
  }
  const m = mean(values);
  const s = sd(values);
  if (!(s > 0)) {
    return {
      n,
      statistic: 0,
      pValue: 1,
      alpha,
      normal: true,
      method: 'Jarque-Bera',
      reference: 'Jarque & Bera (1980)',
      interpretation: 'Variância nula.',
      warnings: ['Variância nula: teste não informativo.'],
    };
  }
  let s3 = 0;
  let s4 = 0;
  for (const v of values) {
    const z = (v - m) / s;
    s3 += z ** 3;
    s4 += z ** 4;
  }
  const skew = s3 / n;
  const kurt = s4 / n - 3;
  const jb = (n / 6) * (skew * skew + (kurt * kurt) / 4);
  const p = Math.min(1, Math.max(0, 1 - chi2Cdf(jb, 2)));
  return {
    n,
    statistic: jb,
    pValue: p,
    alpha,
    normal: p >= alpha,
    method: 'Jarque-Bera',
    reference: 'Jarque & Bera (1980); Thadewald & Büning (2007)',
    interpretation:
      p >= alpha
        ? `Não se rejeita a normalidade (JB = ${jb.toFixed(3)}, p = ${p.toFixed(4)}).`
        : `Rejeita-se a normalidade (JB = ${jb.toFixed(3)}, p = ${p.toFixed(4)}).`,
    warnings: ['Teste assintótico: pouco confiável em amostras pequenas.'],
  };
}

/** Bateria completa de normalidade para exibição no relatório. */
export function normalitySuite(
  values: number[],
  alpha = 0.05,
): {
  primary: NormalityResult;
  shapiro: NormalityResult;
  anderson: NormalityResult;
  jarqueBera: NormalityResult;
  conclusion: string;
} {
  const shapiro = shapiroWilk(values, alpha);
  const anderson = andersonDarling(values, alpha);
  const jarque = jarqueBera(values, alpha);
  const valid = [shapiro, anderson, jarque].filter((r) => Number.isFinite(r.pValue));
  const rejected = valid.filter((r) => !r.normal).length;
  const conclusion =
    valid.length === 0
      ? 'Não foi possível avaliar a normalidade.'
      : rejected === 0
        ? 'Todos os testes disponíveis são compatíveis com a normalidade.'
        : rejected === valid.length
          ? 'Todos os testes disponíveis rejeitam a normalidade.'
          : 'Há divergência entre os testes; avalie gráficos e o conhecimento do processo antes de decidir.';
  return {
    primary: shapiro,
    shapiro,
    anderson,
    jarqueBera: jarque,
    conclusion,
  };
}
