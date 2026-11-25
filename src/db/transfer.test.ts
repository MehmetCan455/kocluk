import Dexie from 'dexie';
import { afterEach, expect, test, vi } from 'vitest';
import type { KoclukDB } from './db';
import { LEGACY_DB_NAME, closeActiveDb, openUserDb } from './dbManager';
import { getMeta } from './sync/meta';
import { whenQueueIdle } from './sync/queue';
import {
  TRANSFER_DONE_KEY,
  fetchCloudHasData,
  hasLegacyData,
  transferDecision,
  transferLegacyData,
  type TransferSummary,
} from './transfer';
import { installMockApi } from '@/test/mockApi';

const openedUsers: string[] = [];
const openedLegacy: KoclukDB[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await closeActiveDb();
  for (const database of openedLegacy.splice(0)) {
    if (database.isOpen()) {
      database.close();
    }
  }
  for (const name of openedUsers.splice(0)) {
    await Dexie.delete(name);
  }
  await Dexie.delete(LEGACY_DB_NAME);
});

async function openLegacy(): Promise<KoclukDB> {
  const { KoclukDB } = await import('./db');
  const database = new KoclukDB(LEGACY_DB_NAME);
  await database.open();
  openedLegacy.push(database);
  return database;
}

async function openUser(userId: string): Promise<KoclukDB> {
  const database = await openUserDb(userId);
  openedUsers.push(database.name);
  return database;
}

const now = '2026-11-20T10:00:00.000Z';

async function seedLegacyData(): Promise<void> {
  const legacy = await openLegacy();
  await legacy.subjects.add({
    id: 'legacy-mat',
    seedKey: 'tyt-matematik',
    exam: 'TYT',
    name: 'Matematik',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
    updatedAt: now,
  });
  await legacy.topics.add({
    id: 'legacy-topic',
    seedKey: 'tyt-matematik-temel',
    subjectId: 'legacy-mat',
    name: 'Temel Kavramlar',
    order: 1,
    isCustom: false,
    createdAt: now,
    updatedAt: now,
  });
  await legacy.exams.add({
    id: 'legacy-exam',
    type: 'TYT',
    name: 'TYT Deneme 1',
    date: '2026-11-18',
    kind: 'full',
    note: '',
    createdAt: now,
    updatedAt: now,
  });
  await legacy.examResults.add({
    id: 'legacy-result',
    examId: 'legacy-exam',
    subjectId: 'legacy-mat',
    correct: 20,
    wrong: 5,
    blank: 0,
    net: 18.75,
    updatedAt: now,
  });
  await legacy.notes.add({
    topicId: 'legacy-topic',
    contentHtml: '<p>Kalıcı not</p>',
    plainText: 'Kalıcı not',
    updatedAt: now,
  });
  await legacy.photos.add({
    id: 'legacy-photo',
    examType: 'TYT',
    subjectId: 'legacy-mat',
    topicId: 'legacy-topic',
    note: 'Yanlış soru',
    blob: new Blob(['büyük'], { type: 'image/jpeg' }),
    thumbBlob: new Blob(['küçük'], { type: 'image/jpeg' }),
    width: 100,
    height: 80,
    mastered: false,
    practiceCount: 0,
    createdAt: now,
  });
  await legacy.attachments.add({
    id: 'legacy-attachment',
    topicId: 'legacy-topic',
    name: 'konu.pdf',
    mime: 'application/pdf',
    size: 3,
    blob: new Blob(['pdf'], { type: 'application/pdf' }),
    createdAt: now,
  });
  await legacy.books.add({
    id: 'legacy-book',
    name: 'Eski Kitap',
    publisher: 'Yayın',
    createdAt: now,
    updatedAt: now,
  });
  await legacy.topicBooks.add({
    id: 'legacy-topic-book',
    topicId: 'legacy-topic',
    bookId: 'legacy-book',
    totalTests: 10,
    solvedTests: 10,
    createdAt: now,
    updatedAt: now,
  });
  await legacy.settings.bulkPut([
    { key: 'profileName', value: 'Eski Kullanıcı' },
    { key: 'onboardingDone', value: true },
  ]);
  legacy.close();
}

