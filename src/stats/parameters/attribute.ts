/**
 * Adaptadores do perfil de atributo.
 *
 * O motor `attribute.ts` devolve um estudo completo (kappa interavaliadores,
 * intra-avaliador e com a referência, eficácia, FAR, FRR e cobertura). Este
 * módulo converte esse estudo nos parâmetros do perfil:
 *
 *  - `accuracy` — concordância com a referência conhecida;
 *  - `repeatability` — concordância intra-avaliador entre réplicas;
 *  - `intermediate_precision` — concordância entre avaliadores.
 *
 * As métricas agregadas usam o pior caso entre avaliadores, de modo que um
 * único avaliador fora do critério não seja mascarado pela média. Cada métrica
 * mantém o seu próprio critério editável; quando não há critério, o veredito é
 * “não avaliado” — nunca se inventa conformidade.
 *
 * Referências: AIAG MSA (2010), 4. ed.; Cohen (1960); Fleiss (1971);
 * Landis & Koch (1977) — orientação, não norma.
 */

import type { AcceptanceCriterion, Verdict } from '../../lib/types';
import type { ParameterDef } from '../../profiles/types';
import { criterionText, evaluateCriterion } from '../../lib/criteria';
import type {
  AnalysisContext,
  AnalysisMetric,
  AnalysisModule,
  ParameterAnalysis,
} from '../analysis-types';
import { emptyParameter, parameterSummary } from '../analysis-utils';
import type { AttributeStudyResult } from '../attribute';
import { fmt } from '../distributions';

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function minOrNull(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}

function maxOrNull(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function overall(metrics: AnalysisMetric[]): Verdict {
  const evaluated = metrics.filter((metric) => metric.verdict !== 'not_evaluated');
  if (evaluated.length === 0) return 'not_evaluated';
  if (evaluated.some((metric) => metric.verdict === 'fail')) return 'fail';
  if (evaluated.some((metric) => metric.verdict === 'warning')) return 'warning';
  return 'pass';
}

function kappaVerdict(
  value: number | null,
  criterion: AcceptanceCriterion | undefined,
): Verdict {
  if (!criterion || !finite(value)) return 'not_evaluated';
  if (criterion.operator !== '>=') {
    return evaluateCriterion(value, criterion).verdict;
  }
  if (!Number.isFinite(criterion.limit)) return 'not_evaluated';
  if (value >= criterion.limit) return 'pass';
  const warning =
    criterion.limit2 !== undefined &&
    Number.isFinite(criterion.limit2) &&
    criterion.limit2 < criterion.limit
      ? criterion.limit2
      : null;
  if (warning !== null && value >= warning) return 'warning';
  return 'fail';
}

function kappaCriterionText(criterion: AcceptanceCriterion | undefined): string {
  if (!criterion) return 'Sem critério cadastrado';
  if (
    criterion.operator === '>=' &&
    criterion.limit2 !== undefined &&
    Number.isFinite(criterion.limit2) &&
    criterion.limit2 < criterion.limit
  ) {
    return `κ ≥ ${fmt(criterion.limit)} conforme; ${fmt(criterion.limit2)} ≤ κ < ${fmt(criterion.limit)} atenção; κ < ${fmt(criterion.limit2)} não conforme`;
  }
  return criterionText(criterion);
}

function metricFor(
  parameter: ParameterDef,
  key: string,
  value: number | null,
  criteria: AcceptanceCriterion[],
  options: {
    kappa?: boolean;
    coverage?: boolean;
    formula: string;
  },
): AnalysisMetric {
  const definition = parameter.metrics.find((metric) => metric.key === key);
  const criterion = criteria.find((item) => item.metric === key);

  let verdict: Verdict;
  if (options.kappa) {
    verdict = kappaVerdict(value, criterion);
  } else if (options.coverage) {
    if (!criterion || !finite(value)) {
      verdict = 'not_evaluated';
    } else if (criterion.operator === '>=') {
      verdict = value >= criterion.limit ? 'pass' : 'warning';
    } else {
      verdict = evaluateCriterion(value, criterion).verdict;
    }
  } else {
    verdict = criterion && finite(value)
      ? evaluateCriterion(value, criterion).verdict
      : 'not_evaluated';
  }

  return {
    key,
    label: definition?.label ?? key,
    value,
    unit: definition?.unit ?? '',
    verdict,
    criterionText: options.kappa
      ? kappaCriterionText(criterion)
      : criterion
        ? criterionText(criterion)
        : 'Sem critério cadastrado',
    formula: options.formula,
    reference: parameter.reference,
  };
}

function withoutReferenceWarnings(warnings: string[]): string[] {
  return warnings.filter(
    (warning) => !/referência|FAR|FRR|cobertura/i.test(warning),
  );
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(Boolean))];
}

