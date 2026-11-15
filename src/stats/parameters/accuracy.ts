/**
 * Exatidão / tendência — módulo do perfil analítico.
 *
 * Calcula tendência pareada, recuperação e TOST. O TOST é apoio à decisão; o
 * veredito usa somente os critérios cadastrados.
 *
 * Referências: ISO 5725-4:2020; ISO 17043; Schuirmann (1987).
 */

import type { AcceptanceCriterion } from '../../lib/types';
import type { AnalysisModule, AnalysisOptions, ParameterAnalysis } from '../analysis-types';
import {
  accuracyPairsFrom,
  buildMetric,
  emptyParameter,
  parameterSummary,
  referenceOf,
} from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';
import {
  biasTest,
  biasTestWithReferenceUncertainty,
  enScore,
  recoveryTest,
  tost,
  zetaScore,
} from '../bias';
import {
  blandAltman,
  demingRegression,
  passingBablokRegression,
} from '../methodComparison';
import { computeAccuracyProfile } from '../accuracyProfile';
import { mean } from '../descriptive';
import { tInv } from '../distributions';
import type { Measurement } from '../../lib/types';
import type { ParameterDef } from '../../profiles/types';

function accuracyAnalysis(
  parameter: ParameterDef,
  measurements: Measurement[],
  criteria: AcceptanceCriterion[],
  options: AnalysisOptions,
): ParameterAnalysis {
  const pairedMeasurements = measurements.filter(
    (m) => m.value !== null && referenceOf(m) !== null,
  );
  const pairs = accuracyPairsFrom(measurements);
  if (pairs.length < 2) {
    return emptyParameter(
      parameter,
      pairs.length,
      'Informe o valor de referência (coluna “Referência”) ou use níveis numéricos, com pelo menos 2 pares medido × referência.',
    );
  }
  const measured = pairs.map((p) => p.measured);
  const reference = pairs.map((p) => p.reference);
  const refUncertainties = pairedMeasurements
    .map((m) => m.refUncertainty)
    .filter(
      (u): u is number =>
        u !== null && u !== undefined && Number.isFinite(u) && u > 0,
    );
  const alpha = options.alpha ?? 0.05;
  const confidence = options.confidence ?? 0.95;
  const standardRefUncertainty = refUncertainties.length
    ? Math.sqrt(
        refUncertainties.reduce((acc, u) => acc + (u / 2) ** 2, 0) /
          refUncertainties.length,
      )
    : 0;
  const bias =
    standardRefUncertainty > 0
      ? biasTestWithReferenceUncertainty(
          measured,
          reference,
          alpha,
          confidence,
          standardRefUncertainty,
        )
      : biasTest(measured, reference, alpha, confidence);
  const recovery = recoveryTest(
    measured,
    reference,
    alpha,
    null,
  );
  const margin = options.margin && options.margin > 0 ? options.margin : Math.abs(mean(reference)) * 0.01 || 1;
  const equivalence = tost(measured, reference, margin, alpha);
  const measuredMean = mean(measured);
  const refMean = mean(reference);
  const uLab =
    bias.n > 0 && Number.isFinite(bias.sdDifference) && bias.sdDifference > 0
      ? bias.sdDifference / Math.sqrt(bias.n)
      : 0;
  const kLab = tInv(1 - alpha / 2, Math.max(1, bias.df));
  const uExpandedLab = kLab * uLab;
  const uExpandedRef = 2 * standardRefUncertainty;
  const hasPtUncertainties = uLab > 0 || standardRefUncertainty > 0;
  const en = hasPtUncertainties
    ? enScore(measuredMean, refMean, uExpandedLab, uExpandedRef)
    : null;
  const zeta = hasPtUncertainties
    ? zetaScore(measuredMean, refMean, uLab, standardRefUncertainty)
    : null;
  const absEn = en && Number.isFinite(en.score) ? Math.abs(en.score) : null;
  const hasEnCriterion = criteria.some((c) => c.metric === 'en');
  const rawMetrics = {
    recovery: recovery.meanRecovery,
    bias: bias.meanDifference,
    biasP: bias.pValue,
    en: absEn,
  };
  const verdict = evaluateParameter(parameter.key, rawMetrics, criteria).verdict;
  const metrics = [
    buildMetric(parameter, 'recovery', recovery.meanRecovery, criteria, 'R% = 100·medido/referência', recovery.reference),
    buildMetric(parameter, 'bias', bias.meanDifference, criteria, 'd = medido − referência', bias.reference),
    buildMetric(
      parameter,
      'biasP',
      bias.pValue,
      criteria,
      standardRefUncertainty > 0
        ? 'p do teste t pareado com u_ref'
        : 'p do teste t pareado',
      bias.reference,
    ),
    ...(standardRefUncertainty > 0 || hasEnCriterion
      ? [
          buildMetric(
            parameter,
            'en',
            absEn,
            criteria,
            '|En| = |x_lab − x_ref| / √(U_lab² + U_ref²)',
            en?.reference ?? parameter.reference,
          ),
        ]
      : []),
  ];
  const notes = [equivalence.interpretation];
  if (standardRefUncertainty > 0) {
    notes.push(
      `Incerteza-padrão do material de referência incorporada ao teste t de tendência: u_ref = ${standardRefUncertainty.toPrecision(4)} (U_ref/2, k = 2).`,
    );
  }
  if (en && zeta && Number.isFinite(en.score) && Number.isFinite(zeta.score)) {
    notes.push(
      `Compatibilidade metrológica (Eurachem PT / ISO 13528): En = ${en.score.toFixed(3)} (${en.satisfactory ? 'compatível |En| ≤ 1' : 'incompatível |En| > 1'}); ζ = ${zeta.score.toFixed(3)} (${zeta.satisfactory ? '|ζ| ≤ 2' : zeta.questionable ? 'alerta 2 < |ζ| ≤ 3' : 'incompatível |ζ| > 3'}).`,
    );
  }
  const hasMultipleLevels =
    Boolean(options.includeMethodComparison) &&
    pairs.length >= 3 &&
    new Set(reference).size >= 2;
  let ba: ReturnType<typeof blandAltman> | null = null;
  let deming: ReturnType<typeof demingRegression> | null = null;
  let pb: ReturnType<typeof passingBablokRegression> | null = null;
  if (hasMultipleLevels) {
    try {
      ba = blandAltman(reference, measured, alpha);
      deming = demingRegression(reference, measured, 1, alpha);
      if (pairs.length >= 4) {
        pb = passingBablokRegression(reference, measured, alpha);
      }
      notes.push(
        `Comparação de métodos (CLSI EP09): Deming inclinação = ${deming.slope.toFixed(4)} [${deming.slopeCi[0].toFixed(4)}; ${deming.slopeCi[1].toFixed(4)}]`,
      );
      if (pb) {
        notes.push(
          `Passing–Bablok: y = ${pb.intercept.toFixed(4)} + ${pb.slope.toFixed(4)}·x (inclinação IC 95% [${pb.slopeCi[0].toFixed(4)}; ${pb.slopeCi[1].toFixed(4)}]).`,
        );
      }
    } catch {
      // Degenerate or tied series skip orthogonal comparison gracefully.
    }
  }
  const comparisonTables =
    ba && deming
      ? [
          {
            title: 'Comparação de métodos (CLSI EP09 — Deming, Passing–Bablok e Bland–Altman)',
            columns: ['Abordagem', 'Parâmetro principal', 'IC 95%', 'Observação'],
            rows: [
              [
                'Bland–Altman',
                `viés = ${ba.meanBias.toPrecision(4)}`,
                `LoA [${ba.loaLower.toPrecision(4)}; ${ba.loaUpper.toPrecision(4)}]`,
                `viés prop. slope = ${ba.proportionalSlope.toFixed(4)} (p = ${ba.proportionalP.toFixed(4)})`,
              ],
              [
                'Regressão de Deming (λ = 1)',
                `slope = ${deming.slope.toFixed(4)}; intercept = ${deming.intercept.toPrecision(4)}`,
                `slope [${deming.slopeCi[0].toFixed(4)}; ${deming.slopeCi[1].toFixed(4)}]`,
                !deming.equivalentSlope || !deming.equivalentIntercept
                  ? 'Viés detectado (IC não contém 1 ou 0)'
                  : 'Sem viés sistemático significativo',
              ],
              ...(pb
                ? [
                    [
                      'Passing–Bablok (não paramétrica)',
                      `slope = ${pb.slope.toFixed(4)}; intercept = ${pb.intercept.toPrecision(4)}`,
                      `slope [${pb.slopeCi[0].toFixed(4)}; ${pb.slopeCi[1].toFixed(4)}]`,
                      !pb.equivalentSlope || !pb.equivalentIntercept
                        ? `Viés detectado (${pb.validSlopes} pares válidos)`
                        : `Equivalente (${pb.validSlopes} pares válidos)`,
                    ],
                  ]
                : []),
            ],
            note: 'CLSI EP09-A3; Bland & Altman (1986); Passing & Bablok (1983).',
          },
        ]
      : [];
  const accuracyProfile = computeAccuracyProfile(measurements, { beta: confidence });
  if (accuracyProfile) {
    if (accuracyProfile.lloq !== null && accuracyProfile.uloq !== null) {
      notes.push(
        `Perfil de Exatidão (β=${(accuracyProfile.beta * 100).toFixed(0)}%, λ=±${accuracyProfile.acceptanceLimitPct}%): faixa validada [${accuracyProfile.lloq.toPrecision(4)}; ${accuracyProfile.uloq.toPrecision(4)}].`,
      );
    } else {
      notes.push(
        `Perfil de Exatidão (β=${(accuracyProfile.beta * 100).toFixed(0)}%, λ=±${accuracyProfile.acceptanceLimitPct}%): nenhum nível ficou integralmente dentro dos limites ±${accuracyProfile.acceptanceLimitPct}%.`,
      );
    }
  }
  const accuracyProfileTables = accuracyProfile
    ? [
        {
          title: 'Perfil de Exatidão — Erro Total e Intervalo de Tolerância β-Expectation (SFSTP / USP <1210>)',
          columns: [
            'Nível',
            'n',
            'Ref. média',
            'Viés rel. (%)',
            'RSD_r (%)',
            'RSD_IP (%)',
            'IT β-exp. (%)',
            `Status (±${accuracyProfile.acceptanceLimitPct}%)`,
          ],
          rows: accuracyProfile.levels.map((lvl) => [
            lvl.levelLabel,
            lvl.n,
            Number(lvl.referenceMean.toPrecision(5)),
            `${lvl.relativeBiasPct >= 0 ? '+' : ''}${lvl.relativeBiasPct.toFixed(2)}%`,
            `${lvl.rsdRepeatabilityPct.toFixed(2)}%`,
            `${lvl.rsdIpPct.toFixed(2)}%`,
            `[${lvl.lowerTolerancePct.toFixed(2)}%; ${lvl.upperTolerancePct.toFixed(2)}%]`,
            lvl.withinAcceptance ? 'Conforme' : 'Excede ±λ',
          ]),
          note: `${accuracyProfile.reference}. β = ${(accuracyProfile.beta * 100).toFixed(0)}% (limites padrão ±${accuracyProfile.acceptanceLimitPct}%).`,
        },
      ]
    : [];
  const ptTables =
    en && zeta && Number.isFinite(en.score) && Number.isFinite(zeta.score)
      ? [
          {
            title: 'Compatibilidade Metrológica e Proficiência (Eurachem PT 2021 / ISO 13528)',
            columns: ['Índice', 'Fórmula', 'Valor', 'Incerteza lab / ref', 'Interpretação'],
            rows: [
              [
                'Erro Normalizado (En)',
                'En = (x̄_lab − x̄_ref) / √(U_lab² + U_ref²)',
                Number(en.score.toFixed(4)),
                `U_lab = ${uExpandedLab.toPrecision(4)}; U_ref = ${uExpandedRef.toPrecision(4)}`,
                en.interpretation,
              ],
              [
                'Zeta-score (ζ)',
                'ζ = (x̄_lab − x̄_ref) / √(u_lab² + u_ref²)',
                Number(zeta.score.toFixed(4)),
                `u_lab = ${uLab.toPrecision(4)}; u_ref = ${standardRefUncertainty.toPrecision(4)}`,
                zeta.interpretation,
              ],
            ],
            note: 'Critério ISO 13528 / Eurachem PT (3ª ed., 2021): |En| ≤ 1,0 e |ζ| ≤ 2,0 indicam compatibilidade metrológica.',
          },
        ]
      : [];
  const comparisonCharts =
    ba && pairs.length >= 3
      ? [
          {
            kind: 'residual' as const,
            title: 'Gráfico de Bland–Altman (Diferença vs Média)',
            xLabel: 'Média (Referência, Medido)',
            yLabel: 'Diferença (Medido − Referência)',
            data: pairs.map((p) => ({
              x: (p.reference + p.measured) / 2,
              y: p.measured - p.reference,
            })),
          },
        ]
      : [];
  return {
    key: parameter.key,
    label: parameter.label,
    n: pairs.length,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `Tendência = ${bias.meanDifference.toPrecision(4)}; recuperação = ${recovery.meanRecovery.toFixed(2)}%; TOST p = ${equivalence.pValue.toFixed(4)}.`,
    ),
    metrics,
    rawMetrics,
    tables: [
      {
        title: 'Tendência e recuperação',
        columns: ['Métrica', 'Valor', 'IC 95%', 'p'],
        rows: [
          ['Tendência média', bias.meanDifference, `${bias.ciLow.toPrecision(4)} a ${bias.ciHigh.toPrecision(4)}`, bias.pValue],
          ['Recuperação (%)', recovery.meanRecovery, `${recovery.ciLow.toFixed(2)} a ${recovery.ciHigh.toFixed(2)}`, recovery.pValue],
          ['TOST (margem)', equivalence.meanDifference, `${equivalence.ciLow.toPrecision(4)} a ${equivalence.ciHigh.toPrecision(4)}`, equivalence.pValue],
        ],
      },
      ...ptTables,
      ...comparisonTables,
      ...accuracyProfileTables,
    ],
    charts: comparisonCharts,
    warnings: [
      ...new Set([
        ...bias.warnings,
        ...recovery.warnings,
        ...equivalence.warnings,
        ...(accuracyProfile?.warnings ?? []),
      ]),
    ],
    notes,
    reference: comparisonTables.length || accuracyProfileTables.length
      ? 'ISO 5725-4:2020; ISO 17043; ISO 13528:2022; Schuirmann (1987); CLSI EP09; SFSTP / USP <1210>; EURACHEM PT (2021)'
      : 'ISO 5725-4:2020; ISO 17043; ISO 13528:2022; Schuirmann (1987); EURACHEM PT (2021)',
    results: {
      bias,
      recovery,
      tost: equivalence,
      margin,
      ...(en && zeta ? { en, zeta, uLab, uExpandedLab, uRef: standardRefUncertainty, uExpandedRef } : {}),
      ...(comparisonTables.length
        ? { blandAltman: ba, deming, passingBablok: pb }
        : {}),
      ...(accuracyProfile ? { accuracyProfile } : {}),
    },
  };
}

/** Calcula Bland-Altman, Deming e Passing-Bablok sob demanda para comparação de métodos. */
export function computeAccuracyMethodComparison(
  measurements: Measurement[],
  alpha = 0.05,
) {
  const pairs = accuracyPairsFrom(measurements);
  if (pairs.length < 3 || new Set(pairs.map((p) => p.reference)).size < 2) {
    return null;
  }
  const reference = pairs.map((p) => p.reference);
  const measured = pairs.map((p) => p.measured);
  return {
    blandAltman: blandAltman(reference, measured, alpha),
    deming: demingRegression(reference, measured, 1, alpha),
    passingBablok: pairs.length >= 4 ? passingBablokRegression(reference, measured, alpha) : null,
  };
}

export const accuracyAnalysisModule: AnalysisModule = ({ parameter, criteria, context }) =>
  accuracyAnalysis(parameter, context.used, criteria, context.options);
