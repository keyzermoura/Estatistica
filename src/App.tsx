import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { FlaskConical, Loader2 } from 'lucide-react';
import type { AppSettings } from './lib/types';
import { initDb } from './lib/db';
import { loadSettings } from './lib/repository';
import { seedIfEmpty } from './lib/seed';
import { AppProvider } from './lib/app-context';
import { ToastProvider } from './components/ui';
import { Shell } from './components/layout/Shell';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { ValidationWizard } from './pages/ValidationWizard';

function Splash({ error }: { error?: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6 dark:bg-ink-950">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-lift">
          <FlaskConical className="h-8 w-8" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">
          ValidaMétodo
        </h1>
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-left text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
            <p className="font-semibold">Não foi possível iniciar o banco local.</p>
            <p className="mt-1 break-words text-xs">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white"
            >
              Recarregar
            </button>
          </div>
        ) : (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-ink-500 dark:text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Abrindo banco SQLite local…
          </div>
        )}
      </div>
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initDb();
        await seedIfEmpty();
        if (cancelled) return;
        const loaded = loadSettings();
        const root = document.documentElement;
        if (loaded.theme === 'dark') root.classList.add('dark');
        else root.classList.remove('dark');
        setSettings(loaded);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings) return <Splash error={error} />;

  return (
    <AppProvider initialSettings={settings}>
      <ToastProvider>
        <HashRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/validation/:id" element={<ValidationWizard />} />
              <Route path="/validation/:id/:step" element={<ValidationWizard />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        </HashRouter>
      </ToastProvider>
    </AppProvider>
  );
}
