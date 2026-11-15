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
import { chi2Cdf, normalCdf, normalInv, normalPdf } from './distributions';
import type { AnalysisChart } from './analysis-types';

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

export interface NonParametricToleranceInterval {
  /** Limite inferior do intervalo de tolerância não paramétrico (mínimo amostral). */
  lower: number;
  /** Limite superior do intervalo de tolerância não paramétrico (máximo amostral). */
  upper: number;
  /** Cobertura populacional alvo q (ex.: 0,95). */
  targetCoverage: number;
  /** Confiança atingida γ = 1 − n·q^(n−1) + (n−1)·q^n (Wilks, 1941; ISO 16269-6). */
  achievedConfidence: number;
  /** n mínimo necessário pelos extremos para atingir 95% de confiança e cobertura q. */
  recommendedMinN: number;
  method: string;
  reference: string;
}

export interface LogTransformDiagnostic {
  /** Indica se todos os dados são estritamente positivos e elegíveis para ln(x). */
  eligible: boolean;
  /** Indica se a transformação foi explicitamente aplicada por decisão do usuário. */
  applied: boolean;
  /** Teste Shapiro-Wilk sobre ln(x), quando elegível. */
  shapiroOnLog: NormalityResult | null;
  /** Valores transformados (apenas quando `applied === true`). */
  transformedValues: number[] | null;
  /** Média geométrica exp(mean(ln(x))). */
  geometricMean: number | null;
  /** Desvio-padrão geométrico exp(sd(ln(x))). */
  geometricSd: number | null;
  note: string;
}

export interface NonNormalityOptionsResult {
  n: number;
  shapiro: NormalityResult;
  anderson: NormalityResult;
  /** Verdadeiro somente quando Shapiro-Wilk e Anderson-Darling têm p válido e ambos rejeitam. */
  bothRejected: boolean;
  /** Verdadeiro se ao menos um dos dois testes rejeita a normalidade. */
  anyRejected: boolean;
  logTransform: LogTransformDiagnostic;
  nonParametricTolerance: NonParametricToleranceInterval | null;
  warnings: string[];
  reference: string;
}

/** Calcula o n mínimo de Wilks tal que 1 − n·q^(n−1) + (n−1)·q^n >= targetConfidence. */
function wilksMinimumN(coverage: number, confidence: number): number {
  for (let n = 2; n <= 2000; n++) {
    const gamma = 1 - n * Math.pow(coverage, n - 1) + (n - 1) * Math.pow(coverage, n);
    if (gamma >= confidence) return n;
  }
  return 2000;
}

/**
 * Avalia a não normalidade conjunta (Shapiro-Wilk + Anderson-Darling) e
 * prepara as alternativas explícitas sem aplicar transformação automaticamente:
 *  1) Diagnóstico de transformação logarítmica natural ln(x) (aplicada somente se `applyLogTransform === true`).
 *  2) Intervalo de tolerância bilateral livre de distribuição pelos extremos amostrais (Wilks, 1941; ISO 16269-6:2014).
 *
 * Referências:
 *  - Shapiro & Wilk (1965); Stephens (1986) — testes de normalidade.
 *  - Wilks, S. S. (1941). Determination of sample sizes for setting tolerance limits. Ann. Math. Statist., 12(1), 91–96.
 *  - ISO 16269-6:2014 — Statistical interpretation of data — Part 6: Determination of statistical tolerance intervals.
 */
