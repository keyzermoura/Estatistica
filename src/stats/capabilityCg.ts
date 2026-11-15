/**
 * Estudo de Capabilidade Tipo 1 (Cg / Cgk) e Índices de Razão de Incerteza VDA 5.
 *
 * Avalia repetibilidade e tendência do instrumento sobre padrão de referência
 * antes do estudo completo com operadores (AIAG MSA / Q-DAS solara.MP / VDA 5).
 *
 * Referências:
 *  - AIAG MSA (2010), 4. ed.; Bosch / Q-DAS Type 1 Study.
 *  - VDA Volume 5 (2021): Capability of Measurement Processes.
 */

import { mean, sd } from './descriptive';
import type { Verdict } from '../lib/types';

export interface CapabilityCgInput {
  values: number[];
  reference: number;
  tolerance: number;
  /** Fração percentual da tolerância alocada ao instrumento (padrão 20%). */
  kPct?: number;
  /** Multiplicador de dispersão (padrão 6σ, alternativa 4σ em VDA 5/Bosch). */
  sigmaMultiplier?: number;
  /** Incerteza expandida do sistema de medição U_MS (opcional, para Q_MS). */
  uMS?: number | null;
  /** Incerteza expandida do processo de medição U_MP (opcional, para Q_MP). */
  uMP?: number | null;
  /** Limiar mínimo de aprovação para Cg e Cgk (padrão 1,33). */
  minCg?: number;
}

export interface CapabilityCgResult {
  n: number;
  mean: number;
  sd: number;
  bias: number;
  tolerance: number;
  kPct: number;
  sigmaMultiplier: number;
  cg: number | null;
  cgk: number | null;
  qMsPct: number | null;
  qMpPct: number | null;
  minCg: number;
  verdict: Verdict;
  summary: string;
  reference: string;
}

const REFERENCE = 'AIAG MSA (2010) / Q-DAS Tipo 1 (Cg, Cgk); VDA 5:2021 (Q_MS ≤ 15%, Q_MP ≤ 30%)';

export function computeCapabilityCg(input: CapabilityCgInput): CapabilityCgResult {
  const valid = input.values.filter((value) => Number.isFinite(value));
  if (valid.length < 2) {
    throw new Error('O estudo Tipo 1 (Cg/Cgk) requer pelo menos 2 leituras válidas.');
  }
  if (!Number.isFinite(input.tolerance) || input.tolerance <= 0) {
    throw new Error('A tolerância (ou faixa equivalente) deve ser positiva para calcular Cg/Cgk.');
  }
  const kPct = input.kPct ?? 20;
  const sigmaMultiplier = input.sigmaMultiplier ?? 6;
  const minCg = input.minCg ?? 1.33;

  const avg = mean(valid);
  const s = sd(valid);
  const bias = avg - input.reference;

  const cg = s > 0 ? ((kPct / 100) * input.tolerance) / (sigmaMultiplier * s) : null;
  const cgk =
    s > 0
      ? (((kPct / 200) * input.tolerance) - Math.abs(bias)) / ((sigmaMultiplier / 2) * s)
      : null;

  const qMsPct =
    input.uMS !== null && input.uMS !== undefined && Number.isFinite(input.uMS)
      ? (100 * 2 * input.uMS) / input.tolerance
      : null;
  const qMpPct =
    input.uMP !== null && input.uMP !== undefined && Number.isFinite(input.uMP)
      ? (100 * 2 * input.uMP) / input.tolerance
      : null;

  let verdict: Verdict = 'not_evaluated';
  if (cg !== null && cgk !== null) {
    const cgPass = cg >= minCg && cgk >= minCg;
    const vdaPass = (qMsPct === null || qMsPct <= 15) && (qMpPct === null || qMpPct <= 30);
    verdict = cgPass && vdaPass ? 'pass' : 'fail';
  }

  const summary =
    cg !== null && cgk !== null
      ? `Cg = ${cg.toFixed(2)}, Cgk = ${cgk.toFixed(2)} (critério ≥ ${minCg.toFixed(2)}, k=${kPct}%/${sigmaMultiplier}s)${qMpPct !== null ? `; Q_MP = ${qMpPct.toFixed(1)}%` : ''}.`
      : `Desvio-padrão zero em ${valid.length} leituras (Cg/Cgk indeterminado).`;

  return {
    n: valid.length,
    mean: avg,
    sd: s,
    bias,
    tolerance: input.tolerance,
    kPct,
    sigmaMultiplier,
    cg,
    cgk,
    qMsPct,
    qMpPct,
    minCg,
    verdict,
    summary,
    reference: REFERENCE,
  };
}
