import type { ReactNode } from 'react';
import {
  Beaker,
  CheckCircle2,
  ClipboardList,
  FileText,
  FlaskConical,
  LineChart,
  ListChecks,
  Lock,
  ScrollText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Alert, HelpTip } from '../ui';

export const WIZARD_STEPS = [
  { id: 0, label: 'Método', description: 'Identificação, faixa e critérios', icon: FlaskConical },
  { id: 1, label: 'Parâmetros', description: 'Checklist e justificativas', icon: ListChecks },
  { id: 2, label: 'Delineamento', description: 'Poder, n e aleatorização', icon: Beaker },
  { id: 3, label: 'Coleta', description: 'Dados brutos e importação', icon: ClipboardList },
  { id: 4, label: 'Análise', description: 'Estatística e incerteza', icon: LineChart },
  { id: 5, label: 'Relatório', description: 'Prévia, assinaturas e exportação', icon: FileText },
  { id: 6, label: 'Auditoria', description: 'Log, versões e bloqueio', icon: ScrollText },
] as const;

export function Stepper({
  currentStep,
  onSelect,
  locked,
}: {
  currentStep: number;
  onSelect: (step: number) => void;
  locked?: boolean;
}) {
  return (
    <nav aria-label="Etapas da validação" className="surface overflow-x-auto p-2">
      <ol className="flex min-w-[720px] items-stretch gap-1">
        {WIZARD_STEPS.map((step, index) => {
          const active = currentStep === step.id;
          const done = currentStep > step.id;
          const Icon = step.icon;
          return (
            <li key={step.id} className="flex-1">
              <button
                onClick={() => onSelect(step.id)}
                disabled={locked && step.id !== currentStep}
                className={cn(
                  'group flex h-full w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition',
                  active
                    ? 'bg-brand-700 text-white shadow-sm'
                    : 'hover:bg-ink-100 dark:hover:bg-ink-800',
                  locked && step.id !== currentStep && 'cursor-not-allowed opacity-50',
                )}
                aria-current={active ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                    active
                      ? 'border-white/30 bg-white/15 text-white'
                      : done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'border-ink-200 bg-white text-ink-500 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-400',
                  )}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : locked && step.id !== currentStep ? <Lock className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-[10px] font-semibold uppercase tracking-wider', active ? 'text-brand-100' : 'text-ink-400')}>
                    Etapa {index + 1}
                  </span>
                  <span className={cn('block truncate text-sm font-semibold', active ? 'text-white' : 'text-ink-800 dark:text-ink-100')}>
                    {step.label}
                  </span>
                  <span className={cn('hidden truncate text-[11px] xl:block', active ? 'text-brand-100/80' : 'text-ink-400')}>
                    {step.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StepShell({
  step,
  title,
  description,
  help,
  children,
  footer,
  locked,
  aside,
}: {
  step: number;
  title: string;
  description?: string;
  help?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  locked?: boolean;
  aside?: ReactNode;
}) {
  const meta = WIZARD_STEPS[step];
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
            Etapa {step + 1} de {WIZARD_STEPS.length} · {meta?.label}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">{title}</h2>
            {help ? <HelpTip>{help}</HelpTip> : null}
          </div>
          {description ? <p className="mt-1 max-w-3xl text-sm text-ink-500 dark:text-ink-400">{description}</p> : null}
        </div>
        {aside}
      </div>
      {locked ? (
        <Alert tone="warning" title="Validação bloqueada">
          Esta validação foi aprovada. Para alterar dados, crie uma nova versão na etapa de Auditoria.
        </Alert>
      ) : null}
      <div className="space-y-4">{children}</div>
      {footer ? <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-ink-200/80 bg-white/90 p-3 shadow-lift backdrop-blur dark:border-ink-800 dark:bg-ink-900/90">{footer}</div> : null}
    </section>
  );
}
