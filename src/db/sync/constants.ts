/**
 * The client half of the sync contract (design §8.1).
 *
 * `SYNCED_TABLES` mirrors `api/src/Sync/TableMap.php` exactly: the API key is
 * also the local Dexie store name. A table name is never composed ad hoc; every
 * queue, push, pull and rekey decision goes through this module.
 */

export const SYNCED_TABLES = [
  'subjects',
  'topics',
  'exams',
  'examResults',
  'notes',
  'catalogBooks',
  'userBooks',
  'activityLogs',
  'scheduleWeeks',
  'scheduleRows',
  'scheduleTasks',
  'schedulePageChains',
  'topicProgress',
  'settings',
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

export const SYNCED_TABLE_SET: ReadonlySet<string> = new Set(SYNCED_TABLES);

export const PUSH_PATH = '/api/sync/push';

export const PULL_PATH = '/api/sync/pull';

export const FULL_PATH = '/api/sync/full';

export const STATUS_PATH = '/api/sync/status';

/** Pull page size accepted by the API (design §8.3). */
export const PULL_LIMIT = 500;

/** One request carries at most 100 changes (design §8.2). */
export const MAX_PUSH_CHANGES = 100;

/** The API rejects a body larger than 1 MB with 413 payload_too_large. */
export const MAX_PUSH_BYTES = 1048576;

/** A transient error is retried this many times before the row is dead. */
export const MAX_PUSH_ATTEMPTS = 5;

/**
 * Account-level setting names accepted by the sync API. Device settings
 * (`accent`, `scheduleMode`) stay local and are never sent (design §8.2).
 */
export const ACCOUNT_SETTINGS = [
  'profileName',
  'examDate',
  'examName',
  'onboardingDone',
  'lastBackupAt',
  'schemaVersion',
  'seedVersion',
  'aytAlan',
  'hiddenSubjects',
  'geometryMode',
] as const;

/** API field that identifies a row; `notes` and `settings` have no `id`. */
export const SYNC_ROW_ID_FIELDS: Record<SyncedTable, string> = {
  subjects: 'id',
  topics: 'id',
  exams: 'id',
  examResults: 'id',
  notes: 'topicId',
  catalogBooks: 'id',
  userBooks: 'id',
  activityLogs: 'id',
  scheduleWeeks: 'id',
  scheduleRows: 'id',
  scheduleTasks: 'id',
  schedulePageChains: 'id',
  topicProgress: 'id',
  settings: 'userId',
};

/**
 * Public API fields per table, copied from `TableMap::columns()` (plus the
 * settings identity and LWW fields). Push sends only these fields so a local
 * future-only field can never reach the strict server whitelist.
 */
export const SYNC_TABLE_FIELDS: Record<SyncedTable, readonly string[]> = {
  subjects: ['id', 'seedKey', 'exam', 'name', 'slug', 'icon', 'order', 'updatedAt', 'deletedAt'],
  topics: [
    'id',
    'seedKey',
    'subjectId',
    'name',
    'order',
    'isCustom',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  exams: [
    'id',
    'type',
    'name',
    'date',
    'alan',
    'kind',
    'branch',
    'note',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  examResults: [
    'id',
    'examId',
    'subjectId',
    'correct',
    'wrong',
    'blank',
    'net',
    'updatedAt',
    'deletedAt',
  ],
  notes: ['topicId', 'contentHtml', 'plainText', 'updatedAt', 'deletedAt'],
  catalogBooks: [
    'id',
    'title',
    'publisher',
    'exam',
    'subjectSlug',
    'totalPages',
    'edition',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  userBooks: [
    'id',
    'bookId',
    'totalPagesOverride',
    'note',
    'status',
    'startedAt',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  activityLogs: [
    'id',
    'type',
    'userBookId',
    'topicId',
    'fromPage',
    'toPage',
    'taskId',
    'source',
    'createdAt',
    'deletedAt',
  ],
  scheduleWeeks: ['id', 'weekStart', 'note', 'createdAt', 'updatedAt', 'deletedAt'],
  scheduleRows: [
    'id',
    'weekId',
    'subjectId',
    'label',
    'order',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  scheduleTasks: [
    'id',
    'weekId',
    'rowId',
    'dayIndex',
    'type',
    'userBookId',
    'fromPage',
    'toPage',
    'topicId',
    'title',
    'completedAt',
    'missedAt',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  schedulePageChains: [
    'id',
    'weekId',
    'rowId',
    'userBookId',
    'startPage',
    'endPage',
    'chunkSize',
    'chunkCount',
    'slots',
    'skippedChunks',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  topicProgress: ['id', 'topicId', 'done', 'doneAt', 'updatedAt', 'deletedAt'],
  settings: [...ACCOUNT_SETTINGS, 'userId', 'updatedAt'],
};

/**
 * Tables whose local rows carry `updatedAt`. `activityLogs` has no such column
 * server-side and `settings` is a key/value store, so hooks must not invent
 * the field for either.
 */
export const SYNC_TABLES_WITH_UPDATED_AT: ReadonlySet<SyncedTable> = new Set(
  SYNCED_TABLES.filter((table) => table !== 'activityLogs' && table !== 'settings'),
);

/**
 * Fields that back a local unique Dexie index (v6). Unlike the server, Dexie's
 * unique indexes include tombstones, so at most one row per natural key can
 * exist locally. Pull must reconcile a server active row against a local
 * tombstone instead of letting the index abort the page.
 */
export const SYNC_NATURAL_KEYS: Partial<Record<SyncedTable, string>> = {
  subjects: 'seedKey',
  topics: 'seedKey',
  userBooks: 'bookId',
  scheduleWeeks: 'weekStart',
  topicProgress: 'topicId',
};

/** Queue identity: one coalesced queue row per table + row. */
export function queueRowId(table: string, rowId: string): string {
  return `${table}:${rowId}`;
}

/** Row identity of a canonical API row (settings => userId, notes => topicId). */
export function apiRowId(table: SyncedTable, row: Record<string, unknown>): string | null {
  const field = SYNC_ROW_ID_FIELDS[table];
  const value = row[field];
  return typeof value === 'string' && value !== '' ? value : null;
}

const USER_DB_PREFIX = 'kocluk-u-';

/** Account id encoded in a database name, or null for any other database. */
export function userIdFromDatabaseName(name: string): string | null {
  if (!name.startsWith(USER_DB_PREFIX)) {
    return null;
  }
  const userId = name.slice(USER_DB_PREFIX.length);
  return userId === '' ? null : userId;
}
