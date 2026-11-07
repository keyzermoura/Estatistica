import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Verdict } from '../../lib/types';

// ── Button ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-700 text-white hover:bg-brand-800 focus-visible:ring-brand-500 shadow-sm',
  secondary:
    'bg-ink-900 text-white hover:bg-ink-800 focus-visible:ring-ink-500 dark:bg-ink-100 dark:text-ink-900 dark:hover:bg-white',
  outline:
    'border border-ink-300 bg-white text-ink-700 hover:bg-ink-50 focus-visible:ring-brand-500 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800',
  ghost:
    'text-ink-600 hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-brand-500 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-white',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500 shadow-sm',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-11 gap-2 px-5 text-sm',
  icon: 'h-9 w-9 justify-center',
};

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-ink-950',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

// ── Card ───────────────────────────────────────────────────────────────────

export function Card({
  className,
  children,
  as: Tag = 'div',
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article';
}) {
  return <Tag className={cn('surface', className)}>{children}</Tag>;
}

export function CardHeader({
  className,
  title,
  description,
  action,
  icon,
}: {
  className?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-ink-800', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold tracking-tight text-ink-900 dark:text-white">{title}</h3>
          {description ? <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 px-5 py-3 dark:border-ink-800', className)}>{children}</div>;
}

// ── Form ───────────────────────────────────────────────────────────────────

const controlBase =
  'w-full rounded-xl border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 shadow-sm outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-500 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:placeholder:text-ink-500 dark:disabled:bg-ink-800';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="field-label">
          {label}
          {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p> : hint ? <p className="text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

export function Input({
  className,
  label,
  hint,
  error,
  wrapperClassName,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}) {
  const id = useId();
  const input = <input id={props.id ?? id} className={cn(controlBase, 'h-10', className)} {...props} />;
  if (!label && !hint && !error) return input;
  return (
    <Field label={label} hint={hint} error={error} required={props.required} htmlFor={props.id ?? id} className={wrapperClassName}>
      {input}
    </Field>
  );
}

export function Textarea({
  className,
  label,
  hint,
  error,
  wrapperClassName,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}) {
  const id = useId();
  const textarea = <textarea id={props.id ?? id} className={cn(controlBase, 'min-h-[90px] resize-y', className)} {...props} />;
  if (!label && !hint && !error) return textarea;
  return (
    <Field label={label} hint={hint} error={error} required={props.required} htmlFor={props.id ?? id} className={wrapperClassName}>
      {textarea}
    </Field>
  );
}

export function Select({
  className,
  label,
  hint,
  error,
  wrapperClassName,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}) {
  const id = useId();
  const select = (
    <select id={props.id ?? id} className={cn(controlBase, 'h-10 pr-8', className)} {...props}>
      {children}
    </select>
  );
  if (!label && !hint && !error) return select;
  return (
    <Field label={label} hint={hint} error={error} required={props.required} htmlFor={props.id ?? id} className={wrapperClassName}>
      {select}
    </Field>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2 text-sm text-ink-700 dark:text-ink-200', className)}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-700 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-900"
        {...props}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-4', disabled && 'opacity-60')}>
      <span>
        {label ? <span className="block text-sm font-medium text-ink-800 dark:text-ink-100">{label}</span> : null}
        {description ? <span className="mt-0.5 block text-xs text-ink-500">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-700',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
  brand: 'bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  danger: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  outline: 'border border-ink-300 text-ink-600 dark:border-ink-700 dark:text-ink-300',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const map: Record<Verdict, { tone: BadgeTone; label: string; icon: ReactNode }> = {
    pass: { tone: 'success', label: 'Conforme', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    fail: { tone: 'danger', label: 'Não conforme', icon: <XCircle className="h-3.5 w-3.5" /> },
    warning: { tone: 'warning', label: 'Atenção', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    not_evaluated: { tone: 'neutral', label: 'Não avaliado', icon: <Info className="h-3.5 w-3.5" /> },
  };
  const v = map[verdict];
  return (
    <Badge tone={v.tone} className={className}>
      {v.icon}
      {v.label}
    </Badge>
  );
}

// ── Alert ──────────────────────────────────────────────────────────────────

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  onDismiss,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  onDismiss?: () => void;
}) {
  const styles = {
    info: { box: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100', icon: <Info className="h-4 w-4" /> },
    success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100', icon: <CheckCircle2 className="h-4 w-4" /> },
    warning: { box: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100', icon: <AlertTriangle className="h-4 w-4" /> },
    danger: { box: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100', icon: <XCircle className="h-4 w-4" /> },
  }[tone];
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm', styles.box, className)}>
      <span className="mt-0.5 shrink-0">{styles.icon}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5', 'text-[13px] leading-relaxed opacity-90')}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button onClick={onDismiss} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Fechar aviso">
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-lift animate-fade-in dark:bg-ink-900 sm:rounded-2xl', sizes[size])}>
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-ink-800">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink-900 dark:text-white">{title}</h3>
            {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 px-5 py-3 dark:border-ink-800">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

// ── Progress / stat / misc ─────────────────────────────────────────────────

export function Progress({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'success' | 'danger' | 'warning' }) {
  const tones = {
    brand: 'bg-brand-600',
    success: 'bg-emerald-500',
    danger: 'bg-rose-500',
    warning: 'bg-amber-500',
  };
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800', className)}>
      <div className={cn('h-full rounded-full transition-all', tones[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300',
    success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    danger: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
    neutral: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
          <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">{value}</p>
          {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
        </div>
        {icon ? <span className={cn('inline-flex h-10 w-10 items-center justify-center rounded-xl', tones[tone])}>{icon}</span> : null}
      </div>
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-300 px-6 py-12 text-center dark:border-ink-700', className)}>
      {icon ? <div className="mb-3 text-ink-400">{icon}</div> : null}
      <h3 className="font-display text-base font-semibold text-ink-900 dark:text-white">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? 'Carregando…'}
    </div>
  );
}

export function HelpTip({ children, label = 'Ajuda' }: { children: ReactNode; label?: string }) {
  return (
    <details className="group inline-block align-middle">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-ink-300 px-2 py-0.5 text-[11px] font-medium text-ink-500 hover:border-brand-400 hover:text-brand-700 dark:border-ink-700 dark:text-ink-400">
        <Info className="h-3 w-3" />
        {label}
      </summary>
      <div className="mt-2 max-w-md rounded-xl border border-brand-200 bg-brand-50 p-3 text-xs leading-relaxed text-brand-950 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-100">
        {children}
      </div>
    </details>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────────

export interface TabItem {
  id: string;
  label: ReactNode;
  badge?: ReactNode;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1 dark:bg-ink-900', className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
            value === item.id
              ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-white'
              : 'text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100',
          )}
        >
          {item.label}
          {item.badge}
        </button>
      ))}
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────

interface ToastItem {
  id: number;
  tone: 'success' | 'danger' | 'info';
  message: string;
}

const ToastContext = createContext<{ push: (message: string, tone?: ToastItem['tone']) => void }>({
  push: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = (message: string, tone: ToastItem['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), 4200);
  };
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lift animate-fade-in',
              item.tone === 'success' && 'border-emerald-200 bg-white text-emerald-900 dark:border-emerald-900 dark:bg-ink-900 dark:text-emerald-100',
              item.tone === 'danger' && 'border-rose-200 bg-white text-rose-900 dark:border-rose-900 dark:bg-ink-900 dark:text-rose-100',
              item.tone === 'info' && 'border-sky-200 bg-white text-sky-900 dark:border-sky-900 dark:bg-ink-900 dark:text-sky-100',
            )}
          >
            {item.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : item.tone === 'danger' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
