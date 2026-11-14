/**
 * Orquestração da análise estatística de uma validação.
 *
 * Recebe dados brutos + parâmetros selecionados + critérios e devolve um
 * resultado estruturado, com métricas, veredito e material para relatório.
 * Nenhuma métrica é inventada: quando não há dados suficientes, o resultado
 * fica explicitamente "não avaliado".
 *
 * O que é específico de uma família de ensaios (catálogo de parâmetros,
 * módulos de cálculo, critérios e pressupostos padrão) vem do perfil de método.
 * A orquestração, o veredito global e o controle de qualidade permanecem
 * genéricos.
 */

import type {
  AcceptanceCriterion,
  Measurement,
  ValidationParameter,
  Verdict,
} from '../lib/types';
import { resolveCriteriaDetailed } from '../lib/criteria';
import { DEFAULT_PROFILE_ID, getProfile } from '../profiles/index';
import type { MethodProfile } from '../profiles/types';
import { describe, mean, describeGroups } from './descriptive';
import { grubbsTest } from './outliers';
import { normalitySuite, shapiroWilk } from './normality';
import { homogeneitySuite } from './variance';
import { anovaOneWay } from './anova';
import { iso5725Analysis } from './iso5725';
import { biasTest, recoveryTest, tost } from './bias';
import { linearRegression } from './regression';
import { computeUncertainty } from './uncertainty';
import {
  accuracyPairsFrom,
  numericLevel,
  unique,
  withinGroupResiduals,
} from './analysis-utils';
import {
  attributeStudyCriteria,
  buildAttributeStudy,
} from './attribute-data';
import type {
  AnalysisContext,
  AnalysisOptions,
  ParameterAnalysis,
  QcSummary,
  ValidationAnalysis,
} from './analysis-types';

export type {
  AnalysisChart,
  AnalysisMetric,
  AnalysisModule,
  AnalysisModuleInput,
  AnalysisOptions,
  AnalysisTable,
  AttributeQc,
  DimensionalConformityOptions,
  ParameterAnalysis,
  QcSummary,
  ValidationAnalysis,
} from './analysis-types';

function profileParameter(profile: MethodProfile, key: ValidationParameter['key']) {
  const parameter = profile.parameters.find((def) => def.key === key);
  if (!parameter) {
    throw new Error(
      `Parâmetro "${key}" não pertence ao perfil de método "${profile.id}".`,
    );
  }
  return parameter;
}

