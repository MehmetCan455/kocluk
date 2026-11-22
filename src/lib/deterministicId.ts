import { v5 as uuidv5 } from 'uuid';

/** Stable UUIDv5 for natural keys, so seeding and syncing are idempotent. */
export function deterministicId(namespace: string, key: string): string {
  return uuidv5(key, namespace);
}
