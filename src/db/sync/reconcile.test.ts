import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { CatalogBook, ScheduleTask, UserBook } from '@/domain/types';
import { KoclukDB } from '../db';
import { PULL_PATH } from './constants';
import type { PullApiClient } from './pull';
import { installSyncHooks, pendingChanges, setApplyingRemote, whenQueueIdle } from './queue';
import { reconcileTaskActivities } from './reconcile';

const DB_NAME = 'kocluk-sync-reconcile-test';
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

function topicTask(overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: 'task-1',
    weekId: 'week-1',
    rowId: 'row-1',
    dayIndex: 1,
    type: 'topic',
    topicId: 'topic-1',
    completedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function clearQueue(): Promise<void> {
  await whenQueueIdle();
  await database.syncQueue.clear();
}

test('tamamlanmış konu görevi için eksik aktivite kaydı oluşturulur', async () => {
  await database.scheduleTasks.add(topicTask());
  await clearQueue();

  const written = await reconcileTaskActivities(database);
  await whenQueueIdle();

  expect(written).toBe(1);
  const logs = await database.activityLogs.toArray();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    type: 'topic_review',
    topicId: 'topic-1',
    taskId: 'task-1',
    source: 'task',
  });
  expect((await pendingChanges(database)).map((row) => row.id)).toEqual([
    `activityLogs:${logs[0].id}`,
  ]);
});

test('tamamlanmamış görevin aktif aktivitesi tombstone edilir', async () => {
  const task = topicTask();
  await database.scheduleTasks.add(task);
  await database.activityLogs.add({
    id: 'log-1',
    type: 'topic_review',
    topicId: 'topic-1',
    taskId: 'task-1',
    source: 'task',
    createdAt: NOW,
  });
  await clearQueue();

  const persisted = await database.scheduleTasks.get('task-1');
  expect(persisted).toBeDefined();
  const next: ScheduleTask = { ...persisted as ScheduleTask };
  delete next.completedAt;
  next.updatedAt = NOW;
  await database.scheduleTasks.put(next);
  await clearQueue();

  const written = await reconcileTaskActivities(database);

  expect(written).toBe(1);
  expect((await database.activityLogs.get('log-1'))?.deletedAt).toBeDefined();
  expect(await database.activityLogs.count()).toBe(1);
});

test('silinen plan görevinin geçmiş aktivitesi korunur', async () => {
  await database.scheduleTasks.add(topicTask({ deletedAt: NOW }));
  await database.activityLogs.add({
    id: 'log-1',
    type: 'topic_review',
    topicId: 'topic-1',
    taskId: 'task-1',
    source: 'task',
    createdAt: NOW,
  });
  await clearQueue();

  const written = await reconcileTaskActivities(database);

  expect(written).toBe(0);
  expect((await database.activityLogs.get('log-1'))?.deletedAt).toBeUndefined();
});

test('kitap görevi tamamlanınca raf durumu da güncellenir', async () => {
  const catalogBook: CatalogBook = {
    id: 'book-1',
    ownerId: 'local',
    title: 'Kitap',
    totalPages: 10,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const userBook: UserBook = {
    id: 'ub-1',
    bookId: 'book-1',
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  };
  await database.catalogBooks.add(catalogBook);
  await database.userBooks.add(userBook);
  await database.scheduleTasks.add(
    topicTask({
      type: 'book',
      topicId: undefined,
      userBookId: 'ub-1',
      fromPage: 1,
      toPage: 10,
    }),
  );
  await clearQueue();

  const written = await reconcileTaskActivities(database);

  expect(written).toBe(1);
  expect((await database.userBooks.get('ub-1'))?.status).toBe('completed');
  const log = (await database.activityLogs.toArray())[0];
  expect(log).toMatchObject({
    type: 'book_pages',
    userBookId: 'ub-1',
    fromPage: 1,
    toPage: 10,
    taskId: 'task-1',
  });
});

test('pull sonrası uzlaştırma çalışır ve imleci bozmaz', async () => {
  await database.scheduleTasks.add(topicTask());
  await clearQueue();

  const client: PullApiClient = {
    async get<T>(path: string): Promise<T> {
      expect(path).toBe(`${PULL_PATH}?since=0&limit=500`);
      return { changes: [], nextCursor: 55, hasMore: false } as T;
    },
  };

  const { pullAll } = await import('./pull');
  await pullAll(database, client);

  expect(await database.activityLogs.count()).toBe(1);
  expect((await database.activityLogs.toArray())[0].taskId).toBe('task-1');
});
