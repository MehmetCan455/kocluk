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
