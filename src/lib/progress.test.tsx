import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import { listSubjects, listTopics } from '@/db/repositories';
import { setTopicDone } from '@/db/topicProgressRepository';
import { seedOnboarded } from '@/test/fixtures';
import { useSubjectOverview, useSubjectProgress, useTopicProgress } from './progress';

const REVIEW_CREATED_AT = '2026-11-10T09:00:00.000Z';

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

  // Legacy test records must stay readable but never feed the new progress.
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

test('ders ilerlemesi biten konu sayısından gelir, legacy test kayıtlarından değil', async () => {
  const subject = (await listSubjects('TYT'))[0];
  const [turev, polinomlar] = await listTopics(subject.id);
  await setTopicDone(turev.id, true);

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.progress).toEqual({
      solved: 1,
      total: 2,
      percent: 50,
      remaining: 1,
      started: true,
      done: false,
    });
  });

  expect(
    result.current?.topics.map((row) => ({
      id: row.topic.id,
      done: row.progress.done,
      reviewCount: row.reviewCount,
      legacyTestRecordCount: row.legacyTestRecordCount,
    })),
  ).toEqual([
    { id: turev.id, done: true, reviewCount: 0, legacyTestRecordCount: 2 },
    { id: polinomlar.id, done: false, reviewCount: 0, legacyTestRecordCount: 0 },
  ]);
  expect(result.current?.continuingTopic).toBeUndefined();
  expect(result.current?.bookEstimate).toBe(0);
  expect(result.current?.manualDoneCount).toBe(1);
});

test('konu tekrarı konuyu başlatır ama bitirmez', async () => {
  const subject = (await listSubjects('TYT'))[0];
  const [turev, polinomlar] = await listTopics(subject.id);
  await setTopicDone(turev.id, true);
  await db.activityLogs.add({
    id: 'review-1',
    type: 'topic_review',
    topicId: polinomlar.id,
    source: 'manual',
    createdAt: REVIEW_CREATED_AT,
  });

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.topics[1]?.reviewCount).toBe(1);
  });

  expect(result.current?.topics[1]?.progress).toEqual({
    solved: 0,
    total: 1,
    percent: 0,
    remaining: 1,
    started: true,
    done: false,
  });
  expect(result.current?.progress).toMatchObject({
    solved: 1,
    total: 2,
    percent: 50,
    done: false,
  });
  expect(result.current?.continuingTopic?.id).toBe(polinomlar.id);
});

test('useSubjectProgress biten konu oranını döndürür', async () => {
  const subject = (await listSubjects('TYT'))[0];
  const [turev] = await listTopics(subject.id);
  await setTopicDone(turev.id, true);

  const { result } = renderHook(() => useSubjectProgress(subject.id));

  await waitFor(() => {
    expect(result.current).toEqual({
      solved: 1,
      total: 2,
      percent: 50,
      remaining: 1,
      started: true,
      done: false,
    });
  });
});

test('useTopicProgress konu durumunu ve tekrarı yansıtır', async () => {
  const subject = (await listSubjects('TYT'))[0];
  const [turev, polinomlar] = await listTopics(subject.id);
  await setTopicDone(turev.id, true);
  await db.activityLogs.add({
    id: 'review-1',
    type: 'topic_review',
    topicId: polinomlar.id,
    source: 'manual',
    createdAt: REVIEW_CREATED_AT,
  });

  const { result: done } = renderHook(() => useTopicProgress(turev.id));
  await waitFor(() => {
    expect(done.current).toEqual({
      solved: 1,
      total: 1,
      percent: 100,
      remaining: 0,
      started: true,
      done: true,
    });
  });

  const { result: reviewed } = renderHook(() => useTopicProgress(polinomlar.id));
  await waitFor(() => {
    expect(reviewed.current).toEqual({
      solved: 0,
      total: 1,
      percent: 0,
      remaining: 1,
      started: true,
      done: false,
    });
  });
});
