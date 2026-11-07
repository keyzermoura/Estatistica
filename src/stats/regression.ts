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
