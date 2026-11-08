/**
 * Estatística descritiva.
 * Referências: ISO 3534-1:2006; Montgomery & Runger, cap. 8.
 */

import { normalInv, tInv } from './distributions';

export interface DescriptiveStats {
  n: number;
  missing: number;
  mean: number | null;
  sd: number | null;
  variance: number | null;
  sem: number | null;
  cv: number | null;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  range: number | null;
  iqr: number | null;
  skewness: number | null;
  kurtosis: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  confidence: number;
}

export function clean(values: Array<number | null | undefined>): number[] {
  return values.filter(
    (v): v is number => v !== null && v !== undefined && Number.isFinite(v),
  );
}

export function mean(values: number[]): number {
  if (!values.length) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Variância amostral (divisor n−1). */
export function variance(values: number[]): number {
  const n = values.length;
  if (n < 2) return NaN;
  const m = mean(values);
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return ss / (n - 1);
}

export function sd(values: number[]): number {
  return Math.sqrt(variance(values));
}

/** Quantil por interpolação linear (método 7 de Hyndman & Fan). */
export function quantile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

export function mode(values: number[]): number[] {
  const counts = new Map<number, number>();
  let max = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > max) max = c;
  }
  return [...counts.entries()].filter(([, c]) => c === max).map(([v]) => v);
}

/** Assimetria ajustada (G1). */
export function skewness(values: number[]): number {
  const n = values.length;
  if (n < 3) return NaN;
  const m = mean(values);
  const s = sd(values);
  if (!(s > 0)) return 0;
  let sum = 0;
  for (const v of values) sum += ((v - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * sum;
}

/** Curtose em excesso ajustada (G2). */
export function kurtosis(values: number[]): number {
  const n = values.length;
  if (n < 4) return NaN;
  const m = mean(values);
  const s = sd(values);
  if (!(s > 0)) return 0;
  let sum = 0;
  for (const v of values) sum += ((v - m) / s) ** 4;
  const a = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const b = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  return a * sum - b;
}

/** Intervalo de confiança da média (t de Student). */
export function ciMean(
  values: number[],
  confidence = 0.95,
): [number, number] {
  const n = values.length;
  if (n < 2) return [NaN, NaN];
  const m = mean(values);
  const se = sd(values) / Math.sqrt(n);
  const t = tInv(1 - (1 - confidence) / 2, n - 1);
  return [m - t * se, m + t * se];
}

/** Intervalo de confiança de uma proporção (Wilson). */
export function ciProportion(
  successes: number,
  n: number,
  confidence = 0.95,
): [number, number] {
  if (n <= 0) return [NaN, NaN];
  const zz =
    Math.abs(confidence - 0.95) < 1e-12
      ? 1.959963984540054
      : normalInv(0.5 + confidence / 2);
  const p = successes / n;
  const denom = 1 + (zz * zz) / n;
  const center = (p + (zz * zz) / (2 * n)) / denom;
  const half =
    (zz * Math.sqrt((p * (1 - p)) / n + (zz * zz) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function describe(
  raw: Array<number | null | undefined>,
  confidence = 0.95,
): DescriptiveStats {
  const values = clean(raw);
  const n = values.length;
  const missing = raw.length - n;
  if (!n) {
    return {
      n: 0,
      missing,
      mean: null,
      sd: null,
      variance: null,
      sem: null,
      cv: null,
      min: null,
      q1: null,
      median: null,
      q3: null,
      max: null,
      range: null,
      iqr: null,
      skewness: null,
      kurtosis: null,
      ciLow: null,
      ciHigh: null,
      confidence,
    };
  }
  const m = mean(values);
  const s = n > 1 ? sd(values) : null;
  const ci = n > 1 ? ciMean(values, confidence) : [NaN, NaN];
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    n,
    missing,
    mean: m,
    sd: s,
    variance: s === null ? null : s * s,
    sem: s === null ? null : s / Math.sqrt(n),
    cv: s === null || m === 0 ? null : (s / Math.abs(m)) * 100,
    min,
    q1,
    median: quantile(values, 0.5),
    q3,
    max,
    range: max - min,
    iqr: q3 - q1,
    skewness: n >= 3 ? skewness(values) : null,
    kurtosis: n >= 4 ? kurtosis(values) : null,
    ciLow: Number.isFinite(ci[0]) ? ci[0] : null,
    ciHigh: Number.isFinite(ci[1]) ? ci[1] : null,
    confidence,
  };
}

/** Estatísticas por grupo. */
export function describeGroups<T>(
  rows: T[],
  group: (row: T) => string,
  value: (row: T) => number | null | undefined,
  confidence = 0.95,
): Array<{ group: string; stats: DescriptiveStats }> {
  const map = new Map<string, Array<number | null | undefined>>();
  for (const row of rows) {
    const key = group(row);
    const list = map.get(key) ?? [];
    list.push(value(row));
    map.set(key, list);
  }
  return [...map.entries()].map(([key, values]) => ({
    group: key,
    stats: describe(values, confidence),
  }));
}

/** Coeficiente de variação (%) — repetibilidade em condições homogêneas. */
export function cvPercent(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const m = mean(values);
  if (!Number.isFinite(m) || m === 0) return null;
  return (sd(values) / Math.abs(m)) * 100;
}

/** Erro padrão da média. */
export function sem(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  return sd(values) / Math.sqrt(n);
}

/** Transformação Box-Cox: encontra λ que maximiza a verossimilhança (perfil). */
export function boxCoxLambda(values: number[]): number {
  const positive = values.filter((v) => v > 0);
  if (positive.length < 3) return NaN;
  const n = positive.length;
  const ybar = Math.exp(mean(positive.map((v) => Math.log(v))));
  let best = 1;
  let bestLl = -Infinity;
  for (let lambda = -2; lambda <= 2.0001; lambda += 0.01) {
    let ss = 0;
    let sum = 0;
    const transformed: number[] = [];
    for (const y of positive) {
      const z =
        Math.abs(lambda) < 1e-8 ? Math.log(y) : (Math.pow(y, lambda) - 1) / lambda;
      transformed.push(z);
      sum += z;
    }
    const m = sum / n;
    for (const z of transformed) ss += (z - m) * (z - m);
    const ll = -0.5 * n * Math.log(ss / n) + (lambda - 1) * n * Math.log(ybar);
    if (ll > bestLl) {
      bestLl = ll;
      best = lambda;
    }
  }
  return best;
}
