import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_SETTINGS, getSettings, patchSettings } from '@/db/repositories';
import type { AppSettings } from '@/domain/types';
import { applyAccent } from './theme';

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function createInitialSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, hiddenSubjects: [...DEFAULT_SETTINGS.hiddenSubjects] };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(createInitialSettings);
  const [loading, setLoading] = useState(true);
  // If the user changes a setting before the initial read resolves, keep the
  // newer local value instead of letting the stale read win.
  const pendingUpdates = useRef<Partial<AppSettings>>({});

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((loaded) => {
        if (!cancelled) {
          setSettings({ ...loaded, ...pendingUpdates.current });
        }
      })
      .catch((error: unknown) => {
        console.error('Ayarlar yüklenemedi', error);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyAccent(settings.accent);
  }, [settings.accent]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    pendingUpdates.current = { ...pendingUpdates.current, ...patch };
    setSettings((current) => ({ ...current, ...patch }));
    try {
      await patchSettings(patch);
    } catch (error: unknown) {
      console.error('Ayarlar kaydedilemedi', error);
    }
  }, []);

  const value = useMemo(
    () => ({ settings, updateSettings, loading }),
    [settings, updateSettings, loading],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useAppSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useAppSettings yalnızca SettingsProvider içinde kullanılabilir');
  }
  return context;
}