function unavailable(
  parameter: ParameterDef,
  context: AnalysisContext,
): ParameterAnalysis {
  const data = context.attributeData;
  const reason =
    context.attributeError ??
    'Dados de atributo insuficientes para executar o estudo de concordância.';
  const result = emptyParameter(parameter, data?.validRows ?? 0, reason);
  result.warnings = uniqueWarnings([...(data?.warnings ?? []), reason]);
  result.rawMetrics = {
    items: data?.items.length ?? 0,
    raters: data?.raters.length ?? 0,
    observations: data?.validRows ?? 0,
    missing_category: data?.missingCategory ?? 0,
    missing_item: data?.missingItem ?? 0,
    missing_rater: data?.missingRater ?? 0,
    missing_reference: data?.missingReference ?? 0,
  };
  if (data) {
    result.tables = [
      {
        title: 'Diagnóstico dos dados de atributo',
        columns: ['Indicador', 'Valor'],
        rows: [
          ['Registros na coleta', data.totalRows],
          ['Observações válidas', data.validRows],
          ['Itens (amostras)', data.items.length],
          ['Avaliadores', data.raters.length],
          ['Sem categoria observada', data.missingCategory],
          ['Sem amostra', data.missingItem],
          ['Sem avaliador', data.missingRater],
          ['Sem referência', data.missingReference],
          ['Combinações duplicadas', data.duplicateCells],
        ],
        note:
          'O estudo não é executado enquanto houver referências conflitantes ou combinações item/avaliador/réplica duplicadas.',
      },
    ];
  }
  return result;
}

function accuracyAnalysis(
  parameter: ParameterDef,
  criteria: AcceptanceCriterion[],
  context: AnalysisContext,
): ParameterAnalysis {
  const study = context.attributeStudy;
  const data = context.attributeData;
  if (!study) return unavailable(parameter, context);

  const referenceKappas = study.vsReference
    .map((result) => result.kappa.kappa)
    .filter(finite);
  const effectivenessValues = study.vsReference
    .map((result) => result.effectiveness)
    .filter(finite);
  const farValues = study.vsReference
    .map((result) => result.falseAcceptRate)
    .filter(finite);
  const frrValues = study.vsReference
    .map((result) => result.falseRejectRate)
    .filter(finite);

  const kappaReference = minOrNull(referenceKappas);
  const effectiveness = minOrNull(effectivenessValues);
  const far = maxOrNull(farValues);
  const frr = maxOrNull(frrValues);
  const coverage = study.referenceCoveragePct;

  const metrics = [
    metricFor(parameter, 'kappa_reference', kappaReference, criteria, {
      kappa: true,
      formula:
        'κ = (p_o − p_e)/(1 − p_e), entre a classificação do avaliador e a referência',
    }),
    metricFor(parameter, 'effectiveness', effectiveness, criteria, {
      formula: 'eficácia = acertos/observações com referência',
    }),
    metricFor(parameter, 'far', far, criteria, {
      formula: 'FAR = falsos aceites/referências rejeitadas',
    }),
    metricFor(parameter, 'frr', frr, criteria, {
      formula: 'FRR = falsos rejeites/referências aceitas',
    }),
    metricFor(parameter, 'reference_coverage', coverage, criteria, {
      coverage: true,
      formula: '100·itens com referência/itens',
    }),
  ];

  const verdict = overall(metrics);
  const n = study.vsReference.reduce((sum, result) => sum + result.trials, 0);
  return {
    key: parameter.key,
    label: parameter.label,
    n,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `κ com a referência (pior avaliador) = ${fmt(kappaReference)}; eficácia = ${fmt(effectiveness)}; cobertura = ${fmt(coverage)}%.`,
    ),
    metrics,
    rawMetrics: {
      ...study.rawMetrics,
      kappa_reference: kappaReference,
      effectiveness,
      far,
      frr,
      reference_coverage: coverage,
    },
    tables: study.tables.filter((table) =>
      /Resumo|referência|Matriz/.test(table.title),
    ),
    charts: study.charts,
    warnings: uniqueWarnings([...(data?.warnings ?? []), ...study.warnings]),
    notes: [
      ...study.notes,
      'A métrica de kappa com a referência usa o pior caso entre avaliadores; as tabelas mostram cada avaliador separadamente.',
      'Cobertura de referência abaixo do mínimo é sinalizada como atenção, pois limita a conclusão sobre exatidão.',
    ],
    reference: parameter.reference,
    results: { attribute: study },
  };
}

