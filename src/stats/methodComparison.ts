/**
 * Comparação de métodos analíticos / metrológicos (CLSI EP09).
 *
 * Implementa:
 *  - Bland–Altman (viés médio, limites de concordância 95% e tendência proporcional)
 *  - Regressão de Deming (ortogonal generalizada com razão de variâncias λ = σ_y²/σ_x²)
 *  - Regressão não-paramétrica de Passing–Bablok com IC 95%
 *
 * Referências:
 *  - CLSI EP09-A3 / EP09c — Measurement Procedure Comparison and Bias Estimation.
 *  - Bland, J. M., & Altman, D. G. (1986). Lancet, 327(8476), 307–310.
 *  - Passing, H., & Bablok, W. (1983). J. Clin. Chem. Clin. Biochem., 21(11), 709–720.
 */

import { mean, quantile, sd } from './descriptive';
import { normalInv as normInv, tInv } from './distributions';
import { linearRegression } from './regression';

export interface BlandAltmanResult {
  n: number;
  meanBias: number;
  sdDiff: number;
  biasCi: [number, number];
  loaLower: number;
  loaUpper: number;
  proportionalSlope: number;
  proportionalP: number;
  meanPctBias: number | null;
  reference: string;
}

export interface DemingRegressionResult {
  n: number;
  lambda: number;
  slope: number;
  intercept: number;
  slopeSe: number;
  interceptSe: number;
  slopeCi: [number, number];
  interceptCi: [number, number];
  equivalentSlope: boolean;
  equivalentIntercept: boolean;
  reference: string;
}

export interface PassingBablokResult {
  n: number;
  validSlopes: number;
  slope: number;
  intercept: number;
  slopeCi: [number, number];
  interceptCi: [number, number];
  equivalentSlope: boolean;
  equivalentIntercept: boolean;
  reference: string;
}

const REFERENCE_BA = 'Bland & Altman (1986); CLSI EP09c';
const REFERENCE_DEMING = 'Linnet (1993) / CLSI EP09c (Deming ponderada com Jackknife)';
const REFERENCE_PB = 'Passing & Bablok (1983); CLSI EP09c';

function validatePairs(x: number[], y: number[], minN = 3): Array<{ x: number; y: number }> {
  if (x.length !== y.length) {
    throw new Error('Os vetores X (referência) e Y (teste) devem ter o mesmo tamanho.');
  }
  const pairs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      pairs.push({ x: x[i], y: y[i] });
    }
  }
  if (pairs.length < minN) {
    throw new Error(`São necessários pelo menos ${minN} pares válidos para comparação de métodos.`);
  }
  return pairs;
}

export function blandAltman(x: number[], y: number[], alpha = 0.05): BlandAltmanResult {
  const pairs = validatePairs(x, y, 2);
  const n = pairs.length;
  const diffs = pairs.map((p) => p.y - p.x);
  const avgs = pairs.map((p) => (p.x + p.y) / 2);
  const pctDiffs = pairs
    .map((p, idx) => (avgs[idx] !== 0 ? (100 * diffs[idx]) / avgs[idx] : null))
    .filter((v): v is number => v !== null && Number.isFinite(v));

  const meanBias = mean(diffs);
  const sdDiff = sd(diffs);
  const tCrit = tInv(1 - alpha / 2, Math.max(1, n - 1));
  const seBias = sdDiff / Math.sqrt(n);
  const loaLower = meanBias - 1.96 * sdDiff;
  const loaUpper = meanBias + 1.96 * sdDiff;

  let proportionalSlope = 0;
  let proportionalP = 1;
  if (n >= 3 && new Set(avgs).size >= 2) {
    const reg = linearRegression(avgs.map((xVal, idx) => ({ x: xVal, y: diffs[idx] })));
    if (Number.isFinite(reg.slope)) proportionalSlope = reg.slope;
    if (Number.isFinite(reg.slopeP)) proportionalP = reg.slopeP;
  }

  return {
    n,
    meanBias,
    sdDiff,
    biasCi: [meanBias - tCrit * seBias, meanBias + tCrit * seBias],
    loaLower,
    loaUpper,
    proportionalSlope,
    proportionalP,
    meanPctBias: pctDiffs.length ? mean(pctDiffs) : null,
    reference: REFERENCE_BA,
  };
}

function fitDemingCore(pairs: Array<{ x: number; y: number }>, lambda: number): { slope: number; intercept: number } {
  const mx = mean(pairs.map((p) => p.x));
  const my = mean(pairs.map((p) => p.y));
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pairs) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0) {
    throw new Error('Variância nula em X impede o ajuste de Deming.');
  }
  const slope =
    sxy === 0
      ? 0
      : (syy - lambda * sxx + Math.sqrt((syy - lambda * sxx) ** 2 + 4 * lambda * sxy * sxy)) /
        (2 * sxy);
  const intercept = my - slope * mx;
  return { slope, intercept };
}

