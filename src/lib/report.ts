/**
 * Composição do relatório auditável a partir do bundle e da análise.
 * O relatório guarda os valores congelados e um hash de auditoria.
 */

import type {
  ParameterAnalysis,
  ValidationAnalysis,
} from '../stats/analysis';
import type {
  ReportContent,
  ReportRecord,
  ValidationBundle,
  Verdict,
} from './types';
import { fmt } from '../stats/distributions';
import { attributeObservationsFrom } from '../stats/attribute-data';
import { nowIso, objectHash, uid } from './utils';

export const VERDICT_LABELS: Record<Verdict, string> = {
  pass: 'Conforme',
  fail: 'Não conforme',
  warning: 'Atenção',
  not_evaluated: 'Não avaliado',
};

function conclusionFor(analysis: ValidationAnalysis): string {
  const failed = analysis.parameters.filter((p) => p.verdict === 'fail');
  const notEvaluated = analysis.parameters.filter((p) => p.verdict === 'not_evaluated');
  if (!analysis.parameters.length) {
    return 'Não há parâmetros selecionados; não é possível concluir sobre a adequação do método.';
  }
  if (failed.length) {
    return `O método não atende integralmente aos critérios de aceitação. Parâmetros não conformes: ${failed
      .map((p) => p.label)
      .join(', ')}. Recomenda-se investigar as causas, corrigir o método e repetir a validação antes de uso rotineiro.`;
  }
  if (notEvaluated.length) {
    return `A validação está incompleta: ${notEvaluated
      .map((p) => p.label)
      .join(', ')} não pôde(ram) ser avaliado(s) com os dados disponíveis. Conclua os experimentos e reavalie antes de aprovar.`;
  }
  return 'O método demonstrou adequação ao uso pretendido para os parâmetros e a faixa avaliados, atendendo aos critérios de aceitação registrados. Os resultados aplicam-se às condições experimentais descritas.';
}

function dataSummary(bundle: ValidationBundle): string {
  const total = bundle.measurements.length;
  if (bundle.method.family === 'attribute') {
    const data = attributeObservationsFrom(bundle.measurements);
    const parts = [
      `${data.validRows} classificação(ões) válida(s) de ${total} registro(s)`,
      `${data.items.length} item(ns)/amostra(s)`,
      `${data.raters.length} avaliador(es)`,
      `${data.categories.length} categoria(s)`,
    ];
    const gaps: string[] = [];
    if (data.missingCategory) gaps.push(`${data.missingCategory} sem categoria observada`);
    if (data.missingReference) gaps.push(`${data.missingReference} sem referência`);
    if (data.duplicateCells) gaps.push(`${data.duplicateCells} duplicidade(s)`);
    return `${parts.join(', ')}.${gaps.length ? ` Pendências: ${gaps.join('; ')}.` : ''} Categorias: ${data.categories.join(', ') || '—'}.`;
  }
  const numeric = bundle.measurements.filter((m) => m.value !== null && Number.isFinite(m.value)).length;
  const levels = [...new Set(bundle.measurements.map((m) => m.level).filter(Boolean))];
  const analysts = [...new Set(bundle.measurements.map((m) => m.analyst).filter(Boolean))];
  const missing = total - numeric;
  return `${numeric} medições numéricas de ${total} registros (${missing} faltante(s)/não numérico(s)), em ${levels.length} nível(is) e ${analysts.length} analista(s)/laboratório(s). Níveis: ${levels.join(', ') || '—'}.`;
}

function parameterToReport(p: ParameterAnalysis): ReportContent['parameterResults'][number] {
  const metrics = p.metrics.map((m) => ({
    label: m.label,
    value: m.value === null || !Number.isFinite(m.value) ? '—' : `${fmt(m.value)}${m.unit ? ` ${m.unit}` : ''}`,
    criterion: m.criterionText,
    verdict: m.verdict,
    formula: m.formula,
  }));
  return {
    key: p.key,
    label: p.label,
    summary: p.summary,
    verdict: p.verdict,
    metrics,
    notes: [...p.notes, ...p.warnings],
  };
}