export function analyzeValidation(
  parameters: ValidationParameter[],
  measurements: Measurement[],
  criteria: AcceptanceCriterion[],
  options: AnalysisOptions = {},
): ValidationAnalysis {
  const profile = getProfile(options.profileId ?? DEFAULT_PROFILE_ID);
  const attributeMode = profile.id === 'attribute';
  const selected = parameters.filter((p) => p.selected);
  const numericUsed = measurements.filter(
    (m) => m.value !== null && Number.isFinite(m.value),
  );
  // No perfil de atributo, todas as linhas são candidatas; o mapeamento e a
  // validação de amostra/avaliador/categoria ficam em attribute-data.ts.
  const used = attributeMode ? measurements : numericUsed;
  const values = attributeMode ? [] : numericUsed.map((m) => m.value!);
  const warnings: string[] = [];
  const analyses: ParameterAnalysis[] = [];

  const resolvedCriteria = selected.map((selection) => ({
    selection,
    items: resolveCriteriaDetailed(criteria, selection.criteria, selection.key),
  }));
  const attributeCriteria = attributeStudyCriteria(
    resolvedCriteria.flatMap(({ items }) => items.map((item) => item.criterion)),
  );
  const resolvedByKey = new Map(
    resolvedCriteria.map(({ selection, items }) => [selection.key, items] as const),
  );
  const overriddenCriteria = resolvedCriteria.flatMap(({ selection, items }) => {
    const parameter = profileParameter(profile, selection.key);
    return items
      .filter((item) => item.replaced !== null)
      .map((item) => {
        const metric = parameter.metrics.find((def) => def.key === item.criterion.metric);
        return `${parameter.label} (${metric?.label ?? item.criterion.metric})`;
      });
  });
  const criteriaAssumptions = overriddenCriteria.length
    ? [
        `Critérios específicos desta validação substituem os globais do método para a mesma métrica: ${[
          ...new Set(overriddenCriteria),
        ].join(', ')}.`,
      ]
    : [];
  const attributeOutcome = attributeMode
    ? buildAttributeStudy(measurements, { criteria: attributeCriteria })
    : null;

  const numericLevels = numericUsed
    .map((m) => numericLevel(m.level))
    .filter((v): v is number => v !== null);
  const uniqueLevels = [...new Set(numericLevels)].sort((a, b) => a - b);
  const regressionPoints = numericUsed
    .filter((m) => numericLevel(m.level) !== null)
    .map((m) => ({ x: numericLevel(m.level)!, y: m.value! }));
  const regression =
    uniqueLevels.length >= 3 && numericLevels.length >= 3
      ? linearRegression(regressionPoints, options.confidence ?? 0.95, options.alpha ?? 0.05)
      : null;
  const levelGroups = [...new Set(numericUsed.map((m) => m.level || 'geral'))].map((level) => ({
    name: level,
    values: numericUsed.filter((m) => (m.level || 'geral') === level).map((m) => m.value!),
  }));
  const residuals = withinGroupResiduals(numericUsed);
  const normality = residuals.length >= 3 ? shapiroWilk(residuals, options.alpha ?? 0.05) : null;
  const normalityAll = values.length >= 3 ? normalitySuite(values, options.alpha ?? 0.05) : null;
  const homogeneity = levelGroups.length >= 2 ? homogeneitySuite(levelGroups.map((g) => g.values), options.alpha ?? 0.05) : null;
  const anova = levelGroups.length >= 2 ? anovaOneWay(levelGroups, options.alpha ?? 0.05) : null;
  const labKey = (m: Measurement) => m.analyst || m.lot;
  const labs = unique(numericUsed.map(labKey));
  const iso5725 =
    labs.length >= 2 && unique(numericUsed.map((m) => m.level)).length >= 1
      ? iso5725Analysis(
          numericUsed.map((m) => ({
            lab: labKey(m) || 'Lab 1',
            level: m.level || 'nível',
            replicate: m.replicate,
            value: m.value!,
          })),
        )
      : null;
  const accuracyPairs = accuracyPairsFrom(numericUsed);
  const bias =
    accuracyPairs.length >= 2
      ? biasTest(
          accuracyPairs.map((p) => p.measured),
          accuracyPairs.map((p) => p.reference),
          options.alpha ?? 0.05,
          options.confidence ?? 0.95,
        )
      : null;
  const recovery =
    accuracyPairs.length >= 2
      ? recoveryTest(
          accuracyPairs.map((p) => p.measured),
          accuracyPairs.map((p) => p.reference),
          options.alpha ?? 0.05,
        )
      : null;
  const equivalence =
    accuracyPairs.length >= 2
      ? tost(
          accuracyPairs.map((p) => p.measured),
          accuracyPairs.map((p) => p.reference),
          options.margin && options.margin > 0 ? options.margin : 1,
          options.alpha ?? 0.05,
        )
      : null;
  const uncertaintyItems = options.uncertaintyItems ?? [];
  const uncertainty = uncertaintyItems.length
    ? computeUncertainty(
        uncertaintyItems.map((i) => ({
          id: i.id,
          source: i.source,
          type: i.type,
          distribution: i.distribution,
          value: i.value,
          divisor: i.divisor,
          sensitivity: i.sensitivity,
          dof: i.dof,
          notes: i.notes,
        })),
      )
    : null;
  const observedMean = values.length ? mean(values) : null;

  const context: AnalysisContext = {
    all: measurements,
    used,
    values,
    options,
    uniqueLevels,
    regressionPoints,
    regression,
    iso5725,
    uncertaintyItems,
    observedMean,
    attributeData: attributeOutcome?.data ?? null,
    attributeStudy: attributeOutcome?.study ?? null,
    attributeError: attributeOutcome?.error ?? null,
  };

  for (const selection of selected) {
    const key = selection.key;
    const parameter = profileParameter(profile, key);
    const analysis = profile.analyses[key];
    if (!analysis) {
      throw new Error(
        `O perfil de método "${profile.id}" não define análise para o parâmetro "${key}".`,
      );
    }
    const criteriaForKey = (resolvedByKey.get(key) ?? []).map((item) => item.criterion);
    analyses.push(analysis({ parameter, criteria: criteriaForKey, context }));
  }

  const fail = analyses.some((a) => a.verdict === 'fail');
  const notEvaluated = analyses.some((a) => a.verdict === 'not_evaluated');
  const passAll = analyses.length > 0 && analyses.every((a) => a.verdict === 'pass');
  const overallVerdict: Verdict = fail ? 'fail' : passAll ? 'pass' : notEvaluated || analyses.length === 0 ? 'not_evaluated' : 'warning';

  if (attributeMode) {
    if (attributeOutcome?.error) {
      warnings.push(`Estudo de atributo: ${attributeOutcome.error}`);
    }
    for (const warning of attributeOutcome?.data.warnings ?? []) warnings.push(warning);
    for (const warning of attributeOutcome?.study?.warnings ?? []) warnings.push(warning);
    if (!attributeOutcome?.study) {
      warnings.push(
        'Os parâmetros de atributo permanecem não avaliados até que os dados de coleta sejam corrigidos.',
      );
    }
  } else {
    if (!numericUsed.length) warnings.push('Nenhuma medição numérica disponível.');
    if (numericUsed.length && numericUsed.length < 6) warnings.push('Menos de 6 medições: interpretação limitada.');
    if (normality && !normality.normal) warnings.push(normality.interpretation);
    if (homogeneity && !homogeneity.primary.homogeneous) warnings.push(homogeneity.conclusion);
  }

  return {
    nTotal: measurements.length,
    nUsed: attributeMode ? attributeOutcome?.data.validRows ?? 0 : numericUsed.length,
    overallVerdict,
    parameters: analyses,
    qc: {
      descriptive: describe(values),
      byLevel: describeGroups(numericUsed, (m) => m.level || 'geral', (m) => m.value),
      byAnalyst: describeGroups(numericUsed, (m) => m.analyst || '—', (m) => m.value),
      byDay: describeGroups(numericUsed, (m) => m.day || '—', (m) => m.value),
      byEquipment: describeGroups(numericUsed, (m) => m.equipment || '—', (m) => m.value),
      outliers: values.length >= 3 ? grubbsTest(values, options.alpha ?? 0.05) : null,
      normality,
      normalitySuite: normalityAll,
      homogeneity: homogeneity?.primary ?? null,
      homogeneitySuite: homogeneity,
      anova,
      iso5725,
      regression,
      bias,
      recovery,
      tost: equivalence,
      uncertainty,
      attribute: attributeMode
        ? {
            data: attributeOutcome?.data ?? null,
            study: attributeOutcome?.study ?? null,
            error: attributeOutcome?.error ?? null,
          }
        : null,
      residualChart:
        regression && regression.residuals.length
          ? {
              kind: 'residual',
              title: 'Resíduos vs. valor ajustado',
              xLabel: 'Ajustado',
              yLabel: 'Resíduo',
              data: regression.residuals.map((r) => ({ x: r.fitted, y: r.residual })),
            }
          : null,
      calibrationChart:
        regressionPoints.length >= 3
          ? {
              kind: 'scatter',
              title: 'Dispersão e reta de calibração',
              xLabel: 'Nível',
              yLabel: 'Resposta',
              data: regressionPoints.map((p) => ({ x: p.x, y: p.y })),
            }
          : null,
    },
    warnings: [...new Set(warnings)],
    assumptions: attributeMode
      ? [
          'Classificações independentes; avaliadores não conhecem a referência durante a classificação.',
          'A referência do item é a categoria registrada em “Nível” (ou o valor de referência numérico).',
          'Dados faltantes tratados por lista (listwise), com n efetivo registrado; nenhuma observação é removida silenciosamente.',
          `Confiança = ${((options.confidence ?? 0.95) * 100).toFixed(0)}%; κ e intervalos calculados com essa confiança.`,
          ...criteriaAssumptions,
        ]
      : [
          'Observações independentes; ausência de erros de transcrição não pode ser provada pelo software.',
          'Dados faltantes tratados por lista (listwise), com n efetivo registrado.',
          `α = ${options.alpha ?? 0.05}; confiança = ${((options.confidence ?? 0.95) * 100).toFixed(0)}%.`,
          ...criteriaAssumptions,
        ],
    generatedAt: new Date().toISOString(),
  };
}