function repeatabilityAnalysis(
  parameter: ParameterDef,
  criteria: AcceptanceCriterion[],
  context: AnalysisContext,
): ParameterAnalysis {
  const study = context.attributeStudy;
  const data = context.attributeData;
  if (!study) return unavailable(parameter, context);

  const intraKappas = study.intraRater
    .map((result) => result.kappa.kappa)
    .filter(finite);
  const intraPo = study.intraRater
    .map((result) => result.kappa.po)
    .filter(finite);
  const kappaIntra = minOrNull(intraKappas);
  const poIntra = minOrNull(intraPo);

  const metrics = [
    metricFor(parameter, 'kappa_intra', kappaIntra, criteria, {
      kappa: true,
      formula: 'κ de Fleiss entre as réplicas de cada avaliador',
    }),
    metricFor(parameter, 'po_intra', poIntra, criteria, {
      formula: 'p_o intra = concordância observada entre réplicas',
    }),
  ];

  const verdict = overall(metrics);
  const n = study.intraRater.reduce(
    (sum, result) => sum + result.items * result.replicates,
    0,
  );
  return {
    key: parameter.key,
    label: parameter.label,
    n,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `κ intra-avaliador (pior avaliador) = ${fmt(kappaIntra)}; p_o = ${fmt(poIntra)}.`,
    ),
    metrics,
    rawMetrics: {
      ...study.rawMetrics,
      kappa_intra: kappaIntra,
      po_intra: poIntra,
    },
    tables: study.tables.filter((table) =>
      /Resumo|intra-avaliador/.test(table.title),
    ),
    charts: study.charts.filter((chart) => /Kappa/i.test(chart.title)),
    warnings: uniqueWarnings([
      ...(data?.warnings ?? []),
      ...withoutReferenceWarnings(study.warnings),
      ...study.intraRater.flatMap((result) => result.warnings),
    ]),
    notes: [
      ...study.notes,
      'A repetibilidade de atributo é a concordância do mesmo avaliador entre réplicas; ela não mede a exatidão contra a referência.',
    ],
    reference: parameter.reference,
    results: { attribute: study },
  };
}

function intermediatePrecisionAnalysis(
  parameter: ParameterDef,
  criteria: AcceptanceCriterion[],
  context: AnalysisContext,
): ParameterAnalysis {
  const study = context.attributeStudy;
  const data = context.attributeData;
  if (!study) return unavailable(parameter, context);

  const kappaInter = study.interRater.kappa;
  const poInter = study.interRater.po;
  const metrics = [
    metricFor(parameter, 'kappa_inter', kappaInter, criteria, {
      kappa: true,
      formula: 'κ de Cohen (2 avaliadores) ou Fleiss (3+) na primeira réplica',
    }),
    metricFor(parameter, 'po_inter', poInter, criteria, {
      formula: 'p_o inter = concordância observada entre avaliadores',
    }),
  ];

  const verdict = overall(metrics);
  const n = study.interRater.ratings || study.n;
  return {
    key: parameter.key,
    label: parameter.label,
    n,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `κ interavaliadores = ${fmt(kappaInter)} (IC ${fmt(study.interRater.ciLow)}–${fmt(study.interRater.ciHigh)}); p_o = ${fmt(poInter)}.`,
    ),
    metrics,
    rawMetrics: {
      ...study.rawMetrics,
      kappa_inter: kappaInter,
      po_inter: poInter,
    },
    tables: study.tables.filter((table) =>
      /Resumo|pares de avaliadores/.test(table.title),
    ),
    charts: study.charts.filter((chart) => /Kappa/i.test(chart.title)),
    warnings: uniqueWarnings([
      ...(data?.warnings ?? []),
      ...withoutReferenceWarnings(study.warnings),
      ...study.interRater.warnings,
    ]),
    notes: [
      ...study.notes,
      'A precisão intermediária de atributo usa a primeira réplica de cada item; a concordância intra-avaliador é avaliada no parâmetro de repetibilidade.',
    ],
    reference: parameter.reference,
    results: { attribute: study },
  };
}

export const attributeAccuracyAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => accuracyAnalysis(parameter, criteria, context);

export const attributeRepeatabilityAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => repeatabilityAnalysis(parameter, criteria, context);

export const attributeIntermediatePrecisionAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => intermediatePrecisionAnalysis(parameter, criteria, context);
