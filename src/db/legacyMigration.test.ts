import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import type { CurriculumSeed } from '@/db/repositories';
import { createBook, upsertTopicBook } from '@/db/repositories';
import { db } from '@/db/db';
import { seedOnboarded } from '@/test/fixtures';
import { addCustomBook, getShelfBook } from './bookRepositories';
import {
  LEGACY_SHELF_MIGRATED_KEY,
  migrateLegacyShelfFromLocalData,
} from './legacyMigration';
import { getTopicDone } from './topicProgressRepository';

const FIXTURE: CurriculumSeed = {
  version: 1,
  subjects: [
    {
      seedKey: 'tyt-mat',
      exam: 'TYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [
        { seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 },
        { seedKey: 'tyt-mat-limit', name: 'Limit', order: 2 },
      ],
    },
    {
      seedKey: 'tyt-fiz',
      exam: 'TYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 2,
      topics: [{ seedKey: 'tyt-fiz-hareket', name: 'Hareket', order: 1 }],
    },
  ],
};

async function topicBySeedKey(seedKey: string) {
  const topic = await db.topics.where('seedKey').equals(seedKey).first();
  if (!topic) {
    throw new Error(`Test konusu bulunamadı: ${seedKey}`);
  }
  return topic;
}

beforeEach(async () => {
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
  // Simulate an in-place update from the pre-migration build.
  await db.settings.delete(LEGACY_SHELF_MIGRATED_KEY);
});

test('eski kitaplar ve tamamlanmış konular bir kez rafa taşınır', async () => {
  const turev = await topicBySeedKey('tyt-mat-turev');
  const limit = await topicBySeedKey('tyt-mat-limit');
  const hareket = await topicBySeedKey('tyt-fiz-hareket');
  const book = await createBook({ name: 'Eski Fizik Defteri', publisher: 'Palme' });
  await db.books.update(book.id, { note: 'Eski kitap notu' });
  await upsertTopicBook({
    topicId: turev.id,
    bookId: book.id,
    totalTests: 10,
    solvedTests: 10,
  });
  await upsertTopicBook({
    topicId: limit.id,
    bookId: book.id,
    totalTests: 10,
    solvedTests: 2,
  });
  await upsertTopicBook({
    topicId: hareket.id,
    bookId: book.id,
    totalTests: 8,
    solvedTests: 8,
  });

  await migrateLegacyShelfFromLocalData();

  const userBooks = await db.userBooks.toArray();
  expect(userBooks).toHaveLength(1);
  expect(userBooks[0]).toMatchObject({
    status: 'active',
    note: 'Eski kitap notu',
  });
  const shelfBook = await getShelfBook(userBooks[0].id);
  expect(shelfBook?.catalogBook).toMatchObject({
    title: 'Eski Fizik Defteri',
    publisher: 'Palme',
    totalPages: 0,
  });
  expect(await getTopicDone(turev.id)).toBe(true);
  expect(await getTopicDone(limit.id)).toBe(false);
  expect(await getTopicDone(hareket.id)).toBe(true);
  expect(await db.topicProgress.count()).toBe(2);
  expect((await db.settings.get(LEGACY_SHELF_MIGRATED_KEY))?.value).toBe(true);

  // Legacy tables stay in place as the read-only archive.
  expect(await db.books.get(book.id)).toMatchObject({
    name: 'Eski Fizik Defteri',
    note: 'Eski kitap notu',
  });
  expect(await db.topicBooks.count()).toBe(3);

  // A second start (or a book added to the legacy table later) must not migrate
  // anything again.
  await createBook({ name: 'Sonradan eklenen eski kitap' });
  await migrateLegacyShelfFromLocalData();
  expect(await db.userBooks.count()).toBe(1);
  expect(await db.topicProgress.count()).toBe(2);
});

test('rafında zaten kitap varsa eski kitaplar taşınmaz', async () => {
  const custom = await addCustomBook({ title: 'Yeni Raf Kitabı', totalPages: 100 });
  const legacy = await createBook({ name: 'Taşınmayacak Eski Kitap' });

  await migrateLegacyShelfFromLocalData();

  const userBooks = await db.userBooks.toArray();
  expect(userBooks).toHaveLength(1);
  expect(userBooks[0].id).toBe(custom.id);
  expect(await db.userBooks.where('bookId').equals(legacy.id).count()).toBe(0);
  expect((await db.settings.get(LEGACY_SHELF_MIGRATED_KEY))?.value).toBe(true);
});

test('eski kitap yoksa da işareti yazar', async () => {
  await migrateLegacyShelfFromLocalData();

  expect(await db.userBooks.count()).toBe(0);
  expect((await db.settings.get(LEGACY_SHELF_MIGRATED_KEY))?.value).toBe(true);
});
