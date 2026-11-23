import { expect, test } from 'vitest';
import {
  calculateSubjectProgress,
  countsForSubject,
  distributeBookPages,
  effectiveTopicPercent,
  subjectBookEstimate,
  topicPageChunks,
} from './subjectEstimate';

const TOPICS = ['t1', 't2', 't3', 't4'];
const TEN_TOPICS = Array.from({ length: 10 }, (_, index) => `t${index + 1}`);
const TOPICS_21 = Array.from({ length: 21 }, (_, index) => `t${index + 1}`);

test('ders eşleşmesi sınav ve slug üzerinden çalışır', () => {
  expect(countsForSubject(
    { title: 'TYT Matematik Soru Bankası', exam: 'TYT', subjectSlug: 'matematik' },
    { exam: 'TYT', slug: 'matematik' },
  )).toBe(true);
  expect(countsForSubject(
    { title: 'TYT Matematik Soru Bankası', exam: 'TYT', subjectSlug: 'matematik' },
    { exam: 'AYT', slug: 'matematik' },
  )).toBe(false);
});

test('TYT-AYT ortak kitabı iki sınava da sayılır', () => {
  const book = { title: 'TYT-AYT Geometri Soru Bankası', exam: 'TYT' as const, subjectSlug: 'geometri' };
  expect(countsForSubject(book, { exam: 'TYT', slug: 'geometri' })).toBe(true);
  expect(countsForSubject(book, { exam: 'AYT', slug: 'geometri' })).toBe(true);
});

test('kitap sayfaları konulara eşit dilimler hâlinde dağıtılır', () => {
  expect(topicPageChunks(TOPICS, 100)).toEqual([25, 25, 25, 25]);
  expect(topicPageChunks(TOPICS, 101)).toEqual([26, 25, 25, 25]);
  expect(topicPageChunks(TOPICS, 0)).toEqual([0, 0, 0, 0]);
  expect(topicPageChunks([], 100)).toEqual([]);
});

test('100 sayfa 10 konuda ilk 10 sayfa yalnızca ilk konuya katkı verir', () => {
  const { byTopic, estimate } = subjectBookEstimate(TEN_TOPICS, [
    { totalPages: 100, ranges: [{ fromPage: 1, toPage: 10 }] },
  ]);

  expect([...byTopic.values()]).toEqual([50, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(estimate).toBe(5);
});

test('100 sayfa 10 konuda 1-99 okununca son konu kısmi kalır', () => {
  const { byTopic, estimate } = subjectBookEstimate(TEN_TOPICS, [
    { totalPages: 100, ranges: [{ fromPage: 1, toPage: 99 }] },
  ]);

  expect([...byTopic.values()]).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 50, 45]);
  expect(estimate).toBe(49);
});

test('100 sayfa 10 konu tamamlanınca her konu 50 alır', () => {
  const { byTopic, estimate } = subjectBookEstimate(TEN_TOPICS, [
    { totalPages: 100, ranges: [{ fromPage: 1, toPage: 100 }] },
  ]);

  expect([...byTopic.values()]).toEqual(Array.from({ length: 10 }, () => 50));
  expect(estimate).toBe(50);
});

test('416 sayfa 21 konuda 415 sayfa son konuyu kısmi bırakır', () => {
  const chunks = topicPageChunks(TOPICS_21, 416);
  expect(chunks.reduce((sum, pages) => sum + pages, 0)).toBe(416);
  expect(chunks.slice(0, 17)).toEqual(Array.from({ length: 17 }, () => 20));
  expect(chunks.slice(17)).toEqual([19, 19, 19, 19]);

  const { byTopic, estimate } = subjectBookEstimate(TOPICS_21, [
    { totalPages: 416, ranges: [{ fromPage: 1, toPage: 415 }] },
  ]);
  const values = [...byTopic.values()];
  expect(values.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => 50));
  expect(values[20]).toBe(47);
  expect(estimate).toBe(49);
});

