/**
 * Exatidão, tendência, recuperação e proficiência.
 *
 * Referências:
 *  - ISO 5725-1/4 (exatidão e medidas de tendência).
 *  - ISO 13528:2022 (z-score, En, proficiência).
 *  - ISO 17043 (ensaios de proficiência).
 *  - Schuirmann (1987); FDA/ICH E9 (TOST).
 *  - EURACHEM Guide (2014).
 */

import { mean, sd } from './descriptive';
import { tCdf, tInv } from './distributions';

export interface BiasResult {
  n: number;
  meanDifference: number;
  sdDifference: number;
  sem: number;
  t: number;
  df: number;
  pValue: number;
  alpha: number;
  ciLow: number;
  ciHigh: number;
  biasPercent: number | null;
  significant: boolean;
  method: string;
  reference: string;
  interpretation: string;
  warnings: string[];
}

function emptyBias(alpha: number, message: string): BiasResult {
  return {
    n: 0,
    meanDifference: NaN,
    sdDifference: NaN,
    sem: NaN,
    t: NaN,
    df: 0,
    pValue: NaN,
    alpha,
    ciLow: NaN,
    ciHigh: NaN,
    biasPercent: null,
    significant: false,
    method: 'Teste t de tendência',
    reference: 'ISO 5725-4; Montgomery & Runger',
    interpretation: message,
    warnings: [message],
  };
}

/** Teste t pareado de tendência: d_i = medido − referência. */
export function biasTest(
  measured: number[],
  reference: number[],
  alpha = 0.05,
  confidence = 0.95,
): BiasResult {
  return biasCore(measured, reference, alpha, confidence, 0, null);
}

/**
 * Teste t de tendência incorporando a incerteza-padrão do valor de referência:
 *   EP = √(s²/n + u_ref²)
 * Quando `referenceDof` é informado, os graus de liberdade usam
 * Welch–Satterthwaite; caso contrário, assume-se u_ref conhecida (gl = n − 1).
 */
export function biasTestWithReferenceUncertainty(
  measured: number[],
  reference: number[],
  alpha = 0.05,
  confidence = 0.95,
  referenceUncertainty = 0,
  referenceDof: number | null = null,
): BiasResult {
  if (!(referenceUncertainty >= 0) || !Number.isFinite(referenceUncertainty)) {
    throw new Error('A incerteza-padrão da referência deve ser um número não negativo.');
  }
  if (
    referenceDof !== null &&
    (!(referenceDof > 0) || !Number.isFinite(referenceDof))
  ) {
    throw new Error('Os graus de liberdade da referência devem ser positivos.');
  }
  return biasCore(measured, reference, alpha, confidence, referenceUncertainty, referenceDof);
}