export function demingRegression(
  x: number[],
  y: number[],
  lambda = 1,
  alpha = 0.05,
): DemingRegressionResult {
  if (!Number.isFinite(lambda) || lambda <= 0) {
    throw new Error('A razão de variâncias λ = σ_y²/σ_x² deve ser positiva.');
  }
  const pairs = validatePairs(x, y, 3);
  const n = pairs.length;
  const full = fitDemingCore(pairs, lambda);

  // Jackknife leave-one-out para erro-padrão (Linnet 1993)
  const jackSlopes: number[] = [];
  const jackIntercepts: number[] = [];
  for (let i = 0; i < n; i++) {
    const sub = pairs.filter((_, idx) => idx !== i);
    const fit = fitDemingCore(sub, lambda);
    jackSlopes.push(n * full.slope - (n - 1) * fit.slope);
    jackIntercepts.push(n * full.intercept - (n - 1) * fit.intercept);
  }
  const slopeSe = sd(jackSlopes) / Math.sqrt(n);
  const interceptSe = sd(jackIntercepts) / Math.sqrt(n);
  const tCrit = tInv(1 - alpha / 2, Math.max(1, n - 2));
  const slopeCi: [number, number] = [
    full.slope - tCrit * slopeSe,
    full.slope + tCrit * slopeSe,
  ];
  const interceptCi: [number, number] = [
    full.intercept - tCrit * interceptSe,
    full.intercept + tCrit * interceptSe,
  ];

  return {
    n,
    lambda,
    slope: full.slope,
    intercept: full.intercept,
    slopeSe,
    interceptSe,
    slopeCi,
    interceptCi,
    equivalentSlope: slopeCi[0] <= 1 && slopeCi[1] >= 1,
    equivalentIntercept: interceptCi[0] <= 0 && interceptCi[1] >= 0,
    reference: REFERENCE_DEMING,
  };
}

export function passingBablokRegression(
  x: number[],
  y: number[],
  alpha = 0.05,
): PassingBablokResult {
  const pairs = validatePairs(x, y, 4);
  const n = pairs.length;
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = pairs[j].x - pairs[i].x;
      const dy = pairs[j].y - pairs[i].y;
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) {
        slopes.push(dy > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        continue;
      }
      const s = dy / dx;
      if (Math.abs(s + 1) < 1e-12) continue;
      slopes.push(s);
    }
  }
  if (slopes.length < 3) {
    throw new Error('Não há pares distintos suficientes para regressão de Passing–Bablok.');
  }
  slopes.sort((a, b) => a - b);
  const bigN = slopes.length;
  const k = slopes.filter((s) => s < -1).length;

  const atShifted = (oneBasedIndex: number): number => {
    const idx = Math.min(bigN - 1, Math.max(0, Math.round(oneBasedIndex) - 1 + k));
    return slopes[idx];
  };

  const slope =
    bigN % 2 === 1
      ? atShifted((bigN + 1) / 2)
      : 0.5 * (atShifted(bigN / 2) + atShifted(bigN / 2 + 1));

  const z = normInv(1 - alpha / 2);
  const cGamma = z * Math.sqrt((n * (n - 1) * (2 * n + 5)) / 18);
  const m1 = Math.max(1, Math.round((bigN - cGamma) / 2));
  const m2 = Math.min(bigN, bigN - m1 + 1);
  const slopeLow = atShifted(m1);
  const slopeHigh = atShifted(m2);

  const intercept = quantile(
    pairs.map((p) => p.y - slope * p.x),
    0.5,
  );
  const int1 = quantile(
    pairs.map((p) => p.y - slopeHigh * p.x),
    0.5,
  );
  const int2 = quantile(
    pairs.map((p) => p.y - slopeLow * p.x),
    0.5,
  );
  const slopeCi: [number, number] = [Math.min(slopeLow, slopeHigh), Math.max(slopeLow, slopeHigh)];
  const interceptCi: [number, number] = [Math.min(int1, int2), Math.max(int1, int2)];

  return {
    n,
    validSlopes: bigN,
    slope,
    intercept,
    slopeCi,
    interceptCi,
    equivalentSlope: slopeCi[0] <= 1 && slopeCi[1] >= 1,
    equivalentIntercept: interceptCi[0] <= 0 && interceptCi[1] >= 0,
    reference: REFERENCE_PB,
  };
}
