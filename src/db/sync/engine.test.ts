import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ScheduleTask, Subject, UserBook } from '@/domain/types';
import { ApiError } from '@/lib/api';
import { KoclukDB } from '../db';
import {
  FULL_PATH,
  PULL_PATH,
  STATUS_PATH,
  SYNCED_TABLES,
  type SyncedTable,
} from './constants';
import {
  deriveSyncStatus,
  startSyncTriggers,
  syncNow,
  type SyncApiClient,
} from './engine';
import { getMeta, setMeta, INITIAL_PULL_DONE_KEY } from './meta';
import {
  enqueueChange,
  installSyncHooks,
  markDead,
  setApplyingRemote,
  whenQueueIdle,
} from './queue';
import type { PushRequestBody } from './push';

let identifier = 0;
const opened: KoclukDB[] = [];
let stopTriggers: (() => void) | null = null;

function now(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

interface CreateDatabaseOptions {
  /** Default true: an already established device uses push → pull. */
  initialPullDone?: boolean;
}

async function createDatabase(
  label: string,
  options: CreateDatabaseOptions = {},
): Promise<KoclukDB> {
  const initialPullDone = options.initialPullDone ?? true;
  identifier += 1;
  const name = `kocluk-sync-engine-${label}-${identifier}`;
  await Dexie.delete(name);
  const database = new KoclukDB(name);
  await database.open();
  installSyncHooks(database, 'user-1', { settingsSyncEnabled: initialPullDone });
  if (initialPullDone) {
    await setMeta(database, INITIAL_PULL_DONE_KEY, true);
  }
  opened.push(database);
  return database;
}

function subject(id: string, overrides: Partial<Subject> = {}): Subject {
  return {
    id,
    seedKey: `seed-${id}`,
    exam: 'TYT',
    name: 'Matematik',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
    updatedAt: now(),
    ...overrides,
  };
}

function userBook(id: string): UserBook {
  return {
    id,
    bookId: `book-${id}`,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };
}

function rowIdOf(change: PushRequestBody['changes'][number]): string {
  if (change.rowId) {
    return change.rowId;
  }
  const row = change.row ?? {};
  return String(row.id ?? row.topicId ?? row.userId ?? '');
}

interface ServerResult {
  table: string;
  rowId: string;
  status: 'applied' | 'conflict' | 'error';
  row?: Record<string, unknown> | null;
  error?: { code: string; message: string };
}

/**
 * In-memory stand-in for the sync API. It keeps one row map per table, a
 * change log in write order and answers pull/full/status exactly like the PHP
 * endpoints. Two databases sharing one instance simulate two devices.
 */
class FakeSyncServer implements SyncApiClient {
  readonly calls: string[] = [];

  /** Raw push envelopes, in request order (asserted for first-open rules). */
  readonly pushBodies: PushRequestBody[] = [];

  readonly tables = new Map<SyncedTable, Map<string, Record<string, unknown>>>();

  readonly log: Array<{ id: number; table: SyncedTable; rowId: string }> = [];

  serverTime = now();

  cursorExpired = false;

  networkDown = false;

  rateLimited = false;

  private nextId = 1;

  constructor() {
    for (const table of SYNCED_TABLES) {
      this.tables.set(table, new Map());
    }
  }

  get cursor(): number {
    return this.nextId - 1;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push(`POST ${path}`);
    if (this.networkDown) {
      throw new ApiError(0, 'network_error', 'Sunucuya ulaşılamadı.');
    }
    if (this.rateLimited) {
      throw new ApiError(429, 'rate_limited', 'Çok fazla istek.', null, 120);
    }

    const request = body as PushRequestBody;
    this.pushBodies.push(request);
    const results = request.changes.map((change) => this.apply(change));
    return { results, serverTime: this.serverTime } as T;
  }

  async get<T>(path: string): Promise<T> {
    this.calls.push(`GET ${path}`);
    if (this.networkDown) {
      throw new ApiError(0, 'network_error', 'Sunucuya ulaşılamadı.');
    }
    if (this.rateLimited) {
      throw new ApiError(429, 'rate_limited', 'Çok fazla istek.', null, 120);
    }

    if (path.startsWith(PULL_PATH)) {
      if (this.cursorExpired) {
        throw new ApiError(410, 'cursor_expired', 'Senkron imleci çok eski.');
      }
      const url = new URL(path, 'https://local.invalid');
      const since = Number(url.searchParams.get('since') ?? '0');
      const entries = this.log.filter((entry) => entry.id > since);
      const collapsed = new Map<string, { table: SyncedTable; row: Record<string, unknown> }>();
      for (const entry of entries) {
        const row = this.tables.get(entry.table)?.get(entry.rowId);
        if (!row) {
          continue;
        }
        const key = `${entry.table}:${entry.rowId}`;
        collapsed.delete(key);
        collapsed.set(key, { table: entry.table, row });
      }
      const last = entries[entries.length - 1];
      return {
        changes: Array.from(collapsed.values()),
        nextCursor: last ? last.id : since,
        hasMore: false,
      } as T;
    }

    if (path === FULL_PATH) {
      const tables: Record<string, Record<string, unknown>[]> = {};
      for (const table of SYNCED_TABLES) {
        tables[table] = Array.from(this.tables.get(table)?.values() ?? []);
      }
      return { tables, cursor: this.cursor, serverTime: this.serverTime } as T;
    }

    if (path === STATUS_PATH) {
      return {
        hasData: this.hasData(),
        counts: this.counts(),
        cursor: this.cursor,
        serverTime: this.serverTime,
      } as T;
    }

    throw new Error(`Beklenmeyen API çağrısı: ${path}`);
  }

  /** Adds a row directly, as if another device had pushed it. */
  seed(table: SyncedTable, row: Record<string, unknown>): void {
    const id = String(row.id ?? row.topicId ?? row.userId);
    this.tables.get(table)?.set(id, row);
    this.log.push({ id: this.nextId, table, rowId: id });
    this.nextId += 1;
  }

  private apply(change: PushRequestBody['changes'][number]): ServerResult {
    const table = change.table as SyncedTable;
    const rowId = rowIdOf(change);
    const rows = this.tables.get(table);

    if (!rows) {
      return {
        table: change.table,
        rowId,
        status: 'error',
        error: { code: 'unknown_table', message: 'Bilinmeyen tablo' },
      };
    }

    if (change.op === 'delete') {
      const existing = rows.get(rowId) ?? { id: rowId };
      const row = {
        ...existing,
        deletedAt: change.updatedAt ?? this.serverTime,
      };
      rows.set(rowId, row);
      this.append(table, rowId);
      return { table, rowId, status: 'applied', row };
    }

    const row = { ...(change.row ?? {}) };
    if (!('deletedAt' in row)) {
      row.deletedAt = null;
    }
    rows.set(rowId, row);
    this.append(table, rowId);
    return { table, rowId, status: 'applied', row };
  }

  private append(table: SyncedTable, rowId: string): void {
    this.log.push({ id: this.nextId, table, rowId });
    this.nextId += 1;
  }

  private hasData(): boolean {
    for (const [table, rows] of this.tables) {
      if (table === 'settings') {
        continue;
      }
      for (const row of rows.values()) {
        if (row.deletedAt === undefined || row.deletedAt === null) {
          return true;
        }
      }
    }
    return false;
  }

  private counts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [table, rows] of this.tables) {
      counts[table] = rows.size;
    }
    return counts;
  }
}