export function evaluateNonNormalityAndOptions(
  values: number[],
  options: {
    alpha?: number;
    applyLogTransform?: boolean;
    targetCoverage?: number;
  } = {},
): NonNormalityOptionsResult {
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  const alpha = options.alpha ?? 0.05;
  const targetCoverage = options.targetCoverage ?? 0.95;
  const applyLogTransform = Boolean(options.applyLogTransform);

  const shapiro = shapiroWilk(clean, alpha);
  const anderson = andersonDarling(clean, alpha);
  const shapiroRejected = Number.isFinite(shapiro.pValue) && !shapiro.normal;
  const andersonRejected = Number.isFinite(anderson.pValue) && !anderson.normal;
  const bothRejected = shapiroRejected && andersonRejected;
  const anyRejected = shapiroRejected || andersonRejected;

  const eligibleLog = n >= 3 && clean.every((v) => v > 0);
  let shapiroOnLog: NormalityResult | null = null;
  let geometricMean: number | null = null;
  let geometricSd: number | null = null;
  let transformedValues: number[] | null = null;

  if (eligibleLog) {
    const lnVals = clean.map((v) => Math.log(v));
    shapiroOnLog = shapiroWilk(lnVals, alpha);
    const mLn = mean(lnVals);
    const sLn = sd(lnVals);
    geometricMean = Math.exp(mLn);
    geometricSd = Number.isFinite(sLn) ? Math.exp(sLn) : null;
    if (applyLogTransform) {
      transformedValues = lnVals;
    }
  }

  let nonParametricTolerance: NonParametricToleranceInterval | null = null;
  if (n >= 2) {
    const sortedVals = sorted(clean);
    const q = Math.min(0.999, Math.max(0.5, targetCoverage));
    const achievedConfidence = Math.max(
      0,
      Math.min(1, 1 - n * Math.pow(q, n - 1) + (n - 1) * Math.pow(q, n)),
    );
    nonParametricTolerance = {
      lower: sortedVals[0],
      upper: sortedVals[sortedVals.length - 1],
      targetCoverage: q,
      achievedConfidence,
      recommendedMinN: wilksMinimumN(q, 1 - alpha),
      method: 'Extremos amostrais livre de distribuição (Wilks / ISO 16269-6)',
      reference: 'Wilks (1941), Ann. Math. Statist. 12:91–96; ISO 16269-6:2014',
    };
  }

  const warnings: string[] = [];
  if (bothRejected) {
    warnings.push(
      `Normalidade rejeitada simultaneamente por Shapiro-Wilk (p = ${shapiro.pValue.toFixed(4)}) e Anderson-Darling (p = ${anderson.pValue.toFixed(4)}). Nenhuma transformação foi aplicada automaticamente: avalie a transformação logarítmica registrada ou o intervalo de tolerância não paramétrico.`,
    );
  } else if (shapiroRejected) {
    warnings.push(
      `Shapiro-Wilk rejeitou a normalidade (p = ${shapiro.pValue.toFixed(4)}); confirme graficamente antes de aplicar transformação.`,
    );
  }
  if (nonParametricTolerance && n < nonParametricTolerance.recommendedMinN && bothRejected) {
    warnings.push(
      `Intervalo de tolerância não paramétrico com n = ${n} atinge apenas ${(nonParametricTolerance.achievedConfidence * 100).toFixed(1)}% de confiança para cobertura ${(targetCoverage * 100).toFixed(0)}% (recomendado n ≥ ${nonParametricTolerance.recommendedMinN} para 95% de confiança).`,
    );
  }

  const logNote = !eligibleLog
    ? 'Transformação logarítmica indisponível: existem valores menores ou iguais a zero ou n < 3.'
    : applyLogTransform
      ? `Transformação ln(x) aplicada e registrada por decisão explícita (Shapiro-Wilk em ln(x): p = ${shapiroOnLog?.pValue.toFixed(4) ?? '—'}).`
      : `Transformação ln(x) NÃO aplicada automaticamente (diagnóstico opcional em ln(x): Shapiro-Wilk p = ${shapiroOnLog?.pValue.toFixed(4) ?? '—'}).`;

  return {
    n,
    shapiro,
    anderson,
    bothRejected,
    anyRejected,
    logTransform: {
      eligible: eligibleLog,
      applied: eligibleLog && applyLogTransform,
      shapiroOnLog,
      transformedValues,
      geometricMean,
      geometricSd,
      note: logNote,
    },
    nonParametricTolerance,
    warnings,
    reference: 'Shapiro & Wilk (1965); Stephens (1986); Wilks (1941); ISO 16269-6:2014',
  };
}

