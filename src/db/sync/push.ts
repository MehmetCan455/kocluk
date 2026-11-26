import type { SyncQueueRow } from '@/domain/types';
import { ApiError } from '@/lib/api';
import { isSharedCatalogBook } from '@/data/catalogBooks';
import type { KoclukDB } from '../db';
import { DEFAULT_SETTINGS } from '../repositories';
import {
  ACCOUNT_SETTINGS,
  MAX_PUSH_BYTES,
  PUSH_PATH,
  SYNCED_TABLE_SET,
  SYNC_TABLES_WITH_UPDATED_AT,
  SYNC_TABLE_FIELDS,
  apiRowId,
  type SyncedTable,
} from './constants';
import { getMeta } from './meta';
import {
  applyServerRow,
  markApplied,
  markDead,
  pendingChanges,
  recordAttempt,
} from './queue';
import { rekeyRow } from './rekey';

/** The subset of `src/lib/api.ts` the push needs; the only HTTP client. */
export interface PushApiClient {
  post<T>(path: string, body?: unknown, csrfToken?: string): Promise<T>;
}

/** Minimal-change payload shape of POST /api/sync/push (design §8.2). */
export interface PushChange {
  table: string;
  op: 'upsert' | 'delete';
  row?: Record<string, unknown>;
  rowId?: string;
  updatedAt?: string;
}

export interface PushRequestBody {
  deviceId?: string;
  changes: PushChange[];
}

export interface PushSummary {
  applied: number;
  conflicts: number;
  errors: number;
}

interface PreparedChange {
  queued: SyncQueueRow;
  change: PushChange;
}

interface PlannedBatches {
  batches: PreparedChange[][];
  oversized: PreparedChange[];
}

const EMPTY_SUMMARY: PushSummary = { applied: 0, conflicts: 0, errors: 0 };

const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

/**
 * Pushes pending queue rows (design §8.2, §9.2).
 *
 * At most 100 rows per request and at most 1 MB of UTF-8 body; larger sets are
 * sent as consecutive requests and a row that cannot fit alone is dead-lettered
 * without blocking the rest.
 *
 * Row-level results:
 *   * `applied` clears the queue entry and applies the canonical row
 *     unconditionally, so a server timestamp clamp or default reaches the
 *     client.
 *   * `conflict` applies/rekeys only when the queue entry is still the version
 *     that was sent; a user edit during the request wins and stays pending.
 *   * `error` is permanent and marks the row dead.
 *
 * Whole-request failures keep the queue usable: network/5xx retry with a
 * five-attempt budget, 400/409/413/422 are permanent, and 401/403/429 stay
 * pending for the next session/trigger.
 */
export async function pushOnce(
  db: KoclukDB,
  apiClient: PushApiClient,
  csrfToken: string,
): Promise<PushSummary> {
  const queued = await pendingChanges(db);
  if (queued.length === 0) {
    return { ...EMPTY_SUMMARY };
  }

  const summary: PushSummary = { applied: 0, conflicts: 0, errors: 0 };
  const prepared: PreparedChange[] = [];

  for (const row of queued) {
    if (!SYNCED_TABLE_SET.has(row.table)) {
      if (await markDead(db, row.id, 'unknown_table', row.updatedAt)) {
        summary.errors += 1;
      }
      continue;
    }

    const table = row.table as SyncedTable;

    // The shared catalog ships with the app and must never be uploaded as the
    // user's private books (design §6.2). Old queues or a restore can still
    // contain a seed row; resolve it locally without a request.
    if (table === 'catalogBooks' && row.op === 'upsert') {
      const local = await db.catalogBooks.get(row.rowId);
      if (local !== undefined && isSharedCatalogBook(local.id)) {
        if (await markApplied(db, row.id, row.updatedAt)) {
          summary.applied += 1;
          continue;
        }
      }
    }

    const change = await buildChange(db, row, table);
    if (change === null) {
      if (await markDead(db, row.id, 'validation_failed', row.updatedAt)) {
        summary.errors += 1;
      }
      continue;
    }
    prepared.push({ queued: row, change });
  }

  if (prepared.length === 0) {
    return summary;
  }

  const deviceId = await readDeviceId(db);
  const planned = planBatches(prepared, deviceId);

  for (const entry of planned.oversized) {
    if (await markDead(db, entry.queued.id, 'payload_too_large', entry.queued.updatedAt)) {
      summary.errors += 1;
    }
  }

  for (const batch of planned.batches) {
    await pushBatch(db, apiClient, csrfToken, deviceId, batch, summary);
  }

  return summary;
}

async function readDeviceId(db: KoclukDB): Promise<string | undefined> {
  const deviceId = await getMeta(db, 'deviceId');
  return typeof deviceId === 'string' && deviceId !== '' ? deviceId : undefined;
}