beforeEach(() => {
  identifier = 0;
  stopTriggers = null;
});

afterEach(async () => {
  stopTriggers?.();
  stopTriggers = null;
  setApplyingRemote(false);
  await whenQueueIdle();
  for (const database of opened.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  vi.useRealTimers();
});

test('push → pull → status sırasıyla çalışır ve durumu kaydeder', async () => {
  const database = await createDatabase('order');
  const server = new FakeSyncServer();
  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const result = await syncNow(database, server, 'csrf-token');

  expect(server.calls.map((call) => call.split('?')[0])).toEqual([
    `POST /api/sync/push`,
    `GET ${PULL_PATH}`,
    `GET ${STATUS_PATH}`,
  ]);
  expect(result.status).toBe('synced');
  expect(result.pushed).toEqual({ applied: 1, conflicts: 0, errors: 0 });
  expect(result.pending).toBe(0);
  expect(result.dead).toBe(0);
  expect(result.lastSyncAt).toEqual(expect.any(String));
  expect(result.serverTime).toBe(server.serverTime);
  expect(result.clockSkewMs).toEqual(expect.any(Number));
  expect(await database.syncQueue.count()).toBe(0);
  expect(await getMeta(database, 'lastSyncAt')).toBe(result.lastSyncAt);
  expect(await getMeta(database, 'serverTime')).toBe(server.serverTime);
});

test('ilk senkron sunucu ayarlarını yerel varsayılanlarla ezmez', async () => {
  const database = await createDatabase('first-open', { initialPullDone: false });
  await database.settings.bulkPut([
    { key: 'profileName', value: 'Yerel Varsayılan' },
    { key: 'examName', value: 'Yerel Sınav' },
    { key: 'hiddenSubjects', value: ['s-local'] },
    { key: 'seedVersion', value: 1 },
  ]);
  await database.subjects.add(subject('s-local'));
  await whenQueueIdle();

  // The settings hook is gated until the first pull, so seeding alone queues
  // nothing. Simulate the row an affected (pre-fix) device already had.
  expect(await database.syncQueue.get('settings:user-1')).toBeUndefined();
  await enqueueChange(database, 'settings', 'user-1');
  await whenQueueIdle();
  expect(await database.syncQueue.get('settings:user-1')).toMatchObject({
    status: 'pending',
  });

  const server = new FakeSyncServer();
  server.seed('settings', {
    userId: 'user-1',
    profileName: 'Sunucu Profili',
    examName: 'Sunucu Sınavı',
    examDate: '2027-06-20',
    hiddenSubjects: ['s-server'],
    onboardingDone: true,
    updatedAt: now(60_000),
  });

  const result = await syncNow(database, server, 'csrf');

  // First sync is pull → push → status.
  expect(server.calls[0]).toMatch(`GET ${PULL_PATH}`);
  expect(server.calls[1]).toBe('POST /api/sync/push');
  expect(server.calls[2]).toBe(`GET ${STATUS_PATH}`);

  const pushedTables = server.pushBodies.flatMap((body) =>
    body.changes.map((change) => change.table),
  );
  expect(pushedTables).not.toContain('settings');
  expect(pushedTables).toContain('subjects');

  expect((await database.settings.get('profileName'))?.value).toBe('Sunucu Profili');
  expect((await database.settings.get('examName'))?.value).toBe('Sunucu Sınavı');
  expect((await database.settings.get('hiddenSubjects'))?.value).toEqual(['s-server']);
  expect(await database.syncQueue.get('settings:user-1')).toBeUndefined();
  expect(await getMeta(database, INITIAL_PULL_DONE_KEY)).toBe(true);
  expect(result.status).toBe('synced');
});

test('ilk pull öncesi settings kuyruğa girmez, sunucuda yoksa pull sonrası gönderilir', async () => {
  const database = await createDatabase('fresh-settings', { initialPullDone: false });
  await database.settings.put({ key: 'accent', value: '#ff0000' });
  await database.settings.put({ key: 'scheduleMode', value: 'manual' });
  await database.settings.put({ key: 'profileName', value: 'Yerel Profil' });
  await whenQueueIdle();

  // Device-only keys and account defaults alike stay out of the queue until
  // the server row has been read.
  expect(await database.syncQueue.get('settings:user-1')).toBeUndefined();
  expect(await database.syncQueue.count()).toBe(0);

  const server = new FakeSyncServer();
  const result = await syncNow(database, server, 'csrf');

  expect(result.status).toBe('synced');
  expect(server.calls.map((call) => call.split('?')[0])).toEqual([
    `GET ${PULL_PATH}`,
    `POST /api/sync/push`,
    `GET ${STATUS_PATH}`,
  ]);
  // The server had no settings row, so the device's account settings are
  // published instead of being lost until the next edit.
  expect(server.pushBodies).toHaveLength(1);
  expect(server.pushBodies[0].changes).toEqual([
    expect.objectContaining({
      table: 'settings',
      op: 'upsert',
      row: expect.objectContaining({ userId: 'user-1', profileName: 'Yerel Profil' }),
    }),
  ]);
  expect((await database.settings.get('accent'))?.value).toBe('#ff0000');
  expect(await getMeta(database, INITIAL_PULL_DONE_KEY)).toBe(true);

  // The initial pull completed, so later settings changes sync again.
  await database.settings.put({ key: 'profileName', value: 'Yeni Profil' });
  await whenQueueIdle();
  expect(await database.syncQueue.get('settings:user-1')).toMatchObject({
    status: 'pending',
  });
});

test('iki cihaz aynı sunucu üzerinden senkronlanır', async () => {
  const deviceA = await createDatabase('two-a');
  const deviceB = await createDatabase('two-b');
  const server = new FakeSyncServer();

  await deviceA.subjects.add(subject('s1', { name: 'A cihazı' }));
  await whenQueueIdle();
  const firstSync = await syncNow(deviceA, server, 'csrf');
  expect(firstSync.status).toBe('synced');

  const secondSync = await syncNow(deviceB, server, 'csrf');
  expect(secondSync.status).toBe('synced');
  expect((await deviceB.subjects.get('s1'))?.name).toBe('A cihazı');

  const newTimestamp = now(60_000);
  await deviceB.subjects.update('s1', { name: 'B cihazı', updatedAt: newTimestamp });
  await whenQueueIdle();
  await syncNow(deviceB, server, 'csrf');

  await syncNow(deviceA, server, 'csrf');
  expect((await deviceA.subjects.get('s1'))?.name).toBe('B cihazı');
  expect((await deviceA.subjects.get('s1'))?.updatedAt).toBe(newTimestamp);
});

test('iki cihaz görev/aktivite çelişkisini uzlaştırır', async () => {
  const deviceA = await createDatabase('task-a');
  const deviceB = await createDatabase('task-b');
  const server = new FakeSyncServer();

  await deviceA.scheduleTasks.add({
    id: 'task-1',
    weekId: 'week-1',
    rowId: 'row-1',
    dayIndex: 1,
    type: 'topic',
    topicId: 'topic-1',
    completedAt: now(),
    createdAt: now(),
    updatedAt: now(),
  });
  await whenQueueIdle();

  // A completes the task; the first run pushes it, the post-pull reconcile
  // creates the missing activity and the next run pushes that too.
  await syncNow(deviceA, server, 'csrf', { forceStatus: true });
  await syncNow(deviceA, server, 'csrf', { forceStatus: true });
  expect(await deviceA.activityLogs.count()).toBe(1);

  await syncNow(deviceB, server, 'csrf', { forceStatus: true });
  expect(await deviceB.activityLogs.count()).toBe(1);
  expect((await deviceB.scheduleTasks.get('task-1'))?.completedAt).toBeDefined();

  // B unticks it; the pull that follows must tombstone the active activity.
  const task = await deviceB.scheduleTasks.get('task-1');
  expect(task).toBeDefined();
  const pending: ScheduleTask = { ...(task as ScheduleTask) };
  delete pending.completedAt;
  pending.updatedAt = now(60_000);
  await deviceB.scheduleTasks.put(pending);
  await whenQueueIdle();
  await syncNow(deviceB, server, 'csrf', { forceStatus: true });
  await syncNow(deviceB, server, 'csrf', { forceStatus: true });

  await syncNow(deviceA, server, 'csrf', { forceStatus: true });

  expect((await deviceA.scheduleTasks.get('task-1'))?.completedAt).toBeUndefined();
  expect(
    (await deviceA.activityLogs.where('taskId').equals('task-1').toArray()).filter(
      (log) => !log.deletedAt,
    ),
  ).toHaveLength(0);
});

test('410 cursor_expired tam çekmeye düşer ve imleci yeniler', async () => {
  const database = await createDatabase('expired');
  const server = new FakeSyncServer();
  server.seed('subjects', {
    id: 's-server',
    seedKey: 'seed-s-server',
    exam: 'TYT',
    name: 'Tam çekme',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
    updatedAt: now(),
    deletedAt: null,
  });
  server.cursorExpired = true;
  await setMeta(database, 'lastChangeId', 7);

  const result = await syncNow(database, server, 'csrf');

  expect(server.calls).toEqual([
    `GET ${PULL_PATH}?since=7&limit=500`,
    `GET ${FULL_PATH}`,
    `GET ${STATUS_PATH}`,
  ]);
  expect(result.status).toBe('synced');
  expect(await database.subjects.get('s-server')).toMatchObject({ name: 'Tam çekme' });
  expect(await getMeta(database, 'lastChangeId')).toBe(server.cursor);
});

test('çevrimdışıyken istek atılmaz ve kuyruk korunur', async () => {
  const database = await createDatabase('offline');
  const server = new FakeSyncServer();
  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });

  const result = await syncNow(database, server, 'csrf');

  expect(result.status).toBe('offline');
  expect(result.pending).toBe(1);
  expect(server.calls).toEqual([]);
  expect(await database.syncQueue.get('userBooks:ub-1')).toMatchObject({
    status: 'pending',
  });
});

