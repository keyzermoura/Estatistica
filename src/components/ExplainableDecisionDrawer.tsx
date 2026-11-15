import { useEffect, type ReactNode } from 'react';
import { BookOpen, CheckCircle2, ChevronRight, HelpCircle, X } from 'lucide-react';
import type { Verdict } from '../lib/types';
import { VerdictBadge } from './ui';

export interface ExplainableDecisionData {
  title: string;
  parameterLabel: string;
  verdict: Verdict;
  formulaText?: string;
  observedValueText: string;
  criterionText: string;
  stepByStepText?: string[];
  normativeReference: string;
  interpretationText: string;
}

export function ExplainableDecisionDrawer({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: ExplainableDecisionData | null;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !data) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink-950/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
          className="w-screen max-w-md bg-white shadow-2xl transition-all dark:bg-ink-900 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-ink-100 px-6 py-4 dark:border-ink-800">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                <HelpCircle className="h-5 w-5" />
              </div>
              <div>
                <h2 id="drawer-title" className="text-sm font-semibold text-ink-900 dark:text-white">
                  Demonstração da Decisão
                </h2>
                <p className="text-[11px] text-ink-400">Rastreabilidade e fundamentação metrológica</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600 dark:hover:bg-ink-800 dark:hover:text-ink-200"
              aria-label="Fechar painel"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs text-ink-700 dark:text-ink-200">
            {/* 1. Identificação e Veredito */}
            <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3.5 dark:border-ink-800 dark:bg-ink-950/50">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-ink-400">
                {data.parameterLabel}
              </span>
              <div className="mt-1 flex items-center justify-between gap-2">
                <h3 className="font-semibold text-sm text-ink-900 dark:text-white">{data.title}</h3>
                <VerdictBadge verdict={data.verdict} />
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-ink-200/60 pt-2 font-mono text-[11px] dark:border-ink-800">
                <span className="text-ink-500">Valor apurado:</span>
                <span className="font-semibold text-brand-700 dark:text-brand-300">
                  {data.observedValueText}
                </span>
              </div>
            </div>

            {/* 2. Equação Matemática / Fórmula */}
            {data.formulaText ? (
              <div className="space-y-1.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Fórmula / Modelo Matemático
                </h4>
                <div className="rounded-xl border border-ink-200 bg-white p-3 font-mono text-xs text-ink-800 dark:border-ink-800 dark:bg-ink-950 dark:text-ink-100">
                  {data.formulaText}
                </div>
              </div>
            ) : null}

            {/* 3. Critério de Aceitação Cadastrado */}
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Critério de Aceitação
              </h4>
              <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-3 text-ink-800 dark:border-ink-800 dark:bg-ink-950/30 dark:text-ink-200">
                {data.criterionText}
              </div>
            </div>

            {/* 4. Dedução Passo a Passo */}
            {data.stepByStepText && data.stepByStepText.length > 0 ? (
              <div className="space-y-1.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Passo a Passo da Dedução
                </h4>
                <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-3 space-y-2 dark:border-ink-800 dark:bg-ink-950/30">
                  {data.stepByStepText.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-[11px]">
                      <ChevronRight className="h-3.5 w-3.5 text-brand-600 mt-0.5 shrink-0" />
                      <span className="font-mono text-ink-700 dark:text-ink-300">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 5. Conclusão Metrológica */}
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Conclusão & Interpretação
              </h4>
              <p className="rounded-xl border border-ink-100 bg-white p-3 leading-relaxed text-ink-700 dark:border-ink-800 dark:bg-ink-950 dark:text-ink-200">
                {data.interpretationText}
              </p>
            </div>

            {/* 6. Base Normativa Oficial */}
            <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3 dark:border-brand-900/60 dark:bg-brand-950/20">
              <div className="flex items-center gap-1.5 text-brand-800 dark:text-brand-300 font-medium text-[11px]">
                <BookOpen className="h-3.5 w-3.5" />
                <span>Base Normativa / Referência Bibliográfica</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-600 dark:text-ink-300 font-mono">
                {data.normativeReference}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-ink-100 px-6 py-3 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-950/50 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-ink-900 px-4 py-2 text-xs font-medium text-white hover:bg-ink-800 dark:bg-white dark:text-ink-900 dark:hover:bg-ink-100 transition"
            >
              Fechar demonstração
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
