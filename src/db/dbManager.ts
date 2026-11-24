import { KoclukDB, getActiveDbOrNull, setActiveDb } from './db';

/** The pre-account local database, kept only for the one-time transfer. */
export const LEGACY_DB_NAME = 'kocluk';

/** Local database name for an account. */
export function userDbName(userId: string): string {
  return `kocluk-u-${userId}`;
}

let currentUserId: string | null = null;

/** The account whose database is active, or null for the legacy/test database. */
export function activeUserId(): string | null {
  return currentUserId;
}

/**
 * Closes the active database, if any, and clears the proxy target. Safe to
 * call more than once; waiting callers never keep a closed database active.
 */
export async function closeActiveDb(): Promise<void> {
  const database = getActiveDbOrNull();
  setActiveDb(null);
  currentUserId = null;
  if (database?.isOpen()) {
    await database.close();
  }
}

/**
 * Opens `kocluk-u-<userId>` and makes it the active database. The previous
 * database is closed first, so Dexie live queries never span two accounts.
 */
export async function openUserDb(userId: string): Promise<KoclukDB> {
  await closeActiveDb();
  const database = new KoclukDB(userDbName(userId));
  await database.open();
  setActiveDb(database);
  currentUserId = userId;
  return database;
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
