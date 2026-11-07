/**
 * Robustez — módulo do perfil analítico.
 *
 * Avaliação exploratória por ANOVA de um fator para analista, dia, equipamento
 * e lote. Efeitos padronizados e p-valores são exibidos; nenhum ponto é
 * excluído. Para robustez formal, o delineamento fatorial 2^k é recomendado.
 *
 * Referências: ICH Q2(R2); Youden & Steiner; Montgomery (2020), cap. 6.
 */

import type { AnalysisModule } from '../analysis-types';
import { buildMetric, emptyParameter, parameterSummary } from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';
import { anovaOneWay } from '../anova';
import { mean, sd } from '../descriptive';
import type { Measurement } from '../../lib/types';

export const robustnessAnalysis: AnalysisModule = ({ parameter, criteria, context }) => {
  const measurements = context.used;
  const factors: Array<{ name: string; get: (m: Measurement) => string }> = [
    { name: 'Analista', get: (m) => m.analyst },
    { name: 'Dia', get: (m) => m.day },
    { name: 'Equipamento', get: (m) => m.equipment },
    { name: 'Lote', get: (m) => m.lot },
  ];
  let maxEffect = 0;
  let minP = 1;
  const effects: Array<{ factor: string; levels: number; effect: number; p: number }> = [];
  for (const factor of factors) {
    const groups = new Map<string, number[]>();
    for (const m of measurements) {
      if (m.value === null) continue;
      const k = factor.get(m);
      if (!k) continue;
      const list = groups.get(k) ?? [];
      list.push(m.value);
      groups.set(k, list);
    }
    if (groups.size < 2) continue;
    const groupList = [...groups.entries()].map(([name, values]) => ({ name, values }));
    if (groupList.some((g) => g.values.length < 2)) continue;
    const anova = anovaOneWay(groupList);
    const p = anova.rows[0]?.p ?? 1;
    const means = groupList.map((g) => mean(g.values));
    const pooled = Math.sqrt(groupList.reduce((acc, g) => acc + sd(g.values) ** 2, 0) / groupList.length);
    const effect = pooled > 0 ? (Math.max(...means) - Math.min(...means)) / pooled : 0;
    effects.push({ factor: factor.name, levels: groups.size, effect, p: p ?? 1 });
    maxEffect = Math.max(maxEffect, effect);
    minP = Math.min(minP, p ?? 1);
  }
  if (!effects.length) {
    return emptyParameter(
      parameter,
      measurements.length,
      'O desenho precisa de pelo menos dois níveis em um fator (analista, dia, equipamento ou lote).',
    );
  }
  const rawMetrics = { maxEffect, criticalFactorP: minP };
  const verdict = evaluateParameter(parameter.key, rawMetrics, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: measurements.filter((m) => m.value !== null).length,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `Maior efeito padronizado = ${maxEffect.toFixed(3)}; menor p entre fatores = ${minP.toFixed(4)}.`,
    ),
    metrics: [
      buildMetric(parameter, 'maxEffect', maxEffect, criteria, 'Efeito = (máx − mín médias)/s_pooled'),
      buildMetric(parameter, 'criticalFactorP', minP, criteria, 'p da ANOVA do fator'),
    ],
    rawMetrics,
    tables: [
      {
        title: 'Efeitos dos fatores',
        columns: ['Fator', 'Níveis', 'Efeito padronizado', 'p'],
        rows: effects.map((e) => [e.factor, e.levels, e.effect, e.p]),
      },
    ],
    charts: [
      {
        kind: 'bar',
        title: 'Efeito padronizado por fator',
        xLabel: 'Fator',
        yLabel: 'Efeito',
        data: effects.map((e) => ({ fator: e.factor, efeito: e.effect })),
      },
    ],
    warnings: ['Avaliação exploratória; para robustez formal use fatorial 2^k com efeitos de interação.'],
    notes: ['Efeito padronizado > 2 sugere sensibilidade prática relevante.'],
    reference: 'ICH Q2(R2); Youden & Steiner; Montgomery (2020), cap. 6',
    results: { effects },
  };
};
