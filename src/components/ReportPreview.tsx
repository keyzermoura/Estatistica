import { forwardRef, type ReactNode } from 'react';
import type { ReportContent } from '../lib/types';
import { formatDate } from '../lib/utils';
import { fmt } from '../stats/distributions';
import { VERDICT_LABELS } from '../lib/report';
import { Badge, VerdictBadge } from './ui';

const ROLE_LABELS: Record<ReportContent['signatures'][number]['role'], string> = {
  elaboration: 'Elaboração',
  review: 'Revisão',
  approval: 'Aprovação',
};

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="border-b border-ink-200 pb-1 font-display text-sm font-semibold uppercase tracking-wide text-brand-800 dark:border-ink-700 dark:text-brand-200">
        {number}. {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-100 py-1.5 text-sm dark:border-ink-800">
      <span className="shrink-0 text-ink-500">{label}</span>
      <span className="text-right font-medium text-ink-800 dark:text-ink-100">{value || '—'}</span>
    </div>
  );
}

export const ReportPreview = forwardRef<
  HTMLDivElement,
  { content: ReportContent; className?: string; compact?: boolean }
>(function ReportPreview({ content, className = '', compact = false }, ref) {
  return (
    <div
      ref={ref}
      className={`print-area rounded-2xl border border-ink-200 bg-white p-6 text-ink-800 shadow-soft dark:border-ink-700 dark:bg-white dark:text-ink-800 sm:p-8 ${className}`}
    >
      <header className="border-b-2 border-brand-700 pb-4 text-center">
        {content.laboratory.logoDataUrl ? (
          <img
            src={content.laboratory.logoDataUrl}
            alt="Logo do laboratório"
            className="mx-auto mb-2 h-14 w-auto object-contain"
          />
        ) : null}
        <p className="text-sm font-semibold text-ink-700">{content.laboratory.name || 'Laboratório'}</p>
        {content.laboratory.address ? <p className="text-xs text-ink-500">{content.laboratory.address}</p> : null}
        {content.laboratory.accreditation ? <p className="text-[11px] text-ink-500">{content.laboratory.accreditation}</p> : null}
        <h2 className="mt-4 font-display text-xl font-semibold tracking-tight text-brand-800">{content.title}</h2>
        <p className="mt-0.5 text-sm italic text-ink-500">{content.subtitle}</p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px] text-ink-500">
          <span>Versão {content.version}</span>
          <span>·</span>
          <span>Gerado em {formatDate(content.generatedAt)}</span>
          <span>·</span>
          <span className="font-mono">hash {content.auditHash.slice(0, 16)}…</span>
        </div>
      </header>

      <div className={compact ? 'mt-4 space-y-4' : 'mt-5 space-y-5'}>
        <Section number="1" title="Identificação">
          <div className="grid gap-x-8 sm:grid-cols-2">
            <Field label="Método" value={`${content.method.name} (${content.method.code})`} />
            <Field label="Tipo" value={content.method.type} />
            <Field label="Unidade" value={content.method.unit} />
            <Field label="Faixa" value={content.method.range} />
            <Field label="Equipamento" value={content.method.equipment} />
            <Field label="Norma de referência" value={content.method.referenceNorm} />
            <Field label="Tipo de validação" value={content.method.validationType} />
            <Field label="Versão da validação" value={content.version} />
          </div>
        </Section>

        <Section number="2" title="Objetivo">
          <p className="text-sm leading-relaxed">{content.objective || '—'}</p>
        </Section>

        <Section number="3" title="Escopo">
          <p className="text-sm leading-relaxed">{content.scope || '—'}</p>
        </Section>

        <Section number="4" title="Delineamento amostral">
          <p className="text-sm leading-relaxed">{content.designSummary}</p>
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">{content.dataSummary}</p>
        </Section>

        <Section number="5" title="Resultados por parâmetro">
          <div className="space-y-4">
            {content.parameterResults.length === 0 ? (
              <p className="text-sm text-ink-500">Nenhum parâmetro selecionado.</p>
            ) : (
              content.parameterResults.map((parameter) => (
                <div key={parameter.key} className="break-inside-avoid rounded-xl border border-ink-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink-900">{parameter.label}</p>
                    <VerdictBadge verdict={parameter.verdict} />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">{parameter.summary}</p>
                  {parameter.metrics.length ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-ink-50 text-left text-ink-500">
                            <th className="border border-ink-200 px-2 py-1">Métrica</th>
                            <th className="border border-ink-200 px-2 py-1">Fórmula</th>
                            <th className="border border-ink-200 px-2 py-1 text-right">Valor</th>
                            <th className="border border-ink-200 px-2 py-1">Critério</th>
                            <th className="border border-ink-200 px-2 py-1">Veredito</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parameter.metrics.map((metric, index) => (
                            <tr key={index}>
                              <td className="border border-ink-200 px-2 py-1 font-medium">{metric.label}</td>
                              <td className="border border-ink-200 px-2 py-1 font-mono text-[10px] text-ink-500">
                                {metric.formula || '—'}
                              </td>
                              <td className="border border-ink-200 px-2 py-1 text-right font-mono">{metric.value}</td>
                              <td className="border border-ink-200 px-2 py-1">{metric.criterion}</td>
                              <td className="border border-ink-200 px-2 py-1">{VERDICT_LABELS[metric.verdict]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-ink-400">Sem métricas calculadas.</p>
                  )}
                  {parameter.notes.length ? (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11px] text-ink-500">
                      {parameter.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Section>

        {content.uncertainty ? (
          <Section number="6" title="Incerteza de medição (GUM)">
            <p className="text-sm leading-relaxed">{content.uncertainty.summary}</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-ink-50 text-left text-ink-500">
                    <th className="border border-ink-200 px-2 py-1">Fonte</th>
                    <th className="border border-ink-200 px-2 py-1">Tipo</th>
                    <th className="border border-ink-200 px-2 py-1 text-right">Valor</th>
                    <th className="border border-ink-200 px-2 py-1 text-right">Divisor</th>
                    <th className="border border-ink-200 px-2 py-1 text-right">c_i</th>
                    <th className="border border-ink-200 px-2 py-1 text-right">u_i</th>
                    <th className="border border-ink-200 px-2 py-1 text-right">ν</th>
                  </tr>
                </thead>
                <tbody>
                  {content.uncertainty.items.map((item, index) => (
                    <tr key={index}>
                      <td className="border border-ink-200 px-2 py-1">{item.source}</td>
                      <td className="border border-ink-200 px-2 py-1">{item.type}</td>
                      <td className="border border-ink-200 px-2 py-1 text-right font-mono">{fmt(item.value)}</td>
                      <td className="border border-ink-200 px-2 py-1 text-right font-mono">{fmt(item.divisor)}</td>
                      <td className="border border-ink-200 px-2 py-1 text-right font-mono">{fmt(item.sensitivity)}</td>
                      <td className="border border-ink-200 px-2 py-1 text-right font-mono">{fmt(item.stdUncertainty)}</td>
                      <td className="border border-ink-200 px-2 py-1 text-right font-mono">
                        {item.dof === null ? '—' : fmt(item.dof)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}

        <Section number={content.uncertainty ? '7' : '6'} title="Conclusão">
          <p className="text-sm leading-relaxed">{content.conclusion}</p>
        </Section>

        <Section number={content.uncertainty ? '8' : '7'} title="Limitações e pressupostos">
          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-600">
            {content.limitations.map((item, index) => (
              <li key={`lim-${index}`}>{item}</li>
            ))}
            {content.assumptions.map((item, index) => (
              <li key={`asm-${index}`}>{item}</li>
            ))}
          </ul>
        </Section>

        <Section number={content.uncertainty ? '9' : '8'} title="Referências">
          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-600">
            {content.references.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </Section>

        <Section number={content.uncertainty ? '10' : '9'} title="Assinaturas">
          <div className="grid gap-3 sm:grid-cols-3">
            {content.signatures.map((signature) => (
              <div key={signature.role} className="rounded-xl border border-ink-200 p-3 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                  {ROLE_LABELS[signature.role]}
                </p>
                <p className="mt-1 text-sm font-medium">{signature.name || '—'}</p>
                <p className="text-[11px] text-ink-400">{signature.date ? formatDate(signature.date) : 'Não assinado'}</p>
                <div className="mt-4 border-t border-ink-300 pt-1 text-[10px] text-ink-400">Assinatura</div>
              </div>
            ))}
          </div>
        </Section>

        <footer className="border-t border-ink-200 pt-2 text-center text-[10px] text-ink-400">
          Documento gerado por ValidaMétodo · hash de auditoria {content.auditHash}
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            <Badge tone="brand">ISO/IEC 17025</Badge>
            <Badge tone="brand">GUM</Badge>
            <Badge tone="brand">ISO 5725</Badge>
          </div>
        </footer>
      </div>
    </div>
  );
});
