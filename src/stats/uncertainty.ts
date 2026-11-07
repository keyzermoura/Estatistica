/**
 * Orçamento de incerteza de medição — GUM / JCGM 100:2008.
 *
 * u_i = valor / divisor (Tipo B) ou desvio-padrão da média (Tipo A)
 * u_c = √Σ(c_i·u_i)²
 * ν_eff = u_c⁴ / Σ(u_i⁴/ν_i)  (Welch–Satterthwaite)
 * U = k·u_c, com k = t(1−α/2, ν_eff) quando ν_eff é finito, senão k = 2.
 *
 * Referências: JCGM 100:2008 (GUM); JCGM 101:2008; EURACHEM/CITAC (2012).
 */

import { mean, sd } from './descriptive';
import { tInv } from './distributions';
import type { UncertaintyDistribution, UncertaintyType } from '../lib/types';

export interface UncertaintyInputItem {
  id?: string;
  source: string;
  type: UncertaintyType;
  distribution: UncertaintyDistribution;
  value: number;
  divisor?: number;
  sensitivity?: number;
  dof?: number | null;
  notes?: string;
}

export interface UncertaintyComputedItem {
  id: string;
  source: string;
  type: UncertaintyType;
  distribution: UncertaintyDistribution;
  value: number;
  divisor: number;
  sensitivity: number;
  stdUncertainty: number;
  contribution: number;
  percentContribution: number;
  dof: number | null;
  notes: string;
}

export interface UncertaintyResult {
  items: UncertaintyComputedItem[];
  combined: number;
  expanded: number;
  coverageFactor: number;
  effectiveDof: number | null;
  confidence: number;
  relativeExpanded: number | null;
  method: string;
  reference: string;
  warnings: string[];
}

export function defaultDivisor(distribution: UncertaintyDistribution): number {
  switch (distribution) {
    case 'rectangular':
      return Math.sqrt(3);
    case 'triangular':
      return Math.sqrt(6);
    case 'u_shaped':
      return Math.SQRT2;
    case 'normal':
    case 'none':
    default:
      return 1;
  }
}

/** Incerteza padrão de uma fonte Tipo B. */
export function standardUncertainty(
  value: number,
  distribution: UncertaintyDistribution,
  divisor?: number,
): number {
  const d = divisor && divisor > 0 ? divisor : defaultDivisor(distribution);
  return value / d;
}

export function computeUncertainty(
  inputs: UncertaintyInputItem[],
  confidence = 0.95,
): UncertaintyResult {
  const warnings: string[] = [];
  const items: UncertaintyComputedItem[] = inputs
    .filter((i) => Number.isFinite(i.value))
    .map((i, index) => {
      const divisor = i.divisor && i.divisor > 0 ? i.divisor : defaultDivisor(i.distribution);
      const sensitivity = i.sensitivity ?? 1;
      const std = (i.value / divisor) * (i.type === 'A' ? 1 : 1);
      return {
        id: i.id ?? `u-${index + 1}`,
        source: i.source,
        type: i.type,
        distribution: i.distribution,
        value: i.value,
        divisor,
        sensitivity,
        stdUncertainty: std,
        contribution: Math.abs(sensitivity) * std,
        percentContribution: 0,
        dof: i.dof ?? null,
        notes: i.notes ?? '',
      };
    });
  const combined = Math.sqrt(
    items.reduce((acc, i) => acc + i.contribution * i.contribution, 0),
  );
  items.forEach((i) => {
    i.percentContribution = combined > 0 ? (100 * i.contribution * i.contribution) / (combined * combined) : 0;
  });
  const denominator = items.reduce((acc, i) => {
    if (i.contribution === 0) return acc;
    if (i.dof === null || !Number.isFinite(i.dof) || i.dof <= 0) return acc;
    return acc + i.contribution ** 4 / i.dof;
  }, 0);
  const allDofKnown = items.every(
    (i) => i.contribution === 0 || (i.dof !== null && Number.isFinite(i.dof) && i.dof > 0),
  );
  const effectiveDof =
    denominator > 0 && combined > 0
      ? combined ** 4 / denominator
      : allDofKnown
        ? 1e6
        : null;
  const coverageFactor =
    effectiveDof !== null && Number.isFinite(effectiveDof)
      ? tInv(1 - (1 - confidence) / 2, Math.max(1, Math.round(effectiveDof)))
      : 2;
  const expanded = coverageFactor * combined;
  if (effectiveDof === null) {
    warnings.push('Graus de liberdade não informados em todas as fontes; adotado k = 2 (≈95%).');
  } else if (effectiveDof < 10) {
    warnings.push(`ν_eff = ${effectiveDof.toFixed(1)} < 10: o fator de abrangência t é sensível à estimativa.`);
  }
  if (items.length === 0) warnings.push('Nenhuma fonte de incerteza informada.');
  if (items.some((i) => i.type === 'A' && i.dof === null)) {
    warnings.push('Fontes Tipo A devem informar graus de liberdade (n − 1).');
  }
  return {
    items,
    combined,
    expanded,
    coverageFactor,
    effectiveDof,
    confidence,
    relativeExpanded: null,
    method: 'GUM: combinação em quadratura + Welch–Satterthwaite',
    reference: 'JCGM 100:2008 (GUM), cláusulas 5 e G; EURACHEM/CITAC (2012)',
    warnings,
  };
}