function summaryTotal(summary: TransferSummary): number {
  return summary.total;
}

test('eski veriyi kimlikleri koruyarak hesap veritabanına kopyalar, eski DB yi silmez', async () => {
  await seedLegacyData();
  const target = await openUser('transfer-copy');

  const summary = await transferLegacyData('transfer-copy');

  expect(await target.subjects.get('legacy-mat')).toMatchObject({
    name: 'Matematik',
    seedKey: 'tyt-matematik',
  });
  expect(await target.topics.get('legacy-topic')).toMatchObject({
    subjectId: 'legacy-mat',
    name: 'Temel Kavramlar',
  });
  expect(await target.exams.get('legacy-exam')).toMatchObject({ name: 'TYT Deneme 1' });
  expect(await target.examResults.get('legacy-result')).toMatchObject({ correct: 20 });
  expect(await target.notes.get('legacy-topic')).toMatchObject({
    plainText: 'Kalıcı not',
  });
  expect(await target.photos.get('legacy-photo')).toMatchObject({ note: 'Yanlış soru' });
  expect((await target.photos.get('legacy-photo'))?.blob).toBeInstanceOf(Blob);
  expect(await target.attachments.get('legacy-attachment')).toMatchObject({
    name: 'konu.pdf',
  });
  expect(await target.books.get('legacy-book')).toMatchObject({ name: 'Eski Kitap' });
  // Pre-v6 book data is converted to the page-based shelf.
  expect(await target.userBooks.count()).toBe(1);

  expect(summary.photos).toBe(1);
  expect(summary.attachments).toBe(1);
  expect(summary.notes).toBe(1);
  expect(summary.exams).toBe(1);
  expect(summaryTotal(summary)).toBeGreaterThan(0);

  // The synced rows reach the push queue; photos/attachments never do.
  await whenQueueIdle();
  expect(await target.syncQueue.get('subjects:legacy-mat')).toMatchObject({
    status: 'pending',
  });
  expect(await target.syncQueue.get('notes:legacy-topic')).toMatchObject({
    status: 'pending',
  });
  expect(await target.syncQueue.get('photos:legacy-photo')).toBeUndefined();
  expect(await target.syncQueue.get('attachments:legacy-attachment')).toBeUndefined();
  expect(await target.syncQueue.get('books:legacy-book')).toBeUndefined();

  expect(await getMeta(target, 'initialPullDone')).toBe(true);
  expect(await getMeta(target, TRANSFER_DONE_KEY)).toBe(true);

  // The old database and its rows are untouched.
  const legacy = await openLegacy();
  expect(await legacy.subjects.count()).toBe(1);
  expect(await legacy.exams.count()).toBe(1);
  expect(await legacy.photos.count()).toBe(1);
  expect(await legacy.notes.count()).toBe(1);
});

test('taşıma iki kez çalıştırılabilir; duplicate oluşmaz', async () => {
  await seedLegacyData();
  const target = await openUser('transfer-twice');

  const progress: Array<[number, number]> = [];
  const first = await transferLegacyData('transfer-twice', (done, total) => {
    progress.push([done, total]);
  });
  const counts = {
    subjects: await target.subjects.count(),
    topics: await target.topics.count(),
    exams: await target.exams.count(),
    examResults: await target.examResults.count(),
    notes: await target.notes.count(),
    photos: await target.photos.count(),
    books: await target.books.count(),
    topicBooks: await target.topicBooks.count(),
    userBooks: await target.userBooks.count(),
  };

  const second = await transferLegacyData('transfer-twice');

  expect(second.total).toBe(first.total);
  expect(progress.at(-1)?.[0]).toBe(progress.at(-1)?.[1]);
  expect(await target.subjects.count()).toBe(counts.subjects);
  expect(await target.topics.count()).toBe(counts.topics);
  expect(await target.exams.count()).toBe(counts.exams);
  expect(await target.examResults.count()).toBe(counts.examResults);
  expect(await target.notes.count()).toBe(counts.notes);
  expect(await target.photos.count()).toBe(counts.photos);
  expect(await target.books.count()).toBe(counts.books);
  expect(await target.topicBooks.count()).toBe(counts.topicBooks);
  expect(await target.userBooks.count()).toBe(counts.userBooks);
  await whenQueueIdle();
  expect(await target.syncQueue.count()).toBe(
    await target.syncQueue.where('status').equals('pending').count(),
  );
});

