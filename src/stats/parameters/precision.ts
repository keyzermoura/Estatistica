/**
 * Repetibilidade e precisão intermediária — módulo do perfil analítico.
 *
 * A repetibilidade usa a variância combinada dentro dos níveis. A precisão
 * intermediária acrescenta o componente entre combinações de analista, dia e
 * equipamento (modelo aleatório de um fator).
 *
 * Referências: ISO 5725-2:2019; ISO 5725-3; ISO/IEC 17025:2017, 7.2.2.
 */

import type { AcceptanceCriterion, Measurement } from '../../lib/types';
import type { AnalysisModule, ParameterAnalysis } from '../analysis-types';
import { buildMetric, emptyParameter, parameterSummary, pooledWithinVariance } from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';
import { anovaOneWay } from '../anova';
import { describe, mean } from '../descriptive';
import type { ParameterDef } from '../../profiles/types';

export type PrecisionKind = 'repeatability' | 'intermediate_precision';

function precisionAnalysis(
  kind: PrecisionKind,
  parameter: ParameterDef,
  measurements: Measurement[],
  criteria: AcceptanceCriterion[],
): ParameterAnalysis {
  const byLevel = new Map<string, number[]>();
  for (const m of measurements) {
    if (m.value === null) continue;
    const k = m.level || 'geral';
    const list = byLevel.get(k) ?? [];
    list.push(m.value);
    byLevel.set(k, list);
  }
  const groups = [...byLevel.values()].filter((g) => g.length >= 2);
  if (!groups.length) {
    return emptyParameter(
      parameter,
      measurements.length,
      'São necessárias pelo menos 2 réplicas no mesmo nível.',
    );
  }
  const overallMean = mean(groups.flat());
  const within = pooledWithinVariance(groups);
  let between = 0;
  let intermediateSd = Math.sqrt(within.variance);
  const subsets = new Map<string, number[]>();
  if (kind === 'intermediate_precision') {
    for (const m of measurements) {
      if (m.value === null) continue;
      const k = `${m.analyst || '—'}|${m.day || '—'}|${m.equipment || '—'}`;
      const list = subsets.get(k) ?? [];
      list.push(m.value);
      subsets.set(k, list);
    }
    const cellGroups = [...subsets.values()].filter((g) => g.length >= 2);
    if (cellGroups.length > 1) {
      const oneWay = anovaOneWay(
        cellGroups.map((values, i) => ({ name: `c${i + 1}`, values })),
      );
      const n0 =
        cellGroups.reduce((acc, g) => acc + g.length, 0) /
        cellGroups.length;
      if (oneWay.msError !== null && Number.isFinite(oneWay.msError)) {
        between = Math.max(0, ((oneWay.rows[0]?.ms ?? 0) - oneWay.msError) / (n0 || 1));
      }
    }
    intermediateSd = Math.sqrt(within.variance + between);
  }
  const cv = overallMean !== 0 ? (100 * intermediateSd) / Math.abs(overallMean) : null;
  const rawMetrics: Record<string, number | null> =
    kind === 'repeatability'
      ? { cv, sr: Math.sqrt(within.variance) }
      : { cv, sd: intermediateSd };
  const verdict = evaluateParameter(parameter.key, rawMetrics, criteria).verdict;
  const metrics = [
    buildMetric(
      parameter,
      'cv',
      cv,
      criteria,
      'CV = 100·s/média',
      'ISO 5725-2:2019; ISO 5725-3',
    ),
    buildMetric(
      parameter,
      kind === 'repeatability' ? 'sr' : 'sd',
      kind === 'repeatability' ? Math.sqrt(within.variance) : intermediateSd,
      criteria,
      kind === 'repeatability'
        ? 's_r = √(Σ(n_i−1)s_i² / Σ(n_i−1))'
        : 's_ip = √(s_r² + s_entre²)',
      'ISO 5725-2/3',
    ),
  ];
  const tableRows = groups.map((g, i) => {
    const s = describe(g);
    return [
      [...byLevel.keys()][i] ?? `Grupo ${i + 1}`,
      s.n,
      s.mean ?? '',
      s.sd ?? '',
      s.cv ?? '',
    ];
  });
  return {
    key: parameter.key,
    label: parameter.label,
    n: groups.reduce((acc, g) => acc + g.length, 0),
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `s = ${intermediateSd.toPrecision(4)}; CV = ${cv?.toFixed(2) ?? '—'}% (${within.df} g.l. dentro dos grupos).`,
    ),
    metrics,
    rawMetrics,
    tables: [
      {
        title: 'Precisão por nível',
        columns: ['Nível', 'n', 'Média', 's', 'CV (%)'],
        rows: tableRows,
      },
    ],
    charts: [],
    warnings:
      kind === 'intermediate_precision' && between === 0
        ? ['Não foi detectada variabilidade entre analistas/dias/equipamentos; verifique se o desenho permite estimá-la.']
        : [],
    notes: [
      kind === 'repeatability'
        ? 'Variabilidade dentro do mesmo nível (mesmo laboratório, analista e dia, quando aplicável).'
        : 'Componente entre combinações de analista × dia × equipamento.',
    ],
    reference: 'ISO 5725-2:2019; ISO 5725-3; ISO/IEC 17025:2017, 7.2.2',
    results: {
      pooledVariance: within.variance,
      pooledDf: within.df,
      betweenVariance: between,
      intermediateSd,
      mean: overallMean,
      groups: tableRows,
    },
  };
}

export function makePrecisionAnalysis(kind: PrecisionKind): AnalysisModule {
  return ({ parameter, criteria, context }) =>
    precisionAnalysis(kind, parameter, context.used, criteria);
}
