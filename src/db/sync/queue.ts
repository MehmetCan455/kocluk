import Dexie, { type Transaction } from 'dexie';
import { isSharedCatalogBook } from '@/data/catalogBooks';
import type { SyncQueueRow } from '@/domain/types';
import { notifySettingsUpdated } from '@/lib/events';
import { LOCAL_SCOPE } from '@/lib/namespaces';
import type { KoclukDB } from '../db';
import {
  ACCOUNT_SETTINGS,
  MAX_PUSH_ATTEMPTS,
  MAX_PUSH_CHANGES,
  SYNC_NATURAL_KEYS,
  SYNCED_TABLES,
  SYNCED_TABLE_SET,
  SYNC_TABLES_WITH_UPDATED_AT,
  apiRowId,
  queueRowId,
  userIdFromDatabaseName,
  type SyncedTable,
} from './constants';

/**
 * Local write queue (design §9.2).
 *
 * Dexie hooks on the 14 synced tables coalesce every mutation into one queue
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

let applyingRemoteDepth = 0;
const remoteTransactions = new WeakSet<Transaction>();

/** Notified after a local change is coalesced into the queue. */
export type QueueWriteListener = (write: { table: SyncedTable; rowId: string }) => void;

const queueWriteListeners = new Set<QueueWriteListener>();

/**
 * Subscribes to local queue writes so the sync engine can debounce a push
 * shortly after the user edits something (design §9.5). Returns the
 * unsubscribe function; a listener that throws never breaks the write.
 */
export function onQueueWrite(listener: QueueWriteListener): () => void {
  queueWriteListeners.add(listener);
  return () => {
    queueWriteListeners.delete(listener);
  };
}

function notifyQueueWrite(table: SyncedTable, rowId: string): void {
  for (const listener of queueWriteListeners) {
    try {
      listener({ table, rowId });
    } catch {
      // A trigger is an optimisation; a broken listener must not lose data.
    }
  }
}

/**
 * Remote-row suppression is scoped to the transaction that writes the server
 * row, not to the whole database: a user write in another transaction (even
 * while a push result is being applied) must still enqueue.
 *
 * The global depth counter remains for `pull`/full-sync callers (Task 13) that
 * write rows without wrapping each one in a transaction. Overlapping paired
 * calls unwind correctly; `withApplyingRemote` also restores on throw.
 */
export function setApplyingRemote(value: boolean): void {
  applyingRemoteDepth = value
    ? applyingRemoteDepth + 1
    : Math.max(0, applyingRemoteDepth - 1);
}

export function isApplyingRemote(): boolean {
  return applyingRemoteDepth > 0;
}

/** Runs `run` with remote-apply hooks disabled, restoring the prior flag. */
export async function withApplyingRemote<T>(run: () => Promise<T>): Promise<T> {
  setApplyingRemote(true);
  try {
    return await run();
  } finally {
    setApplyingRemote(false);
  }
}

/** Marks one Dexie transaction as remote; its hooks never enqueue. */
export function markRemoteTransaction(transaction: Transaction): void {
  remoteTransactions.add(transaction);
}

/**
 * True when the mutation belongs to a marked remote transaction. Sub-
 * transactions are checked through their parent chain so a nested settings
 * write can never escape the guard.
 */
