import { expect, test } from 'vitest';
import {
  calculateSubjectProgress,
  countsForSubject,
  distributeBookPercent,
  effectiveTopicPercent,
  subjectBookEstimate,
} from './subjectEstimate';

const TOPICS = ['t1', 't2', 't3', 't4'];

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

test('kitap yüzdesi konulara sırayla dağıtılır', () => {
  expect([...distributeBookPercent(TOPICS, [{ percent: 25 }]).values()]).toEqual([25, 0, 0, 0]);
  expect([...distributeBookPercent(TOPICS, [{ percent: 50 }]).values()]).toEqual([50, 0, 0, 0]);
  expect([...distributeBookPercent(TOPICS, [{ percent: 75 }]).values()]).toEqual([50, 25, 0, 0]);
  expect([...distributeBookPercent(TOPICS, [{ percent: 100 }]).values()]).toEqual([50, 50, 50, 50]);
});

test('iki kitap bir konuyu tamamlar', () => {
  const values = [...distributeBookPercent(TOPICS, [{ percent: 100 }, { percent: 100 }]).values()];
  expect(values).toEqual([100, 100, 100, 100]);
});

test('dolu konular atlanır', () => {
  const values = [...distributeBookPercent(TOPICS, [
    { percent: 100 },
    { percent: 50 },
    { percent: 50 },
  ]).values()];
  expect(values).toEqual([100, 100, 50, 50]);
});

test('kitap tahmini konu ortalamasının floor değeridir', () => {
  expect(subjectBookEstimate(TOPICS, [{ percent: 25 }])).toEqual({
    byTopic: new Map([['t1', 25], ['t2', 0], ['t3', 0], ['t4', 0]]),
    estimate: 6,
  });
  expect(subjectBookEstimate(TOPICS, [{ percent: 100 }]).estimate).toBe(50);
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

test('bitmiş kitap her konuya %50 verir, kısmi kitap sırayla dağıtır', () => {
  const values = [...distributeBookPercent(TOPICS, [
    { percent: 100 },
    { percent: 25 },
  ]).values()];
  expect(values).toEqual([75, 50, 50, 50]);
});

test('iki yarım kitap yalnızca ilk konuyu tamamlar', () => {
  const values = [...distributeBookPercent(TOPICS, [
    { percent: 50 },
    { percent: 50 },
  ]).values()];
  expect(values).toEqual([100, 0, 0, 0]);
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
