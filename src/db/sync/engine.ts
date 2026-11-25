import { ApiError } from '@/lib/api';
import type { KoclukDB } from '../db';
import { STATUS_PATH } from './constants';
import { INITIAL_PULL_DONE_KEY, SERVER_SETTINGS_SEEN_KEY, getMeta, setMeta } from './meta';
import { pullAll, type PullApiClient } from './pull';
import { pushOnce, type PushApiClient, type PushSummary } from './push';
import {
  deadCount,
  discardSettingsChange,
  enqueueChange,
  onQueueWrite,
  pendingCount,
  setSettingsSyncEnabled,
  syncUserId,
} from './queue';

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
  /** Delay before an automatic retry after 429/5xx/network (null: none). */
  nextRetryMs?: number | null;
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
const LAST_STATUS_AT_KEY = 'lastStatusAt';
const FAILURE_COUNT_KEY = 'syncFailureCount';

const DEFAULT_DEBOUNCE_MS = 2_000;
const DEFAULT_INTERVAL_MS = 5 * 60_000;

/** `/api/sync/status` is limited to 60/hour; refresh at the 5-minute cadence. */
export const STATUS_REFRESH_MS = 5 * 60_000;

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 5 * 60_000;

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

export interface SyncRunOptions {
  /**
   * Fetch `/api/sync/status` even when the five-minute status cache is warm.
   * App-open, interval and manual runs force it; debounced write triggers and
   * visibility/online runs reuse the cached server time (30-60 status calls an
   * hour would otherwise exhaust the 60/hour limit).
   */
  forceStatus?: boolean;
}

async function runSync(
  db: KoclukDB,
  apiClient: SyncApiClient,
  csrfToken: string | null,
  options: SyncRunOptions = {},
): Promise<SyncResult> {
  let pushed: PushSummary = { ...EMPTY_PUSH };
  let pulled = 0;
  let lastSyncAt = await readStringMeta(db, LAST_SYNC_KEY);
  let serverTime = await readStringMeta(db, SERVER_TIME_KEY);
  let clockSkewMs = await readNumberMeta(db, CLOCK_SKEW_KEY);
  let error: string | null = null;
  let status: SyncRunStatus = 'synced';
  let nextRetryMs: number | null = null;

  const initialPullDone = (await getMeta(db, INITIAL_PULL_DONE_KEY)) === true;
  const lastStatusAt = await readNumberMeta(db, LAST_STATUS_AT_KEY);
  const statusDue =
    options.forceStatus === true ||
    lastStatusAt === null ||
    Date.now() - lastStatusAt >= STATUS_REFRESH_MS;
  // Keep the queue gate aligned with the persisted first-pull state even for
  // databases opened outside `dbManager` (tests, future restore flows).
  setSettingsSyncEnabled(db, initialPullDone);

  if (!browserOnline() && !options.forceStatus) {
    // `navigator.onLine` is only a hint: it is false on some VPNs, after
    // sleep/resume and in embedded browsers while traffic still works. An
    // explicit (app-open/manual) run therefore tries the network anyway; a
    // real outage still ends as `offline` through the transport error.
    const counts = await readCounts(db);
    return {
      status: 'offline',
      ...counts,
      lastSyncAt,
      serverTime,
      clockSkewMs,
      error: null,
      nextRetryMs: null,
      pushed,
      pulled,
    };
  }

  try {
    if (initialPullDone) {
      const before = await readCounts(db);
      if (csrfToken !== null && csrfToken !== '' && before.pending > 0) {
        pushed = await pushOnce(db, apiClient, csrfToken);
      }

      pulled = await pullAll(db, apiClient);
    } else {
      // First sync on this device is pull → push, not push → pull. A fresh
      // account database seeds default settings (and seedVersion), and pushing
      // those before reading would overwrite the real account row on the
      // server (design §9.3). Settings stay gated until the pull completes.
      await discardSettingsChange(db);
      pulled = await pullAll(db, apiClient);
      // A settings write made while the pull was in flight is gated too; any
      // entry that still slipped in is stale before the first push.
      await discardSettingsChange(db);
      await setMeta(db, INITIAL_PULL_DONE_KEY, true);
      setSettingsSyncEnabled(db, true);

      // A first pull that found no server settings must publish this device's
      // onboarding/profile settings; otherwise a fresh account stays empty on
      // the server until the user edits something.
      if ((await getMeta(db, SERVER_SETTINGS_SEEN_KEY)) !== true) {
        const userId = syncUserId(db);
        if (userId !== null) {
          await enqueueChange(db, 'settings', userId);
        }
      }

      const afterPull = await readCounts(db);
      if (csrfToken !== null && csrfToken !== '' && afterPull.pending > 0) {
        pushed = await pushOnce(db, apiClient, csrfToken);
      }
    }

    const receivedAt = new Date();

    if (statusDue) {
      const payload = await apiClient.get<unknown>(STATUS_PATH);
      const nextServerTime = readServerTime(payload);
      if (nextServerTime !== null) {
        serverTime = nextServerTime;
        clockSkewMs = Date.parse(nextServerTime) - receivedAt.getTime();
        await setMeta(db, SERVER_TIME_KEY, serverTime);
        await setMeta(db, CLOCK_SKEW_KEY, clockSkewMs);
      }
      await setMeta(db, LAST_STATUS_AT_KEY, receivedAt.getTime());
    }

    lastSyncAt = receivedAt.toISOString();
    await setMeta(db, LAST_SYNC_KEY, lastSyncAt);
    await setMeta(db, FAILURE_COUNT_KEY, 0);
  } catch (runError: unknown) {
    error = describeError(runError);
    status = isOfflineError(runError) ? 'offline' : 'error';
    nextRetryMs = await retryDelay(db, runError);
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
    nextRetryMs,
    pushed,
    pulled,
  };
}

