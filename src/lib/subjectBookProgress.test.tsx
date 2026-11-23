import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { addBookPageRange, addCustomBook, updateUserBook } from '@/db/bookRepositories';
import { db } from '@/db/db';
import { listSubjects, listTopics } from '@/db/repositories';
import type { CurriculumSeed } from '@/db/seed';
import { setTopicDone } from '@/db/topicProgressRepository';
import { seedOnboarded } from '@/test/fixtures';
import { useSubjectOverview, useTopicEstimate } from './progress';

/** Four TYT Fizik topics plus two AYT Geometri topics for the shared title case. */
const FIXTURE = {
  version: 1,
  subjects: [
    {
      seedKey: 'tyt-fizik',
      exam: 'TYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 1,
      topics: [
        { seedKey: 'tyt-fizik-1', name: 'Fizik Bilimine Giriş', order: 1 },
        { seedKey: 'tyt-fizik-2', name: 'Madde ve Özellikleri', order: 2 },
        { seedKey: 'tyt-fizik-3', name: 'Basınç', order: 3 },
        { seedKey: 'tyt-fizik-4', name: 'Hareket', order: 4 },
      ],
    },
    {
      seedKey: 'ayt-geometri',
      exam: 'AYT',
      name: 'Geometri',
      slug: 'geometri',
      icon: 'shapes',
      order: 2,
      topics: [
        { seedKey: 'ayt-geometri-1', name: 'Temel Geometri', order: 1 },
        { seedKey: 'ayt-geometri-2', name: 'Analitik Geometri', order: 2 },
      ],
    },
  ],
} satisfies CurriculumSeed;

async function fizikSubject() {
  const subject = (await listSubjects('TYT')).find((item) => item.slug === 'fizik');
  if (!subject) {
    throw new Error('Fizik dersi bulunamadı');
  }
  return subject;
}

async function addFizikBook(title: string, totalPages: number) {
  return addCustomBook({
    title,
    exam: 'TYT',
    subjectSlug: 'fizik',
    totalPages,
  });
}

beforeEach(async () => {
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
});

test('kitap ilerlemesi konulara sırayla yansır', async () => {
  const subject = await fizikSubject();
  const userBook = await addFizikBook('Fizik Soru Bankası', 100);
  await addBookPageRange(userBook.id, 1, 25);

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.bookEstimate).toBe(6);
    expect(result.current?.topics.map((row) => row.progress.percent)).toEqual([25, 0, 0, 0]);
    expect(result.current?.topics.map((row) => row.bookPercent)).toEqual([25, 0, 0, 0]);
    expect(result.current?.progress.percent).toBe(6);
  });
});

test('biten tek kitap her konuya 50 verir', async () => {
  const subject = await fizikSubject();
  const userBook = await addFizikBook('Fizik Soru Bankası', 100);
  await addBookPageRange(userBook.id, 1, 100);

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.bookEstimate).toBe(50);
    expect(result.current?.topics.map((row) => row.progress.percent)).toEqual([50, 50, 50, 50]);
    expect(result.current?.progress.percent).toBe(50);
  });
});

test('iki biten kitap dersi tamamlar', async () => {
  const subject = await fizikSubject();
  const first = await addFizikBook('Birinci Fizik Kitabı', 100);
  await addBookPageRange(first.id, 1, 100);
  const second = await addFizikBook('İkinci Fizik Kitabı', 200);
  await addBookPageRange(second.id, 1, 200);

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.topics.map((row) => row.progress.percent)).toEqual([100, 100, 100, 100]);
    expect(result.current?.bookEstimate).toBe(100);
    expect(result.current?.progress).toMatchObject({ percent: 100, done: true });
  });
});

test('manuel biten konu kitap yüzdesinden etkilenmez', async () => {
  const subject = await fizikSubject();
  const [first] = await listTopics(subject.id);
  await setTopicDone(first.id, true);
  const userBook = await addFizikBook('Fizik Soru Bankası', 100);
  await addBookPageRange(userBook.id, 1, 25);

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.topics[0]?.progress.percent).toBe(100);
    expect(result.current?.topics[0]?.manualDone).toBe(true);
    expect(result.current?.topics[0]?.bookPercent).toBe(25);
    expect(result.current?.manualDoneCount).toBe(1);
    expect(result.current?.progress.percent).toBe(25);
  });
});

