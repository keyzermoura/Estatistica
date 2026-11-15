/**
 * Limites de Capacidade de Detecção (CLSI EP17) e Regressão Probit (LOD95%).
 *
 * Implementa:
 *  - CLSI EP17-A2: Limite do Branco (LoB paramétrico e não-paramétrico) e LoD
 *  - Regressão Probit por IRLS (Iteratively Reweighted Least Squares) para
 *    ensaios qualitativos / PCR / microbiologia (estimativa de LOD95% e LOD50%)
 *
 * Referências:
 *  - CLSI EP17-A2: Evaluation of Detection Capability for Clinical Laboratory Measurement Procedures.
 *  - Finney, D. J. (1971). Probit Analysis.
 */

import { mean, quantile, sd } from './descriptive';
import {
  normalCdf as normCdf,
  normalInv as normInv,
  normalPdf as normPdf,
} from './distributions';

export interface ClsiEp17Result {
  nBlanks: number;
  nLowLevel: number;
  meanBlank: number;
  sdBlank: number;
  lobParametric: number;
  lobNonParametric: number;
  sdLowLevel: number;
  lodParametric: number;
  alpha: number;
  beta: number;
  reference: string;
}

export interface ProbitLevelInput {
  concentration: number;
  positives: number;
  total: number;
}

export interface ProbitLodResult {
  intercept: number;
  slope: number;
  targetProbability: number;
  lod: number;
  lod50: number;
  lodCi: [number, number];
  deviance: number;
  df: number;
  iterations: number;
  reference: string;
}

const REFERENCE_EP17 = 'CLSI EP17-A2 (LoB paramétrico/não-paramétrico e LoD)';
const REFERENCE_PROBIT = 'Finney (1971) / CLSI EP17-A2 (Regressão Probit por IRLS + Fieller)';

export function clsiEp17Limits(
  blanks: number[],
  lowLevelSamples?: number[],
  alpha = 0.05,
  beta = 0.05,
): ClsiEp17Result {
  const validBlanks = blanks.filter((v) => Number.isFinite(v));
  if (validBlanks.length < 3) {
    throw new Error('CLSI EP17 requer pelo menos 3 leituras de branco.');
  }
  const nB = validBlanks.length;
  const meanBlank = mean(validBlanks);
  const sdBlank = sd(validBlanks);
  const zAlpha = normInv(1 - alpha);
  const cpBlank = nB > 1 ? zAlpha / (1 - 1 / (4 * (nB - 1))) : zAlpha;
  const lobParametric = meanBlank + cpBlank * sdBlank;
  const lobNonParametric = quantile(validBlanks, 1 - alpha);

  const validLow = (lowLevelSamples ?? []).filter((v) => Number.isFinite(v));
  const useLow = validLow.length >= 2;
  const nL = useLow ? validLow.length : nB;
  const sdLowLevel = useLow ? sd(validLow) : sdBlank;
  const zBeta = normInv(1 - beta);
  const dfLow = Math.max(1, nL - 1);
  const cBeta = dfLow > 0 ? zBeta / (1 - 1 / (4 * dfLow)) : zBeta;
  const lodParametric = lobParametric + cBeta * sdLowLevel;

  return {
    nBlanks: nB,
    nLowLevel: validLow.length,
    meanBlank,
    sdBlank,
    lobParametric,
    lobNonParametric,
    sdLowLevel,
    lodParametric,
    alpha,
    beta,
    reference: REFERENCE_EP17,
  };
}

