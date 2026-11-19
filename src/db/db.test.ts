import { beforeEach, expect, test } from 'vitest';
import { newId } from '@/lib/id';
import { resetDb, seedOnboarded } from '@/test/fixtures';
import { db } from './db';
import {
  DEFAULT_SETTINGS,
  addCustomTopic,
  deleteCustomTopicCascade,
  getSettings,
  listSubjects,
  listTopicBooks,
  listTopics,
  patchSettings,
  renameTopic,
  seedCurriculum,
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

test('şema v1 tablolarını ve seedKey tekilliğini tanımlar', () => {
  expect(db.tables.map((table) => table.name).sort()).toEqual([
    'attachments',
    'books',
    'examResults',
    'exams',
    'notes',
    'photos',
    'practiceSessions',
    'settings',
    'subjects',
    'topicBooks',
    'topics',
  ]);
  expect(db.subjects.schema.indexes.find((index) => index.name === 'seedKey')?.unique).toBe(true);
  expect(db.topics.schema.indexes.find((index) => index.name === 'seedKey')?.unique).toBe(true);
  expect(db.photos.schema.indexes.map((index) => index.name)).not.toContain('mastered');
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

  expect(await listTopicBooks(topic.id)).toHaveLength(1);

  await deleteCustomTopicCascade(topic.id);

  expect(await db.topics.get(topic.id)).toBeUndefined();
  expect(await db.topicBooks.count()).toBe(0);
  expect(await db.notes.count()).toBe(0);
  expect(await db.attachments.count()).toBe(0);
  expect(await db.books.count()).toBe(1);
  expect((await db.photos.get('p1'))?.topicId).toBeUndefined();
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

  await deleteCustomTopicCascade(topic!.id);

  expect(await db.topics.get(topic!.id)).toBeDefined();
  expect(await db.topicBooks.count()).toBe(1);
  expect(await db.notes.count()).toBe(1);
  expect(await db.attachments.count()).toBe(1);
  expect((await db.photos.get('p1'))?.topicId).toBe(topic!.id);
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