/**
 * Greedy byte-budget split. A single change that does not fit the 1 MB body
 * limit is returned as oversized; it can never be sent, so it is dead-lettered
 * on its own instead of poisoning up to 99 neighbours.
 */
function planBatches(prepared: PreparedChange[], deviceId?: string): PlannedBatches {
  const envelope = byteLength(
    JSON.stringify({ ...(deviceId === undefined ? {} : { deviceId }), changes: [] }),
  );
  const batches: PreparedChange[][] = [];
  const oversized: PreparedChange[] = [];
  let current: PreparedChange[] = [];
  let size = envelope;

  for (const entry of prepared) {
    // +1 for the comma that separates this change from the previous one.
    const changeBytes = byteLength(JSON.stringify(entry.change)) + 1;

    if (envelope + changeBytes > MAX_PUSH_BYTES) {
      oversized.push(entry);
      continue;
    }

    if (current.length > 0 && size + changeBytes > MAX_PUSH_BYTES) {
      batches.push(current);
      current = [];
      size = envelope;
    }

    current.push(entry);
    size += changeBytes;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return { batches, oversized };
}

async function pushBatch(
  db: KoclukDB,
  apiClient: PushApiClient,
  csrfToken: string,
  deviceId: string | undefined,
  prepared: PreparedChange[],
  summary: PushSummary,
): Promise<void> {
  if (prepared.length === 0) {
    return;
  }

  const body: PushRequestBody = { changes: prepared.map((entry) => entry.change) };
  if (deviceId !== undefined) {
    body.deviceId = deviceId;
  }

  let payload: unknown;
  try {
    payload = await apiClient.post(PUSH_PATH, body, csrfToken);
  } catch (error: unknown) {
    // A 413 means the proxy/server rejected the body size. Split and retry; a
    // single row is the smallest unit and becomes a dead letter.
    if (isPayloadTooLarge(error)) {
      if (prepared.length > 1) {
        const middle = Math.ceil(prepared.length / 2);
        await pushBatch(db, apiClient, csrfToken, deviceId, prepared.slice(0, middle), summary);
        await pushBatch(db, apiClient, csrfToken, deviceId, prepared.slice(middle), summary);
        return;
      }

      const [entry] = prepared;
      if (await markDead(db, entry.queued.id, 'payload_too_large', entry.queued.updatedAt)) {
        summary.errors += 1;
      }
      return;
    }

    await failBatch(db, prepared, error);
    summary.errors += prepared.length;
    return;
  }

  const results = readResults(payload);
  if (results === null) {
    await failBatch(
      db,
      prepared,
      new ApiError(502, 'invalid_response', 'Senkron yanıtı geçersiz.'),
    );
    summary.errors += prepared.length;
    return;
  }

  await processResults(db, prepared, results, summary);
}

async function processResults(
  db: KoclukDB,
  prepared: PreparedChange[],
  results: unknown[],
  summary: PushSummary,
): Promise<void> {
  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    const result = results[index];
    const table = entry.queued.table as SyncedTable;

    try {
      if (!isRecord(result)) {
        if (await recordAttempt(db, entry.queued.id, 'Eksik sonuç', entry.queued.updatedAt)) {
          summary.errors += 1;
        }
        continue;
      }

      if (result.status === 'applied') {
        const cleared = await markApplied(db, entry.queued.id, entry.queued.updatedAt);
        if (cleared && isRecord(result.row)) {
          // Once this exact version was accepted, the server row is
          // authoritative even when its timestamp is older (clock clamp).
          await applyServerRow(db, table, result.row);
        }
        summary.applied += 1;
        continue;
      }

      if (result.status === 'conflict') {
        if (!isRecord(result.row)) {
          if (await markDead(db, entry.queued.id, 'conflict', entry.queued.updatedAt)) {
            summary.errors += 1;
          }
          continue;
        }

        // A user write or an earlier conflict in this batch may have replaced
        // the queue entry; applying the stale canonical row would undo it.
        if (!(await isCurrentQueueVersion(db, entry.queued))) {
          continue;
        }

        if (table === 'activityLogs' && apiRowId(table, result.row) === entry.queued.rowId) {
          // The server is insert-only: the canonical log is the pre-rekey
          // row, so applying it would undo the local reference correction.
          // Other devices cannot receive the corrected reference until the
          // server contract allows activity-log updates.
          await markApplied(db, entry.queued.id, entry.queued.updatedAt);
          summary.conflicts += 1;
          continue;
        }

        await rekeyRow(db, table, entry.queued.rowId, result.row);
        await markApplied(db, entry.queued.id, entry.queued.updatedAt);
        summary.conflicts += 1;
        continue;
      }

      const message = readErrorMessage(result.error);
      if (await markDead(db, entry.queued.id, message, entry.queued.updatedAt)) {
        summary.errors += 1;
      }
    } catch (error: unknown) {
      // A failed rekey or canonical apply is row-level: the transaction is
      // rolled back and the row must not block its neighbours (design §6.5).
      const message = describeError(error);
      if (await markDead(db, entry.queued.id, message, entry.queued.updatedAt)) {
        summary.errors += 1;
      }
    }
  }
}

