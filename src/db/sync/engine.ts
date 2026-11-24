import { ApiError } from '@/lib/api';
import type { KoclukDB } from '../db';
import { STATUS_PATH } from './constants';
import { getMeta, setMeta } from './meta';
import { pullAll, type PullApiClient } from './pull';
import { pushOnce, type PushApiClient, type PushSummary } from './push';
import { deadCount, onQueueWrite, pendingCount } from './queue';

/**
 * The sync state machine (design §9.5).
 *
 * One run is always push → pull → status:
 *   1. pending local rows go out first, so the server decides their final
 *      version before this device reads anything back;
 *   2. pull (or a full snapshot on a 410) applies remote rows without touching
 *      a row that still has a pending local change;
 *   3. status supplies `serverTime`, which lets the UI warn about a skewed
 *      device clock before it corrupts last-writer-wins ordering.
 *
 * Request-level failures are classified: a transport error is `offline` and
 * keeps the queue untouched, anything else is `error`. Rows that reached the
 * dead-letter state are reported separately and keep the status at `error`
 * until the user resolves them ("Gönderilemeyen kayıt").
 */

export type SyncRunStatus = 'synced' | 'pending' | 'offline' | 'error';

export type SyncIndicatorStatus = SyncRunStatus | 'syncing';

export interface SyncState {
  status: SyncIndicatorStatus;
  pending: number;
  dead: number;
  lastSyncAt: string | null;
  serverTime: string | null;
  /** `serverTime - local time` measured when the status response arrived. */
  clockSkewMs: number | null;
  error: string | null;
}

export type SyncResult = Omit<SyncState, 'status'> & {
  status: SyncRunStatus;
  pushed: PushSummary;
  pulled: number;
};

export interface SyncApiClient extends PushApiClient, PullApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown, csrfToken?: string): Promise<T>;
}

const LAST_SYNC_KEY = 'lastSyncAt';
const SERVER_TIME_KEY = 'serverTime';
const CLOCK_SKEW_KEY = 'clockSkewMs';

const DEFAULT_DEBOUNCE_MS = 2_000;
const DEFAULT_INTERVAL_MS = 5 * 60_000;

const EMPTY_PUSH: PushSummary = { applied: 0, conflicts: 0, errors: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function readStringMeta(db: KoclukDB, key: string): Promise<string | null> {
  const value = await getMeta(db, key);
  return typeof value === 'string' && value !== '' ? value : null;
}

async function readNumberMeta(db: KoclukDB, key: string): Promise<number | null> {
  const value = await getMeta(db, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readCounts(
  db: KoclukDB,
): Promise<{ pending: number; dead: number }> {
  const [pending, dead] = await Promise.all([pendingCount(db), deadCount(db)]);
  return { pending, dead };
}

function readServerTime(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const value = payload.serverTime;
  if (typeof value !== 'string' || value === '' || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message === '' ? error.code : `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : 'Senkron tamamlanamadı.';
}

function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

/**
 * UI status when no run is in progress. A dead letter is an error: that row is
 * not on the server and the user has to act on it.
 */
export function deriveSyncStatus(
  pending: number,
  dead: number,
  online: boolean,
): SyncRunStatus {
  if (!online) {
    return 'offline';
  }
  if (pending > 0) {
    return 'pending';
  }
  if (dead > 0) {
    return 'error';
  }
  return 'synced';
}

// Runs for the same database are serialized: two triggers firing together must
// not push the same queue row twice or interleave their cursor updates.
const syncChains = new WeakMap<KoclukDB, Promise<unknown>>();

async function runSync(
  db: KoclukDB,
  apiClient: SyncApiClient,
  csrfToken: string | null,
): Promise<SyncResult> {
  let pushed: PushSummary = { ...EMPTY_PUSH };
  let pulled = 0;
  let lastSyncAt = await readStringMeta(db, LAST_SYNC_KEY);
  let serverTime = await readStringMeta(db, SERVER_TIME_KEY);
  let clockSkewMs = await readNumberMeta(db, CLOCK_SKEW_KEY);
  let error: string | null = null;
  let status: SyncRunStatus = 'synced';

  if (!browserOnline()) {
    const counts = await readCounts(db);
    return {
      status: 'offline',
      ...counts,
      lastSyncAt,
      serverTime,
      clockSkewMs,
      error: null,
      pushed,
      pulled,
    };
  }

  try {
    const before = await readCounts(db);
    if (csrfToken !== null && csrfToken !== '' && before.pending > 0) {
      pushed = await pushOnce(db, apiClient, csrfToken);
    }

    pulled = await pullAll(db, apiClient);

    const payload = await apiClient.get<unknown>(STATUS_PATH);
    const receivedAt = new Date();
    const nextServerTime = readServerTime(payload);
    if (nextServerTime !== null) {
      serverTime = nextServerTime;
      clockSkewMs = Date.parse(nextServerTime) - receivedAt.getTime();
      await setMeta(db, SERVER_TIME_KEY, serverTime);
      await setMeta(db, CLOCK_SKEW_KEY, clockSkewMs);
    }

    lastSyncAt = receivedAt.toISOString();
    await setMeta(db, LAST_SYNC_KEY, lastSyncAt);
  } catch (runError: unknown) {
    error = describeError(runError);
    status = isOfflineError(runError) ? 'offline' : 'error';
  }

  const counts = await readCounts(db);

  if (status === 'synced') {
    status = deriveSyncStatus(counts.pending, counts.dead, true);
    if (status === 'error' && error === null) {
      error = 'Gönderilemeyen kayıtlar var. Ayarlar → Senkron bölümünden yeniden deneyin.';
    }
  }

  return {
    status,
    ...counts,
    lastSyncAt,
    serverTime,
    clockSkewMs,
    error,
    pushed,
    pulled,
  };
}

/**
 * Push → pull → status for one database. Concurrent calls resolve one after
 * another instead of racing on the queue and the cursor.
 */
export function syncNow(
  db: KoclukDB,
  apiClient: SyncApiClient,
  csrfToken: string | null,
): Promise<SyncResult> {
  const previous = syncChains.get(db) ?? Promise.resolve();
  const run = previous.then(
    () => runSync(db, apiClient, csrfToken),
    () => runSync(db, apiClient, csrfToken),
  );
  syncChains.set(
    db,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export interface SyncTriggerOptions {
  run: () => void;
  /** Wait after the last local write before syncing (default 2 s). */
  debounceMs?: number;
  /** Periodic safety pull (default 5 min). */
  intervalMs?: number;
}

/**
 * App-open is the caller's mount run; these are the recurring triggers of
 * design §9.5: `online`, tab visibility, the debounce after a local write and
 * the five-minute interval. Returns a cleanup function that removes every
 * listener and timer.
 */
export function startSyncTriggers(options: SyncTriggerOptions): () => void {
  const { run } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleDebounced = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      run();
    }, debounceMs);
  };

  const handleOnline = () => {
    run();
  };
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      run();
    }
  };

  const unsubscribe = onQueueWrite(scheduleDebounced);
  const interval = setInterval(run, intervalMs);
  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    unsubscribe();
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibility);
    clearInterval(interval);
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };
}
