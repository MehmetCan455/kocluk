import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Photo, Subject, UserBook } from '@/domain/types';
import { KoclukDB } from '../db';
import { SYNCED_TABLES } from './constants';
import {
  deadLetters,
  installSyncHooks,
  markApplied,
  markDead,
  pendingChanges,
  pendingCount,
  retryDead,
  setApplyingRemote,
  whenQueueIdle,
} from './queue';

const DB_NAME = 'kocluk-sync-queue-test';
const NOW = '2026-11-25T10:00:00.000Z';

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

function userBook(id: string, bookId = `book-${id}`): UserBook {
  return {
    id,
    bookId,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function subject(id: string, updatedAt?: string): Subject {
  return {
    id,
    seedKey: `seed-${id}`,
    exam: 'TYT',
    name: 'Matematik',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

test('SYNCED_TABLES backend TableMap ile birebir aynı 13 anahtardır', async () => {
  expect(SYNCED_TABLES).toEqual([
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
    'topicProgress',
    'settings',
  ]);

  const stores = new Set(database.tables.map((table) => table.name));
  for (const table of SYNCED_TABLES) {
    expect(stores.has(table)).toBe(true);
  }
});

test('aynı satır için tek kuyruk kaydı: oluştur, güncelle, sil', async () => {
  const withoutUpdatedAt = { ...userBook('ub-1'), updatedAt: undefined } as unknown as UserBook;
  await database.userBooks.add(withoutUpdatedAt);
  await whenQueueIdle();

  let queued = await pendingChanges(database);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    id: 'userBooks:ub-1',
    table: 'userBooks',
    rowId: 'ub-1',
    op: 'upsert',
    attempts: 0,
    status: 'pending',
    lastError: null,
  });
  const firstCreatedAt = queued[0].createdAt;

  const stored = await database.userBooks.get('ub-1');
  expect(stored?.updatedAt).toEqual(expect.any(String));
  expect(stored?.updatedAt).not.toBe('');

  await database.userBooks.update('ub-1', { note: 'güncel not' });
  await whenQueueIdle();

  queued = await pendingChanges(database);
  expect(queued).toHaveLength(1);
  expect(queued[0].op).toBe('upsert');
  expect(queued[0].createdAt).toBe(firstCreatedAt);

  const updated = await database.userBooks.get('ub-1');
  expect(updated?.note).toBe('güncel not');
  expect(updated?.updatedAt).toEqual(expect.any(String));
  expect(updated!.updatedAt >= stored!.updatedAt!).toBe(true);

  await database.userBooks.delete('ub-1');
  await whenQueueIdle();

  queued = await pendingChanges(database);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ id: 'userBooks:ub-1', op: 'delete' });
});

test('setApplyingRemote(true) iken yazma kuyruğa girmez', async () => {
  setApplyingRemote(true);
  try {
    await database.subjects.add(subject('s1'));
    await database.subjects.put({ ...subject('s1'), name: 'Sunucudan gelen' });
    await database.subjects.delete('s1');
    await database.settings.put({ key: 'profileName', value: 'Sunucu' });
  } finally {
    setApplyingRemote(false);
  }
  await whenQueueIdle();

  expect(await pendingCount(database)).toBe(0);
  expect(await database.syncQueue.count()).toBe(0);
});

test('settings yazımı tek settings kuyruk kaydı üretir', async () => {
  await database.settings.put({ key: 'profileName', value: 'Deniz' });
  await database.settings.put({ key: 'examDate', value: '2027-06-19' });
  await database.settings.delete('profileName');
  await whenQueueIdle();

  const rows = await database.syncQueue.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: 'settings:user-1',
    table: 'settings',
    rowId: 'user-1',
    op: 'upsert',
    status: 'pending',
  });
});

test('senkron dışı tablo kuyruğa girmez', async () => {
  const photo: Photo = {
    id: 'photo-1',
    examType: 'TYT',
    subjectId: 's1',
    note: 'soru',
    blob: new Blob(['büyük']),
    thumbBlob: new Blob(['küçük']),
    width: 10,
    height: 10,
    mastered: false,
    practiceCount: 0,
    createdAt: NOW,
  };

  await database.photos.add(photo);
  await database.practiceSessions.add({
    id: 'practice-1',
    createdAt: NOW,
    results: [],
  } as never);
  await whenQueueIdle();

  expect(await pendingCount(database)).toBe(0);
});

test('updatedAt boşsa hook şimdiki zamanı yazar', async () => {
  await database.subjects.add(subject('s-empty', ''));
  await whenQueueIdle();

  const stored = await database.subjects.get('s-empty');
  expect(stored?.updatedAt).toEqual(expect.any(String));
  expect(stored?.updatedAt).not.toBe('');
  expect((await pendingChanges(database))[0]).toMatchObject({ id: 'subjects:s-empty' });
});

test('markApplied yalnızca beklenen sürümü siler', async () => {
  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const [queued] = await pendingChanges(database);
  await database.userBooks.update('ub-1', { note: 'push sürerken yazıldı' });
  await whenQueueIdle();

  await markApplied(database, queued.id, queued.updatedAt);
  expect(await pendingCount(database)).toBe(1);

  const [current] = await pendingChanges(database);
  await markApplied(database, current.id, current.updatedAt);
  expect(await pendingCount(database)).toBe(0);
});

test('markDead ölü kayıt bırakır, retryDead yeniden dener', async () => {
  await database.userBooks.add(userBook('ub-1'));
  await whenQueueIdle();

  const [queued] = await pendingChanges(database);
  await markDead(database, queued.id, 'validation_failed');

  expect(await pendingCount(database)).toBe(0);
  expect(await deadLetters(database)).toHaveLength(1);
  expect(await deadLetters(database)).toMatchObject([
    { id: 'userBooks:ub-1', status: 'dead', lastError: 'validation_failed' },
  ]);

  expect(await retryDead(database)).toBe(1);
  expect(await pendingCount(database)).toBe(1);
  expect(await deadLetters(database)).toHaveLength(0);
  expect((await database.syncQueue.get(queued.id))?.attempts).toBe(0);
});

test('whenQueueIdle bekleyen kuyruk yazımlarını tamamlar', async () => {
  for (let index = 0; index < 5; index += 1) {
    await database.userBooks.add(userBook(`ub-${index}`));
  }
  await whenQueueIdle();

  expect(await pendingCount(database)).toBe(5);
});
