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
import { accuracyPairsFrom, buildMetric, emptyParameter, parameterSummary } from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';
import { biasTest, recoveryTest, tost } from '../bias';
import { mean } from '../descriptive';
import type { Measurement } from '../../lib/types';
import type { ParameterDef } from '../../profiles/types';

function accuracyAnalysis(
  parameter: ParameterDef,
  measurements: Measurement[],
  criteria: AcceptanceCriterion[],
  options: AnalysisOptions,
): ParameterAnalysis {
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
  const bias = biasTest(measured, reference, options.alpha ?? 0.05, options.confidence ?? 0.95);
  const recovery = recoveryTest(
    measured,
    reference,
    options.alpha ?? 0.05,
    null,
  );
  const margin = options.margin && options.margin > 0 ? options.margin : Math.abs(mean(reference)) * 0.01 || 1;
  const equivalence = tost(measured, reference, margin, options.alpha ?? 0.05);
  const rawMetrics = {
    recovery: recovery.meanRecovery,
    bias: bias.meanDifference,
    biasP: bias.pValue,
  };
  const verdict = evaluateParameter(parameter.key, rawMetrics, criteria).verdict;
  const metrics = [
    buildMetric(parameter, 'recovery', recovery.meanRecovery, criteria, 'R% = 100·medido/referência', recovery.reference),
    buildMetric(parameter, 'bias', bias.meanDifference, criteria, 'd = medido − referência', bias.reference),
    buildMetric(parameter, 'biasP', bias.pValue, criteria, 'p do teste t pareado', bias.reference),
  ];
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
    ],
    charts: [],
    warnings: [...new Set([...bias.warnings, ...recovery.warnings, ...equivalence.warnings])],
    notes: [equivalence.interpretation],
    reference: 'ISO 5725-4:2020; ISO 17043; Schuirmann (1987)',
    results: { bias, recovery, tost: equivalence, margin },
  };
}

export const accuracyAnalysisModule: AnalysisModule = ({ parameter, criteria, context }) =>
  accuracyAnalysis(parameter, context.used, criteria, context.options);