test('arşivli kitap katkı vermez', async () => {
  const subject = await fizikSubject();
  const userBook = await addFizikBook('Fizik Soru Bankası', 100);
  await addBookPageRange(userBook.id, 1, 100);
  await updateUserBook(userBook.id, { status: 'archived' });

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.bookEstimate).toBe(0);
  });
  expect(result.current?.topics.map((row) => row.progress.percent)).toEqual([0, 0, 0, 0]);
});

test('toplam sayfası olmayan kitap katkı vermez', async () => {
  const subject = await fizikSubject();
  await addFizikBook('Sayfasız Fizik Kitabı', 0);

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.bookEstimate).toBe(0);
  });
  expect(result.current?.topics.map((row) => row.progress.percent)).toEqual([0, 0, 0, 0]);
});

test('TYT-AYT ortak kitabı AYT dersine de sayılır', async () => {
  const fizik = await fizikSubject();
  const geometri = (await listSubjects('AYT')).find((item) => item.slug === 'geometri');
  if (!geometri) {
    throw new Error('Geometri dersi bulunamadı');
  }
  const userBook = await addCustomBook({
    title: 'TYT-AYT Geometri Soru Bankası',
    exam: 'TYT',
    subjectSlug: 'geometri',
    totalPages: 100,
  });
  await addBookPageRange(userBook.id, 1, 100);

  const { result: ayt } = renderHook(() => useSubjectOverview(geometri.id));
  await waitFor(() => {
    expect(ayt.current?.bookEstimate).toBe(50);
    expect(ayt.current?.topics.map((row) => row.progress.percent)).toEqual([50, 50]);
  });

  const { result: tyt } = renderHook(() => useSubjectOverview(fizik.id));
  await waitFor(() => {
    expect(tyt.current?.bookEstimate).toBe(0);
  });
});

test('kitap tahmini raftaki updatedAt sırası değişince bozulmaz', async () => {
  const subject = await fizikSubject();
  const completed = await addFizikBook('Birinci Fizik Kitabı', 100);
  await addBookPageRange(completed.id, 1, 100);
  const thirty = await addFizikBook('İkinci Fizik Kitabı', 100);
  await addBookPageRange(thirty.id, 1, 30);
  const forty = await addFizikBook('Üçüncü Fizik Kitabı', 100);
  await addBookPageRange(forty.id, 1, 40);

  // Oluşturma sırası completed < thirty < forty; raf sırası tam tersi olsun.
  await db.userBooks.update(completed.id, {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  });
  await db.userBooks.update(thirty.id, {
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
  });
  await db.userBooks.update(forty.id, {
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-02-03T00:00:00.000Z',
  });

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.bookEstimate).toBe(67);
  });
  const before = result.current;
  expect(before?.topics.map((row) => row.progress.percent)).toEqual([100, 70, 50, 50]);

  await act(async () => {
    await db.userBooks.update(completed.id, {
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    });
  });

  await waitFor(() => {
    expect(result.current).not.toBe(before);
    expect(result.current?.bookEstimate).toBe(before?.bookEstimate);
    expect(result.current?.topics.map((row) => row.progress.percent)).toEqual(
      before?.topics.map((row) => row.progress.percent),
    );
  });
});

test('useTopicEstimate konu katkısını döndürür', async () => {
  const subject = await fizikSubject();
  const [first] = await listTopics(subject.id);
  const userBook = await addFizikBook('Fizik Soru Bankası', 100);
  await addBookPageRange(userBook.id, 1, 25);

  const { result } = renderHook(() => useTopicEstimate(first.id));

  await waitFor(() => {
    expect(result.current).toEqual({
      progress: {
        solved: 0,
        total: 1,
        percent: 25,
        remaining: 1,
        started: true,
        done: false,
      },
      bookPercent: 25,
      manualDone: false,
    });
  });
});
