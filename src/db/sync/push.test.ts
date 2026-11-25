import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ActivityLog, CatalogBook, Subject, Topic, UserBook } from '@/domain/types';
import { CATALOG_SEED, catalogBookId } from '@/data/catalogBooks';
import { ApiError } from '@/lib/api';
import { LOCAL_SCOPE } from '@/lib/namespaces';
import { KoclukDB } from '../db';
import { MAX_PUSH_BYTES } from './constants';
import {
  deadLetters,
  installSyncHooks,
  pendingChanges,
  pendingCount,
  retryDead,
  setApplyingRemote,
  whenQueueIdle,
} from './queue';
import { rekeyRow } from './rekey';
import { pushOnce, type PushApiClient, type PushRequestBody } from './push';

const DB_NAME = 'kocluk-sync-push-test';

interface ServerResult {
  table: string;
  rowId: string;
  status: 'applied' | 'conflict' | 'error';
  row?: Record<string, unknown> | null;
  error?: { code: string; message: string };
}

interface RecordedCall {
  path: string;
  body: PushRequestBody;
  csrfToken?: string;
}

let database: KoclukDB;

beforeEach(async () => {
  await Dexie.delete(DB_NAME);
  database = new KoclukDB(DB_NAME);
  await database.open();
  installSyncHooks(database, 'user-1');
});

afterEach(async () => {
  setApplyingRemote(false);
  await whenQueueIdle();
  database.close();
  await Dexie.delete(DB_NAME);
});

function now(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
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

function topic(id: string, subjectId: string): Topic {
  return {
    id,
    subjectId,
    name: 'Limit',
    order: 1,
    isCustom: false,
    createdAt: now(),
    updatedAt: now(),
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

function activityLog(id: string, topicId: string): ActivityLog {
  return {
    id,
    type: 'topic_review',
    topicId,
    source: 'manual',
    createdAt: now(),
  };
}

/**
 * Records every request and answers with the callback's results. The response
 * is aligned with the sent changes, exactly like the PHP endpoint.
 */
function recordingClient(
  respond: (body: PushRequestBody, call: number) => ServerResult[],
): { client: PushApiClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: PushApiClient = {
    async post<T>(path: string, body?: unknown, csrfToken?: string): Promise<T> {
      const request = body as PushRequestBody;
      calls.push({ path, body: request, csrfToken });
      const results = respond(request, calls.length - 1);
      return { results, serverTime: now() } as T;
    },
  };
  return { client, calls };
}

function appliedResults(body: PushRequestBody): ServerResult[] {
  return body.changes.map((change) => ({
    table: change.table,
    rowId: change.rowId ?? String(change.row?.id ?? ''),
    status: 'applied',
    row: change.row ?? null,
  }));
}

function rowIdOf(change: PushRequestBody['changes'][number]): string {
  if (change.rowId) {
    return change.rowId;
  }
  const row = change.row ?? {};
  return String(row.id ?? row.topicId ?? row.userId ?? '');
}

test('3 değişiklik gönderilir, applied kuyruğu temizler', async () => {
  await database.subjects.add(subject('s1'));
  await database.subjects.add(subject('s2'));
  await database.subjects.add(subject('s3'));
  await whenQueueIdle();
  expect(await pendingCount(database)).toBe(3);

  const { client, calls } = recordingClient((body) => appliedResults(body));
  const summary = await pushOnce(database, client, 'csrf-token');

  expect(summary).toEqual({ applied: 3, conflicts: 0, errors: 0 });
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/api/sync/push');
  expect(calls[0].csrfToken).toBe('csrf-token');
  expect(calls[0].body.changes).toHaveLength(3);
  for (const change of calls[0].body.changes) {
    expect(change.op).toBe('upsert');
    expect(change.row).toMatchObject({ updatedAt: expect.any(String) });
  }
  expect(await pendingCount(database)).toBe(0);
  expect(await database.syncQueue.count()).toBe(0);
});

test('en fazla 100 değişiklik gönderilir', async () => {
  for (let index = 0; index < 105; index += 1) {
    await database.userBooks.add(userBook(`ub-${index}`));
  }
  await whenQueueIdle();
  expect(await pendingCount(database)).toBe(105);

  const { client, calls } = recordingClient((body) => appliedResults(body));
  await pushOnce(database, client, 'csrf');

  expect(calls[0].body.changes).toHaveLength(100);
  expect(await pendingCount(database)).toBe(5);
});

test('applied sunucu satırını uygular ve updatedAt eşitlenir', async () => {
  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const serverUpdatedAt = now(60_000);
  const { client } = recordingClient((body) =>
    body.changes.map((change) => ({
      table: change.table,
      rowId: rowIdOf(change),
      status: 'applied',
      row: { ...change.row, updatedAt: serverUpdatedAt },
    })),
  );

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary.applied).toBe(1);
  expect((await database.userBooks.get('ub-1'))?.updatedAt).toBe(serverUpdatedAt);
  expect(await pendingCount(database)).toBe(0);
});

test('conflict sunucu satırını uygular ve kuyruğu siler', async () => {
  await database.subjects.add(subject('s1'));
  await whenQueueIdle();

  const serverRow = {
    ...subject('s1'),
    name: 'Sunucu Matematik',
    updatedAt: now(60_000),
  };
  const { client } = recordingClient((body) =>
    body.changes.map((change) => ({
      table: change.table,
      rowId: rowIdOf(change),
      status: 'conflict',
      row: serverRow,
    })),
  );

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary).toEqual({ applied: 0, conflicts: 1, errors: 0 });
  expect(await database.subjects.get('s1')).toMatchObject({ name: 'Sunucu Matematik' });
  expect(await pendingCount(database)).toBe(0);
});

test('satır düzeyi error kaydı dead işaretler', async () => {
  await database.subjects.add(subject('s1'));
  await whenQueueIdle();

  const { client } = recordingClient((body) =>
    body.changes.map((change) => ({
      table: change.table,
      rowId: rowIdOf(change),
      status: 'error',
      error: { code: 'validation_failed', message: 'Geçersiz alan' },
    })),
  );

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary.errors).toBe(1);
  expect(await pendingCount(database)).toBe(0);
  expect(await deadLetters(database)).toMatchObject([
    { id: 'subjects:s1', status: 'dead' },
  ]);
});