function biasCore(
  measured: number[],
  reference: number[],
  alpha: number,
  confidence: number,
  referenceUncertainty: number,
  referenceDof: number | null,
): BiasResult {
  const n = Math.min(measured.length, reference.length);
  if (n < 2) return emptyBias(alpha, 'São necessários pelo menos 2 pares medido/referência.');
  const diffs = Array.from({ length: n }, (_, i) => measured[i] - reference[i]);
  const md = mean(diffs);
  const sdd = sd(diffs);
  if (!(sdd > 0)) {
    if (referenceUncertainty > 0) {
      const df = referenceDof ?? n - 1;
      const se = referenceUncertainty;
      const t = md / se;
      const p = 2 * (1 - tCdf(Math.abs(t), df));
      const tCrit = tInv(1 - (1 - confidence) / 2, df);
      const refMean = mean(reference);
      return {
        n,
        meanDifference: md,
        sdDifference: 0,
        sem: se,
        t,
        df,
        pValue: p,
        alpha,
        ciLow: md - tCrit * se,
        ciHigh: md + tCrit * se,
        biasPercent: refMean !== 0 ? (100 * md) / Math.abs(refMean) : null,
        significant: p < alpha,
        method: 'Teste t de tendência com incerteza do padrão (H₀: tendência = 0)',
        reference: 'ISO 5725-4:2020; GUM/JCGM 100:2008; Montgomery & Runger, cap. 9',
        interpretation:
          p < alpha
            ? `Tendência significativa de ${md.toPrecision(4)} incluindo a incerteza do padrão (p = ${p.toFixed(4)}).`
            : `Não há evidência de tendência significativa incluindo a incerteza do padrão (p = ${p.toFixed(4)}).`,
        warnings: [
          'Desvio-padrão das diferenças igual a zero; intervalo baseado apenas na incerteza do padrão.',
        ],
      };
    }
    return {
      n,
      meanDifference: md,
      sdDifference: 0,
      sem: 0,
      t: NaN,
      df: n - 1,
      pValue: NaN,
      alpha,
      ciLow: md,
      ciHigh: md,
      biasPercent: mean(reference) !== 0 ? (100 * md) / Math.abs(mean(reference)) : null,
      significant: md !== 0,
      method: 'Teste t pareado de tendência',
      reference: 'ISO 5725-4; Montgomery & Runger, cap. 9',
      interpretation: 'Variabilidade nula entre pares; não é possível testar a tendência.',
      warnings: ['Desvio-padrão das diferenças igual a zero.'],
    };
  }
  const withinVariance = (sdd * sdd) / n;
  const referenceVariance = referenceUncertainty * referenceUncertainty;
  const se =
    referenceVariance > 0 ? Math.sqrt(withinVariance + referenceVariance) : sdd / Math.sqrt(n);
  let df = n - 1;
  if (referenceUncertainty > 0 && referenceDof !== null && referenceDof > 0) {
    df =
      (withinVariance + referenceVariance) ** 2 /
      (withinVariance ** 2 / (n - 1) + referenceVariance ** 2 / referenceDof);
  }
  const t = md / se;
  const p = 2 * (1 - tCdf(Math.abs(t), df));
  const tCrit = tInv(1 - (1 - confidence) / 2, df);
  const refMean = mean(reference);
  const hasReferenceUncertainty = referenceUncertainty > 0;
  const ciLow = md - tCrit * se;
  const ciHigh = md + tCrit * se;
  const warnings: string[] = [];
  if (hasReferenceUncertainty) {
    warnings.push(
      'Incerteza do padrão incluída no erro-padrão da tendência; o IC reflete a calibração da referência.',
    );
  } else if (n < 6) {
    warnings.push('Amostra pequena: baixo poder para detectar tendência.');
  }
  return {
    n,
    meanDifference: md,
    sdDifference: sdd,
    sem: se,
    t,
    df,
    pValue: p,
    alpha,
    ciLow,
    ciHigh,
    biasPercent: refMean !== 0 ? (100 * md) / Math.abs(refMean) : null,
    significant: p < alpha,
    method: hasReferenceUncertainty
      ? 'Teste t de tendência com incerteza do padrão (H₀: tendência = 0)'
      : 'Teste t pareado de tendência (H₀: tendência = 0)',
    reference: hasReferenceUncertainty
      ? 'ISO 5725-4:2020; GUM/JCGM 100:2008; Montgomery & Runger, cap. 9'
      : 'ISO 5725-4:2020; Montgomery & Runger, cap. 9',
    interpretation: hasReferenceUncertainty
      ? p < alpha
        ? `Tendência significativa de ${md.toPrecision(4)} incluindo a incerteza do padrão (IC ${(confidence * 100).toFixed(0)}%: ${ciLow.toPrecision(4)} a ${ciHigh.toPrecision(4)}).`
        : `Não há evidência de tendência significativa incluindo a incerteza do padrão (p = ${p.toFixed(4)}); IC ${(confidence * 100).toFixed(0)}%: ${ciLow.toPrecision(4)} a ${ciHigh.toPrecision(4)}.`
      : p < alpha
        ? `Tendência significativa de ${md.toPrecision(4)} (IC ${(confidence * 100).toFixed(0)}%: ${(md - tCrit * se).toPrecision(4)} a ${(md + tCrit * se).toPrecision(4)}).`
        : `Não há evidência de tendência significativa (p = ${p.toFixed(4)}); IC ${(confidence * 100).toFixed(0)}%: ${(md - tCrit * se).toPrecision(4)} a ${(md + tCrit * se).toPrecision(4)}.`,
    warnings,
  };
}

export interface RecoveryResult {
  n: number;
  meanRecovery: number;
  sdRecovery: number;
  ciLow: number;
  ciHigh: number;
  t: number;
  df: number;
  pValue: number;
  alpha: number;
  acceptable: boolean | null;
  criterion: [number, number] | null;
  method: string;
  reference: string;
  interpretation: string;
  warnings: string[];
}

