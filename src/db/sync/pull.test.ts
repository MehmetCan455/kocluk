import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Attachment, Book, CatalogBook, Photo, Subject, UserBook } from '@/domain/types';
import { ApiError } from '@/lib/api';
import { KoclukDB } from '../db';
import { FULL_PATH, PULL_PATH, SYNCED_TABLES } from './constants';
import { getMeta, setMeta } from './meta';
import { fullSync, pullAll, pullOnce, type PullApiClient } from './pull';
import {
  installSyncHooks,
  isApplyingRemote,
  setApplyingRemote,
  whenQueueIdle,
} from './queue';

const DB_NAME = 'kocluk-sync-pull-test';

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

interface RecordedPull {
  path: string;
}

/**
 * Minimal pull client: records the requested path and answers with the
 * callback. A thrown error simulates an HTTP failure.
 */
function recordingClient(
  respond: (path: string, call: number) => unknown,
): { client: PullApiClient; calls: RecordedPull[] } {
  const calls: RecordedPull[] = [];
  const client: PullApiClient = {
    async get<T>(path: string): Promise<T> {
      calls.push({ path });
      return respond(path, calls.length - 1) as T;
    },
  };
  return { client, calls };
}

function serverSubject(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    seedKey: `seed-${id}`,
    exam: 'TYT',
    name: 'Matematik',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
    updatedAt: now(),
    deletedAt: null,
    ...overrides,
  };
}

