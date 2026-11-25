import type { KoclukDB } from '../db';

/**
 * Set after the first successful pull of a device. Until then settings stay
 * out of the push queue: the server's settings row owns profile/exam values
 * and must not be overwritten by a fresh device's seeded defaults.
 */
export const INITIAL_PULL_DONE_KEY = 'initialPullDone';

/**
 * Set when a pull/full actually applied a server settings row. When it stays
 * absent after the first pull, the account has no server settings yet and the
 * device's current account settings must be queued (minor review finding).
 */
export const SERVER_SETTINGS_SEEN_KEY = 'serverSettingsSeen';

/** Reads a sync metadata value; missing keys read as undefined. */
export async function getMeta(database: KoclukDB, key: string): Promise<unknown> {
  const row = await database.syncMeta.get(key);
  return row?.value;
}

/** Writes a sync metadata value, replacing any previous value for `key`. */
export async function setMeta(
  database: KoclukDB,
  key: string,
  value: unknown,
): Promise<void> {
  await database.syncMeta.put({ key, value });
}