test('ağ hatası kuyruğu silmez, durumu offline yapar', async () => {
  const database = await createDatabase('network');
  const server = new FakeSyncServer();
  server.networkDown = true;
  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const result = await syncNow(database, server, 'csrf');

  expect(result.status).toBe('offline');
  expect(result.error).toContain('network_error');
  expect(result.pending).toBe(1);
  expect(result.nextRetryMs).toBe(30_000);
  expect(await database.syncQueue.get('userBooks:ub-1')).toMatchObject({
    status: 'pending',
  });
});

test('CSRF yokken push atlanır, bekleyen kayıt durumu pending olur', async () => {
  const database = await createDatabase('no-csrf');
  const server = new FakeSyncServer();
  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const result = await syncNow(database, server, null);

  expect(result.status).toBe('pending');
  expect(result.pending).toBe(1);
  expect(server.calls.some((call) => call.startsWith('POST'))).toBe(false);
  expect(server.calls.some((call) => call.startsWith(`GET ${PULL_PATH}`))).toBe(true);
});

test('ölü kayıt varsa durum error olur ve sayı raporlanır', async () => {
  const database = await createDatabase('dead');
  const server = new FakeSyncServer();
  await database.subjects.add(subject('s1'));
  await whenQueueIdle();
  await markDead(database, 'subjects:s1', 'validation_failed');

  const result = await syncNow(database, server, 'csrf');

  expect(result.status).toBe('error');
  expect(result.dead).toBe(1);
  expect(result.pending).toBe(0);
});

