import type { KoclukDB } from '../db';

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
