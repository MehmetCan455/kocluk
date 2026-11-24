import Dexie, { type Transaction } from 'dexie';
import type { SyncQueueRow } from '@/domain/types';
import type { KoclukDB } from '../db';
import {
  ACCOUNT_SETTINGS,
  MAX_PUSH_ATTEMPTS,
  MAX_PUSH_CHANGES,
  SYNCED_TABLES,
  SYNCED_TABLE_SET,
  SYNC_TABLES_WITH_UPDATED_AT,
  queueRowId,
  userIdFromDatabaseName,
  type SyncedTable,
} from './constants';

/**
 * Local write queue (design §9.2).
 *
 * Dexie hooks on the 13 synced tables coalesce every mutation into one queue
 * row per table + row id. The queue write is scheduled for the transaction's
 * `complete` event, so an aborted transaction never leaves a queue entry, and
 * runs in its own transaction because a single-table `put()` transaction does
 * not include `syncQueue` in its scope.
 *
 * `setApplyingRemote(true)` disables the hooks while pull/push writes server
 * rows: remote data must not bounce back to the server.
 */

type QueueOp = 'upsert' | 'delete';

interface PendingQueueWrite {
  table: SyncedTable;
  rowId: string;
  op: QueueOp;
}

let applyingRemote = false;

/** While true, hooks neither touch `updatedAt` nor enqueue. */
export function setApplyingRemote(value: boolean): void {
  applyingRemote = value;
}

export function isApplyingRemote(): boolean {
  return applyingRemote;
}

/** Runs `run` with remote-apply hooks disabled, restoring the prior flag. */
export async function withApplyingRemote<T>(run: () => Promise<T>): Promise<T> {
  const previous = applyingRemote;
  applyingRemote = true;
  try {
    return await run();
  } finally {
    applyingRemote = previous;
  }
}

let lastIssuedAt = 0;

/**
 * Monotonic ISO timestamp for local mutations and queue bookkeeping. Two
 * writes in the same millisecond still get distinct values, so a queue row
 * written during a push can never be mistaken for the version being pushed.
 */
export function nextTimestamp(): string {
  const current = Date.now();
  lastIssuedAt = current > lastIssuedAt ? current : lastIssuedAt + 1;
  return new Date(lastIssuedAt).toISOString();
}

const installedHooks = new WeakSet<KoclukDB>();
const syncUserIds = new WeakMap<KoclukDB, string>();
const transactionWrites = new WeakMap<Transaction, Map<string, PendingQueueWrite>>();

let flushChain: Promise<void> = Promise.resolve();

/** Waits until every queue row scheduled by completed transactions is written. */
export async function whenQueueIdle(): Promise<void> {
  let current: Promise<void>;
  do {
    current = flushChain;
    await current;
  } while (current !== flushChain);
}

/**
 * Installs the creating/updating/deleting hooks on every synced table. Call it
 * when a user database is opened (dbManager/AuthGate), never at module scope:
 * the hooks need the account id and must not run against the legacy database.
 * Installing twice on the same instance is a no-op.
 */
export function installSyncHooks(db: KoclukDB, userId: string): void {
  if (installedHooks.has(db)) {
    return;
  }
  installedHooks.add(db);
  syncUserIds.set(db, userId);

  for (const table of SYNCED_TABLES) {
    if (table === 'settings') {
      installSettingsHooks(db, userId);
    } else {
      installTableHooks(db, table);
    }
  }
}

/** Account id of an installed database, falling back to its name. */
export function syncUserId(db: KoclukDB): string | null {
  return syncUserIds.get(db) ?? userIdFromDatabaseName(db.name);
}

function installTableHooks(db: KoclukDB, tableName: SyncedTable): void {
  const table = db.table(tableName);
  const hasUpdatedAt = SYNC_TABLES_WITH_UPDATED_AT.has(tableName);

  table.hook('creating', function (primKey, obj, transaction) {
    if (applyingRemote) {
      return;
    }
    if (hasUpdatedAt) {
      touchUpdatedAt(obj as Record<string, unknown>);
    }
    scheduleQueueWrite(db, transaction, tableName, String(primKey), 'upsert');
  });

  table.hook('updating', function (modifications, primKey, _obj, transaction) {
    if (applyingRemote) {
      return;
    }
    if (hasUpdatedAt) {
      touchUpdatedAt(modifications as Record<string, unknown>);
    }
    scheduleQueueWrite(db, transaction, tableName, String(primKey), 'upsert');
  });

  table.hook('deleting', function (primKey, _obj, transaction) {
    if (applyingRemote) {
      return;
    }
    scheduleQueueWrite(db, transaction, tableName, String(primKey), 'delete');
  });
}