test('416 sayfada son sayfa sıçrama yapmaz', () => {
  const before = subjectBookEstimate(TOPICS_21, [
    { totalPages: 416, ranges: [{ fromPage: 1, toPage: 415 }] },
  ]);
  const after = subjectBookEstimate(TOPICS_21, [
    { totalPages: 416, ranges: [{ fromPage: 1, toPage: 416 }] },
  ]);

  expect(before.estimate).toBe(49);
  expect([...after.byTopic.values()]).toEqual(Array.from({ length: 21 }, () => 50));
  expect(after.estimate).toBe(50);
});

test('iki biten kitap tüm konuları 100 yapar', () => {
  const { byTopic, estimate } = subjectBookEstimate(TOPICS, [
    { totalPages: 100, ranges: [{ fromPage: 1, toPage: 100 }] },
    { totalPages: 200, ranges: [{ fromPage: 1, toPage: 200 }] },
  ]);

  expect([...byTopic.values()]).toEqual([100, 100, 100, 100]);
  expect(estimate).toBe(100);
});

test('dağınık ve örtüşen aralıklar her dilimde bir kez sayılır', () => {
  const byTopic = distributeBookPages(TOPICS, [
    {
      totalPages: 100,
      ranges: [
        { fromPage: 1, toPage: 10 },
        { fromPage: 5, toPage: 15 },
        { fromPage: 20, toPage: 30 },
        { fromPage: 50, toPage: 60 },
      ],
    },
  ]);

  // 4 konu x 25 sayfa. İlk dilim: 1-15 + 20-25 = 21 sayfa (42); ikinci dilim:
  // 26-30 + 50 = 6 sayfa (12); üçüncü dilim: 51-60 = 10 sayfa (20).
  expect([...byTopic.values()]).toEqual([42, 12, 20, 0]);
});

test('konu yoksa kitap tahmini sıfırdır', () => {
  const { byTopic, estimate } = subjectBookEstimate([], [
    { totalPages: 100, ranges: [{ fromPage: 1, toPage: 100 }] },
  ]);

  expect(byTopic.size).toBe(0);
  expect(estimate).toBe(0);
});

test('sayfası olmayan veya aralığı olmayan kitap katkı vermez', () => {
  const zeroPages = subjectBookEstimate(TOPICS, [
    { totalPages: 0, ranges: [{ fromPage: 1, toPage: 50 }] },
  ]);
  expect([...zeroPages.byTopic.values()]).toEqual([0, 0, 0, 0]);
  expect(zeroPages.estimate).toBe(0);

  const noRanges = subjectBookEstimate(TOPICS, [{ totalPages: 100, ranges: [] }]);
  expect([...noRanges.byTopic.values()]).toEqual([0, 0, 0, 0]);
  expect(noRanges.estimate).toBe(0);
});

test('manuel bitirme kitap katkısını düşürmez', () => {
  expect(effectiveTopicPercent(true, 0)).toBe(100);
  expect(effectiveTopicPercent(false, 25)).toBe(25);
  expect(effectiveTopicPercent(true, 50)).toBe(100);
});

test('ders yüzdesi ortalamadır ve tümü bitmeden 99u geçmez', () => {
  expect(calculateSubjectProgress([25, 0, 0, 0], true)).toMatchObject({
    percent: 6, solved: 0, total: 4, remaining: 4, started: true, done: false,
  });
  expect(calculateSubjectProgress([100, 100, 100, 100], true)).toMatchObject({
    percent: 100, solved: 4, total: 4, remaining: 0, done: true,
  });
  expect(calculateSubjectProgress([99, 100, 100, 100], true)).toMatchObject({
    percent: 99, solved: 3, done: false,
  });
});

test('birleşik AYT Tarih kitabı iki alt derse de sayılır', () => {
  const book = { title: 'AYT Tarih Soru Bankası', exam: 'AYT' as const, subjectSlug: 'tarih-1' };
  expect(countsForSubject(book, { exam: 'AYT', slug: 'tarih-1' })).toBe(true);
  expect(countsForSubject(book, { exam: 'AYT', slug: 'tarih-2' })).toBe(true);
});

