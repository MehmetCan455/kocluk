import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { addCustomBook } from '@/db/bookRepositories';
import { db } from '@/db/db';
import { createBook, saveExam, saveNote } from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import type { CatalogBook, Exam, Subject, Topic, UserBook } from '@/domain/types';
import { newId } from '@/lib/id';
import { normalizeTr } from '@/lib/normalize';
import { seedOnboarded } from '@/test/fixtures';
import { searchAll, SEARCH_RESULT_LIMIT } from './searchAll';

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
        { seedKey: 'tyt-mat-turev-uygulama', name: 'Türev Uygulamaları', order: 2 },
        { seedKey: 'tyt-mat-pol', name: 'Polinomlar', order: 3 },
      ],
    },
    {
      seedKey: 'ayt-mat',
      exam: 'AYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [{ seedKey: 'ayt-mat-integral', name: 'İntegral', order: 1 }],
    },
    {
      seedKey: 'tyt-fiz',
      exam: 'TYT',
      name: 'Fizik',
      slug: 'fen',
      icon: 'atom',
      order: 2,
      topics: [],
    },
  ],
};

let turevSubject: Subject;
let turevTopic: Topic;
let turevBook: UserBook;
let turevCatalogBook: CatalogBook;
let fizikBook: UserBook;
let turevExam: Exam;

beforeEach(async () => {
  // Fixture seedVersion'ı güncel tutar; SettingsProvider tam müfredatı yüklemez.
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });

  const topic = await db.topics.where('seedKey').equals('tyt-mat-turev').first();
  if (!topic) {
    throw new Error('Türev konusu bulunamadı');
  }
  const subject = await db.subjects.get(topic.subjectId);
  if (!subject) {
    throw new Error('Matematik dersi bulunamadı');
  }
  turevTopic = topic;
  turevSubject = subject;

  await saveNote(
    topic.id,
    '<p>Türev konu anlatımı</p><p>Uygulama soruları</p>',
    '',
  );
  turevBook = await addCustomBook({
    title: 'Türev Soru Bankası',
    publisher: 'Karekök',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 240,
  });
  const catalogBook = await db.catalogBooks.get(turevBook.bookId);
  if (!catalogBook) {
    throw new Error('Türev kitabının katalog kaydı bulunamadı');
  }
  turevCatalogBook = catalogBook;

  fizikBook = await addCustomBook({
    title: 'Soru Bankası',
    publisher: 'Palme',
    exam: 'TYT',
    subjectSlug: 'fen',
    totalPages: 320,
  });

  // Eski kitaplar yalnızca `books` tablosunda durur; aramada görünmemelidir.
  await createBook({ name: 'Eski Kitap', publisher: 'Eski Yayınevi' });

  turevExam = await saveExam({
    type: 'TYT',
    name: 'Türev Tarama',
    date: '2026-11-10',
    note: 'Türev konularını kapsar',
    results: [],
  });
});

test('normalizeTr Türkçe büyük/küçük harfi ve boşlukları normalize eder', () => {
  expect(normalizeTr('İSTANBUL')).toBe('istanbul');
  expect(normalizeTr('Iğdır')).toBe('ığdır');
  expect(normalizeTr('  Türev   Uygulamaları \n ')).toBe('türev uygulamaları');
});

test('türev araması konu, not, kitap ve deneme sonuçlarını döndürür', async () => {
  const results = await searchAll('türev');

  const topics = results.filter((result) => result.kind === 'topic');
  expect(topics.map((result) => result.title)).toEqual(['Türev', 'Türev Uygulamaları']);
  expect(topics[0]).toMatchObject({
    id: turevTopic.id,
    subtitle: 'Matematik · TYT',
    href: `/tyt/${turevSubject.id}/${turevTopic.id}`,
  });

  const notes = results.filter((result) => result.kind === 'note');
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({
    id: turevTopic.id,
    subtitle: 'Türev · Matematik',
    href: `/tyt/${turevSubject.id}/${turevTopic.id}`,
  });
  expect(notes[0].title).toContain('Türev konu anlatımı');

  const books = results.filter((result) => result.kind === 'book');
  expect(books).toHaveLength(1);
  expect(books[0]).toMatchObject({
    id: turevBook.id,
    title: 'Türev Soru Bankası',
    subtitle: 'Karekök · Matematik',
    href: `/kitaplar/${turevBook.id}`,
  });
  // Bağlantı raf kaydını kullanır, katalog kaydını değil.
  expect(turevBook.id).not.toBe(turevCatalogBook.id);

  const exams = results.filter((result) => result.kind === 'exam');
  expect(exams).toHaveLength(1);
  expect(exams[0]).toMatchObject({
    id: turevExam.id,
    title: 'Türev Tarama',
    href: `/denemeler/${turevExam.id}`,
  });
  expect(exams[0].subtitle).toContain('TYT');

  expect(results.some((result) => result.kind === 'photo')).toBe(false);
});

test('çok kelimeli arama sıradan bağımsızdır ve not bloklarını aşar', async () => {
  const results = await searchAll('UYGULAMA türev');

  expect(
    results.some((result) => result.kind === 'topic' && result.title === 'Türev Uygulamaları'),
  ).toBe(true);
  expect(results.some((result) => result.kind === 'note')).toBe(true);
});