test('status yalnızca beş dakikalık aralıkta veya zorlanınca çağrılır', async () => {
  const database = await createDatabase('status-cadence');
  const server = new FakeSyncServer();

  await syncNow(database, server, 'csrf', { forceStatus: true });
  expect(server.calls.filter((call) => call === `GET ${STATUS_PATH}`)).toHaveLength(1);

  // A burst of debounced note writes must not spend the 60/hour status budget.
  for (let index = 0; index < 5; index += 1) {
    await database.subjects.add(subject(`s-burst-${index}`));
    await whenQueueIdle();
    await syncNow(database, server, 'csrf');
  }
  expect(server.calls.filter((call) => call === `GET ${STATUS_PATH}`)).toHaveLength(1);

  await syncNow(database, server, 'csrf', { forceStatus: true });
  expect(server.calls.filter((call) => call === `GET ${STATUS_PATH}`)).toHaveLength(2);
});

test('429 yanıtı Retry-After ile geri çekilme planlar', async () => {
  const database = await createDatabase('backoff-429');
  const server = new FakeSyncServer();
  server.rateLimited = true;

  const failed = await syncNow(database, server, 'csrf', { forceStatus: true });

  expect(failed.status).toBe('error');
  expect(failed.nextRetryMs).toBe(120_000);

  server.rateLimited = false;
  const recovered = await syncNow(database, server, 'csrf', { forceStatus: true });

  expect(recovered.status).toBe('synced');
  expect(recovered.nextRetryMs).toBeNull();
});