export interface HistogramBin {
  binIndex: number;
  binStart: number;
  binEnd: number;
  binMid: number;
  label: string;
  count: number;
  frequency: number;
  density: number;
  expectedCount: number;
  normalPdf: number;
}

export interface HistogramResult {
  bins: HistogramBin[];
  binWidth: number;
  mean: number;
  sd: number;
  n: number;
  min: number;
  max: number;
}

/**
 * Calcula classes de histograma e curva teórica normal sobreposta
 * escalonada para a mesma unidade de contagem esperada:
 *   expectedCount = n · h · normalPdf(binMid, x̄, s)
 *
 * Binning: Freedman–Diaconis (h = 2·IQR·n^(-1/3)), com fallback para Sturges.
 * Referências: Freedman & Diaconis (1981); Scott (1979); Sturges (1926).
 */
export function computeHistogramWithNormalCurve(
  values: number[],
  numBinsTarget?: number,
): HistogramResult {
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n === 0) {
    return {
      bins: [],
      binWidth: 0,
      mean: 0,
      sd: 0,
      n: 0,
      min: 0,
      max: 0,
    };
  }
  const sortedVals = sorted(clean);
  const minVal = sortedVals[0];
  const maxVal = sortedVals[sortedVals.length - 1];
  const m = mean(clean);
  const s = n > 1 ? sd(clean) : 0;

  if (minVal === maxVal || s === 0) {
    const singleBin: HistogramBin = {
      binIndex: 0,
      binStart: minVal - 0.5,
      binEnd: maxVal + 0.5,
      binMid: minVal,
      label: minVal.toFixed(3),
      count: n,
      frequency: 1,
      density: 1,
      expectedCount: n,
      normalPdf: 1,
    };
    return {
      bins: [singleBin],
      binWidth: 1,
      mean: m,
      sd: s,
      n,
      min: minVal,
      max: maxVal,
    };
  }

  // IQR via quantis empíricos
  const q1 = sortedVals[Math.floor(0.25 * (n - 1))];
  const q3 = sortedVals[Math.floor(0.75 * (n - 1))];
  const iqr = q3 - q1;

  let k: number;
  if (numBinsTarget && numBinsTarget >= 3) {
    k = numBinsTarget;
  } else if (iqr > 0 && n >= 6) {
    const fdH = 2 * iqr * Math.pow(n, -1 / 3);
    k = Math.max(3, Math.min(25, Math.round((maxVal - minVal) / fdH)));
  } else {
    // Sturges
    k = Math.max(3, Math.min(20, Math.ceil(1 + 3.322 * Math.log10(n))));
  }

  const range = maxVal - minVal;
  const binWidth = range / k;
  const bins: HistogramBin[] = [];

  for (let i = 0; i < k; i++) {
    const binStart = minVal + i * binWidth;
    const binEnd = minVal + (i + 1) * binWidth;
    const binMid = (binStart + binEnd) / 2;
    const count = clean.filter((val) =>
      i === k - 1 ? val >= binStart && val <= binEnd : val >= binStart && val < binEnd,
    ).length;
    const frequency = count / n;
    const density = binWidth > 0 ? frequency / binWidth : 0;
    const pdf = s > 0 ? normalPdf(binMid, m, s) : 0;
    const expectedCount = s > 0 ? n * binWidth * pdf : 0;
    bins.push({
      binIndex: i,
      binStart,
      binEnd,
      binMid,
      label: `${binMid.toFixed(2)}`,
      count,
      frequency,
      density,
      expectedCount,
      normalPdf: pdf,
    });
  }

  return {
    bins,
    binWidth,
    mean: m,
    sd: s,
    n,
    min: minVal,
    max: maxVal,
  };
}

export interface NormalProbabilityPoint {
  index: number;
  observed: number;
  percentile: number;
  zTheoretical: number;
  expected: number;
  lowerBand: number;
  upperBand: number;
  se: number;
}

export interface NormalProbabilityPlotResult {
  points: NormalProbabilityPoint[];
  mean: number;
  sd: number;
  n: number;
  slope: number;
  intercept: number;
}

