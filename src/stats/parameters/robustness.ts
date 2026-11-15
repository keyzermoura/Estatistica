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
import { mean, quantile, sd } from '../descriptive';
import { tInv } from '../distributions';
import type { Measurement } from '../../lib/types';

export const robustnessAnalysis: AnalysisModule = ({ parameter, criteria, context }) => {
  const measurements = context.used;
  const alpha = context.options.alpha ?? 0.05;
  const factors: Array<{ name: string; get: (m: Measurement) => string }> = [
    { name: 'Analista', get: (m) => m.analyst },
    { name: 'Dia', get: (m) => m.day },
    { name: 'Equipamento', get: (m) => m.equipment },
    { name: 'Lote', get: (m) => m.lot },
  ];
  let maxEffect = 0;
  let minP = 1;
  const effects: Array<{
    factor: string;
    levels: number;
    effect: number;
    p: number;
    youdenCrit: number;
    significant: boolean;
  }> = [];
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
    const nTotal = groupList.reduce((acc, g) => acc + g.values.length, 0);
    const df = Math.max(1, nTotal - groupList.length);
    const nAvg = nTotal / groupList.length;
    const youdenCrit = tInv(1 - alpha / 2, df) * Math.sqrt(2 / Math.max(1, nAvg));
    const pVal = p ?? 1;
    const significant = pVal < alpha || effect > youdenCrit;
    effects.push({
      factor: factor.name,
      levels: groups.size,
      effect,
      p: pVal,
      youdenCrit,
      significant,
    });
    maxEffect = Math.max(maxEffect, effect);
    minP = Math.min(minP, pVal);
  }
  if (!effects.length) {
    return emptyParameter(
      parameter,
      measurements.length,
      'O desenho precisa de pelo menos dois níveis em um fator (analista, dia, equipamento ou lote).',
    );
  }

  let lenthMe: number | null = null;
  let lenthSme: number | null = null;
  if (effects.length >= 3) {
    const absSorted = effects.map((e) => Math.abs(e.effect)).sort((a, b) => a - b);
    const s0 = 1.5 * quantile(absSorted, 0.5);
    const trimmed = absSorted.filter((v) => v <= 2.5 * s0);
    const pse = 1.5 * quantile(trimmed.length ? trimmed : absSorted, 0.5);
    const m = effects.length;
    const dfLenth = Math.max(1, m / 3);
    lenthMe = tInv(0.975, dfLenth) * pse;
    const gammaSme = (1 + Math.pow(0.95, 1 / m)) / 2;
    lenthSme = tInv(gammaSme, dfLenth) * pse;
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
        title: 'Efeitos dos fatores (ANOVA & Limite Crítico de Youden)',
        columns: ['Fator', 'Níveis', 'Efeito padronizado', 'p', 'Limite Youden (d_crit)', 'Conclusão'],
        rows: effects.map((e) => [
          e.factor,
          e.levels,
          e.effect,
          e.p,
          e.youdenCrit,
          e.significant ? 'Sensível (significativo)' : 'Robusto (NS)',
        ]),
        note:
          lenthMe !== null && lenthSme !== null
            ? `Limites de Lenth (efeitos múltiplos): ME = ${lenthMe.toFixed(3)}; SME = ${lenthSme.toFixed(3)}.`
            : 'Para ≥ 3 fatores avaliados simultaneamente, os limites ME/SME de Lenth são calculados automaticamente.',
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
    warnings: ['Avaliação por variação deliberada de fatores; para interações de 2ª ordem use fatorial completo/fracionário 2^k.'],
    notes: [
      'Efeito padronizado > Limite de Youden (d_crit) ou > 2 indica sensibilidade prática relevante que requer controle em POP.',
      ...(lenthMe !== null ? [`Margem de Erro de Lenth (ME 95%): ${lenthMe.toFixed(3)} (SME: ${lenthSme?.toFixed(3) ?? '—'}).`] : []),
    ],
    reference: 'ICH Q2(R2); Youden & Steiner; Lenth (1989); Montgomery (2020), cap. 6',
    results: { effects, lenthMe, lenthSme },
  };
};
