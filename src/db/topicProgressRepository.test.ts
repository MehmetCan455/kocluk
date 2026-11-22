import { beforeEach, expect, test } from 'vitest';
import type { ActivityLog, ScheduleTask, Topic } from '@/domain/types';
import { deterministicId } from '@/lib/deterministicId';
import { LOCAL_SCOPE, TOPIC_PROGRESS_NAMESPACE } from '@/lib/namespaces';
import { db } from './db';
import { deleteCustomTopicCascade } from './repositories';
import {
  getTopicDone,
  listAllTopicProgress,
  listAllTopicReviews,
  listTopicReviews,
  setTopicDone,
} from './topicProgressRepository';

const CREATED_AT = '2026-11-01T09:00:00.000Z';

function expectedId(topicId: string): string {
  return deterministicId(TOPIC_PROGRESS_NAMESPACE, `${LOCAL_SCOPE}:${topicId}`);
}

async function insertTopic(id: string, isCustom = false): Promise<Topic> {
  const topic: Topic = {
    id,
    subjectId: 'subject-1',
    name: `Konu ${id}`,
    order: 1,
    isCustom,
    createdAt: CREATED_AT,
  };
  await db.topics.add(topic);
  return topic;
}

function reviewLog(id: string, topicId: string, overrides: Partial<ActivityLog> = {}): ActivityLog {
  return {
    id,
    type: 'topic_review',
    topicId,
    source: 'manual',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function planTask(id: string, topicId: string): ScheduleTask {
  return {
    id,
    weekId: 'week-1',
    rowId: 'row-1',
    dayIndex: 0,
    type: 'topic',
    topicId,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

test('konu bitirme tek deterministik satır oluşturur ve aynı satırı günceller', async () => {
  await insertTopic('topic-1');

  const first = await setTopicDone('topic-1', true);

  expect(first.id).toBe(expectedId('topic-1'));
  expect(first.topicId).toBe('topic-1');
  expect(first.done).toBe(true);
  expect(first.doneAt).toBeDefined();
  expect(await db.topicProgress.count()).toBe(1);
  expect(await getTopicDone('topic-1')).toBe(true);
  expect(await listAllTopicProgress()).toHaveLength(1);

  const second = await setTopicDone('topic-1', false);

  expect(second.id).toBe(expectedId('topic-1'));
  expect(second.done).toBe(false);
  expect(second.doneAt).toBeUndefined();
  expect(await db.topicProgress.count()).toBe(1);
  expect(await getTopicDone('topic-1')).toBe(false);
});

test('konu tekrar kayıtları tür, konu ve silinme durumuna göre süzülür', async () => {
  await db.activityLogs.bulkAdd([
    reviewLog('review-1', 'topic-1', { createdAt: '2026-11-02T09:00:00.000Z' }),
    reviewLog('review-2', 'topic-2'),
    reviewLog('review-3', 'topic-1', { type: 'book_pages' }),
    reviewLog('review-4', 'topic-1', { deletedAt: CREATED_AT }),
  ]);

  expect((await listTopicReviews('topic-1')).map((log) => log.id)).toEqual(['review-1']);
  expect((await listAllTopicReviews()).map((log) => log.id).sort()).toEqual([
    'review-1',
    'review-2',
  ]);
});

test('özel konu silinince durum satırı, tekrar kayıtları ve plan görevleri temizlenir', async () => {
  await insertTopic('topic-1', true);
  await insertTopic('topic-2', true);
  await setTopicDone('topic-1', true);
  await setTopicDone('topic-2', true);
  await db.notes.put({
    topicId: 'topic-1',
    contentHtml: '<p>Not</p>',
    plainText: 'Not',
    updatedAt: CREATED_AT,
  });
  await db.activityLogs.bulkAdd([
    reviewLog('review-1', 'topic-1'),
    reviewLog('review-2', 'topic-2'),
  ]);
  await db.scheduleTasks.bulkAdd([
    planTask('task-1', 'topic-1'),
    planTask('task-2', 'topic-2'),
  ]);

  await deleteCustomTopicCascade('topic-1');

  expect(await db.topics.get('topic-1')).toBeUndefined();
  expect(await db.notes.get('topic-1')).toBeUndefined();
  expect(await db.topicProgress.where('topicId').equals('topic-1').count()).toBe(0);
  expect((await db.activityLogs.get('review-1'))?.deletedAt).toBeDefined();
  expect((await db.scheduleTasks.get('task-1'))?.deletedAt).toBeDefined();

  // Başka bir konunun durumu ve kayıtları etkilenmez.
  expect(await getTopicDone('topic-2')).toBe(true);
  expect((await db.activityLogs.get('review-2'))?.deletedAt).toBeUndefined();
  expect((await db.scheduleTasks.get('task-2'))?.deletedAt).toBeUndefined();
});
