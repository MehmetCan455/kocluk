import Dexie from 'dexie';
import { afterEach, expect, test, vi } from 'vitest';
import type { KoclukDB } from './db';
import { LEGACY_DB_NAME, closeActiveDb, openUserDb } from './dbManager';
import { getMeta } from './sync/meta';
import { whenQueueIdle } from './sync/queue';
import { addRow, addTask, getOrCreateWeek, saveWeekNote } from './scheduleRepository';
import {
  LocalDataTransferBlockedError,
  TRANSFER_DONE_KEY,
  fetchCloudHasUserData,
  hasLegacyData,
  localUserDataSummary,
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

test('tamamlanan taşıma ikinci kez reddedilir; hedef veri değişmez', async () => {
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

  await expect(transferLegacyData('transfer-twice')).rejects.toBeInstanceOf(
    LocalDataTransferBlockedError,
  );

  expect(progress.at(-1)?.[0]).toBe(progress.at(-1)?.[1]);
  expect(first.total).toBeGreaterThan(0);
  expect(await target.subjects.count()).toBe(counts.subjects);
  expect(await target.topics.count()).toBe(counts.topics);
  expect(await target.exams.count()).toBe(counts.exams);
  expect(await target.examResults.count()).toBe(counts.examResults);
  expect(await target.notes.count()).toBe(counts.notes);
  expect(await target.photos.count()).toBe(counts.photos);
  expect(await target.books.count()).toBe(counts.books);
  expect(await target.topicBooks.count()).toBe(counts.topicBooks);
  expect(await target.userBooks.count()).toBe(counts.userBooks);
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

test('kullanıcı verisi olan yerel hesapta taşıma reddedilir ve hedef değişmez', async () => {
  const target = await openUser('transfer-used');
  await target.exams.add({
    id: 'local-exam',
    type: 'TYT',
    name: 'Yerel Deneme',
    date: '2026-11-18',
    kind: 'full',
    note: '',
    createdAt: now,
    updatedAt: now,
  });
  await target.notes.add({
    topicId: 'local-topic',
    contentHtml: '<p>Yerel not</p>',
    plainText: 'Yerel not',
    updatedAt: now,
  });

  await seedLegacyData();
  const summary = await localUserDataSummary(target);
  expect(summary.hasUserData).toBe(true);

  await expect(transferLegacyData('transfer-used')).rejects.toBeInstanceOf(
    LocalDataTransferBlockedError,
  );

  expect(await target.exams.get('local-exam')).toBeDefined();
  expect(await target.notes.get('local-topic')).toBeDefined();
  expect(await target.subjects.count()).toBe(0);
  expect(await target.topics.count()).toBe(0);
  expect(await target.books.count()).toBe(0);
  expect(await target.photos.count()).toBe(0);
});

test('özel konu da kullanıcı verisi sayılır ve taşıma reddedilir', async () => {
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

  await expect(transferLegacyData('transfer-custom-topic')).rejects.toBeInstanceOf(
    LocalDataTransferBlockedError,
  );

  expect(await target.topics.get('custom-topic')).toMatchObject({
    subjectId: 'new-seed-subject',
    name: 'Kendi Konum',
    isCustom: true,
  });
  expect(await target.subjects.get('legacy-mat')).toBeUndefined();
});

test('taze hesapta tüm bağımlı referanslar yeni tohum kimliklerine çevrilir', async () => {
  const target = await openUser('transfer-remap');
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
  await target.topics.bulkPut([
    {
      id: 'new-seed-topic',
      seedKey: 'tyt-matematik-temel',
      subjectId: 'new-seed-subject',
      name: 'Temel Kavramlar',
      order: 1,
      isCustom: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'new-seed-topic-2',
      seedKey: 'tyt-matematik-ikinci',
      subjectId: 'new-seed-subject',
      name: 'İkinci Konu',
      order: 2,
      isCustom: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await target.settings.put({
    key: 'hiddenSubjects',
    value: ['new-seed-subject'],
  });

  await seedLegacyData();
  const legacy = await openLegacy();
  await legacy.topics.add({
    id: 'legacy-topic-2',
    seedKey: 'tyt-matematik-ikinci',
    subjectId: 'legacy-mat',
    name: 'İkinci Konu',
    order: 2,
    isCustom: false,
    createdAt: now,
    updatedAt: now,
  });
  await legacy.notes.add({
    topicId: 'new-seed-topic-2',
    contentHtml: '<p>Taşınan not</p>',
    plainText: 'Taşınan not',
    updatedAt: now,
  });
  await legacy.examResults.add({
    id: 'ref-result',
    examId: 'legacy-exam',
    subjectId: 'new-seed-subject',
    correct: 10,
    wrong: 2,
    blank: 0,
    net: 9.5,
    updatedAt: now,
  });
  await legacy.activityLogs.add({
    id: 'ref-log',
    type: 'topic_review',
    topicId: 'new-seed-topic-2',
    source: 'manual',
    createdAt: now,
  });
  await legacy.scheduleWeeks.add({
    id: 'legacy-week',
    weekStart: '2026-11-16',
    note: '',
    createdAt: now,
    updatedAt: now,
  });
  await legacy.scheduleRows.add({
    id: 'legacy-row',
    weekId: 'legacy-week',
    subjectId: 'new-seed-subject',
    label: 'Matematik',
    order: 1,
    createdAt: now,
    updatedAt: now,
  });
  await legacy.scheduleTasks.add({
    id: 'legacy-task',
    weekId: 'legacy-week',
    rowId: 'legacy-row',
    dayIndex: 1,
    type: 'free',
    topicId: 'new-seed-topic-2',
    title: 'Görev',
    createdAt: now,
    updatedAt: now,
  });
  await legacy.photos.add({
    id: 'ref-photo',
    examType: 'TYT',
    subjectId: 'new-seed-subject',
    topicId: 'new-seed-topic-2',
    note: 'Taşınan fotoğraf',
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    thumbBlob: new Blob(['t'], { type: 'image/jpeg' }),
    width: 10,
    height: 10,
    mastered: false,
    practiceCount: 0,
    createdAt: now,
  });
  await legacy.attachments.add({
    id: 'ref-attachment',
    topicId: 'new-seed-topic-2',
    name: 'ek.pdf',
    mime: 'application/pdf',
    size: 1,
    blob: new Blob(['p'], { type: 'application/pdf' }),
    createdAt: now,
  });
  await legacy.practiceSessions.add({
    id: 'ref-session',
    createdAt: now,
    updatedAt: now,
    filters: {
      subjectIds: ['new-seed-subject'],
      topicIds: ['new-seed-topic-2'],
      count: 1,
    },
    photoIds: [],
    results: {},
  });
  await legacy.scheduleEntries.add({
    id: 'ref-entry',
    day: 1,
    startTime: '09:00',
    endTime: '10:00',
    title: 'Ders',
    subjectId: 'new-seed-subject',
    createdAt: now,
    updatedAt: now,
  });
  await legacy.topicProgress.add({
    id: 'ref-progress',
    topicId: 'new-seed-topic-2',
    done: true,
    doneAt: now,
    updatedAt: now,
  });
  await legacy.settings.put({
    key: 'hiddenSubjects',
    value: ['new-seed-subject'],
  });
  legacy.close();

  await transferLegacyData('transfer-remap');

  expect(await target.subjects.get('new-seed-subject')).toBeUndefined();
  expect(await target.topics.get('new-seed-topic')).toBeUndefined();
  expect(await target.topics.get('new-seed-topic-2')).toBeUndefined();
  expect(await target.notes.get('legacy-topic-2')).toMatchObject({
    topicId: 'legacy-topic-2',
    plainText: 'Taşınan not',
  });
  expect(await target.notes.get('new-seed-topic-2')).toBeUndefined();
  expect(await target.examResults.get('ref-result')).toMatchObject({
    subjectId: 'legacy-mat',
  });
  expect(await target.activityLogs.get('ref-log')).toMatchObject({
    topicId: 'legacy-topic-2',
  });
  expect(await target.scheduleRows.get('legacy-row')).toMatchObject({
    subjectId: 'legacy-mat',
  });
  expect(await target.scheduleTasks.get('legacy-task')).toMatchObject({
    topicId: 'legacy-topic-2',
  });
  expect(await target.photos.get('ref-photo')).toMatchObject({
    subjectId: 'legacy-mat',
    topicId: 'legacy-topic-2',
  });
  expect(await target.photoSearch.get('ref-photo')).toMatchObject({
    subjectId: 'legacy-mat',
    topicId: 'legacy-topic-2',
  });
  expect(await target.attachments.get('ref-attachment')).toMatchObject({
    topicId: 'legacy-topic-2',
  });
  expect(await target.practiceSessions.get('ref-session')).toMatchObject({
    filters: { subjectIds: ['legacy-mat'], topicIds: ['legacy-topic-2'] },
  });
  expect(await target.scheduleEntries.get('ref-entry')).toMatchObject({
    subjectId: 'legacy-mat',
  });
  expect(await target.topicProgress.get('ref-progress')).toMatchObject({
    topicId: 'legacy-topic-2',
    done: true,
  });
  expect((await target.settings.get('hiddenSubjects'))?.value).toEqual(['legacy-mat']);
});

test('eksik ebeveyne bağlı alt kayıtlar yetim bırakılmaz', async () => {
  const target = await openUser('transfer-orphans');
  const legacy = await openLegacy();
  await legacy.notes.add({
    topicId: 'missing-topic',
    contentHtml: '<p>Yetim</p>',
    plainText: 'Yetim',
    updatedAt: now,
  });
  await legacy.activityLogs.add({
    id: 'orphan-log',
    type: 'book_pages',
    userBookId: 'missing-book',
    source: 'manual',
    createdAt: now,
  });
  await legacy.scheduleTasks.add({
    id: 'orphan-task',
    weekId: 'missing-week',
    rowId: 'missing-row',
    dayIndex: 1,
    type: 'free',
    title: 'Yetim görev',
    createdAt: now,
    updatedAt: now,
  });
  legacy.close();

  const summary = await transferLegacyData('transfer-orphans');

  expect(await target.notes.count()).toBe(0);
  expect(await target.activityLogs.count()).toBe(0);
  expect(await target.scheduleTasks.count()).toBe(0);
  expect(summary.skipped).toBe(3);
});

test('boş plan haftası kullanıcı verisi sayılmaz ve taşımayı engellemez', async () => {
  const target = await openUser('transfer-empty-week');

  const week = await getOrCreateWeek('2026-11-16');

  expect(week.week.id).toBeTruthy();
  expect(await target.scheduleWeeks.count()).toBe(1);
  expect((await localUserDataSummary(target)).hasUserData).toBe(false);

  await seedLegacyData();
  const summary = await transferLegacyData('transfer-empty-week');

  expect(summary.total).toBeGreaterThan(0);
  expect(await target.subjects.get('legacy-mat')).toBeDefined();
});

test('plan notu veya satırı olan hafta kullanıcı verisi sayılır', async () => {
  const withNote = await openUser('transfer-week-note');
  const noteWeek = await getOrCreateWeek('2026-11-16');
  await saveWeekNote(noteWeek.week.id, 'Plan notu');
  expect((await localUserDataSummary(withNote)).hasUserData).toBe(true);

  const withRow = await openUser('transfer-week-row');
  const rowWeek = await getOrCreateWeek('2026-11-23');
  await addRow(rowWeek.week.id, 'Matematik');
  expect((await localUserDataSummary(withRow)).hasUserData).toBe(true);

  const withTask = await openUser('transfer-week-task');
  const taskWeek = await getOrCreateWeek('2026-11-30');
  const row = await addRow(taskWeek.week.id, 'Fizik');
  await addTask({
    weekId: taskWeek.week.id,
    rowId: row.id,
    dayIndex: 1,
    type: 'free',
    title: 'Görev',
  });
  // Keep only the task live; it still makes the week user content.
  await withTask.scheduleRows.update(row.id, { deletedAt: now });
  expect((await localUserDataSummary(withTask)).hasUserData).toBe(true);

  await seedLegacyData();
  await expect(transferLegacyData('transfer-week-task')).rejects.toBeInstanceOf(
    LocalDataTransferBlockedError,
  );
});

test('silinmiş not, deneme ve hafta yerel taşımayı engellemez', async () => {
  const target = await openUser('transfer-tombstones');

  await target.notes.add({
    topicId: 'deleted-topic',
    contentHtml: '',
    plainText: '',
    updatedAt: now,
    deletedAt: now,
  });
  await target.exams.add({
    id: 'deleted-exam',
    type: 'TYT',
    name: 'Silinmiş Deneme',
    date: '2026-11-18',
    kind: 'full',
    note: '',
    createdAt: now,
    updatedAt: now,
    deletedAt: now,
  });
  const week = await getOrCreateWeek('2026-11-16');
  await saveWeekNote(week.week.id, 'Eski plan');
  await target.scheduleWeeks.update(week.week.id, { deletedAt: now });

  expect((await localUserDataSummary(target)).hasUserData).toBe(false);

  await seedLegacyData();
  const summary = await transferLegacyData('transfer-tombstones');

  expect(summary.total).toBeGreaterThan(0);
  expect(await target.notes.get('deleted-topic')).toMatchObject({ deletedAt: now });
  expect(await target.exams.get('deleted-exam')).toMatchObject({ deletedAt: now });
});

test('bulut kullanıcı verisi doluysa taşıma önerilmez; durum bilinmiyorsa engellenir', () => {
  expect(transferDecision(true, true, false)).toBe('cloud-full');
  expect(transferDecision(true, false, false)).toBe('offer');
  expect(transferDecision(false, false, false)).toBe('none');
  expect(transferDecision(false, true, false)).toBe('none');
  expect(transferDecision(true, null, false)).toBe('unavailable');
  expect(transferDecision(true, false, true)).toBe('local-full');
  expect(transferDecision(true, true, true)).toBe('local-full');
});

test('okunamayan durum yanıtı taşıma kapısını güvenli tarafa çeker', async () => {
  const mock = installMockApi({
    'GET /api/sync/status': { body: { counts: {}, hasData: false } },
  });

  await expect(fetchCloudHasUserData()).rejects.toThrow('Senkron durumu okunamadı.');

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
