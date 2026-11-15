/**
 * Regressão linear, linearidade e limites de detecção/quantificação.
 *
 * Referências:
 *  - ISO 8466-1:2021 (calibração linear).
 *  - ICH Q2(R2) (linearidade e faixa).
 *  - ISO 11843-2 (limites de detecção).
 *  - Draper & Smith (1998), Applied Regression Analysis.
 *  - Montgomery, Peck & Vining (2021), Introduction to Linear Regression.
 */

import { mean } from './descriptive';
import { fCdf, tCdf, tInv } from './distributions';

export interface RegressionPoint {
  x: number;
  y: number;
}

export interface RegressionResult {
  n: number;
  slope: number;
  intercept: number;
  slopeSe: number;
  interceptSe: number;
  slopeT: number;
  slopeP: number;
  interceptT: number;
  interceptP: number;
  r2: number;
  adjR2: number;
  syx: number;
  df: number;
  ssReg: number;
  ssRes: number;
  ssTot: number;
  f: number;
  p: number;
  slopeCi: [number, number];
  interceptCi: [number, number];
  confidence: number;
  alpha: number;
  residuals: Array<{
    x: number;
    y: number;
    fitted: number;
    residual: number;
    stdResidual: number;
    leverage: number;
  }>;
  lackOfFit: {
    f: number;
    p: number;
    dfLof: number;
    dfPure: number;
    ssLof: number;
    ssPure: number;
    significant: boolean;
  } | null;
  method: string;
  reference: string;
  warnings: string[];
}

function emptyResult(confidence: number, alpha: number, warning: string): RegressionResult {
  return {
    n: 0,
    slope: NaN,
    intercept: NaN,
    slopeSe: NaN,
    interceptSe: NaN,
    slopeT: NaN,
    slopeP: NaN,
    interceptT: NaN,
    interceptP: NaN,
    r2: NaN,
    adjR2: NaN,
    syx: NaN,
    df: 0,
    ssReg: NaN,
    ssRes: NaN,
    ssTot: NaN,
    f: NaN,
    p: NaN,
    slopeCi: [NaN, NaN],
    interceptCi: [NaN, NaN],
    confidence,
    alpha,
    residuals: [],
    lackOfFit: null,
    method: 'Regressão linear ordinária',
    reference: 'ISO 8466-1; Draper & Smith (1998)',
    warnings: [warning],
  };
}

