import type { SyncQueueRow } from '@/domain/types';
import { ApiError } from '@/lib/api';
import type { KoclukDB } from '../db';
import { DEFAULT_SETTINGS } from '../repositories';
import {
  ACCOUNT_SETTINGS,
  PUSH_PATH,
  SYNCED_TABLE_SET,
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
  withApplyingRemote,
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

const EMPTY_SUMMARY: PushSummary = { applied: 0, conflicts: 0, errors: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Pushes at most 100 pending queue rows (design §8.2, §9.2).
 *
 * Row-level results:
 *   * `applied` clears the queue entry and applies the canonical row so a
 *     server timestamp clamp or default reaches the client.
 *   * `conflict` applies the canonical row and rekeys the local identity when
 *     the natural key lives under a different id (design §6.5).
 *   * `error` is permanent and marks the row dead.
 *
 * Whole-request failures keep the queue usable: network/5xx/401/403/429 retry,
 * a 4xx validation answer is permanent. Dead rows are never sent again.
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

  const prepared: PreparedChange[] = [];
  let errors = 0;

  for (const row of queued) {
    if (!SYNCED_TABLE_SET.has(row.table)) {
      if (await markDead(db, row.id, 'unknown_table', row.updatedAt)) {
        errors += 1;
      }
      continue;
    }

    const change = await buildChange(db, row, row.table as SyncedTable);
    if (change === null) {
      if (await markDead(db, row.id, 'validation_failed', row.updatedAt)) {
        errors += 1;
      }
      continue;
    }
    prepared.push({ queued: row, change });
  }

  if (prepared.length === 0) {
    return { applied: 0, conflicts: 0, errors };
  }

  const body: PushRequestBody = { changes: prepared.map((entry) => entry.change) };
  const deviceId = await getMeta(db, 'deviceId');
  if (typeof deviceId === 'string' && deviceId !== '') {
    body.deviceId = deviceId;
  }

  let payload: unknown;
  try {
    payload = await apiClient.post(PUSH_PATH, body, csrfToken);
  } catch (error: unknown) {
    await failBatch(db, prepared, error);
    return { applied: 0, conflicts: 0, errors: errors + prepared.length };
  }

  const results = readResults(payload);
  if (results === null) {
    await failBatch(
      db,
      prepared,
      new ApiError(502, 'invalid_response', 'Senkron yanıtı geçersiz.'),
    );
    return { applied: 0, conflicts: 0, errors: errors + prepared.length };
  }

  let applied = 0;
  let conflicts = 0;

  await withApplyingRemote(async () => {
    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index];
      const result = results[index];

      try {
        if (!isRecord(result)) {
          if (await recordAttempt(db, entry.queued.id, 'Eksik sonuç', entry.queued.updatedAt)) {
            errors += 1;
          }
          continue;
        }

        if (result.status === 'applied') {
          const cleared = await markApplied(db, entry.queued.id, entry.queued.updatedAt);
          if (cleared && isRecord(result.row)) {
            await applyConfirmedRow(db, entry.queued.table as SyncedTable, result.row);
          }
          applied += 1;
          continue;
        }

        if (result.status === 'conflict') {
          if (!isRecord(result.row)) {
            if (await markDead(db, entry.queued.id, 'conflict', entry.queued.updatedAt)) {
              errors += 1;
            }
            continue;
          }
          await rekeyRow(
            db,
            entry.queued.table as SyncedTable,
            entry.queued.rowId,
            result.row,
          );
          await markApplied(db, entry.queued.id, entry.queued.updatedAt);
          conflicts += 1;
          continue;
        }

        const message = readErrorMessage(result.error);
        if (await markDead(db, entry.queued.id, message, entry.queued.updatedAt)) {
          errors += 1;
        }
      } catch (error: unknown) {
        // A failed rekey or canonical apply is row-level: the transaction is
        // rolled back and the row must not block its neighbours (design §6.5).
        const message = describeError(error);
        if (await markDead(db, entry.queued.id, message, entry.queued.updatedAt)) {
          errors += 1;
        }
      }
    }
  });

  return { applied, conflicts, errors };
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

/**
 * Applies a canonical row without clobbering a newer local edit. Settings and
 * activity logs are special: the former is one server-owned row, the latter is
 * insert-only, so an existing local activity row keeps its rekeyed references.
 */
async function applyConfirmedRow(
  db: KoclukDB,
  table: SyncedTable,
  row: Record<string, unknown>,
): Promise<void> {
  if (table === 'settings') {
    await applyServerRow(db, table, row);
    return;
  }

  const rowId = apiRowId(table, row);
  if (rowId === null) {
    return;
  }

  const local = (await db.table(table).get(rowId)) as Record<string, unknown> | undefined;

  if (table === 'activityLogs') {
    if (local === undefined) {
      await applyServerRow(db, table, row);
    }
    return;
  }

  if (local !== undefined) {
    const localAt = timestampValue(local.updatedAt);
    const serverAt = timestampValue(row.updatedAt);
    if (localAt !== null && serverAt !== null && serverAt < localAt) {
      return;
    }
  }

  await applyServerRow(db, table, row);
}

function timestampValue(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
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
