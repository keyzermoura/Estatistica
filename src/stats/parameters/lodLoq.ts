/**
 * Limites de detecção e quantificação — módulo do perfil analítico.
 *
 * Prioriza brancos independentes; na ausência deles usa a curva de calibração.
 * O critério de aceitação é sempre cadastrado pelo laboratório.
 *
 * Referências: ISO 8466-1:2021; ISO 11843-2; IUPAC (1997); ICH Q2(R2).
 */

import type { AcceptanceCriterion, Measurement } from '../../lib/types';
import type { AnalysisModule, ParameterAnalysis } from '../analysis-types';
import { buildMetric, emptyParameter, numericLevel, parameterSummary } from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';
import { lodLoqEurachemBlanks, lodLoqFromBlanks, lodLoqFromRegression } from '../regression';
import { clsiEp17Limits, probitLod95, type ProbitLodResult } from '../lodProbit';
import type { ParameterDef } from '../../profiles/types';

function estimateLod(
  parameter: ParameterDef,
  measurements: Measurement[],
  criteria: AcceptanceCriterion[],
): ParameterAnalysis {
  const blanks = measurements.filter((m) => {
    const lvl = m.level.toLowerCase();
    return m.value !== null && (lvl.includes('branco') || lvl.includes('blank') || numericLevel(m.level) === 0);
  });
  if (blanks.length >= 3) {
    const blankValues = blanks.map((m) => m.value!);
    const result = lodLoqFromBlanks(blankValues);
    const eurachemBlank = lodLoqEurachemBlanks(blankValues);
    const lowMeasurements = measurements.filter((m) => {
      const lvl = m.level.toLowerCase();
      return m.value !== null && !(lvl.includes('branco') || lvl.includes('blank') || numericLevel(m.level) === 0);
    });
    const lowLevels = lowMeasurements.map((m) => m.value!);
    let ep17: ReturnType<typeof clsiEp17Limits> | null = null;
    try {
      ep17 = clsiEp17Limits(blankValues, lowLevels.length >= 3 ? lowLevels : undefined);
    } catch {
      ep17 = null;
    }
    let probit: ProbitLodResult | null = null;
    if (ep17) {
      const byConc = new Map<number, number[]>();
      for (const m of lowMeasurements) {
        const conc = numericLevel(m.level);
        if (conc === null || !(conc > 0) || m.value === null) continue;
        const list = byConc.get(conc) ?? [];
        list.push(m.value);
        byConc.set(conc, list);
      }
      if (byConc.size >= 3) {
        const probitInput = [...byConc.entries()].map(([concentration, vals]) => ({
          concentration,
          positives: vals.filter((v) => v > ep17!.lobParametric).length,
          total: vals.length,
        }));
        try {
          probit = probitLod95(probitInput, 0.95, 0.05);
        } catch {
          probit = null;
        }
      }
    }
    const rawMetrics = { lod: result.lod, loq: result.loq };
    const metrics = [
      buildMetric(parameter, 'lod', result.lod, criteria, 'LD = média_branco + 3·s', result.reference),
      buildMetric(parameter, 'loq', result.loq, criteria, 'LQ = média_branco + 10·s', result.reference),
    ];
    const verdict = evaluateParameter(parameter.key, rawMetrics, criteria).verdict;
    const eurachemTable = Number.isFinite(eurachemBlank.s0Prime)
      ? [
          {
            title: 'Limites por Brancos com Correção de Rotina (Eurachem Blanks 2025)',
            columns: ['Parâmetro Eurachem', 'Valor', 'Fórmula / Detalhes'],
            rows: [
              [
                "DP efetivo s₀'",
                Number(eurachemBlank.s0Prime.toPrecision(5)),
                `s₀·√(1/n + 1/n_b) = ${eurachemBlank.blankSd.toPrecision(4)} × ${eurachemBlank.correctionFactor.toFixed(4)}`,
              ],
              [
                't unilateral (95%)',
                Number(eurachemBlank.tCrit.toFixed(4)),
                `ν = ${eurachemBlank.dof} (n_brancos = ${eurachemBlank.nBlanks})`,
              ],
              [
                'LD (branco subtraído)',
                Number(eurachemBlank.lodCorrected.toPrecision(5)),
                "LD = t_{1−α,ν}·s₀' (sinal líquido)",
              ],
              [
                'LQ (branco subtraído)',
                Number(eurachemBlank.loqCorrected.toPrecision(5)),
                `LQ = ${eurachemBlank.kQ}·s₀'`,
              ],
              [
                'LD / LQ (sinal bruto sem subtração)',
                `${eurachemBlank.lodUncorrected.toPrecision(4)} / ${eurachemBlank.loqUncorrected.toPrecision(4)}`,
                `média_branco (${eurachemBlank.blankMean.toPrecision(4)}) + termo`,
              ],
            ],
            note: eurachemBlank.reference,
          },
        ]
      : [];
    return {
      key: parameter.key,
      label: parameter.label,
      n: blanks.length,
      verdict,
      summary: parameterSummary(
        parameter.label,
        verdict,
        `LD = ${result.lod.toPrecision(4)}; LQ = ${result.loq.toPrecision(4)} (${blanks.length} brancos).`,
      ),
      metrics,
      rawMetrics,
      tables: [
        ...(ep17
          ? [
              {
                title: 'Limites CLSI EP17 (LoB / LoD / Probit 95%)',
                columns: ['Parâmetro EP17', 'Estimativa', 'Detalhes'],
                rows: [
                  ['LoB paramétrico (CP)', Number(ep17.lobParametric.toPrecision(5)), `α = ${ep17.alpha}`],
                  ['LoB não paramétrico (percentil)', Number(ep17.lobNonParametric.toPrecision(5)), `n_brancos = ${ep17.nBlanks}`],
                  ['LoD paramétrico (LoB + c_β·s_baixo)', Number(ep17.lodParametric.toPrecision(5)), `β = ${ep17.beta}; s_baixo = ${ep17.sdLowLevel.toPrecision(4)}`],
                  ...(probit
                    ? [
                        [
                          'LoD95% por Regressão Probit',
                          Number(probit.lod.toPrecision(5)),
                          `IC 95% [${probit.lodCi[0].toPrecision(4)}; ${probit.lodCi[1].toPrecision(4)}]`,
                        ],
                      ]
                    : []),
                  ['Brancos (média / DP)', `${ep17.meanBlank.toPrecision(4)} / ${ep17.sdBlank.toPrecision(4)}`, `n_baixo = ${ep17.nLowLevel}`],
                ],
                note: probit ? `${ep17.reference}; ${probit.reference}` : ep17.reference,
              },
            ]
          : []),
        ...eurachemTable,
      ],
      charts: [],
      warnings: result.caveats,
      notes: [
        'Estimativa a partir de brancos independentes.',
        ...(Number.isFinite(eurachemBlank.lodCorrected)
          ? [
              `Eurachem Blanks (2025): s₀' = ${eurachemBlank.s0Prime.toPrecision(4)} (fator √(1/1 + 1/1) = √2), LD_subtraído = ${eurachemBlank.lodCorrected.toPrecision(4)}, LQ_subtraído = ${eurachemBlank.loqCorrected.toPrecision(4)}.`,
            ]
          : []),
        ...(ep17 ? [`CLSI EP17: LoB_param = ${ep17.lobParametric.toPrecision(4)}, LoD_param = ${ep17.lodParametric.toPrecision(4)} (n_brancos = ${ep17.nBlanks}).`] : []),
        ...(probit ? [`CLSI EP17-A2 Probit (95% detecção acima do LoB): LoD95 = ${probit.lod.toPrecision(4)} [${probit.lodCi[0].toPrecision(4)}; ${probit.lodCi[1].toPrecision(4)}].`] : []),
      ],
      reference: probit ? `${result.reference}; ${probit.reference}; ${eurachemBlank.reference}` : `${result.reference}; ${eurachemBlank.reference}`,
      results: { lodLoq: result, eurachemBlank, ep17, probit, approach: 'blank' },
    };
  }
  const points = measurements
    .filter((m) => m.value !== null && numericLevel(m.level) !== null)
    .map((m) => ({ x: numericLevel(m.level)!, y: m.value! }));
  if (points.length >= 3) {
    const result = lodLoqFromRegression(points);
    const rawMetrics = { lod: result.lod, loq: result.loq };
    const metrics = [
      buildMetric(parameter, 'lod', result.lod, criteria, 'LD = 3,3·s_yx/b', result.reference),
      buildMetric(parameter, 'loq', result.loq, criteria, 'LQ = 10·s_yx/b', result.reference),
    ];
    const verdict = evaluateParameter(parameter.key, rawMetrics, criteria).verdict;
    return {
      key: parameter.key,
      label: parameter.label,
      n: points.length,
      verdict,
      summary: parameterSummary(
        parameter.label,
        verdict,
        `LD = ${result.lod.toPrecision(4)}; LQ = ${result.loq.toPrecision(4)} pela curva.`,
      ),
      metrics,
      rawMetrics,
      tables: [],
      charts: [],
      warnings: result.caveats,
      notes: [],
      reference: result.reference,
      results: { lodLoq: result, approach: 'calibration' },
    };
  }
  return emptyParameter(
    parameter,
    points.length || blanks.length,
    'Informe brancos (≥ 3) ou uma curva com níveis numéricos (≥ 3 pontos).',
  );
}

export const lodLoqAnalysis: AnalysisModule = ({ parameter, criteria, context }) =>
  estimateLod(parameter, context.used, criteria);
