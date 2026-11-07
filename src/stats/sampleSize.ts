/**
 * Módulo 3 — Cálculo de tamanho de amostra e poder.
 *
 * Todas as fórmulas são explícitas e rastreáveis. Referências:
 *  - ISO 5725-1/2 (exatidão e precisão)
 *  - ISO 3534-1 (vocabulário)
 *  - Montgomery & Runger, Applied Statistics and Probability for Engineers
 *  - Cohen, Statistical Power Analysis for the Behavioral Sciences (1988)
 *  - Chow, Shao & Wang, Sample Size Calculations in Clinical Research (2008)
 *  - GUM/JCGM 100:2008 (para incerteza; ver uncertainty.ts)
 *
 * Convenção: `nPerGroup` é o número de medições por condição/grupo; `total`
 * é o número total de medições. Para testes de uma amostra, groups = 1.
 */

import {
  fCdf,
  fInv,
  normalInv,
  noncentralFCdf,
  noncentralTCdf,
  tCdf,
  tInv,
} from './distributions';
import type { SampleSizeMethod } from '../lib/types';

export type TestDesign = 'one_sample' | 'two_sample' | 'paired';

export interface SampleSizeOptions {
  alpha?: number;
  power?: number;
  confidence?: number;
  sides?: 1 | 2;
  design?: TestDesign;
}

export interface SampleSizeResult {
  method: SampleSizeMethod;
  nPerGroup: number | null;
  groups: number | null;
  total: number;
  power: number | null;
  precision: number | null;
  formula: string;
  reference: string;
  assumptions: string[];
  notes: string[];
}

const DEFAULT_ALPHA = 0.05;
const DEFAULT_POWER = 0.8;
const DEFAULT_CONFIDENCE = 0.95;
const MAX_N = 100000;

function clampProb(p: number, fallback: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return fallback;
  return p;
}

function zCrit(alpha: number, sides: 1 | 2): number {
  return normalInv(1 - alpha / sides);
}

