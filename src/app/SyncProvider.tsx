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
import { getActiveDb } from '@/db/db';
import {
  deriveSyncStatus,
  startSyncTriggers,
  syncNow as runSyncNow,
  type SyncState,
} from '@/db/sync/engine';
import { getMeta } from '@/db/sync/meta';
import { deadCount, pendingCount } from '@/db/sync/queue';
import { api } from '@/lib/api';
import { useAuth } from './AuthProvider';

/**
 * Owns the sync engine for the signed-in account (design §9.2, §9.5).
 *
 * The provider lives inside `AuthGate`, i.e. after `openUserDb`, so every run
 * uses the active per-user database and never the legacy or signed-out one.
 * It triggers an app-open sync, then online / visibility / 2 s debounce /
 * 5 min interval runs, and exposes the state the top bar and Settings read.
 */

export interface SyncContextValue extends SyncState {
  syncNow: () => Promise<void>;
}

const INITIAL_STATE: SyncState = {
  status: 'synced',
  pending: 0,
  dead: 0,
  lastSyncAt: null,
  serverTime: null,
  clockSkewMs: null,
  error: null,
};

const SyncContext = createContext<SyncContextValue | null>(null);

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function readStringMeta(key: string): Promise<string | null> {
  const value = await getMeta(getActiveDb(), key);
  return typeof value === 'string' && value !== '' ? value : null;
}

async function readNumberMeta(key: string): Promise<number | null> {
  const value = await getMeta(getActiveDb(), key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { csrfToken } = useAuth();
  const [state, setState] = useState<SyncState>(INITIAL_STATE);
  const csrfRef = useRef<string | null>(csrfToken);
  const previousCsrfRef = useRef<string | null>(csrfToken);
  const mountedRef = useRef(false);
  // Every run gets an id; only the newest result may update the UI.
  const runSequence = useRef(0);

  useEffect(() => {
    csrfRef.current = csrfToken;
  }, [csrfToken]);

  const run = useCallback(async (): Promise<void> => {
    const sequence = runSequence.current + 1;
    runSequence.current = sequence;

    if (mountedRef.current) {
      setState((current) => ({ ...current, status: 'syncing' }));
    }

    let result;
    try {
      result = await runSyncNow(getActiveDb(), api, csrfRef.current);
    } catch {
      // The engine classifies its own failures; this only covers a database
      // that closed between the trigger and the run.
      if (!mountedRef.current || sequence !== runSequence.current) {
        return;
      }
      setState((current) => ({
        ...current,
        status: browserOnline() ? 'error' : 'offline',
        error: 'Senkron tamamlanamadı.',
      }));
      return;
    }

    if (!mountedRef.current || sequence !== runSequence.current) {
      return;
    }

    setState({
      status: result.status,
      pending: result.pending,
      dead: result.dead,
      lastSyncAt: result.lastSyncAt,
      serverTime: result.serverTime,
      clockSkewMs: result.clockSkewMs,
      error: result.error,
    });
  }, []);

  useEffect(() => {
    const previous = previousCsrfRef.current;
    previousCsrfRef.current = csrfToken;

    // A reconnect can validate the session after the `online` trigger already
    // ran without a CSRF token. Retry as soon as the token arrives so queued
    // rows are not left waiting for the five-minute interval.
    if ((previous === null || previous === '') && csrfToken) {
      void run();
    }
  }, [csrfToken, run]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const hydrate = async () => {
      const sequenceAtStart = runSequence.current;
      try {
        const database = getActiveDb();
        const [pending, dead, lastSyncAt, serverTime, clockSkewMs] = await Promise.all([
          pendingCount(database),
          deadCount(database),
          readStringMeta('lastSyncAt'),
          readStringMeta('serverTime'),
          readNumberMeta('clockSkewMs'),
        ]);

        // A trigger already started or finished a run; its result is newer.
        if (
          cancelled ||
          sequenceAtStart !== runSequence.current ||
          !mountedRef.current
        ) {
          return;
        }

        setState({
          status: deriveSyncStatus(pending, dead, browserOnline()),
          pending,
          dead,
          lastSyncAt,
          serverTime,
          clockSkewMs,
          error: null,
        });
      } catch {
        // The gate guarantees an open database; a failed read leaves the
        // initial state and the first sync run reports the real outcome.
      }
    };

    void hydrate();
    // App-open trigger.
    void run();

    const stopTriggers = startSyncTriggers({
      run: () => {
        void run();
      },
    });
    const handleOffline = () => {
      if (mountedRef.current) {
        setState((current) => ({ ...current, status: 'offline' }));
      }
    };
    window.addEventListener('offline', handleOffline);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      runSequence.current += 1;
      stopTriggers();
      window.removeEventListener('offline', handleOffline);
    };
  }, [run]);

  const syncNow = useCallback(async (): Promise<void> => {
    await run();
  }, [run]);

  const value = useMemo<SyncContextValue>(
    () => ({ ...state, syncNow }),
    [state, syncNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync yalnızca SyncProvider içinde kullanılabilir');
  }
  return context;
}

/** Read-only access for components that also render outside the provider. */
export function useSyncOptional(): SyncContextValue | null {
  return useContext(SyncContext);
}
