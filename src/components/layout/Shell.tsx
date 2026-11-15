import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  ChevronRight,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Moon,
  Plus,
  Settings as SettingsIcon,
  Sun,
  X,
  Database,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useApp } from '../../lib/app-context';
import { getValidationSummaries } from '../../lib/repository';
import { Badge, Button, Modal } from '../ui';
import { Glossary } from '../Glossary';

const navItems = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, end: true },
  { to: '/settings', label: 'Configurações', icon: SettingsIcon },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { settings, refreshKey, dataVersion } = useApp();
  const summaries = useMemo(() => getValidationSummaries().slice(0, 6), [refreshKey, dataVersion]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700 text-white shadow-sm">
          <FlaskConical className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-display text-base font-semibold leading-tight tracking-tight text-ink-900 dark:text-white">
            ValidaMétodo
          </p>
          <p className="truncate text-[11px] text-ink-500 dark:text-ink-400">
            {settings.laboratoryName || 'Validação de métodos'}
          </p>
        </div>
      </div>

      <div className="px-3">
        <Button
          className="w-full"
          onClick={() => {
            onNavigate?.();
            window.location.hash = '#/';
            setTimeout(() => window.dispatchEvent(new CustomEvent('open-new-validation')), 20);
          }}
        >
          <Plus className="h-4 w-4" />
          Nova validação
        </Button>
      </div>

      <nav className="mt-4 space-y-1 px-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-white',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6 flex min-h-0 flex-1 flex-col px-3">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Validações recentes
        </p>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-3">
          {summaries.length === 0 ? (
            <p className="px-3 text-xs text-ink-400">Nenhuma validação ainda.</p>
          ) : (
            summaries.map(({ validation, method }) => (
              <NavLink
                key={validation.id}
                to={`/validation/${validation.id}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'block rounded-xl px-3 py-2 transition',
                    isActive
                      ? 'bg-ink-100 dark:bg-ink-800'
                      : 'hover:bg-ink-100/70 dark:hover:bg-ink-800/70',
                  )
                }
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-ink-800 dark:text-ink-100">
                    {method.code || 'Método'}
                  </span>
                  {validation.locked ? <Badge tone="neutral">bloqueada</Badge> : null}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-ink-500 dark:text-ink-400">
                  {validation.title}
                </span>
              </NavLink>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-ink-200 px-5 py-3 text-[11px] text-ink-400 dark:border-ink-800">
        <span className="inline-flex items-center gap-1.5">
          <Database className="h-3 w-3" /> Dados locais · SQLite
        </span>
        <p className="mt-1">v1.0 · offline-first</p>
      </div>
    </div>
  );
}

function useTitle() {
  const location = useLocation();
  if (location.pathname.startsWith('/settings')) return 'Configurações';
  if (location.pathname.startsWith('/validation/')) return 'Fluxo de validação';
  return 'Painel de validações';
}

export function Shell({ children }: { children?: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const { settings, updateSettings } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const title = useTitle();

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900 lg:block">
        <SidebarContent />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-lift dark:bg-ink-900">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/80 px-4 backdrop-blur-md dark:border-ink-800 dark:bg-ink-950/80 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800 lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-semibold tracking-tight text-ink-900 dark:text-white">
              {title}
            </h1>
            <p className="hidden text-xs text-ink-500 dark:text-ink-400 sm:block">
              {location.pathname.startsWith('/validation/')
                ? 'Método → Parâmetros → Delineamento → Coleta → Análise → Relatório → Auditoria'
                : 'Validação de métodos analíticos com rastreabilidade estatística'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 md:flex" title="Banco de dados SQLite compilado para WebAssembly persistido localmente no IndexedDB">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Offline · SQLite sincronizado</span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setGlossaryOpen(true)} title="Glossário">
              <BookOpen className="h-4 w-4" />
            </Button>
            {location.pathname.startsWith('/validation/') ? (
              <Button variant="ghost" size="icon" onClick={() => navigate('/')} title="Voltar ao painel">
                <ChevronRight className="h-4 w-4 rotate-180" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              title={settings.theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
              onClick={() => void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
            >
              {settings.theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children ?? <Outlet />}</main>
        <footer className="app-footer mx-auto w-full max-w-7xl px-4 pb-6 text-center text-[11px] text-ink-400 sm:px-6 lg:px-8">
          ValidaMétodo · os resultados são reproduzíveis a partir dos dados, das decisões registradas e dos hashes de auditoria.
        </footer>
      </div>

      <Modal open={glossaryOpen} onClose={() => setGlossaryOpen(false)} title="Glossário rápido" description="Termos estatísticos e metrológicos usados no sistema." size="lg">
        <Glossary />
      </Modal>
    </div>
  );
}