/** Recuperação percentual em relação ao valor fortificado. */
export function recoveryTest(
  measured: number[],
  reference: number[],
  alpha = 0.05,
  criterion: [number, number] | null = null,
): RecoveryResult {
  const n = Math.min(measured.length, reference.length);
  if (n < 2) {
    return {
      n: 0,
      meanRecovery: NaN,
      sdRecovery: NaN,
      ciLow: NaN,
      ciHigh: NaN,
      t: NaN,
      df: 0,
      pValue: NaN,
      alpha,
      acceptable: null,
      criterion,
      method: 'Recuperação',
      reference: 'ISO 5725-4; EURACHEM (2014)',
      interpretation: 'São necessários pelo menos 2 níveis/pares.',
      warnings: ['Dados insuficientes.'],
    };
  }
  const rec = Array.from({ length: n }, (_, i) => (100 * measured[i]) / reference[i]).filter(
    (v) => Number.isFinite(v),
  );
  if (rec.length < 2) {
    return {
      n: 0,
      meanRecovery: NaN,
      sdRecovery: NaN,
      ciLow: NaN,
      ciHigh: NaN,
      t: NaN,
      df: 0,
      pValue: NaN,
      alpha,
      acceptable: null,
      criterion,
      method: 'Recuperação',
      reference: 'ISO 5725-4; EURACHEM (2014)',
      interpretation: 'Valores de referência nulos ou inválidos.',
      warnings: ['Dados inválidos.'],
    };
  }
  const m = mean(rec);
  const s = sd(rec);
  const se = s / Math.sqrt(rec.length);
  const df = rec.length - 1;
  const t = se > 0 ? (m - 100) / se : NaN;
  const p = Number.isFinite(t) ? 2 * (1 - tCdf(Math.abs(t), df)) : NaN;
  const tCrit = tInv(1 - alpha / 2, df);
  const ciLow = m - tCrit * se;
  const ciHigh = m + tCrit * se;
  const acceptable =
    criterion === null
      ? Number.isFinite(p)
        ? p >= alpha
        : null
      : ciLow >= criterion[0] && ciHigh <= criterion[1];
  return {
    n: rec.length,
    meanRecovery: m,
    sdRecovery: s,
    ciLow,
    ciHigh,
    t,
    df,
    pValue: p,
    alpha,
    acceptable,
    criterion,
    method: 'Recuperação percentual média com IC t',
    reference: 'ISO 5725-4:2020; EURACHEM Guide (2014), cap. 6',
    interpretation:
      criterion === null
        ? `Recuperação média = ${m.toFixed(2)}% (IC ${(100 * (1 - alpha)).toFixed(0)}%: ${ciLow.toFixed(2)}–${ciHigh.toFixed(2)}%).`
        : acceptable
          ? `Recuperação média = ${m.toFixed(2)}%; IC dentro do critério ${criterion[0]}–${criterion[1]}%.`
          : `Recuperação média = ${m.toFixed(2)}%; IC fora do critério ${criterion[0]}–${criterion[1]}%.`,
    warnings: rec.length < 6 ? ['Recomenda-se ≥ 6 níveis/pares para estimar recuperação.'] : [],
  };
}

export interface ProficiencyResult {
  score: number;
  satisfactory: boolean;
  questionable: boolean;
  method: string;
  reference: string;
  interpretation: string;
}

/** z-score de proficiência (ISO 13528). */
export function zScore(
  measured: number,
  assigned: number,
  sigmaPt: number,
): ProficiencyResult {
  const z = sigmaPt > 0 ? (measured - assigned) / sigmaPt : NaN;
  const a = Math.abs(z);
  const satisfactory = a <= 2;
  const questionable = a > 2 && a <= 3;
  return {
    score: z,
    satisfactory,
    questionable,
    method: 'z = (x − x_ref) / σ_pt',
    reference: 'ISO 13528:2022, cláusula 9; ISO 17043',
    interpretation: Number.isFinite(z)
      ? a <= 2
        ? `|z| = ${a.toFixed(2)} ≤ 2: desempenho satisfatório.`
        : a <= 3
          ? `2 < |z| = ${a.toFixed(2)} ≤ 3: desempenho questionável.`
          : `|z| = ${a.toFixed(2)} > 3: desempenho insatisfatório.`
      : 'σ_pt inválido.',
  };
}

/** En-score: (x − x_ref)/√(u_lab² + u_ref²). */
export function enScore(
  measured: number,
  assigned: number,
  uLab: number,
  uRef: number,
): ProficiencyResult {
  const denom = Math.sqrt(uLab * uLab + uRef * uRef);
  const en = denom > 0 ? (measured - assigned) / denom : NaN;
  return {
    score: en,
    satisfactory: Number.isFinite(en) && Math.abs(en) <= 1,
    questionable: false,
    method: 'En = (x − x_ref) / √(u_lab² + u_ref²)',
    reference: 'ISO 13528:2022, cláusula 9; ISO 17043',
    interpretation: Number.isFinite(en)
      ? Math.abs(en) <= 1
        ? `|En| = ${Math.abs(en).toFixed(2)} ≤ 1: resultado compatível dentro das incertezas.`
        : `|En| = ${Math.abs(en).toFixed(2)} > 1: resultado incompatível dentro das incertezas.`
      : 'Incertezas inválidas.',
  };
}