test('Tarih-1/2 ayrımı olan kitap kardeş alt derse sayılmaz', () => {
  expect(countsForSubject(
    { title: 'AYT Tarih-1 Soru Bankası', exam: 'AYT', subjectSlug: 'tarih-1' },
    { exam: 'AYT', slug: 'tarih-2' },
  )).toBe(false);
  expect(countsForSubject(
    { title: 'AYT Tarih-2 Soru Bankası', exam: 'AYT', subjectSlug: 'tarih-2' },
    { exam: 'AYT', slug: 'tarih-1' },
  )).toBe(false);
});

test('birleşik AYT Coğrafya kitabı iki alt derse de sayılır', () => {
  const book = { title: 'AYT Coğrafya Soru Bankası', exam: 'AYT' as const, subjectSlug: 'cografya-1' };
  expect(countsForSubject(book, { exam: 'AYT', slug: 'cografya-1' })).toBe(true);
  expect(countsForSubject(book, { exam: 'AYT', slug: 'cografya-2' })).toBe(true);
});

test('Coğrafya-1/2 ayrımı olan kitap kardeş alt derse sayılmaz', () => {
  expect(countsForSubject(
    { title: 'AYT Coğrafya-2 Soru Bankası', exam: 'AYT', subjectSlug: 'cografya-2' },
    { exam: 'AYT', slug: 'cografya-1' },
  )).toBe(false);
  expect(countsForSubject(
    { title: 'AYT Coğrafya-1 Soru Bankası', exam: 'AYT', subjectSlug: 'cografya-1' },
    { exam: 'AYT', slug: 'cografya-2' },
  )).toBe(false);
});

test('birleşik AYT kitabı TYT dersine sızmaz', () => {
  expect(countsForSubject(
    { title: 'AYT Tarih Soru Bankası', exam: 'AYT', subjectSlug: 'tarih-1' },
    { exam: 'TYT', slug: 'tarih' },
  )).toBe(false);
  expect(countsForSubject(
    { title: 'TYT Tarih Soru Bankası', exam: 'TYT', subjectSlug: 'tarih' },
    { exam: 'AYT', slug: 'tarih-1' },
  )).toBe(false);
});

test('Türkçe büyük harfli birleşik başlık eşleşir', () => {
  expect(countsForSubject(
    { title: 'AYT TARİH SORU BANKASI', exam: 'AYT', subjectSlug: 'tarih-1' },
    { exam: 'AYT', slug: 'tarih-2' },
  )).toBe(true);
  expect(countsForSubject(
    { title: 'AYT COĞRAFYA SORU BANKASI', exam: 'AYT', subjectSlug: 'cografya-2' },
    { exam: 'AYT', slug: 'cografya-1' },
  )).toBe(true);
});

test('marka önekli birleşik AYT Tarih kitapları kardeş alt derse sayılır', () => {
  const titles = [
    'AYT 3D Tarih Tamamı Video Çözümlü Soru Bankası',
    'AYT Iceberg Tarih Soru Bankası',
  ];
  for (const title of titles) {
    const book = { title, exam: 'AYT' as const, subjectSlug: 'tarih-1' };
    expect(countsForSubject(book, { exam: 'AYT', slug: 'tarih-1' })).toBe(true);
    expect(countsForSubject(book, { exam: 'AYT', slug: 'tarih-2' })).toBe(true);
  }
});

test('marka önekli birleşik AYT Coğrafya kitapları kardeş alt derse sayılır', () => {
  const titles = [
    'AYT 3D Coğrafya Soru Bankası',
    'AYT Iceberg Coğrafya Konu Anlatımı',
  ];
  for (const title of titles) {
    const book = { title, exam: 'AYT' as const, subjectSlug: 'cografya-2' };
    expect(countsForSubject(book, { exam: 'AYT', slug: 'cografya-2' })).toBe(true);
    expect(countsForSubject(book, { exam: 'AYT', slug: 'cografya-1' })).toBe(true);
  }
});