/**
 * Gráfico de Probabilidade Normal (Normal Probability Plot / Q-Q Plot).
 * Plota observações ordenadas contra os quantis teóricos normais:
 *   p_i = (i − 0,375) / (n + 0,25)  (Blom, 1958)
 *   z_i = Φ⁻¹(p_i)
 *   esperado_i = x̄ + s · z_i
 * Bandas de confiança pontuais a 95% calculadas por:
 *   SE(x_(i)) ≈ (s / φ(z_i)) · √[ p_i·(1 − p_i) / n ]
 *
 * Referências: Blom (1958); Chambers et al. (1983); NIST/SEMATECH e-Handbook (1.3.3.21).
 */
export function computeNormalProbabilityPlot(
  values: number[],
  alpha = 0.05,
): NormalProbabilityPlotResult {
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n === 0) {
    return {
      points: [],
      mean: 0,
      sd: 0,
      n: 0,
      slope: 0,
      intercept: 0,
    };
  }
  const sortedVals = sorted(clean);
  const m = mean(clean);
  const s = n > 1 ? sd(clean) : 0;
  const zCrit = normalInv(1 - alpha / 2);

  const points: NormalProbabilityPoint[] = sortedVals.map((observed, idx) => {
    const i = idx + 1;
    const p_i = (i - 0.375) / (n + 0.25);
    const z = normalInv(p_i);
    const expected = m + s * z;
    const phi = normalPdf(z, 0, 1);
    const se = phi > 1e-12 && s > 0 ? (s / phi) * Math.sqrt((p_i * (1 - p_i)) / n) : 0;
    const lowerBand = expected - zCrit * se;
    const upperBand = expected + zCrit * se;
    return {
      index: i,
      observed,
      percentile: p_i * 100,
      zTheoretical: z,
      expected,
      lowerBand,
      upperBand,
      se,
    };
  });

  return {
    points,
    mean: m,
    sd: s,
    n,
    slope: s,
    intercept: m,
  };
}

/** Gera a estrutura AnalysisChart para Histograma com Curva Normal Sobreposta. */
export function buildHistogramChart(
  values: number[],
  title = 'Histograma com Curva Normal Sobreposta',
  xLabel = 'Valor medido',
): AnalysisChart {
  const res = computeHistogramWithNormalCurve(values);
  return {
    kind: 'histogram',
    title,
    xLabel,
    yLabel: 'Frequência (Contagem)',
    data: res.bins.map((b) => ({
      classe: b.label,
      binMid: b.binMid,
      contagem: b.count,
      esperado: Number(b.expectedCount.toFixed(2)),
      densidade: Number(b.density.toFixed(4)),
    })),
    meta: {
      mean: res.mean,
      sd: res.sd,
      binWidth: res.binWidth,
      n: res.n,
    },
  };
}

/** Gera a estrutura AnalysisChart para Gráfico de Probabilidade Normal (Q-Q). */
export function buildNormalProbabilityChart(
  values: number[],
  title = 'Gráfico de Probabilidade Normal (Q–Q Plot)',
  outlierIndices?: Set<number>,
): AnalysisChart {
  const res = computeNormalProbabilityPlot(values);
  return {
    kind: 'qq',
    title,
    xLabel: 'Quantil Teórico Normal (z)',
    yLabel: 'Valor Observado',
    data: res.points.map((p) => ({
      z: Number(p.zTheoretical.toFixed(3)),
      observado: Number(p.observed.toFixed(4)),
      esperado: Number(p.expected.toFixed(4)),
      lic: Number(p.lowerBand.toFixed(4)),
      lsc: Number(p.upperBand.toFixed(4)),
      outlier: outlierIndices ? outlierIndices.has(p.index - 1) : false,
      percentil: Number(p.percentile.toFixed(1)),
    })),
    meta: {
      mean: res.mean,
      sd: res.sd,
      n: res.n,
      slope: res.slope,
      intercept: res.intercept,
    },
  };
}