/**
 * Backoff for a failed run. A 429 honours the server's Retry-After; network
 * and 5xx failures double from 30 s up to the five-minute interval so a dead
 * connection cannot spin, and the UI is never stuck in a permanent error
 * without a scheduled retry.
 */
async function retryDelay(db: KoclukDB, error: unknown): Promise<number | null> {
  if (!browserOnline()) {
    return null;
  }

  if (error instanceof ApiError) {
    if (error.status === 429) {
      return Math.max(1, error.retryAfterSeconds ?? 60) * 1000;
    }
    if (error.status !== 0 && error.status < 500 && error.code !== 'invalid_response') {
      // 4xx is a validation/session answer; a blind automatic retry would
      // simply fail again. The next trigger or the user's action retries.
      // `invalid_response` (2xx but not JSON) is transient host/proxy noise and
      // is retried with the network backoff below instead.
      return null;
    }
  }

  const failures = ((await readNumberMeta(db, FAILURE_COUNT_KEY)) ?? 0) + 1;
  await setMeta(db, FAILURE_COUNT_KEY, failures);
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));
}

/**
 * Push → pull → status for one database. Concurrent calls resolve one after
 * another instead of racing on the queue and the cursor.
 */
export function syncNow(
  db: KoclukDB,
  apiClient: SyncApiClient,
  csrfToken: string | null,
  options: SyncRunOptions = {},
): Promise<SyncResult> {
  const previous = syncChains.get(db) ?? Promise.resolve();
  const run = previous.then(
    () => runSync(db, apiClient, csrfToken, options),
    () => runSync(db, apiClient, csrfToken, options),
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

export type SyncTrigger = 'online' | 'visibility' | 'debounce' | 'interval';

export interface SyncTriggerOptions {
  run: (trigger: SyncTrigger) => void;
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
      run('debounce');
    }, debounceMs);
  };

  const handleOnline = () => {
    run('online');
  };
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      run('visibility');
    }
  };

  const unsubscribe = onQueueWrite(scheduleDebounced);
  const interval = setInterval(() => run('interval'), intervalMs);
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
