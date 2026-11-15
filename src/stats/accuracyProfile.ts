/**
 * Perfil de Exatidão (Accuracy Profile / Erro Total — SFSTP / USP <1210>).
 *
 * Calcula, por nível de concentração/referência, o viés relativo, repetibilidade,
 * precisão intermediária e o intervalo de tolerância β-expectation [L_j, U_j],
 * comparando-o com os limites de aceitação ±λ (%) para definir LLOQ e ULOQ validados.
 *
 * Referências:
 *  - Hubert et al. (2004, 2007, 2008) — Validation of quantitative analytical procedures (SFSTP).
 *  - USP <1210> Statistical Tools for Procedure Validation.
 *  - ISO 5725-2:2019 — Decomposição intra e entre séries.
 */

import type { Measurement } from '../lib/types';
import { referenceOf } from './analysis-utils';
import { mean, sd } from './descriptive';
import { tInv } from './distributions';

export interface AccuracyProfileLevel {
  levelLabel: string;
  referenceMean: number;
  n: number;
  seriesCount: number;
  measuredMean: number;
  recoveryPct: number;
  relativeBiasPct: number;
  sr: number;
  sL: number;
  sIp: number;
  rsdRepeatabilityPct: number;
  rsdIpPct: number;
  dofEffective: number;
  toleranceFactor: number;
  lowerTolerancePct: number;
  upperTolerancePct: number;
  withinAcceptance: boolean;
}

export interface AccuracyProfileResult {
  beta: number;
  acceptanceLimitPct: number;
  levels: AccuracyProfileLevel[];
  allWithinAcceptance: boolean;
  lloq: number | null;
  uloq: number | null;
  reference: string;
  warnings: string[];
}

export interface AccuracyProfileOptions {
  /** Probabilidade β do intervalo de tolerância (padrão 0,95). */
  beta?: number;
  /** Limite simétrico ±λ (%) de erro total aceito (padrão 10%). */
  acceptanceLimitPct?: number;
}

const REFERENCE = 'Hubert et al. (SFSTP, 2007); USP <1210>; ISO 5725-2:2019';