function localSubject(id: string, overrides: Partial<Subject> = {}): Subject {
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

function localUserBook(id: string, overrides: Partial<UserBook> = {}): UserBook {
  return {
    id,
    bookId: `book-${id}`,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function fullTables(
  overrides: Record<string, unknown[]> = {},
): Record<string, unknown[]> {
  const tables: Record<string, unknown[]> = {};
  for (const table of SYNCED_TABLES) {
    tables[table] = [];
  }
  return { ...tables, ...overrides };
}

function fullResponse(
  overrides: Record<string, unknown[]> = {},
  cursor = 1,
): Record<string, unknown> {
  return { tables: fullTables(overrides), cursor, serverTime: now() };
}

test('pull bir satırı uygular, imleci günceller ve kuyruğa yazmaz', async () => {
  const { client, calls } = recordingClient(() => ({
    changes: [{ table: 'subjects', row: serverSubject('s1') }],
    nextCursor: 42,
    hasMore: false,
  }));

  const result = await pullOnce(database, client);

  expect(result).toEqual({ applied: 1, hasMore: false });
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe(`${PULL_PATH}?since=0&limit=500`);
  expect(await database.subjects.get('s1')).toMatchObject({
    id: 's1',
    name: 'Matematik',
  });
  expect(await getMeta(database, 'lastChangeId')).toBe(42);
  expect(await database.syncQueue.count()).toBe(0);
  expect(isApplyingRemote()).toBe(false);
});

test('hasMore true iken imleçten devam edilir', async () => {
  const { client, calls } = recordingClient((_path, call) =>
    call === 0
      ? {
          changes: [{ table: 'subjects', row: serverSubject('s1') }],
          nextCursor: 5,
          hasMore: true,
        }
      : {
          changes: [{ table: 'subjects', row: serverSubject('s2') }],
          nextCursor: 9,
          hasMore: false,
        },
  );

  const applied = await pullAll(database, client);

  expect(applied).toBe(2);
  expect(calls.map((call) => call.path)).toEqual([
    `${PULL_PATH}?since=0&limit=500`,
    `${PULL_PATH}?since=5&limit=500`,
  ]);
  expect(await getMeta(database, 'lastChangeId')).toBe(9);
  expect(await database.subjects.get('s2')).toBeDefined();
});

test('bekleyen kuyruk satırı sunucu satırıyla ezilmez', async () => {
  await database.userBooks.add(localUserBook('ub-1', { note: 'yerel düzenleme' }));
  await whenQueueIdle();
  expect(await database.syncQueue.get('userBooks:ub-1')).toMatchObject({
    status: 'pending',
  });

  const { client } = recordingClient(() => ({
    changes: [
      {
        table: 'userBooks',
        row: {
          id: 'ub-1',
          bookId: 'book-ub-1',
          status: 'active',
          note: 'sunucu değeri',
          createdAt: now(),
          updatedAt: now(60_000),
          deletedAt: null,
        },
      },
    ],
    nextCursor: 7,
    hasMore: false,
  }));

  const result = await pullOnce(database, client);

  expect(result.applied).toBe(0);
  expect((await database.userBooks.get('ub-1'))?.note).toBe('yerel düzenleme');
  expect(await database.syncQueue.get('userBooks:ub-1')).toMatchObject({
    status: 'pending',
  });
  expect(await getMeta(database, 'lastChangeId')).toBe(7);
});

test('bekleyen silme, sunucu satırını geri getirmez', async () => {
  await database.subjects.add(localSubject('s1'));
  await whenQueueIdle();
  await database.subjects.delete('s1');
  await whenQueueIdle();
  expect(await database.syncQueue.get('subjects:s1')).toMatchObject({
    op: 'delete',
    status: 'pending',
  });

  const { client } = recordingClient(() => ({
    changes: [{ table: 'subjects', row: serverSubject('s1') }],
    nextCursor: 4,
    hasMore: false,
  }));

  const result = await pullOnce(database, client);

  expect(result.applied).toBe(0);
  expect(await database.subjects.get('s1')).toBeUndefined();
});

test('pull sürerken yapılan kullanıcı yazımı kuyruğa girer', async () => {
  const { client } = recordingClient(() => {
    // A user write from another transaction while the pull is in flight must
    // still be queued; remote suppression is transaction-scoped, not global.
    void database.topics.add({
      id: 't-during',
      subjectId: 's1',
      name: 'Kullanıcı konusu',
      order: 1,
      isCustom: true,
      createdAt: now(),
      updatedAt: now(),
    });

    return {
      changes: [{ table: 'subjects', row: serverSubject('s1') }],
      nextCursor: 3,
      hasMore: false,
    };
  });

  await pullOnce(database, client);
  await whenQueueIdle();

  expect(await database.syncQueue.get('topics:t-during')).toMatchObject({
    status: 'pending',
  });
  expect((await database.subjects.get('s1'))?.name).toBe('Matematik');
});

test('tombstone satırı silinmeden deletedAt ile saklanır', async () => {
  await database.subjects.add(localSubject('s1'));
  await whenQueueIdle();
  // Simulate an already pushed row: no pending entry blocks the pull.
  await database.syncQueue.clear();

  const deletedAt = now(60_000);
  const { client } = recordingClient(() => ({
    changes: [
      {
        table: 'subjects',
        row: serverSubject('s1', { deletedAt, name: 'Silinmiş ders' }),
      },
    ],
    nextCursor: 8,
    hasMore: false,
  }));

  const result = await pullOnce(database, client);

  expect(result.applied).toBe(1);
  const local = await database.subjects.get('s1');
  expect(local).toBeDefined();
  expect(local?.deletedAt).toBe(deletedAt);
  expect(local?.name).toBe('Silinmiş ders');
  expect(await database.subjects.count()).toBe(1);
});

test('sunucudan gelen null alanlar undefined olarak saklanır (yedek uyumu)', async () => {
  const { client } = recordingClient(() => ({
    changes: [
      {
        table: 'subjects',
        row: serverSubject('s1', { deletedAt: null }),
      },
      {
        table: 'catalogBooks',
        row: {
          id: 'cb-1',
          title: 'Özel Kitap',
          publisher: null,
          exam: null,
          subjectSlug: null,
          totalPages: 100,
          edition: null,
          createdAt: now(),
          updatedAt: now(),
          deletedAt: null,
        },
      },
    ],
    nextCursor: 11,
    hasMore: false,
  }));

  await pullOnce(database, client);

  const subject = await database.subjects.get('s1');
  const book = await database.catalogBooks.get('cb-1');
  expect(subject).toBeDefined();
  expect(book).toBeDefined();
  expect(subject?.deletedAt).toBeUndefined();
  expect(book?.publisher).toBeUndefined();
  expect(book?.deletedAt).toBeUndefined();
  // Backup schemas use `z.string().optional()`, which rejects an explicit null.
  expect(subject !== undefined && 'deletedAt' in subject).toBe(false);
  expect(book !== undefined && 'deletedAt' in book).toBe(false);
});

test('bilinmeyen tablo ve kimliksiz satır atlanır, imleç ilerler', async () => {
  const { client } = recordingClient(() => ({
    changes: [
      { table: 'photos', row: { id: 'foto-1' } },
      { table: 'subjects', row: { name: 'Kimliksiz' } },
      { table: 'subjects', row: serverSubject('s1') },
    ],
    nextCursor: 12,
    hasMore: false,
  }));

  const result = await pullOnce(database, client);

  expect(result.applied).toBe(1);
  expect(await getMeta(database, 'lastChangeId')).toBe(12);
  expect(await database.subjects.count()).toBe(1);
});

test('410 cursor_expired tam çekmeye (fullSync) düşer', async () => {
  await setMeta(database, 'lastChangeId', 500);
  const serverRow = serverSubject('s1', { name: 'Tam çekme' });
  const { client, calls } = recordingClient((path) => {
    if (path.startsWith(PULL_PATH)) {
      throw new ApiError(410, 'cursor_expired', 'İmleç çok eski.');
    }
    return fullResponse({ subjects: [serverRow] }, 900);
  });

  await pullAll(database, client);

  expect(calls[0].path).toBe(`${PULL_PATH}?since=500&limit=500`);
  expect(calls[1].path).toBe(FULL_PATH);
  expect(await database.subjects.get('s1')).toMatchObject({ name: 'Tam çekme' });
  expect(await getMeta(database, 'lastChangeId')).toBe(900);
});

test('fullSync yalnızca senkron tabloları birleştirir, fotoğraf/ek/eski veriyi korur', async () => {
  const photo: Photo = {
    id: 'foto-1',
    examType: 'TYT',
    subjectId: 's1',
    note: '',
    blob: new Blob(['foto']),
    thumbBlob: new Blob(['kucuk']),
    width: 10,
    height: 10,
    mastered: false,
    practiceCount: 0,
    createdAt: now(),
  };
  const attachment: Attachment = {
    id: 'ek-1',
    topicId: 't1',
    name: 'ek.pdf',
    mime: 'application/pdf',
    size: 3,
    blob: new Blob(['ek']),
    createdAt: now(),
  };
  const legacyBook: Book = {
    id: 'legacy-1',
    name: 'Eski Kitap',
    createdAt: now(),
    updatedAt: now(),
  };
  const customBook: CatalogBook = {
    id: 'cb-1',
    title: 'Raf Kitabı',
    totalPages: 10,
    createdAt: now(),
    updatedAt: now(),
  };
  await database.photos.add(photo);
  await database.attachments.add(attachment);
  await database.books.add(legacyBook);
  await database.catalogBooks.add(customBook);
  await database.settings.put({ key: 'accent', value: '#ff0000' });
  await database.userBooks.add(localUserBook('ub-local', { note: 'bekleyen' }));
  await whenQueueIdle();
  // `accent` is device-level: its write queued a settings push that carries no
  // device field, so the queue is clear for the account settings row below.
  await database.syncQueue.delete('settings:user-1');

  const serverBook = {
    id: 'ub-remote',
    bookId: 'book-remote',
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  const { client } = recordingClient(() =>
    fullResponse(
      {
        subjects: [serverSubject('s1')],
        topics: [],
        userBooks: [
          {
            id: 'ub-local',
            bookId: 'book-ub-local',
            status: 'active',
            note: 'sunucu',
            createdAt: now(),
            updatedAt: now(60_000),
            deletedAt: null,
          },
          serverBook,
        ],
        settings: [
          {
            userId: 'user-1',
            profileName: 'Sunucu Profili',
            examDate: '2027-06-01',
            examName: 'YKS 2027',
            onboardingDone: true,
            hiddenSubjects: [],
            geometryMode: 'separate',
            updatedAt: now(),
          },
        ],
      },
      99,
    ),
  );

  await fullSync(database, client);

  expect(await database.photos.count()).toBe(1);
  expect(await database.attachments.count()).toBe(1);
  expect(await database.books.count()).toBe(1);
  expect(await database.catalogBooks.count()).toBe(1);
  expect((await database.settings.get('accent'))?.value).toBe('#ff0000');
  expect((await database.settings.get('profileName'))?.value).toBe('Sunucu Profili');
  expect(await database.subjects.get('s1')).toBeDefined();
  expect(await database.userBooks.get('ub-remote')).toBeDefined();
  // A pending local row is never replaced by the snapshot.
  expect((await database.userBooks.get('ub-local'))?.note).toBe('bekleyen');
  expect(await getMeta(database, 'lastChangeId')).toBe(99);
  expect(await database.syncQueue.get('userBooks:ub-local')).toMatchObject({
    status: 'pending',
  });
});

test('eksik tablo içeren tam çekme reddedilir, hiçbir satır yazılmaz', async () => {
  await setMeta(database, 'lastChangeId', 5);
  const { client } = recordingClient(() => ({
    tables: { subjects: [serverSubject('s1')] },
    cursor: 50,
    serverTime: now(),
  }));

  await expect(fullSync(database, client)).rejects.toMatchObject({
    code: 'invalid_response',
  });

  expect(await database.subjects.get('s1')).toBeUndefined();
  expect(await getMeta(database, 'lastChangeId')).toBe(5);
});
