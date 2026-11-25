import { KoclukDB, getActiveDbOrNull, setActiveDb } from './db';
import { INITIAL_PULL_DONE_KEY } from './sync/meta';
import { installSyncHooks } from './sync/queue';

/** The pre-account local database, kept only for the one-time transfer. */
export const LEGACY_DB_NAME = 'kocluk';

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
    await database.close();
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
