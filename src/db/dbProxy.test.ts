import { expect, test } from 'vitest';
import type { Subject } from '@/domain/types';
import { db, getActiveDb, setActiveDb } from './db';

const subject: Subject = {
  id: 'proxy-subject',
  seedKey: 'proxy-subject',
  exam: 'TYT',
  name: 'Matematik',
  slug: 'matematik',
  icon: 'calculator',
  order: 1,
};

test('proxy aktif DB adını ve tablolarını gösterir', () => {
  expect(db.name).toBe('kocluk-test');
  expect(getActiveDb().name).toBe('kocluk-test');
  expect(db.tables.map((table) => table.name)).toEqual(
    expect.arrayContaining(['subjects', 'syncQueue', 'syncMeta']),
  );
});

test('proxy tablo metotlarını aktif DB üzerinde çalıştırır', async () => {
  await db.subjects.add(subject);

  expect(await db.subjects.count()).toBe(1);
  expect(await db.subjects.get('proxy-subject')).toMatchObject({ name: 'Matematik' });
});

test('proxy Dexie transaction destekler ve hata durumunda geri alır', async () => {
  await db.transaction('rw', db.subjects, db.settings, async () => {
    await db.subjects.add(subject);
    await db.settings.put({ key: 'proxy', value: true });
  });

  expect(await db.subjects.count()).toBe(1);
  expect(await db.settings.get('proxy')).toEqual({ key: 'proxy', value: true });

  await expect(
    db.transaction('rw', db.subjects, async () => {
      await db.subjects.add({ ...subject, id: 'rolled-back', seedKey: 'rolled-back' });
      throw new Error('iptal');
    }),
  ).rejects.toThrow('iptal');

  expect(await db.subjects.get('rolled-back')).toBeUndefined();
});

test('proxy delete ve open çağrılarını aktif DB üzerinde çalıştırır', async () => {
  await db.subjects.add(subject);
  expect(db.isOpen()).toBe(true);

  await db.delete();
  expect(db.isOpen()).toBe(false);

  await db.open();
  expect(await db.subjects.count()).toBe(0);
});

test('aktif DB yokken anlamlı hata fırlatır', () => {
  setActiveDb(null);

  expect(() => getActiveDb()).toThrow('Veritabanı açılmadı');
  expect(() => db.subjects).toThrow('Veritabanı açılmadı');
  expect(() => db.transaction).toThrow('Veritabanı açılmadı');
});
