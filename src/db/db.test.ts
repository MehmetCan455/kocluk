import Dexie from 'dexie';
import { beforeEach, expect, test } from 'vitest';
import { newId } from '@/lib/id';
import { resetDb, seedOnboarded } from '@/test/fixtures';
import { db } from './db';
import {
  DEFAULT_SETTINGS,
  addCustomTopic,
  createBook,
  deleteCustomTopicCascade,
  deleteTopicBook,
  getSettings,
  listBooks,
  listSubjects,
  listTopicBooks,
  listTopics,
  patchSettings,
  renameTopic,
  seedCurriculum,
  upsertTopicBook,
} from './repositories';
import type { CurriculumSeed } from './seed';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const matSeed: CurriculumSeed = {
  version: 1,
  subjects: [
    {
      seedKey: 'tyt-mat',
      exam: 'TYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [{ seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 }],
    },
  ],
};

test('newId UUID üretir', () => {
  const first = newId();
  const second = newId();

  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(first).not.toBe(second);
});

test('şema tablolarını ve seedKey tekilliğini tanımlar', () => {  expect(db.tables.map((table) => table.name).sort()).toEqual([
    'attachments',
    'books',
    'examResults',
    'exams',
    'notes',
    'photoSearch',
    'photos',
    'practiceSessions',
    'scheduleEntries',
    'scheduleFiles',
    'scheduleTables',
    'settings',
    'subjects',
    'topicBooks',
    'topics',
  ]);
  expect(db.subjects.schema.indexes.find((index) => index.name === 'seedKey')?.unique).toBe(true);
  expect(db.topics.schema.indexes.find((index) => index.name === 'seedKey')?.unique).toBe(true);
  expect(db.photos.schema.indexes.map((index) => index.name)).not.toContain('mastered');
  expect(db.scheduleEntries.schema.indexes.map((index) => index.name)).toEqual([
    'day',
    'startTime',
    'updatedAt',
  ]);
  expect(db.scheduleFiles.schema.indexes.map((index) => index.name)).toEqual(['createdAt']);
  expect(db.scheduleTables.schema.primKey.name).toBe('id');
});

test('varsayılan ayarları döner ve yamayı saklar', async () => {
  expect(DEFAULT_SETTINGS).toEqual({
    profileName: '',
    accent: '#3B82F6',
    examDate: '2027-06-19',
    examName: 'YKS 2027',
    onboardingDone: false,
    schemaVersion: 1,
    seedVersion: 1,
    aytAlan: 'tumu',
    hiddenSubjects: [],
    geometryMode: 'separate',
    scheduleMode: 'manual',
  });
  expect(await getSettings()).toMatchObject(DEFAULT_SETTINGS);
  await patchSettings({ profileName: 'Deniz', aytAlan: 'sayisal' });
  expect(await getSettings()).toMatchObject({
    profileName: 'Deniz',
    aytAlan: 'sayisal',
    accent: '#3B82F6',
    onboardingDone: false,
  });
});

test('seed idempotenttir ve mevcut kaydı ezmez', async () => {
  await seedCurriculum(matSeed);
  const subject = await db.subjects.where('seedKey').equals('tyt-mat').first();
  const topic = await db.topics.where('seedKey').equals('tyt-mat-turev').first();

  await db.subjects.update(subject!.id, { name: 'Matematik (özel)' });
  await renameTopic(topic!.id, 'Türev (özel)');

  await seedCurriculum({ ...matSeed, version: 2 });

  expect(await db.subjects.count()).toBe(1);
  expect(await db.topics.count()).toBe(1);
  expect((await db.subjects.get(subject!.id))?.name).toBe('Matematik (özel)');
  expect((await db.topics.get(topic!.id))?.name).toBe('Türev (özel)');
  expect((await getSettings()).seedVersion).toBe(2);
});

test('seed sürümünü geriye düşürmez', async () => {
  await seedCurriculum({ ...matSeed, version: 3 });
  await seedCurriculum(matSeed);

  expect((await getSettings()).seedVersion).toBe(3);
});

