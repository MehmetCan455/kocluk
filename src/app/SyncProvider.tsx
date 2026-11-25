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

/**
 * A fresh device must not route to onboarding before the first pull has
 * applied the account settings. The initial sync is normally fast; offline or
 * a hung request still releases the gate after this bound so the app can open
 * with the local settings.
 */
export const INITIAL_SYNC_GATE_TIMEOUT_MS = 5_000;

const INITIAL_STATE: SyncState = {
  status: 'synced',
  pending: 0,
  dead: 0,
  lastSyncAt: null,
  serverTime: null,
  clockSkewMs: null,
  error: null,
};

function InitialSyncGate() {
  return (
    <div
      role="status"
      className="flex min-h-dvh items-center justify-center gap-3 bg-canvas px-4 text-sm text-muted"
    >
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-[var(--accent)]"
        aria-hidden="true"
      />
      <span>Hesabın hazırlanıyor…</span>
    </div>
  );
}

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
  const [initialSyncReady, setInitialSyncReady] = useState(false);
  const csrfRef = useRef<string | null>(csrfToken);
  const previousCsrfRef = useRef<string | null>(csrfToken);
  const mountedRef = useRef(false);
  const initialSyncSettledRef = useRef(false);
  const initialSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every run gets an id; only the newest result may update the UI.
  const runSequence = useRef(0);

  const settleInitialSync = useCallback((): void => {
    if (initialSyncSettledRef.current) {
      return;
    }
    initialSyncSettledRef.current = true;
    if (initialSyncTimerRef.current !== null) {
      clearTimeout(initialSyncTimerRef.current);
      initialSyncTimerRef.current = null;
    }
    setInitialSyncReady(true);
  }, []);

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
      settleInitialSync();
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

    settleInitialSync();

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
  }, [settleInitialSync]);

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
    if (initialSyncSettledRef.current) {
      setInitialSyncReady(true);
    }
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
    // Offline, a failed pull or a hung request must not block the shell forever.
    if (!initialSyncSettledRef.current) {
      initialSyncTimerRef.current = setTimeout(
        settleInitialSync,
        INITIAL_SYNC_GATE_TIMEOUT_MS,
      );
    }

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
      if (initialSyncTimerRef.current !== null) {
        clearTimeout(initialSyncTimerRef.current);
        initialSyncTimerRef.current = null;
      }
      stopTriggers();
      window.removeEventListener('offline', handleOffline);
    };
  }, [run, settleInitialSync]);

  const syncNow = useCallback(async (): Promise<void> => {
    await run();
  }, [run]);

  const value = useMemo<SyncContextValue>(
    () => ({ ...state, syncNow }),
    [state, syncNow],
  );

  // The first pull must apply the server settings before SettingsProvider and
  // AppRoutes decide whether onboarding is still needed (design §9.5). Offline
  // or failed first runs release the gate above; later pulls still notify via
  // `kocluk:settings-updated`.
  if (!initialSyncReady) {
    return <InitialSyncGate />;
  }

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