test('marka önekli Tarih-1/Coğrafya-2 kitabı kardeş alt derse sayılmaz', () => {
  expect(countsForSubject(
    { title: 'AYT 3D Tarih-1 Soru Bankası', exam: 'AYT', subjectSlug: 'tarih-1' },
    { exam: 'AYT', slug: 'tarih-2' },
  )).toBe(false);
  expect(countsForSubject(
    { title: 'AYT Iceberg Coğrafya-2 Soru Bankası', exam: 'AYT', subjectSlug: 'cografya-2' },
    { exam: 'AYT', slug: 'cografya-1' },
  )).toBe(false);
});

test('TYT AYT ortak başlığı tiresiz yazımda da iki sınava sayılır', () => {
  const kimya = {
    title: 'TYT AYT Kimya Avantaj Soru Bankası',
    exam: 'TYT' as const,
    subjectSlug: 'kimya',
  };
  expect(countsForSubject(kimya, { exam: 'TYT', slug: 'kimya' })).toBe(true);
  expect(countsForSubject(kimya, { exam: 'AYT', slug: 'kimya' })).toBe(true);

  const geometri = {
    title: 'Eyüp B. TYT AYT Geometri',
    exam: 'TYT' as const,
    subjectSlug: 'geometri',
  };
  expect(countsForSubject(geometri, { exam: 'TYT', slug: 'geometri' })).toBe(true);
  expect(countsForSubject(geometri, { exam: 'AYT', slug: 'geometri' })).toBe(true);

  const din = {
    title: 'TYT AYT MSÜ Din Kültürü Soru Bankası',
    exam: 'TYT' as const,
    subjectSlug: 'din-kulturu',
  };
  expect(countsForSubject(din, { exam: 'AYT', slug: 'din-kulturu' })).toBe(true);
});

test('ortak Tarih kitabı AYT Tarih-1 ve Tarih-2 derslerine eşlenir', () => {
  const book = {
    title: '2026 TYT-AYT Tarih Soru Bankası',
    exam: 'TYT' as const,
    subjectSlug: 'tarih',
  };
  expect(countsForSubject(book, { exam: 'AYT', slug: 'tarih-1' })).toBe(true);
  expect(countsForSubject(book, { exam: 'AYT', slug: 'tarih-2' })).toBe(true);
});

test('ortak Coğrafya kitabı AYT Coğrafya-1 ve Coğrafya-2 derslerine eşlenir', () => {
  const book = {
    title: 'TYT AYT Coğrafya Soru Bankası',
    exam: 'TYT' as const,
    subjectSlug: 'cografya',
  };
  expect(countsForSubject(book, { exam: 'AYT', slug: 'cografya-1' })).toBe(true);
  expect(countsForSubject(book, { exam: 'AYT', slug: 'cografya-2' })).toBe(true);
});

test('ortak Felsefe kitabı AYT Felsefe Grubuna eşlenir', () => {
  expect(countsForSubject(
    { title: 'TYT-AYT Felsefe Soru Bankası', exam: 'TYT', subjectSlug: 'felsefe' },
    { exam: 'AYT', slug: 'felsefe-grubu' },
  )).toBe(true);
});

test('ortak olmayan TYT Tarih kitabı AYT alt dersine sızmaz', () => {
  expect(countsForSubject(
    { title: 'TYT Tarih Soru Bankası', exam: 'TYT', subjectSlug: 'tarih' },
    { exam: 'AYT', slug: 'tarih-1' },
  )).toBe(false);
});

test('ortak Türkçe kitabı AYT Edebiyatına eşlenmez', () => {
  expect(countsForSubject(
    { title: 'TYT-AYT Türkçe', exam: 'TYT', subjectSlug: 'turkce' },
    { exam: 'AYT', slug: 'edebiyat' },
  )).toBe(false);
});