/** Busca binária do menor n inteiro que atinge o poder alvo. */
export function findN(
  powerAt: (n: number) => number,
  targetPower: number,
  minN = 3,
  maxN = MAX_N,
): number {
  const target = clampProb(targetPower, DEFAULT_POWER);
  let lo = minN;
  let hi = minN;
  while (hi < maxN && powerAt(hi) < target) {
    lo = hi + 1;
    hi = Math.min(maxN, hi * 2);
  }
  if (powerAt(hi) < target) return maxN;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (powerAt(mid) >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Precisão (semi-amplitude) do IC da média para um n. */
export function meanCIPrecision(
  n: number,
  sigma: number,
  confidence = DEFAULT_CONFIDENCE,
): number {
  if (n < 2 || sigma <= 0) return Infinity;
  const t = tInv(1 - (1 - confidence) / 2, n - 1);
  return (t * sigma) / Math.sqrt(n);
}

/**
 * n para estimar a média com semi-amplitude E e confiança (1-α).
 * Resolve n = (t_{n-1,1-α/2} · σ / E)² por ponto fixo.
 */
export function sampleSizeMeanCI(
  sigma: number,
  margin: number,
  confidence = DEFAULT_CONFIDENCE,
): SampleSizeResult {
  const conf = clampProb(confidence, DEFAULT_CONFIDENCE);
  if (!(sigma > 0) || !(margin > 0)) {
    return {
      method: 'mean_ci',
      nPerGroup: null,
      groups: null,
      total: 0,
      power: null,
      precision: null,
      formula: 'n = (t₁₋α/₂, n−1 · σ / E)²',
      reference: 'ISO 3534-1; Montgomery & Runger, cap. 8',
      assumptions: ['σ conhecido ou estimado por dados piloto', 'Observações independentes'],
      notes: ['Informe σ > 0 e a semi-amplitude E > 0 para calcular.'],
    };
  }
  const z = zCrit(1 - conf, 2);
  let n = Math.max(2, Math.ceil(((z * sigma) / margin) ** 2));
  for (let i = 0; i < 100; i++) {
    const t = tInv(1 - (1 - conf) / 2, n - 1);
    const next = Math.max(2, Math.ceil(((t * sigma) / margin) ** 2));
    if (next <= n) break;
    n = next;
  }
  const precision = meanCIPrecision(n, sigma, conf);
  return {
    method: 'mean_ci',
    nPerGroup: null,
    groups: null,
    total: n,
    power: null,
    precision,
    formula: 'n = (t₁₋α/₂, n−1 · σ / E)², arredondado para cima',
    reference: 'ISO 3534-1; Montgomery & Runger, cap. 8; Chow et al. (2008)',
    assumptions: [
      'σ conhecido ou estimado por dados piloto',
      'Observações independentes e aproximadamente normais',
      `Confiança de ${(conf * 100).toFixed(1)}%`,
    ],
    notes: [
      `A semi-amplitude alcançada com n = ${n} é ${precision.toPrecision(4)} (alvo ${margin}).`,
    ],
  };
}

/** Poder do teste t para um n por grupo. */
export function powerTTest(
  nPerGroup: number,
  delta: number,
  sigma: number,
  options: SampleSizeOptions = {},
): number {
  const alpha = clampProb(options.alpha ?? DEFAULT_ALPHA, DEFAULT_ALPHA);
  const sides = options.sides ?? 2;
  const design = options.design ?? 'two_sample';
  if (nPerGroup < 2 || sigma <= 0 || delta === 0) return alpha;
  const df =
    design === 'two_sample' ? 2 * nPerGroup - 2 : nPerGroup - 1;
  const se =
    design === 'two_sample'
      ? sigma * Math.sqrt(2 / nPerGroup)
      : sigma / Math.sqrt(nPerGroup);
  const ncp = Math.abs(delta) / se;
  const tcrit = tInv(1 - alpha / sides, df);
  if (sides === 2) {
    return Math.min(
      1,
      Math.max(0, 1 - noncentralTCdf(tcrit, df, ncp) + noncentralTCdf(-tcrit, df, ncp)),
    );
  }
  return Math.min(1, Math.max(0, 1 - noncentralTCdf(tcrit, df, ncp)));
}

/**
 * n por grupo para teste t de uma ou duas amostras.
 * Usa a distribuição t não central (poder exato), não apenas a aproximação normal.
 */
export function sampleSizeTTest(
  delta: number,
  sigma: number,
  options: SampleSizeOptions = {},
): SampleSizeResult {
  const alpha = clampProb(options.alpha ?? DEFAULT_ALPHA, DEFAULT_ALPHA);
  const target = clampProb(options.power ?? DEFAULT_POWER, DEFAULT_POWER);
  const sides = options.sides ?? 2;
  const design = options.design ?? 'two_sample';
  const groups = design === 'two_sample' ? 2 : 1;
  if (!(delta > 0) || !(sigma > 0)) {
    return {
      method: 't_test',
      nPerGroup: null,
      groups,
      total: 0,
      power: null,
      precision: null,
      formula: 'n = menor inteiro com poder t não central ≥ 1−β',
      reference: 'Chow, Shao & Wang (2008); Montgomery & Runger',
      assumptions: ['Normalidade', 'Variâncias iguais (duas amostras)', 'Independência'],
      notes: ['Informe diferença mínima detectável e σ maiores que zero.'],
    };
  }
  const powerAt = (n: number) =>
    powerTTest(n, delta, sigma, { alpha, sides, design });
  const n = findN(powerAt, target, 2);
  const achieved = powerAt(n);
  return {
    method: 't_test',
    nPerGroup: n,
    groups,
    total: n * groups,
    power: achieved,
    precision: null,
    formula:
      'Poder = 1 − F_{t′}(t_crítico; ν, δ) + F_{t′}(−t_crítico; ν, δ), δ = |Δ|/EP',
    reference: 'Chow, Shao & Wang (2008), cap. 2; R power.t.test',
    assumptions: [
      'Observações independentes e normais',
      design === 'two_sample' ? 'Variâncias iguais entre grupos' : 'Uma amostra (ou diferenças pareadas)',
      `α = ${alpha} (${sides === 1 ? 'unilateral' : 'bilateral'}), poder alvo = ${(target * 100).toFixed(0)}%`,
    ],
    notes: [
      `n = ${n} por grupo; poder alcançado = ${(achieved * 100).toFixed(1)}%.`,
      'Se a normalidade for rejeitada, considere teste não paramétrico e recalcule o poder por simulação.',
    ],
  };
}

/** Poder do TOST (equivalência) para um n por grupo, diferença verdadeira 0. */
export function powerTOST(
  nPerGroup: number,
  margin: number,
  sigma: number,
  options: SampleSizeOptions = {},
): number {
  const alpha = clampProb(options.alpha ?? DEFAULT_ALPHA, DEFAULT_ALPHA);
  const design = options.design ?? 'two_sample';
  if (nPerGroup < 2 || sigma <= 0 || margin <= 0) return 0;
  const df = design === 'two_sample' ? 2 * nPerGroup - 2 : nPerGroup - 1;
  const se =
    design === 'two_sample'
      ? sigma * Math.sqrt(2 / nPerGroup)
      : sigma / Math.sqrt(nPerGroup);
  const delta = margin / se;
  const tcrit = tInv(1 - alpha, df);
  // P(−tcrit + δ < T < tcrit − δ), T ~ t central.
  return Math.min(1, Math.max(0, tCdf(delta - tcrit, df) - tCdf(-delta + tcrit, df)));
}

/**
 * n por grupo para TOST com margem de equivalência.
 * Fórmula exata: poder = F_t(δ − t_crítico) − F_t(−δ + t_crítico).
 */
export function sampleSizeTOST(
  margin: number,
  sigma: number,
  options: SampleSizeOptions = {},
): SampleSizeResult {
  const alpha = clampProb(options.alpha ?? DEFAULT_ALPHA, DEFAULT_ALPHA);
  const target = clampProb(options.power ?? DEFAULT_POWER, DEFAULT_POWER);
  const design = options.design ?? 'two_sample';
  const groups = design === 'two_sample' ? 2 : 1;
  if (!(margin > 0) || !(sigma > 0)) {
    return {
      method: 'tost',
      nPerGroup: null,
      groups,
      total: 0,
      power: null,
      precision: null,
      formula: 'Poder = F_t(δ − t_cr) − F_t(−δ + t_cr), δ = margem/EP',
      reference: 'Chow, Shao & Wang (2008); Schuirmann (1987)',
      assumptions: ['Normalidade', 'Diferença verdadeira nula', 'Margem definida a priori'],
      notes: ['Informe margem de equivalência e σ maiores que zero.'],
    };
  }
  const powerAt = (n: number) => powerTOST(n, margin, sigma, { alpha, design });
  const n = findN(powerAt, target, 3);
  const achieved = powerAt(n);
  return {
    method: 'tost',
    nPerGroup: n,
    groups,
    total: n * groups,
    power: achieved,
    precision: null,
    formula:
      'Poder = F_t(δ − t₁₋α,ν) − F_t(−δ + t₁₋α,ν), δ = margem/EP; ν = n−1 ou 2n−2',
    reference: 'Schuirmann (1987); Chow, Shao & Wang (2008), cap. 3; FDA/ICH E9',
    assumptions: [
      'Normalidade e independência',
      'A diferença verdadeira é zero (cenário conservador para equivalência)',
      `α unilateral = ${alpha} em cada teste; margem = ${margin}`,
    ],
    notes: [
      `n = ${n} por grupo; poder alcançado = ${(achieved * 100).toFixed(1)}%.`,
      'O TOST exige que o IC 1−2α fique inteiramente dentro de ±margem.',
    ],
  };
}

/** Poder do teste F para razão de variâncias (duas amostras iguais). */
export function powerVarianceRatio(
  nPerGroup: number,
  ratio: number,
  alpha = DEFAULT_ALPHA,
  sides: 1 | 2 = 2,
): number {
  if (nPerGroup < 2 || ratio <= 0) return 0;
  const df = nPerGroup - 1;
  if (sides === 2) {
    const fLow = fInv(alpha / 2, df, df);
    const fHigh = fInv(1 - alpha / 2, df, df);
    return Math.min(
      1,
      Math.max(0, fCdf(fLow / (ratio * ratio), df, df) + 1 - fCdf(fHigh / (ratio * ratio), df, df)),
    );
  }
  const fHigh = fInv(1 - alpha, df, df);
  return Math.min(1, Math.max(0, 1 - fCdf(fHigh / (ratio * ratio), df, df)));
}

/**
 * n por grupo para detectar razão de variâncias σ₁/σ₂.
 * Poder exato via F central: F sob H1 = r² · F_{ν,ν}.
 */
export function sampleSizeVarianceRatio(
  ratio: number,
  alpha = DEFAULT_ALPHA,
  power = DEFAULT_POWER,
  sides: 1 | 2 = 2,
): SampleSizeResult {
  const target = clampProb(power, DEFAULT_POWER);
  if (!(ratio > 0) || ratio === 1) {
    return {
      method: 'variance_ratio',
      nPerGroup: null,
      groups: 2,
      total: 0,
      power: null,
      precision: null,
      formula: 'F sob H₁ = r² · F_{ν,ν}, r = σ₁/σ₂',
      reference: 'Montgomery & Runger, cap. 9; ISO 5725-2 (precisão)',
      assumptions: ['Normalidade', 'Amostras independentes', 'Razão de variâncias especificada'],
      notes: ['Informe uma razão diferente de 1.'],
    };
  }
  const powerAt = (n: number) => powerVarianceRatio(n, ratio, alpha, sides);
  const n = findN(powerAt, target, 2);
  const achieved = powerAt(n);
  return {
    method: 'variance_ratio',
    nPerGroup: n,
    groups: 2,
    total: 2 * n,
    power: achieved,
    precision: null,
    formula:
      'Poder = P(F < f_inf/r²) + P(F > f_sup/r²), F ~ F_{n−1,n−1}; r = σ₁/σ₂',
    reference: 'Montgomery & Runger, cap. 9; ISO 5725-2',
    assumptions: ['Normalidade', 'Independência', 'Razão de variâncias r especificada'],
    notes: [
      `n = ${n} por grupo; poder alcançado = ${(achieved * 100).toFixed(1)}%.`,
      'Este cálculo é útil para comparar precisões (ex.: dois analistas ou dois métodos).',
    ],
  };
}

/** Poder da ANOVA de um fator (k grupos, n por grupo), efeito f de Cohen. */
export function powerAnova(
  nPerGroup: number,
  k: number,
  f: number,
  alpha = DEFAULT_ALPHA,
): number {
  if (nPerGroup < 2 || k < 2 || f <= 0) return 0;
  const df1 = k - 1;
  const df2 = k * (nPerGroup - 1);
  const lambda = nPerGroup * k * f * f;
  const fcrit = fInv(1 - alpha, df1, df2);
  return Math.min(1, Math.max(0, 1 - noncentralFCdf(fcrit, df1, df2, lambda)));
}

/**
 * n por grupo para ANOVA de um fator.
 * f de Cohen = desvio-padrão das médias / σ; λ = n·k·f².
 */
export function sampleSizeAnova(
  k: number,
  f: number,
  alpha = DEFAULT_ALPHA,
  power = DEFAULT_POWER,
): SampleSizeResult {
  const target = clampProb(power, DEFAULT_POWER);
  if (k < 2 || !(f > 0)) {
    return {
      method: 'anova',
      nPerGroup: null,
      groups: k,
      total: 0,
      power: null,
      precision: null,
      formula: 'λ = n·k·f²; poder = P(F′ > F_crítico)',
      reference: 'Cohen (1988); Montgomery & Runger, cap. 13',
      assumptions: ['Normalidade', 'Homogeneidade de variâncias', 'Independência'],
      notes: ['Informe k ≥ 2 e f > 0.'],
    };
  }
  const powerAt = (n: number) => powerAnova(n, k, f, alpha);
  const n = findN(powerAt, target, 2);
  const achieved = powerAt(n);
  return {
    method: 'anova',
    nPerGroup: n,
    groups: k,
    total: n * k,
    power: achieved,
    precision: null,
    formula: 'λ = n·k·f²; poder = 1 − F_{F′}(F_crítico; k−1, k(n−1), λ)',
    reference: 'Cohen (1988), cap. 8; Montgomery & Runger, cap. 13',
    assumptions: [
      'Normalidade e homogeneidade de variâncias',
      'Efeito f de Cohen = DP das médias / σ',
      `α = ${alpha}, poder alvo = ${(target * 100).toFixed(0)}%`,
    ],
    notes: [
      `n = ${n} por grupo; poder alcançado = ${(achieved * 100).toFixed(1)}%.`,
      'Para k = 2, f = d/2 e o resultado coincide com o teste t de duas amostras.',
    ],
  };
}

/** n para estimar σ com erro relativo padrão desejado. */
export function sampleSizeRelativeSd(
  relativeError = 0.2,
): SampleSizeResult {
  const rel = relativeError > 0 ? relativeError : 0.2;
  const n = Math.max(3, Math.ceil(1 + 1 / (2 * rel * rel)));
  return {
    method: 'relative_sd',
    nPerGroup: n,
    groups: 1,
    total: n,
    power: null,
    precision: rel,
    formula: 'EP(s)/s ≈ 1/√(2(n−1)) ⇒ n = 1 + 1/(2·erro_relativo²)',
    reference: 'ISO 5725-2; Montgomery & Runger, cap. 7; ASTM E691',
    assumptions: [
      'Normalidade para a aproximação de s',
      'Erro relativo padrão, não semi-amplitude de IC',
    ],
    notes: [
      `n = ${n} para erro relativo padrão de ${(rel * 100).toFixed(1)}% em s.`,
      'Se o laboratório precisar de IC de 95% para σ, o n será maior (use a opção de IC).',
    ],
  };
}

/** n para IC de 95% da média com erro relativo (usado em orientação). */
export function sampleSizeRelativeMean(relativeError = 0.1, confidence = 0.95): number {
  const z = zCrit(1 - confidence, 2);
  return Math.max(2, Math.ceil((z / relativeError) ** 2));
}

/**
 * Delineamento ISO 5725-2: p laboratórios × n replicatas × q níveis.
 * Calcula a incerteza relativa esperada de s_r e s_R e recomenda p/n.
 *
 * Suposições: componentes independentes; s_L = r·s_r; estimativas balanceadas.
 */
export interface Iso5725SampleResult {
  p: number;
  n: number;
  q: number;
  total: number;
  dofRepeatability: number;
  dofReproducibility: number;
  relativeSeRepeatability: number;
  relativeSeReproducibility: number;
  recommendedP: number;
  recommendedN: number;
  targetRelativeError: number;
  formula: string;
  reference: string;
  assumptions: string[];
  notes: string[];
}

export function iso5725SampleSize(
  p: number,
  n: number,
  q: number,
  betweenLabRatio = 1,
  targetRelativeError = 0.2,
): Iso5725SampleResult {
  const labs = Math.max(3, Math.round(p));
  const reps = Math.max(2, Math.round(n));
  const levels = Math.max(1, Math.round(q));
  const r = Math.max(0, betweenLabRatio);
  const target = targetRelativeError > 0 ? targetRelativeError : 0.2;
  const dofR = labs * (reps - 1);
  const dofL = Math.max(1, labs - 1);
  const relR = 1 / Math.sqrt(2 * Math.max(1, dofR));
  const relRepro = 1 / Math.sqrt(
    2 *
      Math.max(
        1,
        ((1 + r * r) ** 2) /
          (1 / Math.max(1, dofR) + (r ** 4) / Math.max(1, dofL)),
      ),
  );
  let bestP = labs;
  let bestN = reps;
  let bestTotal = labs * reps * levels;
  for (let pp = 6; pp <= 30; pp++) {
    for (let nn = 2; nn <= 10; nn++) {
      const dR = pp * (nn - 1);
      const rel = 1 / Math.sqrt(2 * Math.max(1, dR));
      const relR2 = 1 / Math.sqrt(
        2 *
          Math.max(
            1,
            ((1 + r * r) ** 2) / (1 / Math.max(1, dR) + (r ** 4) / Math.max(1, pp - 1)),
          ),
      );
      if (Math.max(rel, relR2) <= target && pp * nn * levels < bestTotal) {
        bestTotal = pp * nn * levels;
        bestP = pp;
        bestN = nn;
      }
    }
  }
  return {
    p: labs,
    n: reps,
    q: levels,
    total: labs * reps * levels,
    dofRepeatability: dofR,
    dofReproducibility: ((1 + r * r) ** 2) /
      (1 / Math.max(1, dofR) + (r ** 4) / Math.max(1, dofL)),
    relativeSeRepeatability: relR,
    relativeSeReproducibility: relRepro,
    recommendedP: bestP,
    recommendedN: bestN,
    targetRelativeError: target,
    formula:
      's_r² = MSW; s_L² = (MSB−MSW)/n; s_R² = s_r²+s_L²; ν_R por Welch–Satterthwaite',
    reference: 'ISO 5725-2:2019, cláusulas 5–7; ISO 5725-1',
    assumptions: [
      'Delineamento balanceado (p laboratórios, n replicatas, q níveis)',
      'Laboratórios e réplicas independentes',
      `Razão σ_L/σ_r assumida = ${r.toFixed(2)}`,
      'Normalidade para as aproximações de incerteza de s',
    ],
    notes: [
      `Com p=${labs}, n=${reps}, q=${levels}: erro relativo padrão de s_r ≈ ${(relR * 100).toFixed(1)}% e de s_R ≈ ${(relRepro * 100).toFixed(1)}%.`,
      `Sugestão para atingir ≤ ${(target * 100).toFixed(0)}%: p=${bestP}, n=${bestN}, q=${levels} (total ${bestTotal}).`,
      'A ISO 5725-2 recomenda pelo menos 6 laboratórios e 2 replicatas por nível; o sistema alerta abaixo disso.',
    ],
  };
}

/** Orientação para LD/LQ. */
export function sampleSizeLod(
  approach: 'blank' | 'calibration' | 'snr' = 'blank',
): SampleSizeResult {
  const total = approach === 'snr' ? 12 : 20;
  return {
    method: 'lod',
    nPerGroup: approach === 'blank' ? 10 : 6,
    groups: 2,
    total,
    power: null,
    precision: null,
    formula:
      approach === 'blank'
        ? 'LD = média_branco + 3·s_branco; LQ = média_branco + 10·s_branco'
        : approach === 'calibration'
          ? 'LD = 3,3·s_yx/declive; LQ = 10·s_yx/declive'
          : 'LD = 3·sinal/ruído; LQ = 10·sinal/ruído',
    reference: 'ISO 11843; IUPAC (1997); ICH Q2(R2)',
    assumptions: [
      'Branco isento de contaminação e representativo do processo',
      'Sinal/ruído estimado em condições de repetibilidade',
    ],
    notes: [
      'Recomenda-se ≥ 10 réplicas de branco (ou 6 níveis baixos) para LD e ≥ 10 para LQ.',
      'Para calibração, use ≥ 5 níveis e ≥ 3 réplicas por nível.',
    ],
  };
}

/** Orientação para linearidade/faixa. */
export function sampleSizeLinearity(
  levels = 5,
  replicates = 3,
): SampleSizeResult {
  const l = Math.max(5, Math.round(levels));
  const r = Math.max(3, Math.round(replicates));
  return {
    method: 'linearity',
    nPerGroup: r,
    groups: l,
    total: l * r,
    power: null,
    precision: null,
    formula: 'Mínimo de 5 níveis × 3 réplicas; ajuste y = a + bx e teste de falta de ajuste',
    reference: 'ISO 8466-1; ICH Q2(R2); ISO/IEC 17025:2017, 7.2.2',
    assumptions: [
      'Níveis cobrem toda a faixa de trabalho',
      'Réplicas independentes em cada nível',
      'Erros homocedásticos ou modelo ponderado',
    ],
    notes: [
      `Delineamento sugerido: ${l} níveis × ${r} réplicas = ${l * r} medições.`,
      'O sistema testa lack-of-fit quando há réplicas por nível.',
    ],
  };
}

/** Orientação para seletividade, robustez e incerteza. */
export function sampleSizeGuideline(
  parameter: 'selectivity' | 'robustness' | 'uncertainty',
  nReplicates = 3,
): SampleSizeResult {
  if (parameter === 'selectivity') {
    const total = Math.max(6, 2 * nReplicates);
    return {
      method: 'guideline',
      nPerGroup: Math.max(3, nReplicates),
      groups: 2,
      total,
      power: null,
      precision: null,
      formula: 'Branco + amostra fortificada em duplicata/triplicata; comparar respostas',
      reference: 'ICH Q2(R2); EURACHEM Guide; ISO/IEC 17025:2017, 7.2.2',
      assumptions: ['Interferentes relevantes identificados', 'Amostra representativa'],
      notes: [
        `Sugestão: ${Math.max(3, nReplicates)} réplicas de branco e ${Math.max(3, nReplicates)} de amostra fortificada (${total} medições).`,
      ],
    };
  }
  if (parameter === 'robustness') {
    const factors = 3;
    const combos = 2 ** factors;
    const reps = Math.max(2, nReplicates);
    return {
      method: 'guideline',
      nPerGroup: reps,
      groups: combos,
      total: combos * reps,
      power: null,
      precision: null,
      formula: 'Fatorial 2^k com k fatores em dois níveis; efeitos principais e interações',
      reference: 'ICH Q2(R2); Youden & Steiner; Montgomery, Design and Analysis of Experiments',
      assumptions: ['Fatores e níveis escolhidos com base no conhecimento do método'],
      notes: [
        `Sugestão: 2^${factors} = ${combos} combinações × ${reps} réplicas = ${combos * reps} medições.`,
      ],
    };
  }
  return {
    method: 'guideline',
    nPerGroup: Math.max(10, nReplicates),
    groups: 1,
    total: Math.max(10, nReplicates),
    power: null,
    precision: null,
    formula: 'Orçamento GUM: combinar repetibilidade, tendência, calibração, MRC e condições ambientais',
    reference: 'GUM/JCGM 100:2008; ISO/IEC 17025:2017, 7.6',
    assumptions: ['Fontes independentes', 'Distribuições e divisores documentados'],
    notes: [
      'A incerteza usa os dados de precisão e exatidão; não exige um n próprio, mas recomenda-se ≥ 10 réplicas.',
    ],
  };
}

/** Retorna o n de um parâmetro a partir da chave e dos parâmetros do delineamento. */
export function planForParameter(
  key: string,
  opts: {
    sigma: number;
    effect: number;
    margin: number;
    confidence: number;
    power: number;
    alpha: number;
    relativeSdError: number;
    varianceRatio: number;
    betweenLabRatio: number;
    nLevels: number;
    nReplicates: number;
    nAnalysts: number;
    nDays: number;
    nLabs: number;
  },
): SampleSizeResult {
  const common = { alpha: opts.alpha, power: opts.power };
  switch (key) {
    case 'selectivity':
      return sampleSizeGuideline('selectivity', opts.nReplicates);
    case 'linearity':
    case 'working_range':
      return sampleSizeLinearity(opts.nLevels, opts.nReplicates);
    case 'lod_loq':
      return sampleSizeLod('blank');
    case 'repeatability':
      return sampleSizeRelativeSd(opts.relativeSdError);
    case 'intermediate_precision': {
      const reps = Math.max(2, opts.nReplicates);
      const cells = Math.max(2, opts.nAnalysts) * Math.max(2, opts.nDays);
      return {
        method: 'guideline',
        nPerGroup: reps,
        groups: cells,
        total: cells * reps,
        power: null,
        precision: null,
        formula: 'Componentes de variância em desenho cruzado analista × dia; s²_ip = s²_r + s²_analista + s²_dia + s²_interação',
        reference: 'ISO 5725-3; ISO 5725-2 (componentes de variância)',
        assumptions: [
          'Fatores aleatórios',
          'Réplicas independentes dentro de cada combinação analista × dia',
        ],
        notes: [
          `Sugestão: ${Math.max(2, opts.nAnalysts)} analistas × ${Math.max(2, opts.nDays)} dias × ${reps} réplicas = ${cells * reps} medições.`,
        ],
      };
    }
    case 'reproducibility': {
      const iso = iso5725SampleSize(
        opts.nLabs,
        opts.nReplicates,
        opts.nLevels,
        opts.betweenLabRatio,
        opts.relativeSdError,
      );
      return {
        method: 'iso5725',
        nPerGroup: iso.n,
        groups: iso.p,
        total: iso.total,
        power: null,
        precision: Math.max(
          iso.relativeSeRepeatability,
          iso.relativeSeReproducibility,
        ),
        formula: iso.formula,
        reference: iso.reference,
        assumptions: iso.assumptions,
        notes: iso.notes,
      };
    }
    case 'accuracy':
      return sampleSizeTOST(opts.margin || opts.effect, opts.sigma, {
        ...common,
        design: 'one_sample',
      });
    case 'robustness':
      return sampleSizeGuideline('robustness', opts.nReplicates);
    case 'uncertainty':
      return sampleSizeGuideline('uncertainty', opts.nReplicates);
    default:
      return sampleSizeMeanCI(opts.sigma, opts.effect || opts.margin, opts.confidence);
  }
}