/**
 * `settings` is one logical row per account even though it is stored as
 * key/value rows, so every settings write coalesces into `settings:<userId>`
 * and is always an upsert (the server row cannot be deleted).
 */
function installSettingsHooks(db: KoclukDB, userId: string): void {
  const table = db.table('settings');
  const schedule = (transaction: Transaction): void => {
    if (applyingRemote) {
      return;
    }
    scheduleQueueWrite(db, transaction, 'settings', userId, 'upsert');
  };

  table.hook('creating', (_primKey, _obj, transaction) => schedule(transaction));
  table.hook('updating', (_modifications, _primKey, _obj, transaction) => schedule(transaction));
  table.hook('deleting', (_primKey, _obj, transaction) => schedule(transaction));
}

function touchUpdatedAt(target: Record<string, unknown>): void {
  const current = target.updatedAt;
  if (typeof current !== 'string' || current === '') {
    target.updatedAt = nextTimestamp();
  }
}

function scheduleQueueWrite(
  db: KoclukDB,
  transaction: Transaction,
  table: SyncedTable,
  rowId: string,
  op: QueueOp,
): void {
  let writes = transactionWrites.get(transaction);

  if (!writes) {
    writes = new Map<string, PendingQueueWrite>();
    transactionWrites.set(transaction, writes);
    const scheduled = writes;
    transaction.on('complete', () => {
      transactionWrites.delete(transaction);
      scheduleFlush(db, Array.from(scheduled.values()));
    });
  }

  writes.set(queueRowId(table, rowId), { table, rowId, op });
}

function scheduleFlush(db: KoclukDB, writes: PendingQueueWrite[]): void {
  if (writes.length === 0) {
    return;
  }
  flushChain = flushChain
    .then(() =>
      Dexie.ignoreTransaction(async () => {
        for (const write of writes) {
          await enqueueChange(db, write.table, write.rowId, write.op);
        }
      }),
    )
    .catch((error: unknown) => {
      // A lost queue entry must not break the caller; the next local write
      // recreates it. Never log row contents.
      console.error('Senkron kuyruğu güncellenemedi', error);
    });
}

/**
 * Writes (or coalesces) one pending queue row. A new local change revives a
 * dead row and resets its attempt counter, because the content it failed on no
 * longer exists.
 */
export async function enqueueChange(
  db: KoclukDB,
  table: SyncedTable,
  rowId: string,
  op: QueueOp = 'upsert',
): Promise<void> {
  const id = queueRowId(table, rowId);
  const updatedAt = nextTimestamp();

  await db.transaction('rw', db.syncQueue, async () => {
    const existing = await db.syncQueue.get(id);
    const row: SyncQueueRow = {
      id,
      table,
      rowId,
      op,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
      attempts: 0,
      status: 'pending',
      lastError: null,
    };
    await db.syncQueue.put(row);
  });
}

function sortQueueRows(left: SyncQueueRow, right: SyncQueueRow): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/** Oldest pending queue rows, at most one push batch. Dead rows never block. */
export async function pendingChanges(
  db: KoclukDB,
  limit = MAX_PUSH_CHANGES,
): Promise<SyncQueueRow[]> {
  const rows = await db.syncQueue.where('status').equals('pending').toArray();
  rows.sort(sortQueueRows);
  return rows.slice(0, Math.max(0, limit));
}

/** Number of rows waiting to be pushed; dead rows are reported separately. */
export function pendingCount(db: KoclukDB): Promise<number> {
  return db.syncQueue.where('status').equals('pending').count();
}

/** Rows that will not be retried automatically (design §9.2). */
export async function deadLetters(db: KoclukDB): Promise<SyncQueueRow[]> {
  const rows = await db.syncQueue.where('status').equals('dead').toArray();
  return rows.sort(sortQueueRows);
}