function isRemoteTransaction(transaction: Transaction): boolean {
  if (applyingRemoteDepth > 0) {
    return true;
  }

  let current: Transaction | null | undefined = transaction;
  while (current) {
    if (remoteTransactions.has(current)) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
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

/**
 * Accounts whose `settings` changes may enter the queue. It stays off until
 * the first pull has brought the server's row: a fresh device seeds default
 * settings (and `seedVersion`) on open, and pushing those before reading would
 * overwrite a real account's profile/exam settings.
 */
const settingsSyncDatabases = new WeakSet<KoclukDB>();

/** Enables or disables settings enqueueing for one account database. */
export function setSettingsSyncEnabled(db: KoclukDB, enabled: boolean): void {
  if (enabled) {
    settingsSyncDatabases.add(db);
  } else {
    settingsSyncDatabases.delete(db);
  }
}

export function isSettingsSyncEnabled(db: KoclukDB): boolean {
  return settingsSyncDatabases.has(db);
}

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
 *
 * `settingsSyncEnabled` defaults to true for direct callers/tests; the account
 * opener passes the persisted `initialPullDone` state so a fresh device keeps
 * settings out of the queue until its first pull.
 */
export interface InstallSyncHooksOptions {
  settingsSyncEnabled?: boolean;
}

export function installSyncHooks(
  db: KoclukDB,
  userId: string,
  options: InstallSyncHooksOptions = {},
): void {
  if (installedHooks.has(db)) {
    return;
  }
  installedHooks.add(db);
  syncUserIds.set(db, userId);
  setSettingsSyncEnabled(db, options.settingsSyncEnabled ?? true);

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

/**
 * Drops a queued settings change before the initial pull. A fresh device
 * seeds `seedVersion` and default settings, and those must never win over the
 * account row that the first pull brings.
 */
export async function discardSettingsChange(db: KoclukDB): Promise<void> {
  const userId = syncUserId(db);
  if (userId !== null) {
    await db.syncQueue.delete(queueRowId('settings', userId));
  }
}

function installTableHooks(db: KoclukDB, tableName: SyncedTable): void {
  const table = db.table(tableName);
  const hasUpdatedAt = SYNC_TABLES_WITH_UPDATED_AT.has(tableName);

  table.hook('creating', function (primKey, obj, transaction) {
    if (isRemoteTransaction(transaction)) {
      return;
    }
    if (hasUpdatedAt) {
      touchUpdatedAt(obj as Record<string, unknown>);
    }
    scheduleQueueWrite(db, transaction, tableName, String(primKey), 'upsert');
  });

  table.hook('updating', function (modifications, primKey, _obj, transaction) {
    if (isRemoteTransaction(transaction)) {
      return;
    }
    if (hasUpdatedAt) {
      touchUpdatedAt(modifications as Record<string, unknown>);
    }
    scheduleQueueWrite(db, transaction, tableName, String(primKey), 'upsert');
  });

  table.hook('deleting', function (primKey, _obj, transaction) {
    if (isRemoteTransaction(transaction)) {
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
    if (isRemoteTransaction(transaction)) {
      return;
    }
    if (!isSettingsSyncEnabled(db)) {
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
  await db.transaction('rw', db.syncQueue, () =>
    enqueueChangeInTransaction(db, table, rowId, op),
  );
}

/**
 * Same as `enqueueChange` but reuses the caller's active transaction. `rekey`
 * writes its queue corrections in the same transaction as the local reference
 * repair, so a crash can never leave rekeyed rows without a pending push.
 */
export async function enqueueChangeInTransaction(
  db: KoclukDB,
  table: SyncedTable,
  rowId: string,
  op: QueueOp = 'upsert',
): Promise<void> {
  const id = queueRowId(table, rowId);
  const updatedAt = nextTimestamp();
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
  notifyQueueWrite(table, rowId);
}

function sortQueueRows(left: SyncQueueRow, right: SyncQueueRow): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/**
 * Settings always go first: the row is a single account-level upsert and an
 * onboarding/profile change must not wait behind a curriculum seed backlog.
 * Other rows keep the deterministic oldest-first order.
 */
function sortPendingRows(left: SyncQueueRow, right: SyncQueueRow): number {
  const leftPriority = left.table === 'settings' ? 0 : 1;
  const rightPriority = right.table === 'settings' ? 0 : 1;
  return leftPriority - rightPriority || sortQueueRows(left, right);
}

/** Pending queue rows, at most one push batch. Dead rows never block. */
export async function pendingChanges(
  db: KoclukDB,
  limit = MAX_PUSH_CHANGES,
): Promise<SyncQueueRow[]> {
  const rows = await db.syncQueue.where('status').equals('pending').toArray();
  rows.sort(sortPendingRows);
  return rows.slice(0, Math.max(0, limit));
}

/** Number of rows waiting to be pushed; dead rows are reported separately. */
export function pendingCount(db: KoclukDB): Promise<number> {
  return db.syncQueue.where('status').equals('pending').count();
}

/** Number of rows that will not be retried automatically (design §9.2). */
export function deadCount(db: KoclukDB): Promise<number> {
  return db.syncQueue.where('status').equals('dead').count();
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
 * "Yerel kaydı sil": drops one dead letter and its local data row so the
 * failed edit stops blocking the user. The server row is untouched; the next
 * pull brings the canonical value back. Settings are account-level and cannot
 * be deleted server-side, so only their queue entry is removed.
 */
export async function discardDeadLetter(
  db: KoclukDB,
  queueId: string,
): Promise<boolean> {
  return db.transaction('rw', db.tables, async (transaction) => {
    const row = await db.syncQueue.get(queueId);

    if (!row || row.status !== 'dead') {
      return false;
    }

    if (row.table !== 'settings' && SYNCED_TABLE_SET.has(row.table)) {
      markRemoteTransaction(transaction);
      await db.table(row.table).delete(row.rowId);
    }

    await db.syncQueue.delete(queueId);
    return true;
  });
}

/**
 * Writes a canonical server row locally without re-enqueueing it (used by push
 * conflicts, pull and full sync). `null` optional values become absent fields
 * so tombstones and optional columns match the local row shape.
 *
 * Suppression is scoped to this write's own transaction, so a user write from
 * another transaction is still queued even while a long pull is applying rows.
 *
 * `skipIfPending` is the read-side rule of design §8.3: a row with a pending
 * local change is never overwritten by a server value. The pending check and
 * the write run in one read-write transaction over the data store, so a user
 * write on that store cannot interleave between them.
 */
export interface ApplyServerRowOptions {
  skipIfPending?: boolean;
}

/** Returns false only when a pending local change protected the row. */
export async function applyServerRow(
  db: KoclukDB,
  table: SyncedTable,
  row: Record<string, unknown>,
  options: ApplyServerRowOptions = {},
): Promise<boolean> {
  if (!SYNCED_TABLE_SET.has(table)) {
    throw new Error(`Bilinmeyen senkron tablosu: ${table}`);
  }

  const store = table === 'settings' ? db.settings : db.table(table);
  const applied = await db.transaction('rw', [store, db.syncQueue], async (transaction) => {
    if (options.skipIfPending) {
      const identity = apiRowId(table, row);
      if (identity !== null) {
        // A dead letter is unresolved local data too: pull must not overwrite
        // the row the user still has to retry or discard (design §9.2).
        if (await isProtectedQueueRow(db, table, identity)) {
          return false;
        }
      }

      // A local row with the same natural key under another id (usually a
      // tombstone) occupies Dexie's unique index. If the user has an
      // unresolved change there, keep it; otherwise the server row wins and
      // putServerRow removes the stale local row.
      const natural = naturalKeyOf(table, row);
      if (natural !== null) {
        const conflicting = (await db.table(table)
          .where(natural.field)
          .equals(natural.value)
          .toArray()) as Array<Record<string, unknown>>;
        for (const local of conflicting) {
          const localId = apiRowId(table, local);
          if (localId === null || localId === apiRowId(table, row)) {
            continue;
          }
          if (await isProtectedQueueRow(db, table, localId)) {
            return false;
          }
        }
      }
    }

    markRemoteTransaction(transaction);
    await putServerRow(db, table, row);
    return true;
  });

  // Applied account settings must reach SettingsProvider without a reload.
  if (applied && table === 'settings') {
    notifySettingsUpdated();
  }

  return applied;
}

async function isProtectedQueueRow(
  db: KoclukDB,
  table: SyncedTable,
  rowId: string,
): Promise<boolean> {
  const queued = await db.syncQueue.get(queueRowId(table, rowId));
  return queued?.status === 'pending' || queued?.status === 'dead';
}

function naturalKeyOf(
  table: SyncedTable,
  row: Record<string, unknown>,
): { field: string; value: string } | null {
  const field = SYNC_NATURAL_KEYS[table];
  if (field === undefined) {
    return null;
  }
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  return { field, value };
}

/**
 * Applies a canonical row inside the caller's already-marked transaction.
 * `rekeyRow` uses it so the canonical row and the reference repairs commit
 * atomically. It must not open a transaction of its own: a Dexie sub-
 * transaction gets a different object and the hooks would enqueue again.
 */
export async function putServerRow(
  db: KoclukDB,
  table: SyncedTable,
  row: Record<string, unknown>,
): Promise<void> {
  if (table === 'settings') {
    await putSettingsRow(db, row);
    return;
  }

  const clean = stripNulls(row);
  if (table === 'notes' && typeof clean.topicId !== 'string') {
    throw new Error('Not satırında topicId yok');
  }

  if (table === 'catalogBooks' && typeof clean.id === 'string') {
    // The bundled catalog is app-owned, never a server row. Applying one would
    // let a client overwrite the shipped title on every device.
    if (isSharedCatalogBook(clean.id)) {
      return;
    }
    // A custom book is identified by the server row alone. `ownerId` is only a
    // device-side "this book is mine" marker: a fresh device that pulls the
    // row would otherwise store no marker and turn the book read-only.
    clean.ownerId = LOCAL_SCOPE;
  }

  if (table === 'examResults' && typeof clean.net === 'string') {
    const net = Number(clean.net);
    if (Number.isFinite(net)) {
      // Older servers serialized DECIMAL as a string; keep the local row a
      // number so totals/averages cannot become NaN or concatenated.
      clean.net = net;
    }
  }

  if (!(await dropNaturalKeyConflicts(db, table, clean))) {
    return;
  }
  await db.table(table).put(clean);
}

/**
 * Dexie unique indexes include tombstones, so the server's active row cannot
 * be written while a local tombstone (or a stale duplicate) holds the same
 * natural key. An active server row is canonical: remove the local duplicate.
 * A server tombstone is ignored when any local row already owns the key; the
 * key is either active under the local id or already tombstoned.
 */
async function dropNaturalKeyConflicts(
  db: KoclukDB,
  table: SyncedTable,
  row: Record<string, unknown>,
): Promise<boolean> {
  const natural = naturalKeyOf(table, row);
  if (natural === null) {
    return true;
  }

  const incomingId = apiRowId(table, row);
  const incomingActive = row.deletedAt === undefined || row.deletedAt === null;
  const conflicting = (await db.table(table)
    .where(natural.field)
    .equals(natural.value)
    .toArray()) as Array<Record<string, unknown>>;

  for (const local of conflicting) {
    const localId = apiRowId(table, local);
    if (localId === null || localId === incomingId) {
      continue;
    }

    if (await isProtectedQueueRow(db, table, localId)) {
      throw new Error('Bekleyen yerel kayıt doğal anahtarla çakışıyor');
    }

    if (!incomingActive) {
      // Keep the local row; writing this tombstone would hide the key.
      return false;
    }

    await db.table(table).delete(localId);
  }

  return true;
}

async function putSettingsRow(db: KoclukDB, row: Record<string, unknown>): Promise<void> {
  // `onboardingDone` is a one-way local invariant: a stale server row (usually
  // the first sync's default `false`) must never pull a completed account back
  // into onboarding. There is no reset-onboarding feature, so true is final.
  const onboardingDone = (await db.settings.get('onboardingDone'))?.value === true;

  for (const field of ACCOUNT_SETTINGS) {
    const value = row[field];
    if (field === 'onboardingDone' && onboardingDone && value !== true) {
      continue;
    }
    if (value === undefined || value === null) {
      await db.settings.delete(field);
    } else {
      await db.settings.put({ key: field, value });
    }
  }
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
