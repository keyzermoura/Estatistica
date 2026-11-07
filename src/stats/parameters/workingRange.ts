/**
 * Faixa de trabalho — módulo do perfil analítico.
 *
 * Apenas exibe a faixa coberta pelos níveis numéricos observados. A faixa não
 * é declarada conforme só por existir: depende da linearidade, exatidão e
 * precisão nos extremos, com critério cadastrado.
 *
 * Referências: ISO/IEC 17025:2017, 7.2.2; ICH Q2(R2).
 */

import type { Verdict } from '../../lib/types';
import type { AnalysisModule } from '../analysis-types';
import { emptyParameter } from '../analysis-utils';

export const workingRangeAnalysis: AnalysisModule = ({ parameter, context }) => {
  const uniqueLevels = context.uniqueLevels;
  const n = context.used.length;
  if (!uniqueLevels.length) {
    return emptyParameter(
      parameter,
      n,
      'Use níveis numéricos para determinar a faixa observada.',
    );
  }
  const min = Math.min(...uniqueLevels);
  const max = Math.max(...uniqueLevels);
  const raw = { rangeMin: min, rangeMax: max };
  const metrics = [
    {
      key: 'rangeMin',
      label: 'Menor nível ensaiado',
      value: min,
      unit: '',
      verdict: 'not_evaluated' as Verdict,
      criterionText: 'Faixa observada',
    },
    {
      key: 'rangeMax',
      label: 'Maior nível ensaiado',
      value: max,
      unit: '',
      verdict: 'not_evaluated' as Verdict,
      criterionText: 'Faixa observada',
    },
  ];
  return {
    key: parameter.key,
    label: parameter.label,
    n,
    verdict: 'not_evaluated',
    summary: `Faixa de trabalho observada: ${min} a ${max}. Verifique se cobre o escopo declarado.`,
    metrics,
    rawMetrics: raw,
    tables: [],
    charts: [],
    warnings: [],
    notes: ['A faixa só é considerada validada se os critérios de linearidade/exatidão/precisão forem atendidos nos extremos.'],
    reference: 'ISO/IEC 17025:2017, 7.2.2; ICH Q2(R2)',
    results: { rangeMin: min, rangeMax: max },
  };
};
