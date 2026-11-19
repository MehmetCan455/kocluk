import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import { listSubjects, listTopics } from '@/db/repositories';
import { seedOnboarded } from '@/test/fixtures';
import { useSubjectProgress, useTopicProgress } from './progress';

beforeEach(async () => {
  await seedOnboarded(
    {
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
            { seedKey: 'tyt-mat-pol', name: 'Polinomlar', order: 2 },
          ],
        },
      ],
    },
    { seedVersion: CURRICULUM.version },
  );

  const subject = (await listSubjects('TYT'))[0];
  const [turev] = await listTopics(subject.id);

  await db.topicBooks.bulkAdd([
    {
      id: 'tb-1',
      topicId: turev.id,
      bookId: 'book-1',
      totalTests: 6,
      solvedTests: 5,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'tb-2',
      topicId: turev.id,
      bookId: 'book-2',
      totalTests: 4,
      solvedTests: 4,
      createdAt: '',
      updatedAt: '',
    },
  ]);
});

test('useSubjectProgress çok kayıtlı ilerlemeyi toplar ve done kullanır', async () => {
  const subject = (await listSubjects('TYT'))[0];

  const { result } = renderHook(() => useSubjectProgress(subject.id));

  await waitFor(() => {
    expect(result.current).toEqual({
      solved: 9,
      total: 10,
      percent: 90,
      remaining: 1,
      started: true,
      done: false,
    });
  });
});

test('useTopicProgress konu bazında ilerlemeyi döndürür', async () => {
  const subject = (await listSubjects('TYT'))[0];
  const [turev, polinomlar] = await listTopics(subject.id);

  const { result: withRecords } = renderHook(() => useTopicProgress(turev.id));
  await waitFor(() => {
    expect(withRecords.current).toMatchObject({
      solved: 9,
      total: 10,
      percent: 90,
      remaining: 1,
      started: true,
      done: false,
    });
  });

  const { result: empty } = renderHook(() => useTopicProgress(polinomlar.id));
  await waitFor(() => {
    expect(empty.current).toEqual({
      solved: 0,
      total: 0,
      percent: 0,
      remaining: 0,
      started: false,
      done: false,
    });
  });
});