export async function composeReport(
  bundle: ValidationBundle,
  analysis: ValidationAnalysis,
  generatedBy = 'sistema',
): Promise<ReportRecord> {
  const uncertainty =
    analysis.qc.uncertainty ?? null;
  const reportUncertainty: ReportContent['uncertainty'] = uncertainty
    ? {
        summary: `u_c = ${uncertainty.combined.toPrecision(4)}; U = ${uncertainty.expanded.toPrecision(4)}; k = ${uncertainty.coverageFactor.toFixed(3)}; ν_eff = ${uncertainty.effectiveDof?.toFixed(1) ?? '—'}.`,
        combined: uncertainty.combined,
        expanded: uncertainty.expanded,
        coverageFactor: uncertainty.coverageFactor,
        effectiveDof: uncertainty.effectiveDof,
        items: uncertainty.items.map((i) => ({
          source: i.source,
          type: i.type,
          value: i.value,
          divisor: i.divisor,
          sensitivity: i.sensitivity,
          stdUncertainty: i.stdUncertainty,
          contribution: i.contribution,
          dof: i.dof,
        })),
      }
    : null;
  const limitations = [
    ...analysis.warnings,
    ...analysis.parameters.flatMap((p) => p.warnings),
    ...(analysis.parameters.some((p) => p.verdict === 'not_evaluated')
      ? ['Parâmetros não avaliados limitam a conclusão de adequação ao uso.']
      : []),
    'A rastreabilidade metrológica e a validade dos certificados de calibração não são verificadas pelo software.',
  ];
  const references = [
    ...bundle.validation.reportConfig.templateIntro
      ? []
      : [],
    'ISO/IEC 17025:2017 — Requisitos gerais para a competência de laboratórios de ensaio e calibração.',
    'ISO 5725-1:2023 / ISO 5725-2:2019 — Exatidão e precisão de métodos de medição.',
    'JCGM 100:2008 (GUM) — Avaliação de dados de medição.',
    ...analysis.parameters.map((p) => p.reference).filter(Boolean),
    ...(bundle.method.referenceNorm ? [bundle.method.referenceNorm] : []),
  ];
  const dedupReferences = [...new Set(references)];
  const generatedAt = nowIso();
  const signatures = bundle.report?.content.signatures ?? [
    {
      role: 'elaboration' as const,
      name: bundle.validation.responsible,
      date: null,
      signed: false,
    },
    {
      role: 'review' as const,
      name: bundle.validation.reviewer,
      date: null,
      signed: false,
    },
    {
      role: 'approval' as const,
      name: bundle.validation.approver,
      date: null,
      signed: false,
    },
  ];
  const content: ReportContent = {
    title: bundle.validation.reportConfig.reportTitle || `Relatório de Validação — ${bundle.method.name}`,
    subtitle: bundle.validation.title,
    laboratory: {
      name: bundle.validation.reportConfig.laboratoryName,
      address: bundle.validation.reportConfig.laboratoryAddress,
      accreditation: bundle.validation.reportConfig.accreditation,
      logoDataUrl: bundle.validation.reportConfig.logoDataUrl,
    },
    method: {
      name: bundle.method.name,
      code: bundle.method.code,
      type: bundle.method.type,
      unit: bundle.method.unit,
      range: `${bundle.method.rangeMin ?? '—'} – ${bundle.method.rangeMax ?? '—'} ${bundle.method.unit}`,
      equipment: bundle.method.equipment,
      referenceNorm: bundle.method.referenceNorm,
      validationType: bundle.method.validationType,
    },
    objective: bundle.validation.objective,
    scope: bundle.validation.scope,
    designSummary: bundle.design?.plan.summary ?? 'Delineamento não registrado.',
    dataSummary: dataSummary(bundle),
    parameterResults: analysis.parameters.map(parameterToReport),
    uncertainty: reportUncertainty,
    conclusion: conclusionFor(analysis),
    limitations: [...new Set(limitations)],
    assumptions: analysis.assumptions,
    references: dedupReferences,
    signatures,
    generatedAt,
    version: String(bundle.validation.version),
    auditHash: await objectHash({
      validation: bundle.validation,
      method: bundle.method,
      parameters: bundle.parameters,
      measurements: bundle.measurements,
      design: bundle.design,
      analysis: {
        overallVerdict: analysis.overallVerdict,
        nUsed: analysis.nUsed,
        parameters: analysis.parameters.map((p) => ({
          key: p.key,
          verdict: p.verdict,
          rawMetrics: p.rawMetrics,
        })),
      },
      generatedAt,
      generatedBy,
    }),
  };
  return {
    id: uid('report'),
    validationId: bundle.validation.id,
    version: bundle.validation.version,
    status: 'draft',
    content,
    elaboratedBy: generatedBy,
    reviewedBy: '',
    approvedBy: '',
    elaboratedAt: generatedAt,
    reviewedAt: null,
    approvedAt: null,
    locked: false,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}
