import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSettings } from './types';
import { saveSettings as persistSettings } from './repository';

interface AppContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refreshKey: number;
  bumpRefresh: () => void;
  dataVersion: number;
  bumpData: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  initialSettings,
  children,
}: {
  initialSettings: AppSettings;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [settings.theme]);

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      updateSettings: async (patch) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        persistSettings(next);
      },
      refreshKey,
      bumpRefresh: () => setRefreshKey((v) => v + 1),
      dataVersion,
      bumpData: () => setDataVersion((v) => v + 1),
    }),
    [settings, refreshKey, dataVersion],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp deve ser usado dentro de AppProvider.');
  return context;
}
