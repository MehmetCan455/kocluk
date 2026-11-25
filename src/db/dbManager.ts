import Dexie from 'dexie';
import { KoclukDB, getActiveDbOrNull, setActiveDb } from './db';
import { INITIAL_PULL_DONE_KEY } from './sync/meta';
import { installSyncHooks } from './sync/queue';

/** The pre-account local database, kept only for the one-time transfer. */
export const LEGACY_DB_NAME = 'kocluk';

/** How long a local account-copy deletion may take before it is reported. */
export const LOCAL_COPY_DELETE_TIMEOUT_MS = 4000;

export type LocalCopyDeleteReason = 'refused' | 'timeout' | 'failed';

/** A local account-copy deletion that was refused, blocked or rejected. */
export class LocalCopyDeleteError extends Error {
  readonly reason: LocalCopyDeleteReason;

  constructor(reason: LocalCopyDeleteReason, message: string) {
    super(message);
    this.name = 'LocalCopyDeleteError';
    this.reason = reason;
  }
}

/** Only `kocluk-u-<userId>` names may ever be deleted; `kocluk` never can. */
export function canDeleteUserDbCopy(name: string | null): name is string {
  return name !== null && name.startsWith(USER_DB_PREFIX) && name !== LEGACY_DB_NAME;
}

/**
 * Deletes one local account database with a hard timeout.
 *
 * A blocked IndexedDB delete (another tab, an open connection) never resolves,
 * so a bare `Dexie.delete` would leave the caller stuck on "Siliniyor…". The
 * timeout converts that into a reportable failure; the caller keeps the copy.
 */
export async function deleteUserDatabaseCopy(
  name: string,
  timeoutMs = LOCAL_COPY_DELETE_TIMEOUT_MS,
): Promise<void> {
  if (!canDeleteUserDbCopy(name)) {
    throw new LocalCopyDeleteError('refused', 'Yerel kopya adı geçersiz.');
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      Dexie.delete(name),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new LocalCopyDeleteError('timeout', 'Yerel kopya silinemedi.')),
          Math.max(1, timeoutMs),
        );
      }),
    ]);
  } catch (error: unknown) {
    if (error instanceof LocalCopyDeleteError) {
      throw error;
    }
    throw new LocalCopyDeleteError('failed', 'Yerel kopya silinemedi.');
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

const USER_DB_PREFIX = 'kocluk-u-';

/** Local database name for an account. */
export function userDbName(userId: string): string {
  return `${USER_DB_PREFIX}${userId}`;
}

/**
 * Account id encoded in a database name, or null for anything that is not a
 * user database (the test database, the legacy database, a custom name).
 */
function userIdFromDbName(name: string): string | null {
  if (!name.startsWith(USER_DB_PREFIX)) {
    return null;
  }
  const userId = name.slice(USER_DB_PREFIX.length);
  return userId === '' ? null : userId;
}

/**
 * The account whose database is active, or null when no user database is
 * open. It is derived from the active database itself, so it can never
 * disagree with the proxy target after a close or a failed open.
 */
export function activeUserId(): string | null {
  const database = getActiveDbOrNull();
  return database ? userIdFromDbName(database.name) : null;
}

// Opening and closing must never interleave: a close issued while an open is
// still in flight has to run after it, otherwise the new connection would be
// left open with no proxy pointing at it.
let operationQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  // Run the task whether the previous one resolved or rejected; a failed
  // open must not block every later account from opening.
  const run = operationQueue.then(task, task);
  operationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function closeActiveDbNow(): Promise<void> {
  const database = getActiveDbOrNull();
  setActiveDb(null);
  if (database?.isOpen()) {
    // Disable auto-open so a late live query or effect cannot silently reopen
    // the database we are about to replace or delete.
    database.close({ disableAutoOpen: true });
  }
}

/**
 * Closes the active database, if any, and clears the proxy target. Safe to
 * call more than once; waiting callers never keep a closed database active.
 */
export function closeActiveDb(): Promise<void> {
  return enqueue(closeActiveDbNow);
}

/**
 * Opens `kocluk-u-<userId>` and makes it the active database. Calls are
 * serialized and the previous database is closed first, so Dexie live queries
 * never span two accounts.
 */
export function openUserDb(userId: string): Promise<KoclukDB> {
  return enqueue(async () => {
    await closeActiveDbNow();
    const database = new KoclukDB(userDbName(userId));
    await database.open();
    // A fresh device keeps `settings` out of the queue until its first pull:
    // seeded defaults must not overwrite the account's server row.
    const initialPullDone =
      (await database.syncMeta.get(INITIAL_PULL_DONE_KEY))?.value === true;
    // Hooks are installed only on an opened account database: the legacy
    // database and the test database never enqueue anything.
    installSyncHooks(database, userId, { settingsSyncEnabled: initialPullDone });
    setActiveDb(database);
    return database;
  });
}

/**
 * Opens the old `kocluk` database for the transfer screen. It is intentionally
 * not made active; the account database stays the proxy target.
 */
export async function openLegacyDb(): Promise<KoclukDB> {
  const database = new KoclukDB(LEGACY_DB_NAME);
  await database.open();
  return database;
}
