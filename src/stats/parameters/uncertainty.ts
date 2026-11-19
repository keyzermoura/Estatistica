/**
 * Incerteza de medição — módulo do perfil analítico.
 *
 * Usa o orçamento GUM cadastrado na etapa de análise. Quando não há fontes, o
 * parâmetro fica não avaliado. Nenhuma fonte é criada automaticamente.
 *
 * Referências: JCGM 100:2008 (GUM); JCGM 101:2008; EURACHEM/CITAC (2012).
 */

import type { AnalysisModule } from '../analysis-types';
import { buildMetric, emptyParameter, parameterSummary } from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';
import { computeUncertainty } from '../uncertainty';

export const uncertaintyAnalysis: AnalysisModule = ({ parameter, criteria, context }) => {
  const items = context.uncertaintyItems;
  const observedMean = context.observedMean;
  if (!items.length) {
    return emptyParameter(
      parameter,
      observedMean === null ? 0 : 1,
      'Cadastre as fontes no orçamento de incerteza (etapa Análise).',
    );
  }
  const result = computeUncertainty(
    items.map((i) => ({
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
  );
  const relative =
    observedMean && observedMean !== 0 ? (100 * result.expanded) / Math.abs(observedMean) : null;
  const rawMetrics = { expanded: result.expanded, relativeExpanded: relative };
  const evaluated = evaluateParameter(parameter.key, rawMetrics, criteria);
  const isDofIncomplete = result.dofComplete === false;
  const verdict = isDofIncomplete ? 'not_evaluated' : evaluated.verdict;
  const dofIncompleteNote = isDofIncomplete
    ? 'O parâmetro de incerteza de medição permanece Não Avaliado porque existem fontes experimentais (Tipo A) com graus de liberdade ausentes, impedindo a determinação formal de ν_eff e do fator de abrangência k pela fórmula de Welch–Satterthwaite (JCGM 100:2008 §G.4).'
    : null;
  return {
    key: parameter.key,
    label: parameter.label,
    n: observedMean === null ? 0 : 1,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `u_c = ${result.combined.toPrecision(4)}; U = ${result.expanded.toPrecision(4)}${isDofIncomplete ? ' (provisório)' : ''} (k = ${result.coverageFactor.toFixed(3)}${isDofIncomplete ? ' provisório' : ''}, ν_eff ≈ ${result.effectiveDof?.toFixed(1) ?? (isDofIncomplete ? '— [incompleto]' : '—')}).${isDofIncomplete ? ' GL Tipo A ausentes: conformidade não avaliada.' : ''}`,
    ),
    metrics: [
      buildMetric(parameter, 'expanded', result.expanded, criteria, 'U = k·u_c', result.reference),
      buildMetric(parameter, 'relativeExpanded', relative, criteria, 'U_rel = 100·U/valor', result.reference),
    ],
    rawMetrics,
    tables: [
      {
        title: 'Orçamento de incerteza',
        columns: ['Fonte', 'Tipo', 'Valor', 'Divisor', 'c_i', 'u_i', '% contribuição', 'ν'],
        rows: result.items.map((i) => [
          i.source,
          i.type,
          i.value,
          i.divisor,
          i.sensitivity,
          i.stdUncertainty,
          i.percentContribution,
          i.dof ?? '',
        ]),
      },
    ],
    charts: [
      {
        kind: 'bar',
        title: 'Contribuição relativa das fontes de incerteza',
        xLabel: 'Fonte',
        yLabel: '%',
        data: result.items.map((i) => ({ fonte: i.source, contribuicao: i.percentContribution })),
      },
    ],
    warnings: result.warnings,
    notes: dofIncompleteNote ? [dofIncompleteNote] : [],
    reference: result.reference,
    results: { uncertainty: result },
  };
};