test('422 kalıcı hatası dead yapar, kuyruğu tıkamaz, retryDead yeniden dener', async () => {
  const failing: PushApiClient = {
    async post<T>(): Promise<T> {
      throw new ApiError(422, 'validation_failed', 'Değişiklikler doğrulanamadı.');
    },
  };

  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const first = await pushOnce(database, failing, 'csrf');
  expect(first.errors).toBe(1);
  expect(await pendingCount(database)).toBe(0);
  expect(await deadLetters(database)).toHaveLength(1);

  await database.userBooks.add(userBook('ub-2'));
  await whenQueueIdle();
  expect(await pendingCount(database)).toBe(1);

  const { client, calls } = recordingClient((body) => appliedResults(body));
  const second = await pushOnce(database, client, 'csrf');
  expect(second).toEqual({ applied: 1, conflicts: 0, errors: 0 });
  expect(calls[0].body.changes).toHaveLength(1);
  expect(calls[0].body.changes[0].row).toMatchObject({ id: 'ub-2' });
  expect(await deadLetters(database)).toHaveLength(1);

  expect(await retryDead(database)).toBe(1);
  const third = await pushOnce(database, client, 'csrf');
  expect(third.applied).toBe(1);
  expect(await database.syncQueue.count()).toBe(0);
});

test('ağ hatası attempts artırır, 5. denemede dead olur', async () => {
  const offline: PushApiClient = {
    async post<T>(): Promise<T> {
      throw new ApiError(0, 'network_error', 'Sunucuya ulaşılamadı.');
    },
  };

  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();
  const queueId = 'userBooks:ub-1';

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const summary = await pushOnce(database, offline, 'csrf');
    expect(summary.errors).toBe(1);
    const queued = await database.syncQueue.get(queueId);
    expect(queued).toMatchObject({ status: 'pending', attempts: attempt });
    expect(queued?.lastError).toContain('network_error');
  }

  await pushOnce(database, offline, 'csrf');
  expect(await database.syncQueue.get(queueId)).toMatchObject({
    status: 'dead',
    attempts: 5,
  });
  expect(await pendingCount(database)).toBe(0);
});