test('sunucu saati farkı hesaplanır ve saklanır', async () => {
  const database = await createDatabase('skew');
  const server = new FakeSyncServer();
  server.serverTime = now(10 * 60_000);

  const result = await syncNow(database, server, 'csrf');

  expect(result.serverTime).toBe(server.serverTime);
  expect(result.clockSkewMs).not.toBeNull();
  expect(Math.abs((result.clockSkewMs ?? 0) - 10 * 60_000)).toBeLessThan(5_000);
  expect(await getMeta(database, 'serverTime')).toBe(server.serverTime);
  expect(await getMeta(database, 'clockSkewMs')).toBe(result.clockSkewMs);
});

test('deriveSyncStatus öncelikleri', () => {
  expect(deriveSyncStatus(0, 0, true)).toBe('synced');
  expect(deriveSyncStatus(2, 0, true)).toBe('pending');
  expect(deriveSyncStatus(2, 1, true)).toBe('pending');
  expect(deriveSyncStatus(0, 1, true)).toBe('error');
  expect(deriveSyncStatus(0, 0, false)).toBe('offline');
});

describe('senkron tetikleyicileri', () => {
  test('online ve görünürlük olayları çalıştırır, temizlik dinlemeyi bırakır', () => {
    const run = vi.fn();
    const stop = startSyncTriggers({ run });
    stopTriggers = stop;

    window.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(run).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(run).toHaveBeenCalledTimes(2);

    stop();
    stopTriggers = null;
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(run).toHaveBeenCalledTimes(2);

    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  test('5 dakikalık aralık çalışır ve temizlikte durur', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const stop = startSyncTriggers({ run });

    vi.advanceTimersByTime(300_000);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300_000);
    expect(run).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(600_000);
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  test('yazmadan sonra debounce ile tek senkron çalışır', async () => {
    const database = await createDatabase('debounce');
    let runAt = 0;
    const run = vi.fn(() => {
      runAt = Date.now();
    });
    const stop = startSyncTriggers({ run, debounceMs: 120, intervalMs: 3_600_000 });
    stopTriggers = stop;

    const startedAt = Date.now();
    await database.subjects.add(subject('s1'));
    await database.subjects.add(subject('s2'));
    await whenQueueIdle();
    expect(run).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(run).toHaveBeenCalledTimes(1);
    expect(runAt - startedAt).toBeGreaterThanOrEqual(100);

    stop();
    stopTriggers = null;
    await database.subjects.add(subject('s3'));
    await whenQueueIdle();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
