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
import { Toast } from '@/components/ui/Toast';
import { CURRICULUM } from '@/data/curriculum';
import { seedCatalog } from '@/db/catalogRepository';
import { migrateLegacyShelfFromLocalData } from '@/db/legacyMigration';
import { DEFAULT_SETTINGS, getSettings, patchSettings, seedCurriculum } from '@/db/repositories';
import { repairScheduleDayIndexes } from '@/db/scheduleMigration';
import type { AppSettings } from '@/domain/types';
import { applyAccent } from './theme';

export type SettingsUpdateResult =
  | { ok: true }
  | { ok: false; error: unknown };

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<SettingsUpdateResult>;
  refreshSettings: () => Promise<void>;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function createInitialSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, hiddenSubjects: [...DEFAULT_SETTINGS.hiddenSubjects] };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(createInitialSettings);
  const [loading, setLoading] = useState(true);
  const [seedError, setSeedError] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  // If the user changes a setting before the initial read resolves, keep the
  // newer local value instead of letting the stale read win.
  const pendingUpdates = useRef<Partial<AppSettings>>({});
  const settingsRef = useRef(settings);
  const writeSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const loaded = await getSettings();

      if (loaded.seedVersion < CURRICULUM.version) {
        try {
          await seedCurriculum(CURRICULUM);
        } catch (firstError: unknown) {
          console.error('Müfredat yüklenemedi, tekrar denenecek', firstError);
          try {
            await seedCurriculum(CURRICULUM);
          } catch (error: unknown) {
            console.error('Müfredat yüklenemedi', error);
            if (!cancelled) {
              setSeedError(true);
            }
          }
        }
      }

      // The starter catalog is additive and idempotent. A failure here must not
      // block settings: log it and let the next app start retry the seed.
      try {
        await seedCatalog();
      } catch (error: unknown) {
        console.error('Kitap kataloğu yüklenemedi', error);
      }

      // One-time repairs for data written by earlier local builds. Neither
      // blocks settings: a failed migration is logged and retried next start.
      try {
        await repairScheduleDayIndexes();
      } catch (error: unknown) {
        console.error('Haftalık plan gün indeksleri onarılamadı', error);
      }

      try {
        await migrateLegacyShelfFromLocalData();
      } catch (error: unknown) {
        console.error('Eski kitaplar rafa taşınamadı', error);
      }

      if (!cancelled) {
        const next = { ...loaded, ...pendingUpdates.current };
        pendingUpdates.current = {};
        settingsRef.current = next;
        setSettings(next);
      }
    }

    load()
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

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>): Promise<SettingsUpdateResult> => {
      const request = writeSequence.current + 1;
      writeSequence.current = request;
      const previous = settingsRef.current;
      const next = { ...previous, ...patch };
      settingsRef.current = next;
      pendingUpdates.current = { ...pendingUpdates.current, ...patch };
      setSettings(next);

      try {
        await patchSettings(patch);
        if (request === writeSequence.current) {
          setWriteError(null);
        }
        return { ok: true };
      } catch (error: unknown) {
        console.error('Ayarlar kaydedilemedi', error);
        // Only the newest write may roll back the optimistic state; an older
        // failure must not erase a newer value the user just typed.
        if (request === writeSequence.current) {
          const remaining = { ...pendingUpdates.current };
          for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
            delete remaining[key];
          }
          pendingUpdates.current = remaining;
          settingsRef.current = previous;
          setSettings(previous);
          setWriteError('Ayarlar kaydedilemedi. Lütfen tekrar dene.');
        }
        return { ok: false, error };
      }
    },
    [],
  );

  const refreshSettings = useCallback(async () => {
    const loaded = await getSettings();
    pendingUpdates.current = {};
    settingsRef.current = loaded;
    setSettings(loaded);
  }, []);

  const value = useMemo(
    () => ({ settings, updateSettings, refreshSettings, loading }),
    [settings, updateSettings, refreshSettings, loading],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
      {seedError || writeError ? (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md">
          <Toast
            tone="error"
            message={
              seedError
                ? 'Müfredat yüklenemedi. Uygulamayı yenileyip tekrar dene.'
                : (writeError ?? 'Ayarlar kaydedilemedi.')
            }
            onClose={() => {
              setSeedError(false);
              setWriteError(null);
            }}
          />
        </div>
      ) : null}
    </SettingsContext.Provider>
  );
}

export function useAppSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useAppSettings yalnızca SettingsProvider içinde kullanılabilir');
  }
  return context;
}