test('rekey başarısız olursa satır dead olur, kalanlar işlenir', async () => {
  await database.subjects.add(subject('s1'));
  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const { client } = recordingClient((body) =>
    body.changes.map((change) => {
      if (change.table === 'subjects') {
        return {
          table: 'subjects',
          rowId: rowIdOf(change),
          status: 'conflict' as const,
          row: {},
        };
      }
      return {
        table: change.table,
        rowId: rowIdOf(change),
        status: 'applied' as const,
        row: change.row ?? null,
      };
    }),
  );

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary).toEqual({ applied: 1, conflicts: 0, errors: 1 });
  expect(await deadLetters(database)).toMatchObject([
    { id: 'subjects:s1', status: 'dead' },
  ]);
  expect(await pendingCount(database)).toBe(0);
});

test('401 kalıcı olmayan hatadır: satır pending kalır, deneme harcanmaz', async () => {
  const unauthorized: PushApiClient = {
    async post<T>(): Promise<T> {
      throw new ApiError(401, 'unauthenticated', 'Oturum süresi doldu.');
    },
  };

  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const summary = await pushOnce(database, unauthorized, 'csrf');

  expect(summary.errors).toBe(1);
  expect(await database.syncQueue.get('userBooks:ub-1')).toMatchObject({
    status: 'pending',
    attempts: 0,
  });
});

test('subjects conflict rekey: yerel kimlik ve topic.subjectId güncellenir', async () => {
  await database.subjects.add(subject('s-local', { seedKey: 'tyt-mat' }));
  await database.topics.add(topic('t1', 's-local'));
  await whenQueueIdle();
  expect(await pendingCount(database)).toBe(2);

  const canonical = {
    ...subject('s-server', { seedKey: 'tyt-mat' }),
    name: 'Matematik (sunucu)',
    updatedAt: now(60_000),
  };
  const { client } = recordingClient((body) =>
    body.changes.map((change) => {
      if (change.table === 'subjects') {
        return {
          table: 'subjects',
          rowId: rowIdOf(change),
          status: 'conflict' as const,
          row: canonical,
        };
      }
      return {
        table: change.table,
        rowId: rowIdOf(change),
        status: 'applied' as const,
        row: change.row ?? null,
      };
    }),
  );

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary).toEqual({ applied: 1, conflicts: 1, errors: 0 });
  expect(await database.subjects.get('s-local')).toBeUndefined();
  expect(await database.subjects.get('s-server')).toMatchObject({
    name: 'Matematik (sunucu)',
  });
  expect((await database.topics.get('t1'))?.subjectId).toBe('s-server');

  const queued = await pendingChanges(database);
  expect(queued).toMatchObject([
    { id: 'topics:t1', table: 'topics', rowId: 't1', op: 'upsert' },
  ]);
});

test('settings push hesap düzeyi alanları gönderir, cihaz ayarlarını göndermez', async () => {
  await database.settings.put({ key: 'profileName', value: 'Deniz' });
  await database.settings.put({ key: 'accent', value: '#FF0000' });
  await database.settings.put({ key: 'scheduleMode', value: 'manual' });
  await whenQueueIdle();
  expect(await pendingCount(database)).toBe(1);

  const { client, calls } = recordingClient((body) => appliedResults(body));
  await pushOnce(database, client, 'csrf');

  expect(calls[0].body.changes).toHaveLength(1);
  const change = calls[0].body.changes[0];
  expect(change.table).toBe('settings');
  expect(change.row).toMatchObject({
    userId: 'user-1',
    profileName: 'Deniz',
    examDate: expect.any(String),
    hiddenSubjects: expect.any(Array),
    updatedAt: expect.any(String),
  });
  expect(change.row).not.toHaveProperty('accent');
  expect(change.row).not.toHaveProperty('scheduleMode');
  expect(await pendingCount(database)).toBe(0);
});