/** Regressão linear por mínimos quadrados ordinários (OLS). */
export function linearRegression(
  points: RegressionPoint[],
  confidence = 0.95,
  alpha = 0.05,
): RegressionResult {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = valid.length;
  if (n < 3) return emptyResult(confidence, alpha, 'São necessários pelo menos 3 pontos de calibração.');
  const xm = mean(valid.map((p) => p.x));
  const ym = mean(valid.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of valid) {
    sxx += (p.x - xm) ** 2;
    sxy += (p.x - xm) * (p.y - ym);
    syy += (p.y - ym) ** 2;
  }
  if (!(sxx > 0)) return emptyResult(confidence, alpha, 'Todos os valores de x são iguais.');
  const slope = sxy / sxx;
  const intercept = ym - slope * xm;
  const residuals = valid.map((p) => {
    const fitted = intercept + slope * p.x;
    return {
      x: p.x,
      y: p.y,
      fitted,
      residual: p.y - fitted,
      stdResidual: 0,
      leverage: 0,
    };
  });
  const ssRes = residuals.reduce((acc, r) => acc + r.residual ** 2, 0);
  const ssReg = slope * sxy;
  const ssTot = syy;
  const df = n - 2;
  const syx = Math.sqrt(ssRes / df);
  const slopeSe = syx / Math.sqrt(sxx);
  const interceptSe = syx * Math.sqrt(1 / n + (xm * xm) / sxx);
  const slopeT = slope / slopeSe;
  const interceptT = intercept / interceptSe;
  const slopeP = 2 * (1 - tCdf(Math.abs(slopeT), df));
  const interceptP = 2 * (1 - tCdf(Math.abs(interceptT), df));
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;
  const adjR2 = Number.isFinite(r2) ? 1 - (1 - r2) * ((n - 1) / df) : NaN;
  const f = ssRes > 0 ? (ssReg / 1) / (ssRes / df) : Infinity;
  const p = Number.isFinite(f) ? 1 - fCdf(f, 1, df) : NaN;
  const tCrit = tInv(1 - (1 - confidence) / 2, df);
  const warnings: string[] = [];
  if (n < 5) warnings.push('Menos de 5 níveis de calibração: a linearidade é fracamente avaliada.');
  if (!Number.isFinite(r2) || r2 < 0.99) warnings.push('R² abaixo de 0,99: verifique a linearidade e a faixa.');
  const levs = valid.map((p) => 1 / n + ((p.x - xm) ** 2) / sxx);
  residuals.forEach((r, i) => {
    r.leverage = levs[i];
    r.stdResidual =
      syx > 0 ? r.residual / (syx * Math.sqrt(Math.max(1e-12, 1 - levs[i]))) : 0;
  });
  // Falta de ajuste (réplicas em x)
  const byX = new Map<number, number[]>();
  for (const p of valid) {
    const list = byX.get(p.x) ?? [];
    list.push(p.y);
    byX.set(p.x, list);
  }
  let ssPure = 0;
  let dfPure = 0;
  for (const [, ys] of byX) {
    if (ys.length < 2) continue;
    const m = mean(ys);
    for (const y of ys) ssPure += (y - m) ** 2;
    dfPure += ys.length - 1;
  }
  let lackOfFit: RegressionResult['lackOfFit'] = null;
  if (dfPure > 0) {
    const ssLof = Math.max(0, ssRes - ssPure);
    const dfLof = df - dfPure;
    if (dfLof > 0) {
      const fLof = (ssLof / dfLof) / (ssPure / dfPure);
      const pLof = 1 - fCdf(fLof, dfLof, dfPure);
      lackOfFit = {
        f: fLof,
        p: pLof,
        dfLof,
        dfPure,
        ssLof,
        ssPure,
        significant: pLof < alpha,
      };
      if (pLof < alpha) warnings.push('Teste de falta de ajuste significativo: considere modelo não linear ou faixa menor.');
    }
  }
  return {
    n,
    slope,
    intercept,
    slopeSe,
    interceptSe,
    slopeT,
    slopeP,
    interceptT,
    interceptP,
    r2,
    adjR2,
    syx,
    df,
    ssReg,
    ssRes,
    ssTot,
    f,
    p,
    slopeCi: [slope - tCrit * slopeSe, slope + tCrit * slopeSe],
    interceptCi: [intercept - tCrit * interceptSe, intercept + tCrit * interceptSe],
    confidence,
    alpha,
    residuals,
    lackOfFit,
    method: 'Regressão linear por mínimos quadrados ordinários',
    reference: 'ISO 8466-1:2021; Draper & Smith (1998), cap. 1; ICH Q2(R2)',
    warnings,
  };
}

