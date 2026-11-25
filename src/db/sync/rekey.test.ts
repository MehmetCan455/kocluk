import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type {
  ActivityLog,
  ExamResult,
  Note,
  Photo,
  ScheduleRow,
  ScheduleTask,
  ScheduleWeek,
  Subject,
  Topic,
  UserBook,
} from '@/domain/types';
import { deterministicId } from '@/lib/deterministicId';
import {
  EXAM_RESULT_NAMESPACE,
  LOCAL_SCOPE,
  TOPIC_PROGRESS_NAMESPACE,
} from '@/lib/namespaces';
import { KoclukDB } from '../db';
import { toPhotoSearch } from '../photoSearch';
import { installSyncHooks, pendingChanges, setApplyingRemote, whenQueueIdle } from './queue';
import { rekeyRow } from './rekey';

const DB_NAME = 'kocluk-sync-rekey-test';
const NOW = '2026-11-25T10:00:00.000Z';

let database: KoclukDB;

beforeEach(async () => {
  await Dexie.delete(DB_NAME);
  database = new KoclukDB(DB_NAME);
  await database.open();
  installSyncHooks(database, 'user-1');
});

afterEach(async () => {
  setApplyingRemote(false);
  await whenQueueIdle();
  database.close();
  await Dexie.delete(DB_NAME);
});

function subject(id: string, overrides: Partial<Subject> = {}): Subject {
  return {
    id,
    seedKey: `seed-${id}`,
    exam: 'TYT',
    name: 'Matematik',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
    updatedAt: NOW,
    ...overrides,
  };
}