async function isCurrentQueueVersion(db: KoclukDB, queued: SyncQueueRow): Promise<boolean> {
  const current = await db.syncQueue.get(queued.id);
  return current !== undefined && current.updatedAt === queued.updatedAt;
}

async function buildChange(
  db: KoclukDB,
  queued: SyncQueueRow,
  table: SyncedTable,
): Promise<PushChange | null> {
  if (table === 'settings') {
    return { table, op: 'upsert', row: await buildSettingsRow(db, queued) };
  }

  const local = (await db.table(table).get(queued.rowId)) as
    | Record<string, unknown>
    | undefined;
  const localUpdatedAt =
    typeof local?.updatedAt === 'string' && local.updatedAt !== ''
      ? local.updatedAt
      : queued.updatedAt;

  if (queued.op === 'delete' || local === undefined) {
    return { table, op: 'delete', rowId: queued.rowId, updatedAt: localUpdatedAt };
  }

  const row: Record<string, unknown> = {};
  for (const field of SYNC_TABLE_FIELDS[table]) {
    const value = local[field];
    if (value !== undefined) {
      row[field] = value;
    }
  }

  if (apiRowId(table, row) === null) {
    return null;
  }
  // Legacy/transferred rows may predate the `updatedAt` column. The server
  // requires it for every synced table, so use the queue timestamp rather than
  // dead-lettering the row forever.
  if (
    SYNC_TABLES_WITH_UPDATED_AT.has(table) &&
    (typeof row.updatedAt !== 'string' || row.updatedAt === '')
  ) {
    row.updatedAt = localUpdatedAt;
  }
  // Chains created before the skip list existed have no field locally. The API
  // requires it, so a dead-lettered legacy row would stay stuck without this
  // default; new rows already carry their real list.
  if (
    table === 'schedulePageChains' &&
    (typeof row.skippedChunks !== 'string' || row.skippedChunks === '')
  ) {
    row.skippedChunks = '[]';
  }
  return { table, op: 'upsert', row };
}

/**
 * The account-level slice of `getSettings()`, with defaults for keys that were
 * never written locally. Device settings are deliberately excluded (design
 * §8.2: `accent` and `scheduleMode` never leave the device).
 */
async function buildSettingsRow(
  db: KoclukDB,
  queued: SyncQueueRow,
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of await db.settings.toArray()) {
    merged[String(row.key)] = row.value;
  }

  const row: Record<string, unknown> = {
    userId: queued.rowId,
    updatedAt: queued.updatedAt,
  };
  for (const field of ACCOUNT_SETTINGS) {
    const value = merged[field];
    if (value !== undefined) {
      row[field] = value;
    }
  }
  return row;
}

function readResults(payload: unknown): unknown[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return null;
  }
  return payload.results;
}

function readErrorMessage(error: unknown): string {
  if (!isRecord(error)) {
    return 'error';
  }
  const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'error';
  const message = typeof error.message === 'string' ? error.message : '';
  return message === '' ? code : `${code}: ${message}`;
}

function isPayloadTooLarge(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 413 || error.code === 'payload_too_large')
  );
}

/** Network, 5xx, expired session, CSRF and rate limits are retryable. */
function isPermanentFailure(status: number): boolean {
  if (status < 400 || status >= 500) {
    return false;
  }
  return status !== 401 && status !== 403 && status !== 429;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message === '' ? error.code : `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : 'error';
}

async function failBatch(
  db: KoclukDB,
  prepared: PreparedChange[],
  error: unknown,
): Promise<void> {
  const status = error instanceof ApiError ? error.status : 0;
  const message = describeError(error);
  const permanent = isPermanentFailure(status);
  // 401/403/429 are session, CSRF or throttle answers; the row stays pending
  // and the next trigger retries without spending one of its five attempts.
  const retryable = status === 0 || status >= 500;

  for (const entry of prepared) {
    if (permanent) {
      await markDead(db, entry.queued.id, message, entry.queued.updatedAt);
    } else if (retryable) {
      await recordAttempt(db, entry.queued.id, message, entry.queued.updatedAt);
    }
  }
}
