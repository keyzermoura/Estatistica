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

export interface UncertaintyCorrelationInput {
  /** Identificador (`id`) ou nome (`source`) da primeira grandeza de entrada. */
  sourceA: string;
  /** Identificador (`id`) ou nome (`source`) da segunda grandeza de entrada. */
  sourceB: string;
  /** Coeficiente de correlação r(x_i, x_j) ∈ [−1, 1]. */
  correlation: number;
}

export interface UncertaintyResult {
  items: UncertaintyComputedItem[];
  combined: number;
  expanded: number;
  coverageFactor: number;
  effectiveDof: number | null;
  confidence: number;
  relativeExpanded: number | null;
  covarianceTerm?: number;
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
  correlations: UncertaintyCorrelationInput[] = [],
): UncertaintyResult {
  const warnings: string[] = [];
  const items: UncertaintyComputedItem[] = inputs
    .filter((i) => Number.isFinite(i.value))
    .map((i, index) => {
      const divisor = i.divisor && i.divisor > 0 ? i.divisor : defaultDivisor(i.distribution);
      const sensitivity = i.sensitivity ?? 1;
      const std = i.value / divisor;
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

  const diagVariance = items.reduce((acc, i) => acc + i.contribution * i.contribution, 0);
  let covarianceTerm = 0;
  let hasCorrelation = false;

  if (correlations.length > 0) {
    const findIndex = (key: string): number => {
      const byId = items.findIndex((it) => it.id === key);
      if (byId >= 0) return byId;
      return items.findIndex((it) => it.source === key);
    };
    const seenPairs = new Set<string>();
    for (const corr of correlations) {
      if (!Number.isFinite(corr.correlation) || corr.correlation < -1 || corr.correlation > 1) {
        throw new Error('Coeficiente de correlação r(x_i, x_j) deve estar em [−1, 1].');
      }
      const idxA = findIndex(corr.sourceA);
      const idxB = findIndex(corr.sourceB);
      if (idxA < 0 || idxB < 0) {
        warnings.push(`Correlação ignorada: fonte não encontrada (${corr.sourceA} ↔ ${corr.sourceB}).`);
        continue;
      }
      if (idxA === idxB) {
        throw new Error(`Correlação inválida da fonte "${corr.sourceA}" consigo mesma.`);
      }
      const a = Math.min(idxA, idxB);
      const b = Math.max(idxA, idxB);
      const pairKey = `${a}:${b}`;
      if (seenPairs.has(pairKey)) {
        throw new Error(`Par de correlação duplicado (${corr.sourceA} ↔ ${corr.sourceB}).`);
      }
      seenPairs.add(pairKey);
      if (corr.correlation !== 0) {
        hasCorrelation = true;
        const itemA = items[a];
        const itemB = items[b];
        const signedA = itemA.sensitivity * itemA.stdUncertainty;
        const signedB = itemB.sensitivity * itemB.stdUncertainty;
        covarianceTerm += 2 * signedA * signedB * corr.correlation;
      }
    }
  }

  const combinedVariance = diagVariance + covarianceTerm;
  if (combinedVariance < -1e-12 * Math.max(1, diagVariance)) {
    throw new Error('Matriz de correlação inconsistente: variância combinada negativa.');
  }
  const combined = Math.sqrt(Math.max(0, combinedVariance));
  items.forEach((i) => {
    i.percentContribution = combined > 0 ? (100 * i.contribution * i.contribution) / (combined * combined) : 0;
  });

  // JCGM 100:2008 §G.4.2: fontes Tipo B sem ν informado (null) ou ν = ∞ contribuem com u_i⁴/∞ = 0.
  const isInfiniteB = (i: UncertaintyComputedItem): boolean =>
    i.type === 'B' && (i.dof === null || i.dof === Infinity);

  const denominator = items.reduce((acc, i) => {
    if (i.contribution === 0) return acc;
    if (isInfiniteB(i) || i.dof === Infinity) return acc;
    if (i.dof === null || !Number.isFinite(i.dof) || i.dof <= 0) return acc;
    return acc + i.contribution ** 4 / i.dof;
  }, 0);

  const allDofKnown = items.every(
    (i) =>
      i.contribution === 0 ||
      isInfiniteB(i) ||
      i.dof === Infinity ||
      (i.dof !== null && Number.isFinite(i.dof) && i.dof > 0),
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
  if (hasCorrelation && denominator > 0) {
    warnings.push('Fontes correlacionadas presentes: ν_eff por Welch–Satterthwaite é aproximado (JCGM 100:2008 §5.2).');
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
    ...(hasCorrelation ? { covarianceTerm } : {}),
    method: hasCorrelation
      ? 'GUM (JCGM 100:2008 §5.2): combinação com covariância r(x_i, x_j) + Welch–Satterthwaite'
      : 'GUM: combinação em quadratura + Welch–Satterthwaite',
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

export interface TopDownUncertaintyInput {
  /** Desvio-padrão de precisão intermediária s_IP = u(Rw). */
  intermediatePrecisionSd: number;
  /** Graus de liberdade de s_IP (opcional). */
  intermediatePrecisionDof?: number | null;
  /** Valores medidos no estudo de exatidão/recuperação. */
  measuredValues: number[];
  /** Valores de referência correspondentes. */
  referenceValues: number[];
  /** Incertezas expandidas dos materiais/padrões de referência U_ref (opcional). */
  referenceUncertainties?: number[];
  /** Fator de abrangência k das incertezas de referência (padrão 2). */
  refCoverageFactor?: number;
  /** Nível de confiança para U = k·u_c (padrão 0,95). */
  confidence?: number;
}

export interface TopDownUncertaintyResult {
  uRw: number;
  uBias: number;
  uRef: number;
  meanBias: number;
  sdBias: number;
  rmsBias: number;
  nBias: number;
  combined: number;
  expanded: number;
  coverageFactor: number;
  effectiveDof: number | null;
  confidence: number;
  items: UncertaintyInputItem[];
  uncertainty: UncertaintyResult;
  method: string;
  reference: string;
  warnings: string[];
}

/**
 * Incerteza Top-Down a partir de precisão intermediária e tendência/recuperação
 * intralaboratoriais:
 *   u(bias) = √(b̄² + s_b²/n_b + u(C_ref)²)
 *   u_c     = √(u(Rw)² + u(bias)²)
 *
 * Referências: Eurachem/CITAC (2026); QUAM (2012); ISO 11352:2012; Nordtest TR 537.
 */
export function computeTopDownUncertainty(
  input: TopDownUncertaintyInput,
): TopDownUncertaintyResult {
  const confidence = input.confidence ?? 0.95;
  const kRef = input.refCoverageFactor && input.refCoverageFactor > 0 ? input.refCoverageFactor : 2;
  if (!Number.isFinite(input.intermediatePrecisionSd) || input.intermediatePrecisionSd < 0) {
    throw new Error('O desvio-padrão de precisão intermediária u(Rw) deve ser um número não negativo.');
  }
  const nPairs = Math.min(input.measuredValues.length, input.referenceValues.length);
  const diffs: number[] = [];
  for (let i = 0; i < nPairs; i++) {
    const m = input.measuredValues[i];
    const r = input.referenceValues[i];
    if (Number.isFinite(m) && Number.isFinite(r)) {
      diffs.push(m - r);
    }
  }
  const refUn = (input.referenceUncertainties ?? []).filter(
    (u) => Number.isFinite(u) && u > 0,
  );
  const uRef = refUn.length
    ? Math.sqrt(refUn.reduce((acc, u) => acc + (u / kRef) ** 2, 0) / refUn.length)
    : 0;

  const nBias = diffs.length;
  const meanBias = nBias > 0 ? mean(diffs) : 0;
  const sdBias = nBias > 1 ? sd(diffs) : 0;
  const rmsBias =
    nBias > 0 ? Math.sqrt(diffs.reduce((acc, d) => acc + d * d, 0) / nBias) : 0;
  const uBias =
    nBias > 0
      ? Math.sqrt(meanBias * meanBias + (sdBias * sdBias) / nBias + uRef * uRef)
      : uRef;
  const uRw = input.intermediatePrecisionSd;
  const warnings: string[] = [];
  if (nBias === 0) {
    warnings.push(
      'Sem pares medido × referência para estimar u(bias); componente de tendência baseada apenas em u(C_ref).',
    );
  } else if (nBias < 6) {
    warnings.push(
      `Apenas ${nBias} medição(ões) de tendência/recuperação; recomenda-se n ≥ 6 para u(bias) robusto.`,
    );
  }

  const items: UncertaintyInputItem[] = [
    {
      source: 'Precisão Intermediária u(Rw) — Eurachem Top-Down',
      type: 'A',
      distribution: 'normal',
      value: uRw,
      divisor: 1,
      sensitivity: 1,
      dof:
        input.intermediatePrecisionDof !== undefined &&
        input.intermediatePrecisionDof !== null &&
        Number.isFinite(input.intermediatePrecisionDof) &&
        input.intermediatePrecisionDof > 0
          ? input.intermediatePrecisionDof
          : null,
      notes: `s_IP = ${uRw.toPrecision(4)} (ISO 11352 / Nordtest TR 537)`,
    },
    {
      source: 'Tendência / Recuperação u(bias) — Eurachem Top-Down',
      type: 'B',
      distribution: 'normal',
      value: uBias,
      divisor: 1,
      sensitivity: 1,
      dof: null,
      notes: `b̄ = ${meanBias.toPrecision(4)}; s_b = ${sdBias.toPrecision(4)}; n = ${nBias}; RMS_bias = ${rmsBias.toPrecision(4)}; u(C_ref) = ${uRef.toPrecision(4)}`,
    },
  ];

  const uncertainty = computeUncertainty(items, confidence);
  return {
    uRw,
    uBias,
    uRef,
    meanBias,
    sdBias,
    rmsBias,
    nBias,
    combined: uncertainty.combined,
    expanded: uncertainty.expanded,
    coverageFactor: uncertainty.coverageFactor,
    effectiveDof: uncertainty.effectiveDof,
    confidence,
    items,
    uncertainty,
    method: 'Abordagem Top-Down Intralaboratorial: u_c = √(u(Rw)² + u(bias)²)',
    reference:
      'EURACHEM/CITAC (2026); QUAM (2012); ISO 11352:2012; Nordtest TR 537',
    warnings: [...new Set([...warnings, ...uncertainty.warnings])],
  };
}

export interface SamplingDuplicateObservation {
  target: string;
  subsample: string;
  value: number;
}

export interface SamplingDuplicateUncertaintyResult {
  targets: number;
  subsamples: number;
  observations: number;
  betweenTargetSd: number;
  uSampling: number;
  uAnalytical: number;
  uCombined: number;
  pctSampling: number;
  pctAnalytical: number;
  coverageFactor: number;
  expanded: number;
  confidence: number;
  items: UncertaintyInputItem[];
  method: string;
  reference: string;
  warnings: string[];
}

/**
 * Incerteza decorrente da amostragem pelo delineamento duplicado balanceado
 * (Alvo/Lote > Subamostra/Duplicata de amostragem > Réplica analítica).
 *
 * Referência: EURACHEM / CITAC / Nordtest Guide — Measurement Uncertainty Arising
 * from Sampling (UfS), 2ª ed., 2019.
 */
export function computeSamplingDuplicateUncertainty(
  samples: SamplingDuplicateObservation[],
  confidence = 0.95,
): SamplingDuplicateUncertaintyResult {
  const valid = samples.filter(
    (s) => s.target.trim() !== '' && s.subsample.trim() !== '' && Number.isFinite(s.value),
  );
  if (valid.length < 4) {
    throw new Error('O delineamento duplicado de amostragem requer pelo menos 4 observações válidas.');
  }

  const byTarget = new Map<string, Map<string, number[]>>();
  for (const row of valid) {
    let bySub = byTarget.get(row.target);
    if (!bySub) {
      bySub = new Map();
      byTarget.set(row.target, bySub);
    }
    const list = bySub.get(row.subsample) ?? [];
    list.push(row.value);
    bySub.set(row.subsample, list);
  }

  const allValues = valid.map((v) => v.value);
  const grandMean = mean(allValues);
  const targetMeans: Array<{ n: number; m: number }> = [];
  let ssTarget = 0;
  let ssSampling = 0;
  let dfSampling = 0;
  let ssAnalytical = 0;
  let dfAnalytical = 0;
  let totalSubsamples = 0;
  const analGroupSizes: number[] = [];

  for (const bySub of byTarget.values()) {
    const targetVals: number[] = [];
    const subEntries: Array<{ m: number; n: number }> = [];
    for (const vals of bySub.values()) {
      totalSubsamples += 1;
      analGroupSizes.push(vals.length);
      const sm = mean(vals);
      subEntries.push({ m: sm, n: vals.length });
      for (const v of vals) {
        targetVals.push(v);
        ssAnalytical += (v - sm) ** 2;
      }
      if (vals.length > 1) dfAnalytical += vals.length - 1;
    }
    const tm = mean(targetVals);
    targetMeans.push({ n: targetVals.length, m: tm });
    ssTarget += targetVals.length * (tm - grandMean) ** 2;
    for (const sub of subEntries) {
      ssSampling += sub.n * (sub.m - tm) ** 2;
    }
    if (subEntries.length > 1) dfSampling += subEntries.length - 1;
  }

  const dfTarget = byTarget.size - 1;
  const warnings: string[] = [];
  if (byTarget.size < 2 || dfSampling < 1 || dfAnalytical < 1) {
    throw new Error(
      'São necessários pelo menos 2 alvos, ≥ 2 duplicatas de amostragem por alvo e ≥ 2 réplicas analíticas para separar u_sampling de u_analytical.',
    );
  }
  if (byTarget.size < 8) {
    warnings.push(
      `Apenas ${byTarget.size} alvos avaliados; o guia Eurachem UfS (2019) recomenda ao menos 8 alvos em duplicata para estimar u(amostragem).`,
    );
  }

  const msTarget = ssTarget / dfTarget;
  const msSampling = ssSampling / dfSampling;
  const msAnalytical = ssAnalytical / dfAnalytical;

  const avgRepsPerSub = valid.length / totalSubsamples;
  const avgSubsPerTarget = totalSubsamples / byTarget.size;

  const varAnalytical = Math.max(0, msAnalytical);
  const varSampling = Math.max(0, (msSampling - msAnalytical) / avgRepsPerSub);
  const varBetweenTarget = Math.max(
    0,
    (msTarget - msSampling) / (avgSubsPerTarget * avgRepsPerSub),
  );

  const uSampling = Math.sqrt(varSampling);
  const uAnalytical = Math.sqrt(varAnalytical);
  const betweenTargetSd = Math.sqrt(varBetweenTarget);
  const uCombined = Math.sqrt(varSampling + varAnalytical);
  const pctSampling = uCombined > 0 ? (100 * varSampling) / (uCombined * uCombined) : 0;
  const pctAnalytical = uCombined > 0 ? (100 * varAnalytical) / (uCombined * uCombined) : 0;

  const items: UncertaintyInputItem[] = [
    {
      source: 'Amostragem u(samp) — Eurachem UfS',
      type: 'A',
      distribution: 'normal',
      value: uSampling,
      divisor: 1,
      sensitivity: 1,
      dof: dfSampling,
      notes: `${pctSampling.toFixed(1)}% da variância combinada de medição`,
    },
    {
      source: 'Análise u(anal) — Eurachem UfS',
      type: 'A',
      distribution: 'normal',
      value: uAnalytical,
      divisor: 1,
      sensitivity: 1,
      dof: dfAnalytical,
      notes: `${pctAnalytical.toFixed(1)}% da variância combinada de medição`,
    },
  ];
  const uRes = computeUncertainty(items, confidence);

  return {
    targets: byTarget.size,
    subsamples: totalSubsamples,
    observations: valid.length,
    betweenTargetSd,
    uSampling,
    uAnalytical,
    uCombined: uRes.combined,
    pctSampling,
    pctAnalytical,
    coverageFactor: uRes.coverageFactor,
    expanded: uRes.expanded,
    confidence,
    items,
    method: 'Delineamento Duplicado Balanceado (ANOVA Aninhada: Amostragem × Análise)',
    reference: 'EURACHEM / CITAC / Nordtest Guide — UfS (2ª ed., 2019)',
    warnings: [...new Set([...warnings, ...uRes.warnings])],
  };
}