export function computeAccuracyProfile(
  measurements: Measurement[],
  options: AccuracyProfileOptions = {},
): AccuracyProfileResult | null {
  const beta =
    options.beta !== undefined && options.beta > 0.5 && options.beta < 1
      ? options.beta
      : 0.95;
  const acceptanceLimitPct =
    options.acceptanceLimitPct !== undefined && options.acceptanceLimitPct > 0
      ? options.acceptanceLimitPct
      : 10;

  const grouped = new Map<
    string,
    { label: string; rows: Array<{ value: number; ref: number; series: string }> }
  >();

  for (const m of measurements) {
    const ref = referenceOf(m);
    if (m.value === null || !Number.isFinite(m.value) || ref === null || !Number.isFinite(ref) || ref === 0) {
      continue;
    }
    const label = m.level.trim() || String(ref);
    const series = `${m.analyst || 'A'}|${m.day || 'D'}|${m.equipment || 'E'}|${m.lot || 'L'}`;
    const entry = grouped.get(label) ?? { label, rows: [] };
    entry.rows.push({ value: m.value, ref, series });
    grouped.set(label, entry);
  }

  const levelBuckets = [...grouped.values()]
    .filter((bucket) => bucket.rows.length >= 2)
    .map((bucket) => ({
      ...bucket,
      referenceMean: mean(bucket.rows.map((r) => r.ref)),
    }))
    .filter((bucket) => Math.abs(bucket.referenceMean) > 0)
    .sort((a, b) => a.referenceMean - b.referenceMean);

  if (levelBuckets.length < 2) {
    return null;
  }

  const warnings: string[] = [];
  const levels: AccuracyProfileLevel[] = [];

  for (const bucket of levelBuckets) {
    const n = bucket.rows.length;
    const refMean = bucket.referenceMean;
    const measuredMean = mean(bucket.rows.map((r) => r.value));
    const recoveryPct = (100 * measuredMean) / refMean;
    const relativeBiasPct = recoveryPct - 100;

    const bySeries = new Map<string, number[]>();
    for (const row of bucket.rows) {
      const list = bySeries.get(row.series) ?? [];
      list.push(row.value);
      bySeries.set(row.series, list);
    }

    const seriesGroups = [...bySeries.values()];
    const p = seriesGroups.length;
    const hasReplicatesInsideSeries = p >= 2 && seriesGroups.some((g) => g.length >= 2);

    let sr = 0;
    let sL = 0;
    let sIp = 0;
    let dofEffective = n - 1;
    let bTerm = 1;

    if (hasReplicatesInsideSeries && n > p) {
      let ssWithin = 0;
      let ssBetween = 0;
      let sumNiSq = 0;
      for (const vals of seriesGroups) {
        const gMean = mean(vals);
        sumNiSq += vals.length * vals.length;
        ssBetween += vals.length * (gMean - measuredMean) ** 2;
        for (const v of vals) ssWithin += (v - gMean) ** 2;
      }
      const dfBetween = p - 1;
      const dfWithin = n - p;
      const msBetween = ssBetween / dfBetween;
      const msWithin = ssWithin / dfWithin;
      const n0 = (n - sumNiSq / n) / dfBetween || 1;
      const sr2 = Math.max(0, msWithin);
      const rawSL2 = (msBetween - msWithin) / n0;

      if (rawSL2 > 0) {
        const sL2 = rawSL2;
        sr = Math.sqrt(sr2);
        sL = Math.sqrt(sL2);
        sIp = Math.sqrt(sr2 + sL2);
        const rRatio = sr2 > 0 ? sL2 / sr2 : 1e6;
        bTerm = Math.sqrt((rRatio + 1) / (n0 * rRatio + 1));

        const compB = (msBetween / n0);
        const compW = Math.max(0, 1 - 1 / n0) * msWithin;
        const den =
          (compB * compB) / Math.max(1, dfBetween) +
          (dfWithin > 0 ? (compW * compW) / dfWithin : 0);
        dofEffective = den > 0 ? (sIp * sIp) ** 2 / den : Math.max(1, n - 1);
      } else {
        const totalSd = sd(bucket.rows.map((r) => r.value));
        sr = Math.sqrt(sr2);
        sL = 0;
        sIp = totalSd;
        dofEffective = Math.max(1, n - 1);
      }
    } else {
      const totalSd = sd(bucket.rows.map((r) => r.value));
      sr = totalSd;
      sL = 0;
      sIp = totalSd;
      dofEffective = Math.max(1, n - 1);
    }

    const rsdRepeatabilityPct = (100 * sr) / Math.abs(refMean);
    const rsdIpPct = (100 * sIp) / Math.abs(refMean);
    const effN = Math.max(1, n * bTerm * bTerm);
    const tCrit = tInv((1 + beta) / 2, Math.max(1, dofEffective));
    const toleranceFactor = tCrit * Math.sqrt(1 + 1 / effN);
    const halfWidthPct = toleranceFactor * rsdIpPct;
    const lowerTolerancePct = relativeBiasPct - halfWidthPct;
    const upperTolerancePct = relativeBiasPct + halfWidthPct;
    const withinAcceptance =
      Math.abs(lowerTolerancePct) <= acceptanceLimitPct &&
      Math.abs(upperTolerancePct) <= acceptanceLimitPct;

    levels.push({
      levelLabel: bucket.label,
      referenceMean: refMean,
      n,
      seriesCount: p,
      measuredMean,
      recoveryPct,
      relativeBiasPct,
      sr,
      sL,
      sIp,
      rsdRepeatabilityPct,
      rsdIpPct,
      dofEffective,
      toleranceFactor,
      lowerTolerancePct,
      upperTolerancePct,
      withinAcceptance,
    });
  }

  const passingRefs = levels
    .filter((l) => l.withinAcceptance)
    .map((l) => l.referenceMean);
  const allWithinAcceptance = levels.every((l) => l.withinAcceptance);
  if (!allWithinAcceptance) {
    warnings.push(
      `Um ou mais níveis ultrapassam o limite de aceitação ±${acceptanceLimitPct}% pelo intervalo de tolerância β-expectation (${(beta * 100).toFixed(0)}%).`,
    );
  }
  if (levels.some((l) => l.seriesCount < 2)) {
    warnings.push(
      'Nível(is) com apenas uma série (analista/dia): s_IP igualado ao desvio total sem decomposição inter-séries.',
    );
  }

  return {
    beta,
    acceptanceLimitPct,
    levels,
    allWithinAcceptance,
    lloq: passingRefs.length ? Math.min(...passingRefs) : null,
    uloq: passingRefs.length ? Math.max(...passingRefs) : null,
    reference: REFERENCE,
    warnings,
  };
}
