/**
 * ISO 5725-2 — precisão interlaboratorial.
 *
 * Modelo: y_ijk = m_j + B_ij + e_ijk, com B ~ N(0, σ_L²) e e ~ N(0, σ_r²).
 * Para delineamento balanceado por nível:
 *   s_r² = MSW
 *   s_L² = (MSB − MSW) / n
 *   s_R² = s_r² + s_L²
 *   r = 2,8·s_r ; R = 2,8·s_R
 *
 * Referências: ISO 5725-1:2023; ISO 5725-2:2019, cláusulas 5–7.
 */

import { mean, sd } from './descriptive';

export interface Iso5725Row {
  lab: string;
  level: string;
  replicate: number;
  value: number;
}

export interface Iso5725LevelResult {
  level: string;
  p: number;
  n: number;
  grandMean: number;
  msBetween: number;
  msWithin: number;
  sr: number;
  sL: number;
  sR: number;
  repeatabilityLimit: number;
  reproducibilityLimit: number;
  cvRepeatability: number | null;
  cvReproducibility: number | null;
  balanced: boolean;
  labMeans: Array<{ lab: string; mean: number; sd: number; h: number; k: number; hFlag: boolean; kFlag: boolean }>;
}

export interface Iso5725Result {
  levels: Iso5725LevelResult[];
  pooled: {
    p: number;
    n: number;
    q: number;
    sr: number;
    sL: number;
    sR: number;
    repeatabilityLimit: number;
    reproducibilityLimit: number;
    cvRepeatability: number | null;
    cvReproducibility: number | null;
    dofRepeatability: number;
    dofReproducibility: number;
  };
  method: string;
  reference: string;
  interpretation: string;
  warnings: string[];
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

export function iso5725Analysis(rows: Iso5725Row[]): Iso5725Result {
  const warnings: string[] = [];
  const byLevel = groupBy(rows, (r) => r.level);
  const levels: Iso5725LevelResult[] = [];
  let pooledSr2Num = 0;
  let pooledSr2Den = 0;
  let pooledSL2Num = 0;
  let pooledSL2Den = 0;
  let minP = Infinity;
  let minN = Infinity;

  for (const [level, list] of byLevel) {
    const byLab = groupBy(list, (r) => r.lab);
    const p = byLab.size;
    const sizes = [...byLab.values()].map((v) => v.length);
    const n = Math.min(...sizes);
    const balanced = sizes.every((s) => s === n);
    if (!balanced) warnings.push(`Nível ${level}: número de réplicas desigual entre laboratórios.`);
    if (p < 6) warnings.push(`Nível ${level}: apenas ${p} laboratórios (ISO 5725-2 recomenda ≥ 6).`);
    if (n < 2) warnings.push(`Nível ${level}: menos de 2 réplicas por laboratório.`);
    const grandMean = mean(list.map((r) => r.value));
    const labStats = [...byLab.entries()].map(([lab, labRows]) => {
      const values = labRows.map((r) => r.value);
      return { lab, mean: mean(values), sd: sd(values), n: values.length };
    });
    const pEff = labStats.length;
    const msBetween =
      (n / (pEff - 1)) * labStats.reduce((acc, l) => acc + (l.mean - grandMean) ** 2, 0);
    let ssWithin = 0;
    let dfWithin = 0;
    for (const [, labRows] of byLab) {
      const m = mean(labRows.map((r) => r.value));
      for (const r of labRows) ssWithin += (r.value - m) ** 2;
      dfWithin += labRows.length - 1;
    }
    const msWithin = dfWithin > 0 ? ssWithin / dfWithin : NaN;
    const sr2 = msWithin;
    const sL2 = pEff > 1 && n > 0 ? Math.max(0, (msBetween - msWithin) / n) : NaN;
    const sr = Math.sqrt(Math.max(0, sr2));
    const sL = Number.isFinite(sL2) ? Math.sqrt(sL2) : NaN;
    const sR = Math.sqrt(Math.max(0, sr2 + (Number.isFinite(sL2) ? sL2 : 0)));
    const hDenom = Math.sqrt(
      labStats.reduce((acc, l) => acc + (l.mean - grandMean) ** 2, 0) / Math.max(1, pEff - 1),
    );
    const kDenom = Math.sqrt(
      labStats.reduce((acc, l) => acc + l.sd * l.sd, 0) / Math.max(1, pEff),
    );
    const labMeans = labStats.map((l) => {
      const h = hDenom > 0 ? (l.mean - grandMean) / hDenom : 0;
      const k = kDenom > 0 ? l.sd / kDenom : 0;
      return {
        lab: l.lab,
        mean: l.mean,
        sd: l.sd,
        h,
        k,
        hFlag: Math.abs(h) > 2,
        kFlag: k > 2,
      };
    });
    levels.push({
      level,
      p,
      n,
      grandMean,
      msBetween,
      msWithin,
      sr,
      sL,
      sR,
      repeatabilityLimit: 2.8 * sr,
      reproducibilityLimit: 2.8 * sR,
      cvRepeatability: grandMean !== 0 ? (100 * sr) / Math.abs(grandMean) : null,
      cvReproducibility: grandMean !== 0 ? (100 * sR) / Math.abs(grandMean) : null,
      balanced,
      labMeans,
    });
    pooledSr2Num += dfWithin * sr2;
    pooledSr2Den += dfWithin;
    pooledSL2Num += (pEff - 1) * (Number.isFinite(sL2) ? sL2 : 0);
    pooledSL2Den += pEff - 1;
    minP = Math.min(minP, p);
    minN = Math.min(minN, n);
  }

  const sr2 = pooledSr2Den > 0 ? pooledSr2Num / pooledSr2Den : NaN;
  const sL2 = pooledSL2Den > 0 ? pooledSL2Num / pooledSL2Den : NaN;
  const sr = Math.sqrt(Math.max(0, sr2));
  const sL = Math.sqrt(Math.max(0, sL2));
  const sR = Math.sqrt(sr2 + sL2);
  const grandMeans = levels.map((l) => l.grandMean);
  const overallMean = mean(grandMeans);
  const q = levels.length;
  const pooled = {
    p: minP,
    n: minN,
    q,
    sr,
    sL,
    sR,
    repeatabilityLimit: 2.8 * sr,
    reproducibilityLimit: 2.8 * sR,
    cvRepeatability: overallMean !== 0 ? (100 * sr) / Math.abs(overallMean) : null,
    cvReproducibility: overallMean !== 0 ? (100 * sR) / Math.abs(overallMean) : null,
    dofRepeatability: pooledSr2Den,
    dofReproducibility:
      sL2 > 0
        ? (sr2 + sL2) ** 2 /
          (sr2 ** 2 / Math.max(1, pooledSr2Den) + sL2 ** 2 / Math.max(1, pooledSL2Den))
        : pooledSr2Den,
  };
  if (levels.some((l) => l.labMeans.some((lm) => lm.hFlag))) {
    warnings.push('Mandel h sinaliza laboratório(s) com média discrepante (|h| > 2).');
  }
  if (levels.some((l) => l.labMeans.some((lm) => lm.kFlag))) {
    warnings.push('Mandel k sinaliza laboratório(s) com variabilidade discrepante (k > 2).');
  }
  return {
    levels,
    pooled,
    method: 'ISO 5725-2: modelo aleatório de dois níveis, estimação por ANOVA',
    reference: 'ISO 5725-1:2023; ISO 5725-2:2019, cláusulas 5–7; Mandel (1991)',
    interpretation:
      `s_r = ${sr.toPrecision(4)} (${pooled.cvRepeatability?.toFixed(2) ?? '—'}% CV) e ` +
      `s_R = ${sR.toPrecision(4)} (${pooled.cvReproducibility?.toFixed(2) ?? '—'}% CV). ` +
      `Limites r = ${pooled.repeatabilityLimit.toPrecision(4)} e R = ${pooled.reproducibilityLimit.toPrecision(4)}.`,
    warnings: [...new Set(warnings)],
  };
}

/** Verifica se a diferença entre dois resultados é compatível com r ou R. */
export function iso5725Compare(
  x1: number,
  x2: number,
  limit: number,
): { difference: number; limit: number; compatible: boolean; interpretation: string } {
  const difference = Math.abs(x1 - x2);
  return {
    difference,
    limit,
    compatible: difference <= limit,
    interpretation:
      difference <= limit
        ? `|x₁ − x₂| = ${difference.toPrecision(4)} ≤ ${limit.toPrecision(4)}: resultados compatíveis.`
        : `|x₁ − x₂| = ${difference.toPrecision(4)} > ${limit.toPrecision(4)}: diferença além do limite esperado.`,
  };
}