test('arama Türkçe büyük harf sorgusunu ve yayınevi alanını eşler', async () => {
  const uppercase = await searchAll('TÜREV');
  expect(uppercase.some((result) => result.kind === 'topic' && result.title === 'Türev')).toBe(true);

  const publisher = await searchAll('KAREKÖK');
  expect(
    publisher.filter((result) => result.kind === 'book').map((result) => result.title),
  ).toEqual(['Türev Soru Bankası']);
});

test('ders adı ve ders slugı raf kitabını bulur', async () => {
  const byName = await searchAll('Fizik');
  expect(
    byName.filter((result) => result.kind === 'book').map((result) => result.id),
  ).toEqual([fizikBook.id]);
  expect(byName.find((result) => result.kind === 'book')?.subtitle).toBe('Palme · Fizik');

  const bySlug = await searchAll('fen');
  expect(
    bySlug.filter((result) => result.kind === 'book').map((result) => result.id),
  ).toEqual([fizikBook.id]);
});

test('sınav türü raf kitabını bulur', async () => {
  const results = await searchAll('TYT');

  const titles = results
    .filter((result) => result.kind === 'book')
    .map((result) => result.title)
    .sort();

  expect(titles).toEqual(['Soru Bankası', 'Türev Soru Bankası']);
});

test('eski books tablosundaki kitaplar ayrı sonuç olarak çıkmaz', async () => {
  expect(await db.books.count()).toBe(1);

  const results = await searchAll('Eski Kitap');

  expect(results).toEqual([]);
});

test('denemeler not metniyle de bulunur', async () => {
  const results = await searchAll('kapsar');

  expect(results.filter((result) => result.kind === 'exam').map((result) => result.id)).toEqual([
    turevExam.id,
  ]);
});

test('alansız eski AYT denemesi aramada çıkarılan alanla gösterilir', async () => {
  const aytSubject = await db.subjects.where('seedKey').equals('ayt-mat').first();
  expect(aytSubject).toBeDefined();
  const legacy = await saveExam({
    type: 'AYT',
    name: 'Eski AYT Tarama',
    date: '2026-11-12',
    results: [{ subjectId: aytSubject!.id, correct: 10, wrong: 0, blank: 0 }],
  });

  const results = await searchAll('Eski AYT');
  const examResult = results.find(
    (result) => result.kind === 'exam' && result.id === legacy.id,
  );

  expect(examResult?.subtitle).toContain('Eşit Ağırlık');
  expect(examResult?.subtitle).not.toContain('Genel');
});

test('branş denemesi aramada branş etiketiyle listelenir', async () => {
  const branchExam = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'Sosyal Tarama',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });

  const results = await searchAll('Sosyal');
  const examResult = results.find(
    (result) => result.kind === 'exam' && result.id === branchExam.id,
  );

  expect(examResult).toMatchObject({
    title: 'Sosyal Tarama',
    subtitle: 'TYT · Branş · Sosyal · 20 Kasım 2026 · 14,25 net',
    href: `/denemeler/${branchExam.id}`,
  });
});

test('yanlış fotoğrafları not metniyle bulunur ve galeriye bağlanır', async () => {
  const now = new Date().toISOString();
  const photoId = newId();
  // Arama yalnızca blobsuz projeksiyonu okur; photos tablosunda kayıt yoktur.
  await db.photoSearch.put({
    id: photoId,
    examType: 'TYT',
    subjectId: turevSubject.id,
    topicId: turevTopic.id,
    note: 'Türev fotoğrafı',
    mastered: false,
    createdAt: now,
  });
  expect(await db.photos.count()).toBe(0);

  const results = await searchAll('fotoğrafı');

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    kind: 'photo',
    id: photoId,
    title: 'Türev fotoğrafı',
    subtitle: 'Matematik · Türev',
    href: '/yanlislar',
  });
});

test('boş veya yalnızca boşluk içeren sorgu boş dizi döndürür', async () => {
  expect(await searchAll('')).toEqual([]);
  expect(await searchAll('   \n\t ')).toEqual([]);
});

test('sonuç listesi en fazla 20 kayıtla sınırlanır', async () => {
  const now = new Date().toISOString();
  const extraTopics: Topic[] = Array.from({ length: 6 }, (_, index) => ({
    id: newId(),
    subjectId: turevSubject.id,
    name: `Zzortak Konu ${index + 1}`,
    order: 100 + index,
    isCustom: true,
    createdAt: now,
  }));
  for (let index = 0; index < 6; index += 1) {
    await addCustomBook({ title: `Zzortak Kitap ${index + 1}`, totalPages: 100 });
  }
  const extraExams: Exam[] = Array.from({ length: 6 }, (_, index) => ({
    id: newId(),
    type: 'TYT',
    name: `Zzortak Deneme ${index + 1}`,
    date: '2026-11-01',
    note: '',
    createdAt: now,
  }));

  await db.topics.bulkAdd(extraTopics);
  await db.notes.bulkAdd(
    extraTopics.map((topic) => ({
      topicId: topic.id,
      contentHtml: '<p>Zzortak not</p>',
      plainText: 'Zzortak not',
      updatedAt: now,
    })),
  );
  await db.exams.bulkAdd(extraExams);

  const results = await searchAll('zzortak');

  expect(results).toHaveLength(SEARCH_RESULT_LIMIT);
  expect(SEARCH_RESULT_LIMIT).toBe(20);
});