export interface TostResult {
  n: number;
  meanDifference: number;
  se: number;
  df: number;
  margin: number;
  pValue: number;
  alpha: number;
  equivalent: boolean;
  ciLow: number;
  ciHigh: number;
  method: string;
  reference: string;
  interpretation: string;
  warnings: string[];
}

/** Teste de equivalência TOST (duas caudas, α unilateral em cada). */
export function tost(
  measured: number[],
  reference: number[],
  margin: number,
  alpha = 0.05,
): TostResult {
  const n = Math.min(measured.length, reference.length);
  if (n < 2 || !(margin > 0)) {
    return {
      n,
      meanDifference: NaN,
      se: NaN,
      df: 0,
      margin,
      pValue: NaN,
      alpha,
      equivalent: false,
      ciLow: NaN,
      ciHigh: NaN,
      method: 'TOST',
      reference: 'Schuirmann (1987); FDA/ICH E9',
      interpretation: 'Dados insuficientes ou margem inválida.',
      warnings: ['Informe ≥ 2 pares e margem > 0.'],
    };
  }
  const diffs = Array.from({ length: n }, (_, i) => measured[i] - reference[i]);
  const md = mean(diffs);
  const sdd = sd(diffs);
  const se = sdd / Math.sqrt(n);
  const df = n - 1;
  if (!(se > 0)) {
    return {
      n,
      meanDifference: md,
      se: 0,
      df,
      margin,
      pValue: md === 0 ? 0 : 1,
      alpha,
      equivalent: Math.abs(md) < margin,
      ciLow: md,
      ciHigh: md,
      method: 'TOST',
      reference: 'Schuirmann (1987); FDA/ICH E9',
      interpretation: 'Variabilidade nula: a decisão depende apenas da diferença média.',
      warnings: ['Desvio-padrão das diferenças igual a zero.'],
    };
  }
  const tLow = (md + margin) / se; // H0: diferença ≤ −margem
  const tHigh = (margin - md) / se; // H0: diferença ≥ +margem
  const pLow = 1 - tCdf(tLow, df);
  const pHigh = 1 - tCdf(tHigh, df);
  const p = Math.max(pLow, pHigh);
  const tCrit = tInv(1 - alpha, df);
  return {
    n,
    meanDifference: md,
    se,
    df,
    margin,
    pValue: p,
    alpha,
    equivalent: p < alpha,
    ciLow: md - tCrit * se,
    ciHigh: md + tCrit * se,
    method: 'TOST — two one-sided tests',
    reference: 'Schuirmann (1987); Chow, Shao & Wang (2008); FDA/ICH E9',
    interpretation:
      p < alpha
        ? `Equivalência demonstrada: IC ${(100 * (1 - 2 * alpha)).toFixed(0)}% (${(md - tCrit * se).toPrecision(4)} a ${(md + tCrit * se).toPrecision(4)}) dentro de ±${margin}.`
        : `Equivalência não demonstrada: p = ${p.toFixed(4)} ≥ ${alpha}; IC ${(100 * (1 - 2 * alpha)).toFixed(0)}% (${(md - tCrit * se).toPrecision(4)} a ${(md + tCrit * se).toPrecision(4)}).`,
    warnings: n < 6 ? ['TOST com n pequeno tem baixo poder.'] : [],
  };
}

/** Intervalo de tolerância bilateral (aproximação normal). */
export function toleranceInterval(
  values: number[],
  coverage = 0.95,
  confidence = 0.95,
): { low: number; high: number; k: number; method: string } {
  const n = values.length;
  if (n < 2) return { low: NaN, high: NaN, k: NaN, method: 'Intervalo de tolerância' };
  const m = mean(values);
  const s = sd(values);
  const z = 1.959963984540054;
  const k =
    z +
    (z * z + 1) / (2 * n) +
    (5 * z ** 3 + 16 * z) / (12 * n * n) +
    (3 * z ** 5 + 19 * z ** 3 + 17 * z) / (24 * n ** 3);
  return {
    low: m - k * s,
    high: m + k * s,
    k,
    method: `Intervalo de tolerância ${(coverage * 100).toFixed(0)}/${(confidence * 100).toFixed(0)} (Howe)`,
  };
}