/** Incerteza Tipo A a partir de réplicas: s/√n, ν = n − 1. */
export function typeAFromReplicates(
  values: number[],
  source = 'Repetibilidade (Tipo A)',
): UncertaintyInputItem {
  const n = values.length;
  const s = n > 1 ? sd(values) : NaN;
  return {
    source,
    type: 'A',
    distribution: 'normal',
    value: n > 1 ? s / Math.sqrt(n) : NaN,
    divisor: 1,
    sensitivity: 1,
    dof: Math.max(1, n - 1),
    notes: `s = ${Number.isFinite(s) ? s.toPrecision(4) : '—'}; n = ${n}`,
  };
}

/** Incerteza Tipo A a partir do desvio-padrão combinado de precisão intermediária. */
export function typeAFromPrecision(
  sdPooled: number,
  n: number,
  source = 'Precisão intermediária (Tipo A)',
): UncertaintyInputItem {
  return {
    source,
    type: 'A',
    distribution: 'normal',
    value: sdPooled / Math.sqrt(Math.max(1, n)),
    divisor: 1,
    sensitivity: 1,
    dof: Math.max(1, n - 1),
    notes: `s = ${sdPooled.toPrecision(4)}; n = ${n}`,
  };
}

/** Incerteza Tipo B retangular a partir de um limite (semi-amplitude). */
export function typeBRectangular(
  source: string,
  halfWidth: number,
  dof: number | null = null,
  notes = '',
): UncertaintyInputItem {
  return {
    source,
    type: 'B',
    distribution: 'rectangular',
    value: halfWidth,
    divisor: Math.sqrt(3),
    sensitivity: 1,
    dof,
    notes,
  };
}

/** Incerteza Tipo B normal a partir de uma incerteza expandida e k. */
export function typeBNormal(
  source: string,
  expanded: number,
  k = 2,
  dof: number | null = null,
  notes = '',
): UncertaintyInputItem {
  return {
    source,
    type: 'B',
    distribution: 'normal',
    value: expanded,
    divisor: k,
    sensitivity: 1,
    dof,
    notes,
  };
}

/** Incerteza combinada relativa de uma medição, para propagação. */
export function relativeUncertainty(result: UncertaintyResult, value: number): number | null {
  if (!(value > 0) || !Number.isFinite(result.expanded)) return null;
  return result.expanded / value;
}

/** Incerteza padrão da média de um conjunto (Tipo A), com IC. */
export function meanUncertainty(values: number[], confidence = 0.95): {
  mean: number;
  sd: number;
  sem: number;
  dof: number;
  coverageFactor: number;
  expanded: number;
  ciLow: number;
  ciHigh: number;
} {
  const n = values.length;
  const m = mean(values);
  const s = n > 1 ? sd(values) : NaN;
  const sem = s / Math.sqrt(n);
  const dof = n - 1;
  const k = tInv(1 - (1 - confidence) / 2, Math.max(1, dof));
  return {
    mean: m,
    sd: s,
    sem,
    dof,
    coverageFactor: k,
    expanded: k * sem,
    ciLow: m - k * sem,
    ciHigh: m + k * sem,
  };
}
