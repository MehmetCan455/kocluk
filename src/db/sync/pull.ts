import { ApiError } from '@/lib/api';
import type { KoclukDB } from '../db';
import {
  FULL_PATH,
  PULL_LIMIT,
  PULL_PATH,
  SYNCED_TABLES,
  SYNCED_TABLE_SET,
  apiRowId,
  type SyncedTable,
} from './constants';
import { getMeta, setMeta, SERVER_SETTINGS_SEEN_KEY } from './meta';
import { applyServerRow, whenQueueIdle } from './queue';
import { reconcileTaskActivities } from './reconcile';

/**
 * Read half of sync (design §8.3, §8.5).
 *
 * Incremental pull follows the `sync_changes.id` cursor stored in `syncMeta`;
 * a page is applied row by row and the cursor only advances after every row in
 * that page was handled. Tombstones (`deletedAt`) are kept, and a row with a
 * pending local change is never overwritten — the push that follows is the
 * authority for that row.
 *
 * Remote writes go through `applyServerRow`, whose suppression is scoped to
 * the write's own transaction. A user edit during a long pull is still queued
 * and still wins on the next push.
 */

/** The subset of `src/lib/api.ts` the read path needs. */
export interface PullApiClient {
  get<T>(path: string): Promise<T>;
}

export interface PullResult {
  applied: number;
  hasMore: boolean;
}

/** `syncMeta` key holding the last applied `sync_changes.id`. */
const CURSOR_KEY = 'lastChangeId';

/** Safety stop for a server that keeps reporting `hasMore` (100k rows). */
const MAX_PULL_PAGES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function invalidResponse(): ApiError {
  return new ApiError(502, 'invalid_response', 'Senkron yanıtı geçersiz.');
}

/** Current cursor; an absent or malformed value starts from the log start. */
export async function readSyncCursor(db: KoclukDB): Promise<number> {
  const value = await getMeta(db, CURSOR_KEY);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function readCursorValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalidResponse();
  }
  return Math.floor(value);
}

function isCursorExpired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 410 || error.code === 'cursor_expired')
  );
}

/**
 * Fetches and applies one pull page. Returns how many rows were written and
 * whether the server has another page. A 410 is thrown so the caller can fall
 * back to a full snapshot.
 */
export async function pullOnce(
  db: KoclukDB,
  apiClient: PullApiClient,
): Promise<PullResult> {
  // Queue writes are scheduled after their data transaction commits. Waiting
  // for the flush makes the pending check below see every completed write.
  await whenQueueIdle();

  const since = await readSyncCursor(db);
  const payload = await apiClient.get<unknown>(
    `${PULL_PATH}?since=${since}&limit=${PULL_LIMIT}`,
  );

  if (!isRecord(payload) || !Array.isArray(payload.changes)) {
    throw invalidResponse();
  }

  const nextCursor = Math.max(since, readCursorValue(payload.nextCursor));
  const hasMore = payload.hasMore === true;
  let applied = 0;

  for (const change of payload.changes) {
    if (!isRecord(change) || !isRecord(change.row)) {
      continue;
    }
    const table = change.table;
    if (typeof table !== 'string' || !SYNCED_TABLE_SET.has(table)) {
      continue;
    }
    // A row without its identity field cannot be stored safely (Dexie would
    // reject it or invent a key); leave it for a fixed server version.
    if (apiRowId(table as SyncedTable, change.row) === null) {
      continue;
    }
    const written = await applyServerRow(db, table as SyncedTable, change.row, {
      skipIfPending: true,
    });
    if (written) {
      applied += 1;
      if (table === 'settings') {
        await setMeta(db, SERVER_SETTINGS_SEEN_KEY, true);
      }
    }
  }

  await setMeta(db, CURSOR_KEY, nextCursor);
  return { applied, hasMore };
}

/**
 * Applies pages until the server reports no more changes. A 410 cursor expiry
 * is answered with a full snapshot (design §8.3). The cursor does not advance
 * when a page applied nothing and still claims `hasMore`, so a misbehaving
 * server can never spin forever.
 */
export async function pullAll(
  db: KoclukDB,
  apiClient: PullApiClient,
): Promise<number> {
  let applied = 0;

  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const before = await readSyncCursor(db);
    let result: PullResult;

    try {
      result = await pullOnce(db, apiClient);
    } catch (error: unknown) {
      if (isCursorExpired(error)) {
        await fullSync(db, apiClient);
        return applied;
      }
      throw error;
    }

    applied += result.applied;

    if (!result.hasMore) {
      // A conflict can leave a completed task without its activity log (or
      // the reverse); repair the pair once the page sequence is complete.
      await reconcileTaskActivities(db);
      return applied;
    }
    if ((await readSyncCursor(db)) <= before) {
      await reconcileTaskActivities(db);
      return applied;
    }
  }

  await reconcileTaskActivities(db);
  return applied;
}

/**
 * Full snapshot after a cursor expiry (design §8.3, §8.5).
 *
 * This is a merge, not a wipe: the snapshot includes tombstones, so a row the
 * user deleted on another device arrives with `deletedAt` filled. Only the 14
 * synced stores are written through `applyServerRow`; photos, attachments,
 * practice sessions, schedule files and the legacy tables are never touched.
 * A locally pending row keeps its local version, exactly like pull.
 */
export async function fullSync(
  db: KoclukDB,
  apiClient: PullApiClient,
): Promise<void> {
  await whenQueueIdle();

  const payload = await apiClient.get<unknown>(FULL_PATH);
  if (!isRecord(payload) || !isRecord(payload.tables)) {
    throw invalidResponse();
  }

  const cursor = readCursorValue(payload.cursor);
  const tables = payload.tables;
  const snapshot: Array<{ table: SyncedTable; rows: unknown[] }> = [];

  // The endpoint always returns every synced table (empty arrays included).
  // A missing table would make the cursor advance past rows never applied, so
  // the whole snapshot is rejected before anything is written.
  for (const table of SYNCED_TABLES) {
    const rows = tables[table];
    if (!Array.isArray(rows)) {
      throw invalidResponse();
    }
    snapshot.push({ table, rows });
  }

  for (const { table, rows } of snapshot) {
    for (const row of rows) {
      if (!isRecord(row)) {
        continue;
      }
      if (apiRowId(table, row) === null) {
        continue;
      }
      const written = await applyServerRow(db, table, row, { skipIfPending: true });
      if (written && table === 'settings') {
        await setMeta(db, SERVER_SETTINGS_SEEN_KEY, true);
      }
    }
  }

  await setMeta(db, CURSOR_KEY, cursor);
  await reconcileTaskActivities(db);
}
