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

import { fInv, tInv } from './distributions';
import { mean, sd } from './descriptive';
import type { AnalysisChart } from './analysis-types';

/**
 * Valor crítico exato de Mandel h (ISO 5725-2:2019, Anexo B / Tabela B.1).
 * Relação exata com t de Student:
 *   h_crit(p, α) = (p − 1) · t_{1 − α/2, p − 2} / sqrt(p · (t² + p − 2)).
 *
 * Referência: ISO 5725-2:2019, Seção 7.3 e Anexo B; Wilrich (2013).
 */
export function mandelHCritical(p: number, alpha = 0.05): number {
  if (!Number.isInteger(p) || p < 3) {
    throw new Error('Mandel h crítico (ISO 5725-2) requer p ≥ 3 laboratórios inteiros.');
  }
  if (!(alpha > 0 && alpha < 1)) {
    throw new Error('Nível de significância α deve estar estritamente em (0, 1).');
  }
  const t = tInv(1 - alpha / 2, p - 2);
  return ((p - 1) * t) / Math.sqrt(p * (t * t + p - 2));
}

/**
 * Valor crítico exato de Mandel k (ISO 5725-2:2019, Anexo B / Tabela B.2).
 * Relação exata com F de Snedecor:
 *   k_crit(p, n, α) = sqrt( p · F_{1 − α; n − 1, (p − 1)(n − 1)} / (p − 1 + F) ).
 *
 * Referência: ISO 5725-2:2019, Seção 7.3 e Anexo B; Mandel (1991).
 */
export function mandelKCritical(p: number, n: number, alpha = 0.05): number {
  if (!Number.isInteger(p) || p < 2) {
    throw new Error('Mandel k crítico (ISO 5725-2) requer p ≥ 2 laboratórios inteiros.');
  }
  if (!Number.isInteger(n) || n < 2) {
    throw new Error('Mandel k crítico (ISO 5725-2) requer n ≥ 2 réplicas inteiras.');
  }
  if (!(alpha > 0 && alpha < 1)) {
    throw new Error('Nível de significância α deve estar estritamente em (0, 1).');
  }
  const f = fInv(1 - alpha, n - 1, (p - 1) * (n - 1));
  return Math.sqrt((p * f) / (p - 1 + f));
}

export type MandelSeverity = 'ok' | 'straggler' | 'outlier';

export interface MandelLabConsistency {
  level: string;
  lab: string;
  mean: number;
  sd: number;
  h: number;
  k: number;
  hStatus: MandelSeverity;
  kStatus: MandelSeverity;
}

export interface MandelLevelConsistency {
  level: string;
  p: number;
  n: number;
  hCrit05: number | null;
  hCrit01: number | null;
  kCrit05: number | null;
  kCrit01: number | null;
  labs: MandelLabConsistency[];
}

export interface MandelConsistencyResult {
  levels: MandelLevelConsistency[];
  stragglersH: MandelLabConsistency[];
  outliersH: MandelLabConsistency[];
  stragglersK: MandelLabConsistency[];
  outliersK: MandelLabConsistency[];
  reference: string;
}

/**
 * Classifica cada laboratório segundo os valores críticos exatos de Mandel h e k
 * em 5% (straggler / suspeito) e 1% (outlier / aberrante), conforme ISO 5725-2.
 */