test('ortak katalog tohumu sunucuya gönderilmez', async () => {
  const seedCatalogBook = CATALOG_SEED[0];
  const seed: CatalogBook = {
    id: catalogBookId(
      seedCatalogBook.title,
      seedCatalogBook.publisher,
      seedCatalogBook.edition,
    ),
    title: seedCatalogBook.title,
    totalPages: seedCatalogBook.totalPages,
    createdAt: now(),
    updatedAt: now(),
  };
  await database.catalogBooks.add(seed);
  await whenQueueIdle();
  expect(await pendingCount(database)).toBe(1);

  const { client, calls } = recordingClient((body) => appliedResults(body));
  const summary = await pushOnce(database, client, 'csrf');

  expect(calls).toHaveLength(0);
  expect(summary).toEqual({ applied: 1, conflicts: 0, errors: 0 });
  expect(await pendingCount(database)).toBe(0);
});

test('applied kanonik satır özel kitabın ownerId işaretini korur', async () => {
  const book: CatalogBook = {
    id: 'cb-1',
    ownerId: LOCAL_SCOPE,
    title: 'Özel Kitap',
    totalPages: 100,
    createdAt: now(),
    updatedAt: now(),
  };
  await database.catalogBooks.add(book);
  await whenQueueIdle();

  const { client, calls } = recordingClient((body) => appliedResults(body));
  const summary = await pushOnce(database, client, 'csrf');

  expect(summary).toEqual({ applied: 1, conflicts: 0, errors: 0 });
  expect(calls[0].body.changes[0].row).not.toHaveProperty('ownerId');
  expect(await database.catalogBooks.get('cb-1')).toMatchObject({
    ownerId: LOCAL_SCOPE,
    title: 'Özel Kitap',
  });
  expect(await pendingCount(database)).toBe(0);
});

test('aynı partide subject rekey sonrası topic conflict rekeyi geri almaz', async () => {
  await database.subjects.add(subject('s-local', { seedKey: 'tyt-mat' }));
  await database.topics.add(topic('t1', 's-local'));
  await whenQueueIdle();
  expect(await pendingCount(database)).toBe(2);

  const canonicalSubject = {
    ...subject('s-server', { seedKey: 'tyt-mat' }),
    name: 'Sunucu Matematik',
    updatedAt: now(60_000),
  };
  const staleTopic = {
    ...topic('t1', 's-local'),
    name: 'Sunucu Konu',
    updatedAt: now(60_000),
  };

  const { client } = recordingClient((body) =>
    body.changes.map((change) => {
      if (change.table === 'subjects') {
        return {
          table: 'subjects',
          rowId: rowIdOf(change),
          status: 'conflict' as const,
          row: canonicalSubject,
        };
      }
      return {
        table: 'topics',
        rowId: rowIdOf(change),
        status: 'conflict' as const,
        row: staleTopic,
      };
    }),
  );

  const summary = await pushOnce(database, client, 'csrf');

  // The topic's queue row was re-queued by the subject rekey; its stale
  // conflict must be skipped, not applied over the corrected subjectId.
  expect(summary).toEqual({ applied: 0, conflicts: 1, errors: 0 });
  expect((await database.topics.get('t1'))?.subjectId).toBe('s-server');
  expect((await database.topics.get('t1'))?.name).toBe('Limit');
  expect((await pendingChanges(database)).map((row) => row.id)).toEqual(['topics:t1']);
});

test('POST sürerken yapılan kullanıcı düzenlemesi conflict ile ezilmez', async () => {
  await database.topics.add(topic('t1', 's1'));
  await whenQueueIdle();

  const stale = { ...topic('t1', 's1'), name: 'Sunucu Konu', updatedAt: now(60_000) };
  const client: PushApiClient = {
    async post<T>(_path: string, body?: unknown): Promise<T> {
      await database.topics.update('t1', { name: 'Kullanıcı düzenlemesi' });
      await whenQueueIdle();
      const request = body as PushRequestBody;
      return {
        results: request.changes.map((change) => ({
          table: 'topics',
          rowId: rowIdOf(change),
          status: 'conflict',
          row: stale,
        })),
        serverTime: now(),
      } as T;
    },
  };

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary).toEqual({ applied: 0, conflicts: 0, errors: 0 });
  expect((await database.topics.get('t1'))?.name).toBe('Kullanıcı düzenlemesi');
  expect(await pendingCount(database)).toBe(1);
});