test('seed eksik konuları ekler, mevcut konuya dokunmaz', async () => {
  await seedCurriculum(matSeed);
  const topic = await db.topics.where('seedKey').equals('tyt-mat-turev').first();

  await seedCurriculum({
    ...matSeed,
    version: 2,
    subjects: [
      {
        ...matSeed.subjects[0],
        topics: [...matSeed.subjects[0].topics, { seedKey: 'tyt-mat-integral', name: 'İntegral', order: 2 }],
      },
    ],
  });

  expect(await db.subjects.count()).toBe(1);
  expect(await db.topics.count()).toBe(2);
  expect((await db.topics.get(topic!.id))?.name).toBe('Türev');
  expect((await db.topics.where('seedKey').equals('tyt-mat-integral').first())?.subjectId).toBe(
    (await db.subjects.where('seedKey').equals('tyt-mat').first())?.id,
  );
});

test('özel konu silme bağlı verileri temizler, fotoğrafı korur', async () => {
  await seedCurriculum({
    version: 1,
    subjects: [
      {
        seedKey: 'tyt-mat',
        exam: 'TYT',
        name: 'Matematik',
        slug: 'matematik',
        icon: 'calculator',
        order: 1,
        topics: [],
      },
    ],
  });
  const subject = await db.subjects.toCollection().first();
  const topic = await addCustomTopic(subject!.id, 'Kendi konum');
  const book = await db.books.add({
    id: 'b1',
    name: 'Kitap',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.topicBooks.add({
    id: 'tb1',
    topicId: topic.id,
    bookId: book,
    totalTests: 5,
    solvedTests: 2,
    createdAt: '',
    updatedAt: '',
  });
  await db.notes.add({ topicId: topic.id, contentHtml: '<p>x</p>', plainText: 'x', updatedAt: '' });
  await db.attachments.add({
    id: 'a1',
    topicId: topic.id,
    name: 'x.png',
    mime: 'image/png',
    size: 1,
    blob: new Blob(['x']),
    createdAt: '',
  });
  await db.photos.add({
    id: 'p1',
    examType: 'TYT',
    subjectId: subject!.id,
    topicId: topic.id,
    note: '',
    blob: new Blob(['x']),
    thumbBlob: new Blob(['x']),
    width: 1,
    height: 1,
    mastered: false,
    practiceCount: 0,
    createdAt: '',
  });
  await db.photoSearch.put({
    id: 'p1',
    examType: 'TYT',
    subjectId: subject!.id,
    topicId: topic.id,
    note: '',
    mastered: false,
    createdAt: '',
  });

  expect(await listTopicBooks(topic.id)).toHaveLength(1);

  await deleteCustomTopicCascade(topic.id);

  expect(await db.topics.get(topic.id)).toBeUndefined();
  expect(await db.topicBooks.count()).toBe(0);
  expect(await db.notes.count()).toBe(0);
  expect(await db.attachments.count()).toBe(0);
  expect(await db.books.count()).toBe(1);
  expect((await db.photos.get('p1'))?.topicId).toBeUndefined();
  expect((await db.photoSearch.get('p1'))?.topicId).toBeUndefined();
});

test('seed konusu cascade silmede korunur', async () => {
  await seedCurriculum(matSeed);
  const subject = await db.subjects.where('seedKey').equals('tyt-mat').first();
  const topic = await db.topics.where('seedKey').equals('tyt-mat-turev').first();
  await db.topicBooks.add({
    id: 'tb1',
    topicId: topic!.id,
    bookId: 'b1',
    totalTests: 5,
    solvedTests: 2,
    createdAt: '',
    updatedAt: '',
  });
  await db.notes.add({ topicId: topic!.id, contentHtml: '<p>x</p>', plainText: 'x', updatedAt: '' });
  await db.attachments.add({
    id: 'a1',
    topicId: topic!.id,
    name: 'x.png',
    mime: 'image/png',
    size: 1,
    blob: new Blob(['x']),
    createdAt: '',
  });
  await db.photos.add({
    id: 'p1',
    examType: 'TYT',
    subjectId: subject!.id,
    topicId: topic!.id,
    note: '',
    blob: new Blob(['x']),
    thumbBlob: new Blob(['x']),
    width: 1,
    height: 1,
    mastered: false,
    practiceCount: 0,
    createdAt: '',
  });
  await db.photoSearch.put({
    id: 'p1',
    examType: 'TYT',
    subjectId: subject!.id,
    topicId: topic!.id,
    note: '',
    mastered: false,
    createdAt: '',
  });

  await deleteCustomTopicCascade(topic!.id);

  expect(await db.topics.get(topic!.id)).toBeDefined();
  expect(await db.topicBooks.count()).toBe(1);
  expect(await db.notes.count()).toBe(1);
  expect(await db.attachments.count()).toBe(1);
  expect((await db.photos.get('p1'))?.topicId).toBe(topic!.id);
  expect((await db.photoSearch.get('p1'))?.topicId).toBe(topic!.id);
});

test('özel konular seedKey olmadan eklenir, sıralanır ve yeniden adlandırılır', async () => {
  await seedCurriculum(matSeed);
  const subject = await db.subjects.where('seedKey').equals('tyt-mat').first();

  const first = await addCustomTopic(subject!.id, 'Kendi konum');
  const second = await addCustomTopic(subject!.id, 'İkinci konum');

  expect(first).toMatchObject({ subjectId: subject!.id, name: 'Kendi konum', order: 2, isCustom: true });
  expect(first.seedKey).toBeUndefined();
  expect(second.order).toBe(3);

  await renameTopic(first.id, 'Güncel ad');

  expect((await listTopics(subject!.id)).map((topic) => topic.name)).toEqual(['Türev', 'Güncel ad', 'İkinci konum']);
});

test('dersleri sıralar ve sınav türüne göre filtreler', async () => {
  await seedCurriculum({
    version: 1,
    subjects: [
      {
        seedKey: 'tyt-mat',
        exam: 'TYT',
        name: 'Matematik',
        slug: 'matematik',
        icon: 'calculator',
        order: 1,
        topics: [],
      },
      {
        seedKey: 'tyt-fiz',
        exam: 'TYT',
        name: 'Fizik',
        slug: 'fizik',
        icon: 'atom',
        order: 2,
        topics: [],
      },
      {
        seedKey: 'ayt-mat',
        exam: 'AYT',
        name: 'Matematik',
        slug: 'matematik',
        icon: 'calculator',
        order: 3,
        topics: [],
      },
    ],
  });

  expect((await listSubjects()).map((subject) => subject.seedKey)).toEqual(['tyt-mat', 'tyt-fiz', 'ayt-mat']);
  expect((await listSubjects('TYT')).map((subject) => subject.seedKey)).toEqual(['tyt-mat', 'tyt-fiz']);
  expect((await listSubjects('AYT')).map((subject) => subject.seedKey)).toEqual(['ayt-mat']);
});

test('resetDb tüm tabloları temizler', async () => {
  await seedCurriculum(matSeed);
  expect(await db.subjects.count()).toBe(1);
  expect(await db.settings.count()).toBe(1);

  await resetDb();

  expect(await db.subjects.count()).toBe(0);
  expect(await db.topics.count()).toBe(0);
  expect(await db.settings.count()).toBe(0);
});

async function seededSubjectAndTopic(): Promise<{ subjectId: string; topicId: string }> {
  await seedCurriculum(matSeed);
  const subject = await db.subjects.where('seedKey').equals('tyt-mat').first();
  const topic = await db.topics.where('seedKey').equals('tyt-mat-turev').first();
  if (!subject || !topic) {
    throw new Error('Test seed verisi hazırlanamadı');
  }
  return { subjectId: subject.id, topicId: topic.id };
}

test('kitap oluşturur, adı kırpar ve son güncellenen önce listelenir', async () => {
  const first = await createBook({ name: '  Matematik Soru Bankası  ', publisher: '  Palme  ' });

  expect(first).toMatchObject({ name: 'Matematik Soru Bankası', publisher: 'Palme' });
  expect(first.createdAt).toBeTruthy();
  expect(first.updatedAt).toBe(first.createdAt);

  await db.books.update(first.id, { updatedAt: '2020-01-01T00:00:00.000Z' });
  const second = await createBook({ name: 'Fizik Soru Bankası' });

  expect(second.publisher).toBeUndefined();
  expect((await listBooks()).map((book) => book.name)).toEqual([
    'Fizik Soru Bankası',
    'Matematik Soru Bankası',
  ]);

  await expect(createBook({ name: '   ' })).rejects.toThrow('Kitap adı boş olamaz');

  const duplicate = await createBook({ name: 'Fizik Soru Bankası' });
  expect(duplicate.id).not.toBe(second.id);
  expect(await db.books.where('name').equals('Fizik Soru Bankası').count()).toBe(2);
});

test('aynı kitap birden fazla konuya bağlanır, aynı konuda kayıt güncellenir', async () => {
  const { subjectId, topicId } = await seededSubjectAndTopic();
  const secondTopic = await addCustomTopic(subjectId, 'İkinci konu');
  const book = await createBook({ name: 'Ortak Kitap' });

  const firstRecord = await upsertTopicBook({
    topicId,
    bookId: book.id,
    totalTests: 10,
    solvedTests: 4,
  });
  const secondRecord = await upsertTopicBook({
    topicId: secondTopic.id,
    bookId: book.id,
    totalTests: 8,
    solvedTests: 8,
  });

  expect(firstRecord.id).not.toBe(secondRecord.id);
  expect(firstRecord).toMatchObject({ topicId, bookId: book.id, totalTests: 10, solvedTests: 4 });
  expect(await listTopicBooks(topicId)).toHaveLength(1);
  expect(await listTopicBooks(secondTopic.id)).toHaveLength(1);
  expect(await db.books.count()).toBe(1);

  const merged = await upsertTopicBook({
    topicId,
    bookId: book.id,
    totalTests: 12,
    solvedTests: 9,
  });

  expect(merged.id).toBe(firstRecord.id);
  expect(merged).toMatchObject({ totalTests: 12, solvedTests: 9 });
  expect(await listTopicBooks(topicId)).toHaveLength(1);
  expect(await db.topicBooks.count()).toBe(2);

  const edited = await upsertTopicBook({
    id: secondRecord.id,
    topicId: secondTopic.id,
    bookId: book.id,
    totalTests: 9,
    solvedTests: 3,
  });

  expect(edited.id).toBe(secondRecord.id);
  expect(edited).toMatchObject({ totalTests: 9, solvedTests: 3 });
  expect(await listTopicBooks(secondTopic.id)).toHaveLength(1);
});

test('test kaydı doğrulamaları Türkçe hata verir', async () => {
  const { topicId } = await seededSubjectAndTopic();
  const book = await createBook({ name: 'Doğrulama Kitabı' });
  const base = { topicId, bookId: book.id };

  await expect(
    upsertTopicBook({ ...base, totalTests: 5, solvedTests: 6 }),
  ).rejects.toThrow('Çözülen test sayısı toplamdan fazla olamaz');
  await expect(
    upsertTopicBook({ ...base, totalTests: 0, solvedTests: 0 }),
  ).rejects.toThrow('Toplam test sayısı en az 1 olmalı');
  await expect(
    upsertTopicBook({ ...base, totalTests: 2.5, solvedTests: 1 }),
  ).rejects.toThrow('Toplam test sayısı tam sayı olmalı');
  await expect(
    upsertTopicBook({ ...base, totalTests: 4, solvedTests: 1.5 }),
  ).rejects.toThrow('Çözülen test sayısı tam sayı olmalı');
  await expect(
    upsertTopicBook({ ...base, totalTests: 4, solvedTests: -1 }),
  ).rejects.toThrow('Çözülen test sayısı negatif olamaz');
  await expect(
    upsertTopicBook({ ...base, topicId: 'olmayan-konu', totalTests: 4, solvedTests: 1 }),
  ).rejects.toThrow('Konu bulunamadı');
  await expect(
    upsertTopicBook({ ...base, bookId: 'olmayan-kitap', totalTests: 4, solvedTests: 1 }),
  ).rejects.toThrow('Kitap bulunamadı');

  expect(await db.topicBooks.count()).toBe(0);
});

test('test kaydı silinir, kitap korunur', async () => {
  const { topicId } = await seededSubjectAndTopic();
  const book = await createBook({ name: 'Silme Kitabı' });
  const record = await upsertTopicBook({ topicId, bookId: book.id, totalTests: 6, solvedTests: 2 });

  await deleteTopicBook(record.id);

  expect(await listTopicBooks(topicId)).toHaveLength(0);
  expect(await db.books.get(book.id)).toBeDefined();
  expect((await listBooks()).map((item) => item.name)).toContain('Silme Kitabı');
});

test('resetDb temizler, seedOnboarded onboarding ayarını yazar', async () => {
  await seedCurriculum(matSeed);
  const subject = await db.subjects.where('seedKey').equals('tyt-mat').first();
  await addCustomTopic(subject!.id, 'Silinecek konu');
  expect(await db.topics.count()).toBe(2);

  await seedOnboarded(matSeed, { profileName: 'Deniz' });

  expect(await db.subjects.count()).toBe(1);
  expect(await db.topics.count()).toBe(1);
  expect(await getSettings()).toMatchObject({
    ...DEFAULT_SETTINGS,
    onboardingDone: true,
    profileName: 'Deniz',
  });
});

test('v2/v3 geçişi projeksiyon üretir, v4/v5 program ve çizelge tablolarını ekler', async () => {
  await db.close();
  await Dexie.delete('kocluk');

  const legacy = new Dexie('kocluk');
  legacy.version(1).stores({
    settings: 'key',
    subjects: 'id, &seedKey, exam, order',
    topics: 'id, &seedKey, subjectId, order',
    books: 'id, name, updatedAt',
    topicBooks: 'id, topicId, bookId',
    exams: 'id, type, date',
    examResults: 'id, examId, subjectId',
    photos: 'id, examId, subjectId, topicId, createdAt',
    notes: 'topicId',
    attachments: 'id, topicId',
    practiceSessions: 'id, createdAt, completedAt',
  });
  await legacy.open();

  const createdAt = '2026-11-01T10:00:00.000Z';
  await legacy.table('photos').add({
    id: 'eski-foto',
    examId: 'eski-deneme',
    examType: 'TYT',
    subjectId: 'eski-ders',
    topicId: 'eski-konu',
    note: 'Geçiş öncesi not',
    blob: new Blob(['tam'], { type: 'image/jpeg' }),
    thumbBlob: new Blob(['küçük'], { type: 'image/jpeg' }),
    width: 1600,
    height: 900,
    mastered: true,
    practiceCount: 3,
    createdAt,
  });
  legacy.close();

  await db.open();

  expect(await db.photoSearch.get('eski-foto')).toEqual({
    id: 'eski-foto',
    examId: 'eski-deneme',
    examType: 'TYT',
    subjectId: 'eski-ders',
    topicId: 'eski-konu',
    note: 'Geçiş öncesi not',
    mastered: true,
    createdAt,
  });
  const migrated = await db.photos.get('eski-foto');
  expect(migrated).toMatchObject({
    note: 'Geçiş öncesi not',
    mastered: true,
    practiceCount: 3,
  });
  // The test structured-clone shim preserves Blob bytes, matching a browser;
  // the migration must keep both blobs without re-encoding them.
  expect(migrated).toHaveProperty('blob');
  expect(migrated).toHaveProperty('thumbBlob');
  // v4/v5 are additive: the program and schedule table stores exist and the
  // old photo is untouched.
  expect(await db.scheduleEntries.count()).toBe(0);
  expect(await db.scheduleFiles.count()).toBe(0);
  expect(await db.scheduleTables.count()).toBe(0);
  expect(await db.photos.count()).toBe(1);
});

test('v5 geçişi eski program kayıtlarını ve dosyalarını korur', async () => {
  await db.close();
  await Dexie.delete('kocluk');

  const legacy = new Dexie('kocluk');
  legacy.version(1).stores({
    settings: 'key',
    subjects: 'id, &seedKey, exam, order',
    topics: 'id, &seedKey, subjectId, order',
    books: 'id, name, updatedAt',
    topicBooks: 'id, topicId, bookId',
    exams: 'id, type, date',
    examResults: 'id, examId, subjectId',
    photos: 'id, examId, subjectId, topicId, createdAt',
    notes: 'topicId',
    attachments: 'id, topicId',
    practiceSessions: 'id, createdAt, completedAt',
  });
  legacy.version(4).stores({
    scheduleEntries: 'id, day, startTime, updatedAt',
    scheduleFiles: 'id, createdAt',
  });
  await legacy.open();

  await legacy.table('scheduleEntries').add({
    id: 'eski-program-kaydi',
    day: 2,
    startTime: '09:00',
    endTime: '10:00',
    title: 'Eski program kaydı',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  });
  await legacy.table('scheduleFiles').add({
    id: 'eski-program-dosyasi',
    name: 'eski-program.pdf',
    mime: 'application/pdf',
    size: 5,
    blob: new Blob(['%PDF'], { type: 'application/pdf' }),
    createdAt: '2026-11-01T10:01:00.000Z',
  });
  legacy.close();

  await db.open();

  expect(await db.scheduleEntries.get('eski-program-kaydi')).toMatchObject({
    day: 2,
    title: 'Eski program kaydı',
  });
  expect(await db.scheduleFiles.get('eski-program-dosyasi')).toMatchObject({
    name: 'eski-program.pdf',
    mime: 'application/pdf',
  });
  expect(await db.scheduleTables.count()).toBe(0);
});