/** Regressão ponderada (WLS), útil quando a variância cresce com x. */
export function weightedRegression(
  points: RegressionPoint[],
  weights: number[],
  confidence = 0.95,
): RegressionResult {
  const valid = points
    .map((p, i) => ({ ...p, w: weights[i] }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.w > 0);
  const n = valid.length;
  if (n < 3) return emptyResult(confidence, 0.05, 'São necessários pelo menos 3 pontos com pesos positivos.');
  const sw = valid.reduce((a, p) => a + p.w, 0);
  const xm = valid.reduce((a, p) => a + p.w * p.x, 0) / sw;
  const ym = valid.reduce((a, p) => a + p.w * p.y, 0) / sw;
  let sxx = 0;
  let sxy = 0;
  for (const p of valid) {
    sxx += p.w * (p.x - xm) ** 2;
    sxy += p.w * (p.x - xm) * (p.y - ym);
  }
  if (!(sxx > 0)) return emptyResult(confidence, 0.05, 'Todos os valores de x são iguais.');
  const slope = sxy / sxx;
  const intercept = ym - slope * xm;
  const residuals = valid.map((p) => {
    const fitted = intercept + slope * p.x;
    return {
      x: p.x,
      y: p.y,
      fitted,
      residual: p.y - fitted,
      stdResidual: 0,
      leverage: 0,
    };
  });
  const ssResW = valid.reduce((a, p, i) => a + p.w * residuals[i].residual ** 2, 0);
  const df = n - 2;
  const s2 = ssResW / df;
  const slopeSe = Math.sqrt(s2 / sxx);
  const interceptSe = Math.sqrt(s2 * (1 / sw + (xm * xm) / sxx));
  const slopeT = slope / slopeSe;
  const interceptT = intercept / interceptSe;
  const slopeP = 2 * (1 - tCdf(Math.abs(slopeT), df));
  const interceptP = 2 * (1 - tCdf(Math.abs(interceptT), df));
  const tCrit = tInv(1 - (1 - confidence) / 2, df);
  // R² ponderado
  let ssTotW = 0;
  for (const p of valid) ssTotW += p.w * (p.y - ym) ** 2;
  const r2 = ssTotW > 0 ? 1 - ssResW / ssTotW : NaN;
  return {
    n,
    slope,
    intercept,
    slopeSe,
    interceptSe,
    slopeT,
    interceptT,
    slopeP,
    interceptP,
    r2,
    adjR2: Number.isFinite(r2) ? 1 - (1 - r2) * ((n - 1) / df) : NaN,
    syx: Math.sqrt(s2),
    df,
    ssReg: Math.max(0, ssTotW - ssResW),
    ssRes: ssResW,
    ssTot: ssTotW,
    f: ssResW > 0 ? (Math.max(0, ssTotW - ssResW) / 1) / (ssResW / df) : Infinity,
    p: NaN,
    slopeCi: [slope - tCrit * slopeSe, slope + tCrit * slopeSe],
    interceptCi: [intercept - tCrit * interceptSe, intercept + tCrit * interceptSe],
    confidence,
    alpha: 0.05,
    residuals,
    lackOfFit: null,
    method: 'Regressão linear ponderada (WLS)',
    reference: 'Draper & Smith (1998), cap. 9; ISO 8466-1',
    warnings: ['Pesos devem refletir a precisão relativa de cada ponto.'],
  };
}

export interface LodLoqResult {
  lod: number;
  loq: number;
  slope: number;
  intercept: number;
  syx: number;
  method: string;
  reference: string;
  caveats: string[];
}

/** LD/LQ pela curva de calibração: LD = 3,3·s_yx/b; LQ = 10·s_yx/b. */
export function lodLoqFromRegression(points: RegressionPoint[]): LodLoqResult {
  const reg = linearRegression(points);
  if (!Number.isFinite(reg.slope) || reg.slope === 0 || !(reg.syx > 0)) {
    return {
      lod: NaN,
      loq: NaN,
      slope: reg.slope,
      intercept: reg.intercept,
      syx: reg.syx,
      method: 'Curva de calibração',
      reference: 'ISO 11843-2; ICH Q2(R2)',
      caveats: ['Curva insuficiente ou declive nulo.'],
    };
  }
  const lod = (3.3 * reg.syx) / Math.abs(reg.slope);
  const loq = (10 * reg.syx) / Math.abs(reg.slope);
  return {
    lod,
    loq,
    slope: reg.slope,
    intercept: reg.intercept,
    syx: reg.syx,
    method: 'LD = 3,3·s_yx/b; LQ = 10·s_yx/b',
    reference: 'ISO 11843-2; IUPAC (1997); ICH Q2(R2)',
    caveats: [
      'Fórmula válida para calibração linear com variância aproximadamente constante.',
      'Confirme os limites com fortificações independentes na região próxima ao LD/LQ.',
    ],
  };
}

/** LD/LQ a partir de brancos: média + 3s e média + 10s. */
export function lodLoqFromBlanks(blanks: number[]): LodLoqResult {
  const n = blanks.length;
  if (n < 3) {
    return {
      lod: NaN,
      loq: NaN,
      slope: NaN,
      intercept: NaN,
      syx: NaN,
      method: 'Brancos',
      reference: 'ISO 11843; ICH Q2(R2)',
      caveats: ['São necessárias pelo menos 3 (idealmente 10) medições de branco.'],
    };
  }
  const m = mean(blanks);
  const s = Math.sqrt(
    blanks.reduce((acc, v) => acc + (v - m) ** 2, 0) / (n - 1),
  );
  return {
    lod: m + 3 * s,
    loq: m + 10 * s,
    slope: NaN,
    intercept: NaN,
    syx: s,
    method: 'LD = média_branco + 3·s; LQ = média_branco + 10·s',
    reference: 'ISO 11843-1; IUPAC (1997); ICH Q2(R2)',
    caveats: [
      'Assume branco representativo e ausência de contaminação.',
      'Reporte o número de brancos e o nível de confiança adotado.',
    ],
  };
}

/** Faixa de confiança da reta para gráficos. */
export function regressionBand(
  points: RegressionPoint[],
  xs: number[],
  confidence = 0.95,
  prediction = false,
): Array<{ x: number; fit: number; low: number; high: number }> {
  const reg = linearRegression(points, confidence);
  if (!Number.isFinite(reg.slope)) return [];
  const n = reg.n;
  const xm = mean(points.map((p) => p.x));
  const sxx = points.reduce((acc, p) => acc + (p.x - xm) ** 2, 0);
  const t = tInv(1 - (1 - confidence) / 2, reg.df);
  return xs.map((x) => {
    const fit = reg.intercept + reg.slope * x;
    const se = reg.syx * Math.sqrt(1 / n + (x - xm) ** 2 / sxx);
    const width = t * (prediction ? Math.sqrt(se * se + reg.syx * reg.syx) : se);
    return { x, fit, low: fit - width, high: fit + width };
  });
}

// ── Teste de Linearidade de Mandel (ISO 8466-1) & Ponderações WLS ──────────

export interface MandelLinearityResult {
  n: number;
  ssResLinear: number;
  ssResQuadratic: number;
  sy1: number;
  sy2: number;
  ds2: number;
  f: number;
  df1: number;
  df2: number;
  pValue: number;
  significant: boolean;
  quadraticTerm: number;
  reference: string;
}

export interface WeightingComparisonModel {
  scheme: 'ols' | 'wls_inv_x' | 'wls_inv_x2';
  label: string;
  slope: number;
  intercept: number;
  r2: number;
  sumAbsRePct: number | null;
  meanAbsRePct: number | null;
  maxAbsRePct: number | null;
}

export interface CalibrationWeightingComparisonResult {
  models: WeightingComparisonModel[];
  homoscedasticityF: number | null;
  homoscedasticityP: number | null;
  heteroscedastic: boolean | null;
  recommendedScheme: WeightingComparisonModel['scheme'];
  reference: string;
}

function solveLinear3x3(a: number[][], b: number[]): [number, number, number] | null {
  const m = a.map((row, idx) => [...row, b[idx]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-14) return null;
    if (pivot !== col) {
      [m[col], m[pivot]] = [m[pivot], m[col]];
    }
    const diag = m[col][col];
    for (let k = col; k < 4; k++) m[col][k] /= diag;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let k = col; k < 4; k++) m[row][k] -= factor * m[col][k];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

/**
 * Teste de falta de linearidade por ajuste quadrático de Mandel (ISO 8466-1:2021).
 * Confronta a variância residual do modelo linear (N−2 g.l.) contra o quadrático (N−3 g.l.).
 */
export function mandelLinearityTest(
  points: RegressionPoint[],
  alpha = 0.05,
): MandelLinearityResult | null {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = valid.length;
  const distinctX = new Set(valid.map((p) => p.x));
  if (n < 4 || distinctX.size < 3) return null;

  const linear = linearRegression(valid, 1 - alpha, alpha);
  if (!Number.isFinite(linear.ssRes)) return null;

  const xm = mean(valid.map((p) => p.x));
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;
  for (const p of valid) {
    const u = p.x - xm;
    const u2 = u * u;
    s0 += 1;
    s1 += u;
    s2 += u2;
    s3 += u2 * u;
    s4 += u2 * u2;
    t0 += p.y;
    t1 += u * p.y;
    t2 += u2 * p.y;
  }

  const coef = solveLinear3x3(
    [
      [s0, s1, s2],
      [s1, s2, s3],
      [s2, s3, s4],
    ],
    [t0, t1, t2],
  );
  if (!coef) return null;

  let ssResQuad = 0;
  for (const p of valid) {
    const u = p.x - xm;
    const yHat = coef[0] + coef[1] * u + coef[2] * u * u;
    ssResQuad += (p.y - yHat) ** 2;
  }

  const df1 = 1;
  const df2 = n - 3;
  const sy1 = Math.sqrt(linear.ssRes / (n - 2));
  const sy2 = Math.sqrt(ssResQuad / df2);
  const ds2 = Math.max(0, linear.ssRes - ssResQuad);
  const f = ssResQuad > 0 ? ds2 / (ssResQuad / df2) : ds2 > 0 ? Infinity : 0;
  const pValue = Number.isFinite(f) ? Math.max(0, Math.min(1, 1 - fCdf(f, df1, df2))) : 0;

  return {
    n,
    ssResLinear: linear.ssRes,
    ssResQuadratic: ssResQuad,
    sy1,
    sy2,
    ds2,
    f,
    df1,
    df2,
    pValue,
    significant: pValue < alpha,
    quadraticTerm: coef[2],
    reference: 'ISO 8466-1:2021; Mandel (1991)',
  };
}

function backCalculatedMetrics(
  valid: RegressionPoint[],
  reg: RegressionResult,
): { sumAbsRePct: number | null; meanAbsRePct: number | null; maxAbsRePct: number | null } {
  if (!Number.isFinite(reg.slope) || reg.slope === 0 || !Number.isFinite(reg.intercept)) {
    return { sumAbsRePct: null, meanAbsRePct: null, maxAbsRePct: null };
  }
  const absRes: number[] = [];
  for (const p of valid) {
    if (p.x === 0) continue;
    const xHat = (p.y - reg.intercept) / reg.slope;
    const rePct = (100 * (xHat - p.x)) / p.x;
    if (Number.isFinite(rePct)) absRes.push(Math.abs(rePct));
  }
  if (!absRes.length) {
    return { sumAbsRePct: null, meanAbsRePct: null, maxAbsRePct: null };
  }
  const sum = absRes.reduce((acc, v) => acc + v, 0);
  return {
    sumAbsRePct: sum,
    meanAbsRePct: sum / absRes.length,
    maxAbsRePct: Math.max(...absRes),
  };
}

/**
 * Compara OLS (w = 1) vs WLS (1/x e 1/x²) conforme ANVISA RDC 166/2017 e ISO 8466-1,
 * verificando homocedasticidade entre extremos e somatório do erro relativo retrocalculado.
 */
export function compareCalibrationWeightings(
  points: RegressionPoint[],
  confidence = 0.95,
): CalibrationWeightingComparisonResult | null {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length < 3) return null;

  // Teste F de homocedasticidade entre o menor e maior x com réplicas
  const byX = new Map<number, number[]>();
  for (const p of valid) {
    const list = byX.get(p.x) ?? [];
    list.push(p.y);
    byX.set(p.x, list);
  }
  const sortedX = [...byX.entries()]
    .filter(([, ys]) => ys.length >= 2)
    .sort((a, b) => a[0] - b[0]);

  let homoscedasticityF: number | null = null;
  let homoscedasticityP: number | null = null;
  let heteroscedastic: boolean | null = null;

  if (sortedX.length >= 2) {
    const lowVals = sortedX[0][1];
    const highVals = sortedX[sortedX.length - 1][1];
    const varOf = (arr: number[]) => {
      const m = mean(arr);
      return arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / (arr.length - 1);
    };
    const vLow = varOf(lowVals);
    const vHigh = varOf(highVals);
    const lowIsMax = vLow >= vHigh;
    const vMax = lowIsMax ? vLow : vHigh;
    const vMin = lowIsMax ? vHigh : vLow;
    const dfMax = (lowIsMax ? lowVals.length : highVals.length) - 1;
    const dfMin = (lowIsMax ? highVals.length : lowVals.length) - 1;

    if (vMin > 0) {
      homoscedasticityF = vMax / vMin;
      homoscedasticityP = Math.max(0, Math.min(1, 2 * (1 - fCdf(homoscedasticityF, dfMax, dfMin))));
      heteroscedastic = homoscedasticityP < 0.05;
    }
  }

  const ols = linearRegression(valid, confidence);
  const models: WeightingComparisonModel[] = [
    {
      scheme: 'ols',
      label: 'OLS (w = 1)',
      slope: ols.slope,
      intercept: ols.intercept,
      r2: ols.r2,
      ...backCalculatedMetrics(valid, ols),
    },
  ];

  const positivePoints = valid.filter((p) => p.x > 0);
  if (positivePoints.length === valid.length) {
    const w1 = weightedRegression(
      valid,
      valid.map((p) => 1 / p.x),
      confidence,
    );
    const w2 = weightedRegression(
      valid,
      valid.map((p) => 1 / (p.x * p.x)),
      confidence,
    );
    models.push(
      {
        scheme: 'wls_inv_x',
        label: 'WLS (w = 1/x)',
        slope: w1.slope,
        intercept: w1.intercept,
        r2: w1.r2,
        ...backCalculatedMetrics(valid, w1),
      },
      {
        scheme: 'wls_inv_x2',
        label: 'WLS (w = 1/x²)',
        slope: w2.slope,
        intercept: w2.intercept,
        r2: w2.r2,
        ...backCalculatedMetrics(valid, w2),
      },
    );
  }

  const scored = models.filter((m) => m.sumAbsRePct !== null && Number.isFinite(m.sumAbsRePct));
  const best = scored.sort((a, b) => (a.sumAbsRePct ?? Infinity) - (b.sumAbsRePct ?? Infinity))[0];

  return {
    models,
    homoscedasticityF,
    homoscedasticityP,
    heteroscedastic,
    recommendedScheme: best?.scheme ?? 'ols',
    reference: 'ANVISA RDC 166/2017; ICH Q2(R2); ISO 8466-1',
  };
}

export interface EurachemBlankLodOptions {
  /** Replicatas da amostra na rotina (n). Padrão = 1. */
  routineSampleReplicates?: number;
  /** Replicatas do branco usadas na correção de rotina (n_b). Padrão = 1. */
  routineBlankReplicates?: number;
  /** Se o sinal da rotina é subtraído pelo branco (padrão = true). */
  blankCorrected?: boolean;
  /** Nível de significância unilateral α para t_{1−α, ν} (padrão = 0,05 → 95%). */
  alpha?: number;
  /** Fator k_Q para o LQ (padrão = 10 conforme Eurachem). */
  kQ?: number;
}

export interface EurachemBlankLodResult {
  nBlanks: number;
  blankMean: number;
  blankSd: number;
  dof: number;
  routineSampleReplicates: number;
  routineBlankReplicates: number;
  blankCorrected: boolean;
  correctionFactor: number;
  s0Prime: number;
  tCrit: number;
  kQ: number;
  lodCorrected: number;
  loqCorrected: number;
  lodUncorrected: number;
  loqUncorrected: number;
  method: string;
  reference: string;
}

/**
 * Limites de detecção e quantificação via brancos com fator de correção de rotina
 * s₀' = s₀·√(1/n + 1/n_b) e quantil t_{1−α, ν}.
 *
 * Referências: EURACHEM Blanks in Method Validation (2025); The Fitness for
 * Purpose of Analytical Methods (3ª ed., 2025).
 */
export function lodLoqEurachemBlanks(
  blanks: number[],
  options: EurachemBlankLodOptions = {},
): EurachemBlankLodResult {
  const valid = blanks.filter((v) => Number.isFinite(v));
  const n = Math.max(1, Math.floor(options.routineSampleReplicates ?? 1));
  const nb = Math.max(1, Math.floor(options.routineBlankReplicates ?? 1));
  const blankCorrected = options.blankCorrected ?? true;
  const alpha = options.alpha ?? 0.05;
  const kQ = options.kQ ?? 10;
  const nBlanks = valid.length;
  const reference =
    'EURACHEM — Blanks in Method Validation (2025); The Fitness for Purpose of Analytical Methods (3ª ed., 2025)';

  if (nBlanks < 3) {
    return {
      nBlanks,
      blankMean: NaN,
      blankSd: NaN,
      dof: 0,
      routineSampleReplicates: n,
      routineBlankReplicates: nb,
      blankCorrected,
      correctionFactor: NaN,
      s0Prime: NaN,
      tCrit: NaN,
      kQ,
      lodCorrected: NaN,
      loqCorrected: NaN,
      lodUncorrected: NaN,
      loqUncorrected: NaN,
      method: "LD = t_{1−α,ν}·s₀'; LQ = k_Q·s₀'",
      reference,
    };
  }

  const dof = nBlanks - 1;
  const blankMean = mean(valid);
  const blankSd = Math.sqrt(
    valid.reduce((acc, v) => acc + (v - blankMean) ** 2, 0) / dof,
  );
  const correctionFactor = blankCorrected
    ? Math.sqrt(1 / n + 1 / nb)
    : Math.sqrt(1 / n);
  const s0Prime = blankSd * correctionFactor;
  const tCrit = tInv(1 - alpha, dof);

  return {
    nBlanks,
    blankMean,
    blankSd,
    dof,
    routineSampleReplicates: n,
    routineBlankReplicates: nb,
    blankCorrected,
    correctionFactor,
    s0Prime,
    tCrit,
    kQ,
    lodCorrected: tCrit * s0Prime,
    loqCorrected: kQ * s0Prime,
    lodUncorrected: blankMean + tCrit * s0Prime,
    loqUncorrected: blankMean + kQ * s0Prime,
    method: `LD = t(${(1 - alpha) * 100}%, ν=${dof})·s₀'; LQ = ${kQ}·s₀'`,
    reference,
  };
}
