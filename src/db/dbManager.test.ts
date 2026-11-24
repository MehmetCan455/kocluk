import Dexie from 'dexie';
import { afterEach, expect, test } from 'vitest';
import type { Subject } from '@/domain/types';
import { KoclukDB, db, getActiveDb } from './db';
import { activeUserId, closeActiveDb, openLegacyDb, openUserDb } from './dbManager';
import { getMeta, setMeta } from './sync/meta';

const subject: Subject = {
  id: 's1',
  seedKey: 'tyt-mat',
  exam: 'TYT',
  name: 'Matematik',
  slug: 'matematik',
  icon: 'calculator',
  order: 1,
};

const opened: KoclukDB[] = [];

function track(database: KoclukDB): KoclukDB {
  opened.push(database);
  return database;
}

afterEach(async () => {
  await closeActiveDb();
  for (const database of opened.splice(0)) {
    if (database.isOpen()) {
      database.close();
    }
    await Dexie.delete(database.name);
  }
});

test('openUserDb kullanıcıya özel DB açar ve aktif yapar', async () => {
  const database = track(await openUserDb('u1'));

  expect(database.name).toBe('kocluk-u-u1');
  expect(db.name).toBe('kocluk-u-u1');
  expect(activeUserId()).toBe('u1');
  expect(await db.subjects.count()).toBe(0);
});

test('kullanıcı verileri birbirinden izole kalır', async () => {
  track(await openUserDb('u1'));
  await db.subjects.add(subject);

  track(await openUserDb('u2'));
  expect(await db.subjects.count()).toBe(0);

  track(await openUserDb('u1'));
  expect(await db.subjects.get('s1')).toMatchObject({ name: 'Matematik' });
  expect(await db.subjects.count()).toBe(1);
});

test('openUserDb önceki aktif DB yi kapatır', async () => {
  const first = track(await openUserDb('u1'));
  const second = track(await openUserDb('u2'));

  expect(first.isOpen()).toBe(false);
  expect(second.isOpen()).toBe(true);
  expect(db.name).toBe('kocluk-u-u2');
});

test('openLegacyDb kocluk DB sini açar ama aktif yapmaz', async () => {
  const legacy = track(await openLegacyDb());

  expect(legacy.name).toBe('kocluk');
  expect(legacy.isOpen()).toBe(true);
  expect(db.name).toBe('kocluk-test');
  expect(getActiveDb().name).toBe('kocluk-test');
  expect(activeUserId()).toBeNull();

  await legacy.settings.put({ key: 'legacy', value: true });
  expect(await legacy.settings.get('legacy')).toEqual({ key: 'legacy', value: true });
});

test('closeActiveDb aktif DB yi kapatır ve temizler', async () => {
  const database = track(await openUserDb('u1'));
  expect(database.isOpen()).toBe(true);

  await closeActiveDb();
  expect(database.isOpen()).toBe(false);
  expect(activeUserId()).toBeNull();
  expect(() => getActiveDb()).toThrow('Veritabanı açılmadı');

  await expect(closeActiveDb()).resolves.toBeUndefined();
});

test('syncMeta anahtar/değer saklar ve günceller', async () => {
  const database = track(new KoclukDB('kocluk-meta-test'));
  await database.open();

  expect(await getMeta(database, 'cursor')).toBeUndefined();
  await setMeta(database, 'cursor', 42);
  expect(await getMeta(database, 'cursor')).toBe(42);

  await setMeta(database, 'cursor', { lastChangeId: 7 });
  expect(await getMeta(database, 'cursor')).toEqual({ lastChangeId: 7 });
  expect(await database.syncMeta.count()).toBe(1);
});

test('v7 geçişi eski tabloları korur ve senkron tablolarını ekler', async () => {
  const name = 'kocluk-v7-test';
  await Dexie.delete(name);

  const legacy = new Dexie(name);
  legacy.version(6).stores({
    settings: 'key',
    subjects: 'id, &seedKey, exam, order',
    userBooks: 'id, &bookId, status, updatedAt, deletedAt',
  });
  await legacy.open();
  await legacy.table('settings').put({ key: 'profileName', value: 'Deniz' });
  await legacy.table('subjects').put(subject);
  legacy.close();

  const upgraded = track(new KoclukDB(name));
  await upgraded.open();

  expect(upgraded.verno).toBe(7);
  expect(await upgraded.settings.get('profileName')).toEqual({ key: 'profileName', value: 'Deniz' });
  expect(await upgraded.subjects.get('s1')).toMatchObject({ name: 'Matematik' });
  expect(await upgraded.syncQueue.count()).toBe(0);
  expect(await upgraded.syncMeta.count()).toBe(0);
  expect(upgraded.tables.map((table) => table.name)).toEqual(
    expect.arrayContaining(['syncQueue', 'syncMeta']),
  );

  await upgraded.syncQueue.put({
    id: 'subjects:s1',
    table: 'subjects',
    rowId: 's1',
    op: 'upsert',
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    attempts: 0,
    status: 'pending',
    lastError: null,
  });
  expect(await upgraded.syncQueue.get('subjects:s1')).toMatchObject({ op: 'upsert', attempts: 0 });
});