export function probitLod95(
  levels: ProbitLevelInput[],
  targetProbability = 0.95,
  alpha = 0.05,
): ProbitLodResult {
  const clean = levels
    .filter((l) => l.concentration > 0 && l.total > 0 && l.positives >= 0 && l.positives <= l.total)
    .map((l) => ({
      x: Math.log10(l.concentration),
      k: l.positives,
      n: l.total,
    }))
    .sort((a, b) => a.x - b.x);

  if (clean.length < 3) {
    throw new Error('A regressão Probit requer pelo menos 3 níveis de concentração positivos.');
  }

  // Chute inicial OLS com continuidade de Bartlett (0.5 / (n+1))
  const ys0 = clean.map((l) => {
    const p = Math.min(0.995, Math.max(0.005, (l.k + 0.5) / (l.n + 1)));
    return normInv(p);
  });
  const mx = mean(clean.map((l) => l.x));
  const my = mean(ys0);
  const sxx = clean.reduce((acc, l) => acc + (l.x - mx) ** 2, 0);
  if (sxx <= 0) {
    throw new Error('Os níveis devem apresentar concentrações distintas na regressão Probit.');
  }
  let b = clean.reduce((acc, l, idx) => acc + (l.x - mx) * (ys0[idx] - my), 0) / sxx;
  if (!(b > 0)) b = 1;
  let a = my - b * mx;

  let cov00 = 0;
  let cov01 = 0;
  let cov11 = 0;
  let iterations = 0;

  for (let iter = 0; iter < 50; iter++) {
    iterations = iter + 1;
    let info00 = 0;
    let info01 = 0;
    let info11 = 0;
    let g0 = 0;
    let g1 = 0;

    for (const row of clean) {
      const eta = Math.min(6, Math.max(-6, a + b * row.x));
      const p = Math.min(1 - 1e-10, Math.max(1e-10, normCdf(eta)));
      const phi = Math.max(1e-12, normPdf(eta));
      const w = (row.n * phi * phi) / (p * (1 - p));
      const scoreWeight = (row.k - row.n * p) * (phi / (p * (1 - p)));

      info00 += w;
      info01 += w * row.x;
      info11 += w * row.x * row.x;
      g0 += scoreWeight;
      g1 += scoreWeight * row.x;
    }

    const det = info00 * info11 - info01 * info01;
    if (!(det > 1e-14)) break;

    cov00 = info11 / det;
    cov01 = -info01 / det;
    cov11 = info00 / det;

    const da = cov00 * g0 + cov01 * g1;
    const db = cov01 * g0 + cov11 * g1;
    a += da;
    b += db;
    if (Math.abs(da) < 1e-8 && Math.abs(db) < 1e-8) break;
  }

  if (!(b > 0)) {
    throw new Error('O modelo Probit não convergiu para declive positivo.');
  }

  const targetZ = normInv(targetProbability);
  const xTarget = (targetZ - a) / b;
  const x50 = -a / b;
  const lod = 10 ** xTarget;
  const lod50 = 10 ** x50;

  // Variância por método Delta em log10(LOD)
  const daDeriv = -1 / b;
  const dbDeriv = -(targetZ - a) / (b * b);
  const varLogLod = Math.max(
    0,
    daDeriv * daDeriv * cov00 + 2 * daDeriv * dbDeriv * cov01 + dbDeriv * dbDeriv * cov11,
  );
  const seLogLod = Math.sqrt(varLogLod);
  const zCrit = normInv(1 - alpha / 2);
  const lodCi: [number, number] = [
    10 ** (xTarget - zCrit * seLogLod),
    10 ** (xTarget + zCrit * seLogLod),
  ];

  // Deviance residual
  let deviance = 0;
  for (const row of clean) {
    const p = Math.min(1 - 1e-10, Math.max(1e-10, normCdf(a + b * row.x)));
    if (row.k > 0) deviance += 2 * row.k * Math.log(row.k / (row.n * p));
    if (row.k < row.n) {
      deviance += 2 * (row.n - row.k) * Math.log((row.n - row.k) / (row.n * (1 - p)));
    }
  }

  return {
    intercept: a,
    slope: b,
    targetProbability,
    lod,
    lod50,
    lodCi,
    deviance,
    df: clean.length - 2,
    iterations,
    reference: REFERENCE_PROBIT,
  };
}