function topic(id: string, subjectId: string): Topic {
  return {
    id,
    subjectId,
    name: `Konu ${id}`,
    order: 1,
    isCustom: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function activityLog(id: string, refs: { topicId?: string; userBookId?: string }): ActivityLog {
  return {
    id,
    type: refs.topicId ? 'topic_review' : 'book_pages',
    ...refs,
    source: 'manual',
    createdAt: NOW,
  };
}

function scheduleTask(id: string, refs: { topicId?: string; userBookId?: string }): ScheduleTask {
  return {
    id,
    weekId: 'week-1',
    rowId: 'row-1',
    dayIndex: 1,
    type: refs.topicId ? 'topic' : 'book',
    ...refs,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function photo(id: string, refs: { subjectId?: string; topicId?: string }): Photo {
  return {
    id,
    examType: 'TYT',
    subjectId: refs.subjectId ?? 's1',
    topicId: refs.topicId,
    note: 'soru',
    blob: new Blob(['büyük']),
    thumbBlob: new Blob(['küçük']),
    width: 10,
    height: 10,
    mastered: false,
    practiceCount: 0,
    createdAt: NOW,
  };
}

async function clearQueue(): Promise<void> {
  await whenQueueIdle();
  await database.syncQueue.clear();
}

async function queuedIds(): Promise<string[]> {
  return (await pendingChanges(database, 1000)).map((row) => row.id).sort();
}

test('subjects rekey tüm ders referanslarını ve gizli dersleri günceller', async () => {
  await database.subjects.add(subject('s-old', { seedKey: 'tyt-mat' }));
  await database.topics.add(topic('t1', 's-old'));
  await database.topics.add(topic('t2', 's-old'));
  await database.examResults.add({
    id: 'er1',
    examId: 'e1',
    subjectId: 's-old',
    correct: 10,
    wrong: 2,
    blank: 1,
    net: 9.5,
    updatedAt: NOW,
  });
  await database.scheduleRows.add({
    id: 'row-1',
    weekId: 'week-1',
    subjectId: 's-old',
    label: 'Matematik',
    order: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await database.settings.put({ key: 'hiddenSubjects', value: ['s-old', 's-keep'] });
  const oldPhoto = photo('photo-1', { subjectId: 's-old' });
  await database.photos.add(oldPhoto);
  await database.photoSearch.put(toPhotoSearch(oldPhoto));
  await clearQueue();

  const canonical = subject('s-new', {
    seedKey: 'tyt-mat',
    name: 'Matematik (sunucu)',
    updatedAt: '2026-11-25T11:00:00.000000Z',
  });
  await rekeyRow(database, 'subjects', 's-old', canonical as unknown as Record<string, unknown>);
  await whenQueueIdle();

  const movedResultId = deterministicId(EXAM_RESULT_NAMESPACE, 'e1:s-new');

  expect(await database.subjects.get('s-old')).toBeUndefined();
  expect(await database.subjects.get('s-new')).toMatchObject({ name: 'Matematik (sunucu)' });
  expect(await database.topics.get('t1')).toMatchObject({ subjectId: 's-new' });
  expect(await database.topics.get('t2')).toMatchObject({ subjectId: 's-new' });
  expect(await database.examResults.get('er1')).toBeUndefined();
  expect(await database.examResults.get(movedResultId)).toMatchObject({
    examId: 'e1',
    subjectId: 's-new',
    net: 9.5,
  });
  expect(await database.scheduleRows.get('row-1')).toMatchObject({ subjectId: 's-new' });
  expect((await database.settings.get('hiddenSubjects'))?.value).toEqual(['s-new', 's-keep']);
  expect((await database.photos.get('photo-1'))?.subjectId).toBe('s-new');
  expect((await database.photoSearch.get('photo-1'))?.subjectId).toBe('s-new');

  expect(await queuedIds()).toEqual(
    [
      `examResults:${movedResultId}`,
      'examResults:er1',
      'scheduleRows:row-1',
      'settings:user-1',
      'topics:t1',
      'topics:t2',
    ].sort(),
  );
  expect(await database.syncQueue.get('subjects:s-new')).toBeUndefined();
});

test('subject rekey mevcut hedef sonucu varsa doğal anahtarı çoğaltmaz', async () => {
  await database.subjects.add(subject('s-old', { seedKey: 'tyt-mat' }));
  const targetResultId = deterministicId(EXAM_RESULT_NAMESPACE, 'e1:s-new');
  await database.examResults.bulkAdd([
    {
      id: 'er-old',
      examId: 'e1',
      subjectId: 's-old',
      correct: 10,
      wrong: 2,
      blank: 1,
      net: 9.5,
      updatedAt: NOW,
    },
    {
      id: targetResultId,
      examId: 'e1',
      subjectId: 's-new',
      correct: 15,
      wrong: 1,
      blank: 0,
      net: 14.75,
      updatedAt: '2026-11-25T12:00:00.000Z',
    },
  ]);
  await clearQueue();

  await rekeyRow(
    database,
    'subjects',
    's-old',
    subject('s-new', {
      seedKey: 'tyt-mat',
      updatedAt: '2026-11-25T11:00:00.000Z',
    }) as unknown as Record<string, unknown>,
  );
  await whenQueueIdle();

  // The target result was newer, so it stays and the old identity is only
  // tombstoned: no second active row for exam e1 + subject s-new.
  expect(await database.examResults.get('er-old')).toMatchObject({
    deletedAt: expect.any(String),
  });
  expect(await database.examResults.get(targetResultId)).toMatchObject({
    correct: 15,
    subjectId: 's-new',
  });
  expect(
    (await database.examResults.toArray()).filter(
      (row) => !row.deletedAt && row.examId === 'e1' && row.subjectId === 's-new',
    ),
  ).toHaveLength(1);
  expect(await queuedIds()).toContain('examResults:er-old');
  expect(await queuedIds()).not.toContain(`examResults:${targetResultId}`);
});

test('topics rekey not, ilerleme, aktivite ve plan referanslarını taşır', async () => {
  await database.subjects.add(subject('s1'));
  await database.topics.add(topic('t-old', 's1'));
  const note: Note = {
    topicId: 't-old',
    contentHtml: '<p>Limit</p>',
    plainText: 'Limit',
    updatedAt: NOW,
  };
  await database.notes.add(note);
  const oldProgressId = deterministicId(
    TOPIC_PROGRESS_NAMESPACE,
    `${LOCAL_SCOPE}:t-old`,
  );
  await database.topicProgress.add({
    id: oldProgressId,
    topicId: 't-old',
    done: true,
    doneAt: NOW,
    updatedAt: NOW,
  });
  await database.activityLogs.add(activityLog('log-1', { topicId: 't-old' }));
  await database.scheduleTasks.add(scheduleTask('task-1', { topicId: 't-old' }));
  const oldPhoto = photo('photo-1', { subjectId: 's1', topicId: 't-old' });
  await database.photos.add(oldPhoto);
  await database.photoSearch.put(toPhotoSearch(oldPhoto));
  await database.attachments.add({
    id: 'attachment-1',
    topicId: 't-old',
    name: 'cozum.png',
    mime: 'image/png',
    size: 3,
    blob: new Blob(['abc']),
    createdAt: NOW,
  });
  await database.topicBooks.add({
    id: 'topic-book-1',
    topicId: 't-old',
    bookId: 'book-1',
    totalTests: 5,
    solvedTests: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await clearQueue();

  const newProgressId = deterministicId(TOPIC_PROGRESS_NAMESPACE, `${LOCAL_SCOPE}:t-new`);
  await rekeyRow(
    database,
    'topics',
    't-old',
    topic('t-new', 's1') as unknown as Record<string, unknown>,
  );
  await whenQueueIdle();

  expect(await database.topics.get('t-old')).toBeUndefined();
  expect(await database.topics.get('t-new')).toMatchObject({ name: 'Konu t-new' });

  expect(await database.notes.get('t-old')).toBeUndefined();
  expect(await database.notes.get('t-new')).toMatchObject({
    topicId: 't-new',
    plainText: 'Limit',
    updatedAt: expect.any(String),
  });

  expect(await database.topicProgress.get(oldProgressId)).toBeUndefined();
  expect(await database.topicProgress.get(newProgressId)).toMatchObject({
    topicId: 't-new',
    done: true,
  });

  expect(await database.activityLogs.get('log-1')).toMatchObject({ topicId: 't-new' });
  expect(await database.scheduleTasks.get('task-1')).toMatchObject({ topicId: 't-new' });
  expect((await database.photos.get('photo-1'))?.topicId).toBe('t-new');
  expect((await database.photoSearch.get('photo-1'))?.topicId).toBe('t-new');
  expect((await database.attachments.get('attachment-1'))?.topicId).toBe('t-new');
  expect((await database.topicBooks.get('topic-book-1'))?.topicId).toBe('t-new');

  expect(await queuedIds()).toEqual(
    [
      'activityLogs:log-1',
      `notes:${'t-new'}`,
      'notes:t-old',
      'scheduleTasks:task-1',
      `topicProgress:${newProgressId}`,
      `topicProgress:${oldProgressId}`,
    ].sort(),
  );
  expect(await database.syncQueue.get('topics:t-new')).toBeUndefined();
});

test('userBooks rekey aktivite ve plan görev referanslarını günceller', async () => {
  await database.userBooks.add({
    id: 'ub-old',
    bookId: 'book-1',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  } satisfies UserBook);
  await database.activityLogs.add(activityLog('log-1', { userBookId: 'ub-old' }));
  await database.scheduleTasks.add(scheduleTask('task-1', { userBookId: 'ub-old' }));
  await clearQueue();

  await rekeyRow(
    database,
    'userBooks',
    'ub-old',
    {
      id: 'ub-new',
      bookId: 'book-1',
      status: 'active',
      createdAt: NOW,
      updatedAt: '2026-11-25T11:00:00.000000Z',
    } as unknown as Record<string, unknown>,
  );
  await whenQueueIdle();

  expect(await database.userBooks.get('ub-old')).toBeUndefined();
  expect(await database.userBooks.get('ub-new')).toMatchObject({ bookId: 'book-1' });
  expect(await database.activityLogs.get('log-1')).toMatchObject({ userBookId: 'ub-new' });
  expect(await database.scheduleTasks.get('task-1')).toMatchObject({ userBookId: 'ub-new' });
  expect(await queuedIds()).toEqual(['activityLogs:log-1', 'scheduleTasks:task-1']);
});

test('scheduleWeeks rekey satır ve görev referanslarını günceller', async () => {
  const week: ScheduleWeek = {
    id: 'week-old',
    weekStart: '2026-11-16',
    note: '',
    createdAt: NOW,
    updatedAt: NOW,
  };
  await database.scheduleWeeks.add(week);
  const row: ScheduleRow = {
    id: 'row-1',
    weekId: 'week-old',
    label: 'Matematik',
    order: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await database.scheduleRows.add(row);
  await database.scheduleTasks.add({
    id: 'task-1',
    weekId: 'week-old',
    rowId: 'row-1',
    dayIndex: 1,
    type: 'free',
    title: 'Tekrar',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await clearQueue();

  await rekeyRow(
    database,
    'scheduleWeeks',
    'week-old',
    {
      ...week,
      id: 'week-new',
      updatedAt: '2026-11-25T11:00:00.000000Z',
    } as unknown as Record<string, unknown>,
  );
  await whenQueueIdle();

  expect(await database.scheduleWeeks.get('week-old')).toBeUndefined();
  expect(await database.scheduleWeeks.get('week-new')).toMatchObject({
    weekStart: '2026-11-16',
  });
  expect(await database.scheduleRows.get('row-1')).toMatchObject({ weekId: 'week-new' });
  expect(await database.scheduleTasks.get('task-1')).toMatchObject({ weekId: 'week-new' });
  expect(await queuedIds()).toEqual(['scheduleRows:row-1', 'scheduleTasks:task-1']);
});

test('examResults rekey satırı kanonik kimlikle değiştirir', async () => {
  const result: ExamResult = {
    id: 'er-old',
    examId: 'e1',
    subjectId: 's1',
    correct: 10,
    wrong: 2,
    blank: 1,
    net: 9.5,
    updatedAt: NOW,
  };
  await database.examResults.add(result);
  await clearQueue();

  await rekeyRow(database, 'examResults', 'er-old', {
    ...result,
    id: 'er-new',
    correct: 12,
    updatedAt: '2026-11-25T11:00:00.000000Z',
  } as unknown as Record<string, unknown>);
  await whenQueueIdle();

  expect(await database.examResults.get('er-old')).toBeUndefined();
  expect(await database.examResults.get('er-new')).toMatchObject({
    examId: 'e1',
    subjectId: 's1',
    correct: 12,
  });
  expect(await queuedIds()).toEqual([]);
});

test('kimlik değişmezse yalnızca kanonik satır uygulanır', async () => {
  await database.subjects.add(subject('s1', { name: 'Yerel' }));
  await database.topics.add(topic('t1', 's1'));
  await clearQueue();

  await rekeyRow(database, 'subjects', 's1', subject('s1', {
    name: 'Sunucu',
    updatedAt: '2026-11-25T11:00:00.000000Z',
  }) as unknown as Record<string, unknown>);
  await whenQueueIdle();

  expect(await database.subjects.get('s1')).toMatchObject({ name: 'Sunucu' });
  expect(await database.topics.get('t1')).toMatchObject({ subjectId: 's1' });
  expect(await queuedIds()).toEqual([]);
});

test('kuyruk yazımı başarısız olursa rekey tümüyle geri alınır', async () => {
  await database.subjects.add(subject('s-old', { seedKey: 'tyt-mat' }));
  await database.topics.add(topic('t1', 's-old'));
  await clearQueue();

  database.syncQueue.hook('creating', () => {
    throw new Error('kuyruk yazılamadı');
  });

  await expect(
    rekeyRow(
      database,
      'subjects',
      's-old',
      subject('s-new', {
        seedKey: 'tyt-mat',
        updatedAt: '2026-11-25T11:00:00.000000Z',
      }) as unknown as Record<string, unknown>,
    ),
  ).rejects.toThrow();

  // The reference repair and its queue rows share one transaction: no local
  // row may change when the queue write fails.
  expect(await database.subjects.get('s-old')).toMatchObject({ name: 'Matematik' });
  expect(await database.subjects.get('s-new')).toBeUndefined();
  expect((await database.topics.get('t1'))?.subjectId).toBe('s-old');
  expect(await database.syncQueue.count()).toBe(0);
});