test('aynı seedKey farklı kimlikle varsa tohum satırı çoğaltmadan değiştirir', async () => {
  const target = await openUser('transfer-seed');
  await target.subjects.put({
    id: 'new-seed-subject',
    seedKey: 'tyt-matematik',
    exam: 'TYT',
    name: 'Matematik',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
    updatedAt: now,
  });
  await target.topics.put({
    id: 'new-seed-topic',
    seedKey: 'tyt-matematik-temel',
    subjectId: 'new-seed-subject',
    name: 'Temel Kavramlar',
    order: 1,
    isCustom: false,
    createdAt: now,
    updatedAt: now,
  });

  await seedLegacyData();
  await transferLegacyData('transfer-seed');

  expect(await target.subjects.get('legacy-mat')).toBeDefined();
  expect(await target.subjects.get('new-seed-subject')).toBeUndefined();
  expect(await target.topics.get('legacy-topic')).toBeDefined();
  expect(await target.topics.get('new-seed-topic')).toBeUndefined();
  expect(await target.subjects.where('seedKey').equals('tyt-matematik').count()).toBe(1);
  expect(
    await target.topics.where('seedKey').equals('tyt-matematik-temel').count(),
  ).toBe(1);
});

test('tohum ders değişirken kullanıcının oluşturduğu konu korunur', async () => {
  const target = await openUser('transfer-custom-topic');
  await target.subjects.put({
    id: 'new-seed-subject',
    seedKey: 'tyt-matematik',
    exam: 'TYT',
    name: 'Matematik',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
    updatedAt: now,
  });
  await target.topics.put({
    id: 'custom-topic',
    subjectId: 'new-seed-subject',
    name: 'Kendi Konum',
    order: 1,
    isCustom: true,
    createdAt: now,
    updatedAt: now,
  });

  await seedLegacyData();
  await transferLegacyData('transfer-custom-topic');

  expect(await target.topics.get('custom-topic')).toMatchObject({
    subjectId: 'legacy-mat',
    name: 'Kendi Konum',
    isCustom: true,
  });
  await whenQueueIdle();
  expect(await target.syncQueue.get('topics:custom-topic')).toMatchObject({
    status: 'pending',
  });
});

test('bulut doluysa taşıma önerilmez; durum bilinmiyorsa engellenir', () => {
  expect(transferDecision(true, true)).toBe('cloud-full');
  expect(transferDecision(true, false)).toBe('offer');
  expect(transferDecision(false, false)).toBe('none');
  expect(transferDecision(false, true)).toBe('none');
  expect(transferDecision(true, null)).toBe('unavailable');
});

test('okunamayan durum yanıtı taşıma kapısını güvenli tarafa çeker', async () => {
  const mock = installMockApi({
    'GET /api/sync/status': { body: { counts: {} } },
  });

  await expect(fetchCloudHasData()).rejects.toThrow('Senkron durumu okunamadı.');

  mock.restore();
});

test('hasLegacyData yalnızca anlamlı eski veriyi true sayar', async () => {
  expect(await hasLegacyData()).toBe(false);

  const legacy = await openLegacy();
  await legacy.subjects.add({
    id: 'seed-only',
    seedKey: 'tyt-matematik',
    exam: 'TYT',
    name: 'Matematik',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
  });
  expect(await hasLegacyData()).toBe(false);

  await legacy.exams.add({
    id: 'meaningful-exam',
    type: 'TYT',
    name: 'Deneme',
    date: '2026-11-18',
    note: '',
    createdAt: now,
    updatedAt: now,
  });
  expect(await hasLegacyData()).toBe(true);
});

test('fotoğraf ve ekler yerel kalır; taşıma sunucuya istek atmaz', async () => {
  await seedLegacyData();
  await openUser('transfer-no-upload');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  await transferLegacyData('transfer-no-upload');
  await whenQueueIdle();

  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