test('activityLogs conflict rekey edilmiş topicId yi korur ve kuyruğu temizler', async () => {
  await database.subjects.add(subject('s1'));
  await database.topics.add(topic('t-old', 's1'));
  await database.activityLogs.add(activityLog('log-1', 't-old'));
  await whenQueueIdle();
  await database.syncQueue.clear();

  await rekeyRow(
    database,
    'topics',
    't-old',
    topic('t-new', 's1') as unknown as Record<string, unknown>,
  );
  await whenQueueIdle();
  expect((await pendingChanges(database)).map((row) => row.id)).toEqual([
    'activityLogs:log-1',
  ]);

  const serverLog = {
    id: 'log-1',
    type: 'topic_review',
    topicId: 't-old',
    source: 'manual',
    createdAt: now(),
  };
  const { client } = recordingClient((body) =>
    body.changes.map((change) => ({
      table: 'activityLogs',
      rowId: rowIdOf(change),
      status: 'conflict' as const,
      row: serverLog,
    })),
  );

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary).toEqual({ applied: 0, conflicts: 1, errors: 0 });
  expect((await database.activityLogs.get('log-1'))?.topicId).toBe('t-new');
  expect(await pendingCount(database)).toBe(0);
});

test('1 MB üstü tek satır ölü kayda düşer, küçük satırlar gönderilir', async () => {
  await database.notes.add({
    topicId: 'topic-big',
    contentHtml: 'a'.repeat(1_100_000),
    plainText: 'büyük not',
    updatedAt: now(),
  });
  await database.userBooks.add(userBook('ub-1'));
  await database.userBooks.add(userBook('ub-2'));
  await whenQueueIdle();
  expect(await pendingCount(database)).toBe(3);

  const { client, calls } = recordingClient((body) => appliedResults(body));
  const summary = await pushOnce(database, client, 'csrf');

  expect(summary).toEqual({ applied: 2, conflicts: 0, errors: 1 });
  for (const call of calls) {
    expect(new TextEncoder().encode(JSON.stringify(call.body)).length).toBeLessThanOrEqual(
      MAX_PUSH_BYTES,
    );
  }
  expect(calls.flatMap((call) => call.body.changes.map((change) => change.table))).not.toContain(
    'notes',
  );
  expect(await deadLetters(database)).toMatchObject([
    { id: 'notes:topic-big', status: 'dead', lastError: expect.stringContaining('payload_too_large') },
  ]);
  expect(await pendingCount(database)).toBe(0);
});

test('413 yanıtı partiyi bölerek yeniden dener', async () => {
  for (let index = 0; index < 4; index += 1) {
    await database.userBooks.add(userBook(`ub-${index}`));
  }
  await whenQueueIdle();

  const { client, calls } = recordingClient((body) => {
    if (body.changes.length > 1) {
      throw new ApiError(413, 'payload_too_large', 'Gövde çok büyük.');
    }
    return appliedResults(body);
  });

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary).toEqual({ applied: 4, conflicts: 0, errors: 0 });
  expect(await pendingCount(database)).toBe(0);
  // 4 -> 2+2 -> 1+1 four times: one initial, two halves, four singles.
  expect(calls.length).toBe(7);
});

test('applied sunucu zaman damgası daha eski olsa da uygulanır', async () => {
  await database.userBooks.add({ ...userBook('ub-1'), updatedAt: now(10 * 60_000) });
  await whenQueueIdle();

  const clamped = now();
  const { client } = recordingClient((body) =>
    body.changes.map((change) => ({
      table: change.table,
      rowId: rowIdOf(change),
      status: 'applied' as const,
      row: { ...change.row, updatedAt: clamped },
    })),
  );

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary.applied).toBe(1);
  expect((await database.userBooks.get('ub-1'))?.updatedAt).toBe(clamped);
});

test('push POST sürerken yerel yazım kuyruğa girer', async () => {
  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const client: PushApiClient = {
    async post<T>(_path: string, body?: unknown): Promise<T> {
      await database.userBooks.add(userBook('ub-during'));
      await whenQueueIdle();
      return { results: appliedResults(body as PushRequestBody), serverTime: now() } as T;
    },
  };

  const summary = await pushOnce(database, client, 'csrf');

  expect(summary.applied).toBe(1);
  expect((await pendingChanges(database)).map((row) => row.id)).toEqual([
    'userBooks:ub-during',
  ]);
});