export function evaluateMandelConsistency(result: Iso5725Result): MandelConsistencyResult {
  const stragglersH: MandelLabConsistency[] = [];
  const outliersH: MandelLabConsistency[] = [];
  const stragglersK: MandelLabConsistency[] = [];
  const outliersK: MandelLabConsistency[] = [];

  const levels: MandelLevelConsistency[] = result.levels.map((lvl) => {
    const hCrit05 = lvl.p >= 3 ? mandelHCritical(lvl.p, 0.05) : null;
    const hCrit01 = lvl.p >= 3 ? mandelHCritical(lvl.p, 0.01) : null;
    const kCrit05 = lvl.p >= 2 && lvl.n >= 2 ? mandelKCritical(lvl.p, lvl.n, 0.05) : null;
    const kCrit01 = lvl.p >= 2 && lvl.n >= 2 ? mandelKCritical(lvl.p, lvl.n, 0.01) : null;

    const labs: MandelLabConsistency[] = lvl.labMeans.map((lm) => {
      const absH = Math.abs(lm.h);
      const hStatus: MandelSeverity =
        hCrit01 !== null && absH > hCrit01
          ? 'outlier'
          : hCrit05 !== null && absH > hCrit05
            ? 'straggler'
            : 'ok';
      const kStatus: MandelSeverity =
        kCrit01 !== null && lm.k > kCrit01
          ? 'outlier'
          : kCrit05 !== null && lm.k > kCrit05
            ? 'straggler'
            : 'ok';

      const entry: MandelLabConsistency = {
        level: lvl.level,
        lab: lm.lab,
        mean: lm.mean,
        sd: lm.sd,
        h: lm.h,
        k: lm.k,
        hStatus,
        kStatus,
      };
      if (hStatus === 'straggler') stragglersH.push(entry);
      if (hStatus === 'outlier') outliersH.push(entry);
      if (kStatus === 'straggler') stragglersK.push(entry);
      if (kStatus === 'outlier') outliersK.push(entry);
      return entry;
    });

    return {
      level: lvl.level,
      p: lvl.p,
      n: lvl.n,
      hCrit05,
      hCrit01,
      kCrit05,
      kCrit01,
      labs,
    };
  });

  return {
    levels,
    stragglersH,
    outliersH,
    stragglersK,
    outliersK,
    reference: 'ISO 5725-2:2019, Seção 7.3 e Anexo B (Tabelas B.1 e B.2)',
  };
}

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
    const hCrit01 = pEff >= 3 ? mandelHCritical(pEff, 0.01) : 2;
    const kCrit01 = pEff >= 2 && n >= 2 ? mandelKCritical(pEff, n, 0.01) : 2;
    const labMeans = labStats.map((l) => {
      const h = hDenom > 0 ? (l.mean - grandMean) / hDenom : 0;
      const k = kDenom > 0 ? l.sd / kDenom : 0;
      return {
        lab: l.lab,
        mean: l.mean,
        sd: l.sd,
        h,
        k,
        hFlag: Math.abs(h) > hCrit01,
        kFlag: k > kCrit01,
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
    warnings.push('Mandel h sinaliza laboratório(s) com média discrepante além do limite crítico de 1% (ISO 5725-2).');
  }
  if (levels.some((l) => l.labMeans.some((lm) => lm.kFlag))) {
    warnings.push('Mandel k sinaliza laboratório(s) com variabilidade discrepante além do limite crítico de 1% (ISO 5725-2).');
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

/**
 * Constrói gráficos diagnósticos de Mandel h (entre laboratórios) e k (dentro de laboratórios)
 * com as linhas de corte exatas de 5% (suspeito / straggler) e 1% (aberrante / outlier).
 */
export function buildMandelCharts(result: Iso5725Result): {
  hChart: AnalysisChart | null;
  kChart: AnalysisChart | null;
} {
  const consistency = evaluateMandelConsistency(result);
  if (!consistency.levels.length) return { hChart: null, kChart: null };

  const hData: Array<Record<string, string | number | null>> = [];
  const kData: Array<Record<string, string | number | null>> = [];
  let maxHCrit05 = 0;
  let maxHCrit01 = 0;
  let maxKCrit05 = 0;
  let maxKCrit01 = 0;

  for (const lvl of consistency.levels) {
    if (lvl.hCrit05) maxHCrit05 = Math.max(maxHCrit05, lvl.hCrit05);
    if (lvl.hCrit01) maxHCrit01 = Math.max(maxHCrit01, lvl.hCrit01);
    if (lvl.kCrit05) maxKCrit05 = Math.max(maxKCrit05, lvl.kCrit05);
    if (lvl.kCrit01) maxKCrit01 = Math.max(maxKCrit01, lvl.kCrit01);

    for (const lab of lvl.labs) {
      const label = consistency.levels.length > 1 ? `${lvl.level} - ${lab.lab}` : lab.lab;
      hData.push({
        lab: label,
        h: Number(lab.h.toFixed(3)),
        status: lab.hStatus,
      });
      kData.push({
        lab: label,
        k: Number(lab.k.toFixed(3)),
        status: lab.kStatus,
      });
    }
  }

  const hChart: AnalysisChart = {
    kind: 'mandel',
    title: 'Consistência entre laboratórios — Mandel h',
    xLabel: 'Laboratório / Analista',
    yLabel: 'Estatística h',
    data: hData,
    meta: {
      statKey: 'h',
      crit05: maxHCrit05 || 2,
      crit01: maxHCrit01 || 2.5,
      bilateral: true,
    },
  };

  const kChart: AnalysisChart = {
    kind: 'mandel',
    title: 'Consistência intra-laboratório — Mandel k',
    xLabel: 'Laboratório / Analista',
    yLabel: 'Estatística k',
    data: kData,
    meta: {
      statKey: 'k',
      crit05: maxKCrit05 || 1.8,
      crit01: maxKCrit01 || 2.1,
      bilateral: false,
    },
  };

  return { hChart, kChart };
}