/**
 * Deletes the queue row after the server accepted that exact local version.
 * When `expectedUpdatedAt` is given, a row rewritten during the request is
 * kept: its newer content still has to be pushed.
 */
export async function markApplied(
  db: KoclukDB,
  queueId: string,
  expectedUpdatedAt?: string,
): Promise<boolean> {
  return db.transaction('rw', db.syncQueue, async () => {
    const row = await db.syncQueue.get(queueId);
    if (!row) {
      return false;
    }
    if (expectedUpdatedAt !== undefined && row.updatedAt !== expectedUpdatedAt) {
      return false;
    }
    await db.syncQueue.delete(queueId);
    return true;
  });
}

/** Marks a row dead so it stops blocking the queue (design §9.2). */
export async function markDead(
  db: KoclukDB,
  queueId: string,
  message: string,
  expectedUpdatedAt?: string,
): Promise<boolean> {
  return db.transaction('rw', db.syncQueue, async () => {
    const row = await db.syncQueue.get(queueId);
    if (!row) {
      return false;
    }
    if (expectedUpdatedAt !== undefined && row.updatedAt !== expectedUpdatedAt) {
      return false;
    }
    await db.syncQueue.put({
      ...row,
      attempts: row.attempts + 1,
      status: 'dead',
      lastError: message,
      updatedAt: nextTimestamp(),
    });
    return true;
  });
}

/**
 * Counts one failed transient attempt. The row stays pending until the fifth
 * failure, then becomes dead (design §9.2).
 */
export async function recordAttempt(
  db: KoclukDB,
  queueId: string,
  message: string,
  expectedUpdatedAt?: string,
): Promise<boolean> {
  return db.transaction('rw', db.syncQueue, async () => {
    const row = await db.syncQueue.get(queueId);
    if (!row) {
      return false;
    }
    if (expectedUpdatedAt !== undefined && row.updatedAt !== expectedUpdatedAt) {
      return false;
    }
    const attempts = row.attempts + 1;
    await db.syncQueue.put({
      ...row,
      attempts,
      status: attempts >= MAX_PUSH_ATTEMPTS ? 'dead' : 'pending',
      lastError: message,
      updatedAt: nextTimestamp(),
    });
    return true;
  });
}

/** Re-arms dead rows ("Tekrar dene"); returns how many rows were revived. */
export async function retryDead(db: KoclukDB, ids?: string[]): Promise<number> {
  const rows = ids
    ? (await db.syncQueue.bulkGet(ids)).filter(
        (row): row is SyncQueueRow => row !== undefined && row.status === 'dead',
      )
    : await db.syncQueue.where('status').equals('dead').toArray();

  if (rows.length === 0) {
    return 0;
  }

  const updatedAt = nextTimestamp();
  await db.syncQueue.bulkPut(
    rows.map((row) => ({
      ...row,
      attempts: 0,
      status: 'pending',
      lastError: null,
      updatedAt,
    })),
  );
  return rows.length;
}

/**
 * Writes a canonical server row locally without re-enqueueing it (used by push
 * conflicts and Task 13's pull). `null` optional values become absent fields so
 * tombstones and optional columns match the local row shape.
 */
export async function applyServerRow(
  db: KoclukDB,
  table: SyncedTable,
  row: Record<string, unknown>,
): Promise<void> {
  if (!SYNCED_TABLE_SET.has(table)) {
    throw new Error(`Bilinmeyen senkron tablosu: ${table}`);
  }

  await withApplyingRemote(async () => {
    if (table === 'settings') {
      await applySettingsRow(db, row);
      return;
    }

    const clean = stripNulls(row);
    if (table === 'notes' && typeof clean.topicId !== 'string') {
      throw new Error('Not satırında topicId yok');
    }
    await db.table(table).put(clean);
  });
}

async function applySettingsRow(db: KoclukDB, row: Record<string, unknown>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    for (const field of ACCOUNT_SETTINGS) {
      const value = row[field];
      if (value === undefined || value === null) {
        await db.settings.delete(field);
      } else {
        await db.settings.put({ key: field, value });
      }
    }
  });
}

function stripNulls(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}
