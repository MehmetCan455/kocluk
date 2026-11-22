import { beforeEach, expect, test } from 'vitest';
import type { ActivityLog, CatalogBook, ScheduleTask, Topic } from '@/domain/types';
import { deterministicId } from '@/lib/deterministicId';
import { COPY_NAMESPACE, LOCAL_SCOPE, WEEK_NAMESPACE } from '@/lib/namespaces';
import { addCatalogBookToShelf, getShelfBook, updateUserBook } from './bookRepositories';
import { db } from './db';
import type { CreateScheduleTaskInput } from './scheduleRepository';
import {
  addRow,
  addTask,
  copyWeek,
  deleteRow,
  deleteTask,
  getOrCreateWeek,
  getWeek,
  listBookTasks,
  listTasksForDay,
  renameRow,
  saveWeekNote,
  toggleTask,
  updateTask,
} from './scheduleRepository';
import { getTopicDone } from './topicProgressRepository';

const CREATED_AT = '2026-11-01T09:00:00.000Z';
const WEEK_START = '2026-11-16';
const NEXT_WEEK_START = '2026-11-23';

async function seedShelfBook(totalPages = 400): Promise<string> {
  const catalog: CatalogBook = {
    id: 'catalog-book-1',
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    totalPages,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.catalogBooks.add(catalog);
  const userBook = await addCatalogBookToShelf(catalog.id);
  return userBook.id;
}

async function seedWeekAndRow(): Promise<{
  weekId: string;
  rowId: string;
}> {
  const { week } = await getOrCreateWeek(WEEK_START);
  const row = await addRow(week.id, 'Matematik');
  return { weekId: week.id, rowId: row.id };
}

function bookInput(
  weekId: string,
  rowId: string,
  userBookId: string,
  fromPage: number | undefined,
  toPage: number | undefined,
  dayIndex = 1,
): CreateScheduleTaskInput {
  return {
    weekId,
    rowId,
    dayIndex,
    type: 'book',
    userBookId,
    fromPage,
    toPage,
  };
}

async function taskLogs(taskId: string): Promise<ActivityLog[]> {
  return db.activityLogs.where('taskId').equals(taskId).toArray();
}

async function activeTaskLogs(taskId: string): Promise<ActivityLog[]> {
  return (await taskLogs(taskId)).filter((log) => !log.deletedAt);
}

async function insertTopic(id = 'topic-1'): Promise<Topic> {
  const topic: Topic = {
    id,
    subjectId: 'subject-1',
    name: 'Türev',
    order: 1,
    isCustom: false,
    createdAt: CREATED_AT,
  };
  await db.topics.add(topic);
  return topic;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

test('hafta deterministik kimlikle oluşturulur, not kaydedilir ve silinmiş hafta geri getirilir', async () => {
  expect(await getWeek(WEEK_START)).toBeUndefined();

  const first = await getOrCreateWeek(WEEK_START);
  expect(first.week.id).toBe(
    deterministicId(WEEK_NAMESPACE, `${LOCAL_SCOPE}:${WEEK_START}`),
  );
  expect(first.week.note).toBe('');
  expect(first.rows).toEqual([]);
  expect(first.tasks).toEqual([]);

  await saveWeekNote(first.week.id, '  Deneme notu  ');
  expect((await getWeek(WEEK_START))?.week.note).toBe('Deneme notu');

  await db.scheduleWeeks.update(first.week.id, { deletedAt: CREATED_AT });
  expect(await getWeek(WEEK_START)).toBeUndefined();

  const revived = await getOrCreateWeek(WEEK_START);
  expect(revived.week.id).toBe(first.week.id);
  expect(revived.week.deletedAt).toBeUndefined();
  expect(revived.week.note).toBe('Deneme notu');
  expect(await db.scheduleWeeks.count()).toBe(1);
});

test('satırlar sırayla eklenir ve yeniden adlandırılır', async () => {
  const { week } = await getOrCreateWeek(WEEK_START);

  const first = await addRow(week.id, '  Bilgi Sarmal  ', 'subject-1');
  const second = await addRow(week.id, 'Fizik');

  expect(first).toMatchObject({ label: 'Bilgi Sarmal', subjectId: 'subject-1', order: 0 });
  expect(second.order).toBe(1);
  expect((await getWeek(WEEK_START))?.rows.map((row) => row.id)).toEqual([
    first.id,
    second.id,
  ]);

  await renameRow(first.id, '  Bilgi Sarmal TYT  ');
  expect((await db.scheduleRows.get(first.id))?.label).toBe('Bilgi Sarmal TYT');
  await expect(renameRow(first.id, '   ')).rejects.toThrow('Satır adı boş olamaz.');
});

test('kitap görevi sayfa aralığını ve kitabı doğrular', async () => {
  const userBookId = await seedShelfBook(400);
  const { weekId, rowId } = await seedWeekAndRow();
  const input = bookInput(weekId, rowId, userBookId, 10, 20, 3);

  await expect(addTask({ ...input, fromPage: 30, toPage: 20 })).rejects.toThrow(
    'Başlangıç sayfası bitiş sayfasından büyük olamaz.',
  );
  await expect(addTask({ ...input, fromPage: 0, toPage: 20 })).rejects.toThrow(
    'Sayfa numaraları 1 veya daha büyük olmalı.',
  );
  await expect(addTask({ ...input, fromPage: 10, toPage: 401 })).rejects.toThrow(
    'Bitiş sayfası toplam sayfa sayısını aşamaz.',
  );
  await expect(addTask({ ...input, fromPage: 1.5, toPage: 20 })).rejects.toThrow(
    'Sayfa numaraları tam sayı olmalı.',
  );
  await expect(
    addTask({ ...input, fromPage: undefined, toPage: undefined }),
  ).rejects.toThrow('Başlangıç ve bitiş sayfası gerekli.');
  await expect(addTask({ ...input, userBookId: 'olmayan-kitap' })).rejects.toThrow(
    'Raf kitabı bulunamadı',
  );
  expect(await db.scheduleTasks.count()).toBe(0);

  const task = await addTask(input);
  expect(task).toMatchObject({
    weekId,
    rowId,
    dayIndex: 3,
    type: 'book',
    userBookId,
    fromPage: 10,
    toPage: 20,
  });
  expect(task.completedAt).toBeUndefined();
});

test('konu ve serbest görev alanları doğrulanır', async () => {
  const { weekId, rowId } = await seedWeekAndRow();

  await expect(
    addTask({ weekId, rowId, dayIndex: 2, type: 'topic', topicId: 'olmayan-konu' }),
  ).rejects.toThrow('Konu bulunamadı');
  await expect(
    addTask({ weekId, rowId, dayIndex: 2, type: 'free', title: '   ' }),
  ).rejects.toThrow('Görev adı boş olamaz.');

  await insertTopic('topic-1');
  const topicTask = await addTask({
    weekId,
    rowId,
    dayIndex: 2,
    type: 'topic',
    topicId: 'topic-1',
  });
  expect(topicTask).toMatchObject({
    type: 'topic',
    topicId: 'topic-1',
    dayIndex: 2,
  });
  expect(topicTask.userBookId).toBeUndefined();
  expect(topicTask.fromPage).toBeUndefined();

  const freeTask = await addTask({
    weekId,
    rowId,
    dayIndex: 5,
    type: 'free',
    title: '  Deneme çöz  ',
  });
  expect(freeTask).toMatchObject({ type: 'free', title: 'Deneme çöz' });
  expect(freeTask.topicId).toBeUndefined();
});

test('tikleme tek etkin kitap kaydı oluşturur, geri alma kaydı tombstone eder', async () => {
  const userBookId = await seedShelfBook(400);
  const { weekId, rowId } = await seedWeekAndRow();
  const task = await addTask(bookInput(weekId, rowId, userBookId, 10, 20));

  await toggleTask(task.id, true);

  const firstActive = await activeTaskLogs(task.id);
  expect(firstActive).toHaveLength(1);
  expect(firstActive[0]).toMatchObject({
    type: 'book_pages',
    source: 'task',
    taskId: task.id,
    userBookId,
    fromPage: 10,
    toPage: 20,
  });
  expect((await db.scheduleTasks.get(task.id))?.completedAt).toBeDefined();
  expect((await getShelfBook(userBookId))?.progress.currentPage).toBe(20);

  // İkinci kez tiklemek etkin kayıt sayısını artırmaz.
  await toggleTask(task.id, true);
  expect(await activeTaskLogs(task.id)).toHaveLength(1);

  await toggleTask(task.id, false);
  const afterUntick = await taskLogs(task.id);
  expect(afterUntick).toHaveLength(1);
  expect(afterUntick[0].deletedAt).toBeDefined();
  expect((await db.scheduleTasks.get(task.id))?.completedAt).toBeUndefined();
  expect((await getShelfBook(userBookId))?.progress.currentPage).toBe(0);

  await toggleTask(task.id, true);
  const afterRetick = await taskLogs(task.id);
  expect(afterRetick).toHaveLength(2);
  const activeAgain = afterRetick.filter((log) => !log.deletedAt);
  expect(activeAgain).toHaveLength(1);
  expect(activeAgain[0].id).not.toBe(firstActive[0].id);
  expect((await getShelfBook(userBookId))?.progress.currentPage).toBe(20);
});

test('tikleme kitabın güncel toplam sayfasına göre yeniden doğrulanır', async () => {
  const userBookId = await seedShelfBook(400);
  const { weekId, rowId } = await seedWeekAndRow();
  const task = await addTask(bookInput(weekId, rowId, userBookId, 10, 100));

  await updateUserBook(userBookId, { totalPagesOverride: 50 });

  await expect(toggleTask(task.id, true)).rejects.toThrow(
    'Bitiş sayfası toplam sayfa sayısını aşamaz.',
  );
  expect((await db.scheduleTasks.get(task.id))?.completedAt).toBeUndefined();
  expect(await db.activityLogs.count()).toBe(0);
});

test('görev kaydı kitabın son etkin kaydından sonra zaman damgalanır', async () => {
  const userBookId = await seedShelfBook(400);
  const { weekId, rowId } = await seedWeekAndRow();
  const task = await addTask(bookInput(weekId, rowId, userBookId, 10, 20));

  const future = new Date(Date.now() + 60_000).toISOString();
  await db.activityLogs.add({
    id: 'page-set-1',
    type: 'page_set',
    userBookId,
    toPage: 5,
    source: 'manual',
    createdAt: future,
  });

  await toggleTask(task.id, true);

  const tick = (await activeTaskLogs(task.id))[0];
  expect(tick.createdAt > future).toBe(true);
  expect((await getShelfBook(userBookId))?.progress.currentPage).toBe(20);
});

test('konu görevi tekrar kaydı oluşturur ve konu durumunu değiştirmez', async () => {
  await insertTopic('topic-1');
  const { weekId, rowId } = await seedWeekAndRow();
  const task = await addTask({
    weekId,
    rowId,
    dayIndex: 2,
    type: 'topic',
    topicId: 'topic-1',
  });

  await toggleTask(task.id, true);

  const reviews = (
    await db.activityLogs.where('topicId').equals('topic-1').toArray()
  ).filter((log) => !log.deletedAt);
  expect(reviews).toHaveLength(1);
  expect(reviews[0]).toMatchObject({
    type: 'topic_review',
    source: 'task',
    taskId: task.id,
    topicId: 'topic-1',
  });
  expect(await db.topicProgress.count()).toBe(0);
  expect(await getTopicDone('topic-1')).toBe(false);
});

test('serbest görev aktivite kaydı oluşturmaz', async () => {
  const { weekId, rowId } = await seedWeekAndRow();
  const task = await addTask({
    weekId,
    rowId,
    dayIndex: 4,
    type: 'free',
    title: 'Deneme çöz',
  });

  await toggleTask(task.id, true);

  expect((await db.scheduleTasks.get(task.id))?.completedAt).toBeDefined();
  expect(await db.activityLogs.count()).toBe(0);
});

test('tamamlanan görevin sayfa aralığı güncellenince kayıt yenilenir', async () => {
  const userBookId = await seedShelfBook(400);
  const { weekId, rowId } = await seedWeekAndRow();
  const task = await addTask(bookInput(weekId, rowId, userBookId, 10, 20));

  await toggleTask(task.id, true);
  const oldLog = (await activeTaskLogs(task.id))[0];

  await updateTask(task.id, {
    rowId,
    dayIndex: 4,
    type: 'book',
    userBookId,
    fromPage: 30,
    toPage: 40,
  });

  const logs = await taskLogs(task.id);
  expect(logs).toHaveLength(2);
  expect(logs.find((log) => log.id === oldLog.id)?.deletedAt).toBeDefined();
  const active = logs.filter((log) => !log.deletedAt);
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({
    type: 'book_pages',
    fromPage: 30,
    toPage: 40,
    taskId: task.id,
  });

  const saved = await db.scheduleTasks.get(task.id);
  expect(saved).toMatchObject({ fromPage: 30, toPage: 40, dayIndex: 4 });
  expect(saved?.completedAt).toBeDefined();
  expect((await getShelfBook(userBookId))?.progress.currentPage).toBe(40);

  await expect(
    updateTask(task.id, {
      rowId,
      dayIndex: 4,
      type: 'book',
      userBookId,
      fromPage: 50,
      toPage: 10,
    }),
  ).rejects.toThrow('Başlangıç sayfası bitiş sayfasından büyük olamaz.');
});

test('hafta kopyası tamamlanma ve kayıtları taşımaz, tekrar kopya çoğaltmaz', async () => {
  const userBookId = await seedShelfBook(400);
  const source = await getOrCreateWeek(WEEK_START);
  await saveWeekNote(source.week.id, 'Kaynak hafta notu');
  const mathRow = await addRow(source.week.id, 'Matematik');
  const physicsRow = await addRow(source.week.id, 'Fizik');
  const bookTask = await addTask(
    bookInput(source.week.id, mathRow.id, userBookId, 10, 20),
  );
  const freeTask = await addTask({
    weekId: source.week.id,
    rowId: physicsRow.id,
    dayIndex: 2,
    type: 'free',
    title: 'Deneme çöz',
  });
  await toggleTask(bookTask.id, true);
  const logCount = await db.activityLogs.count();
  expect(logCount).toBe(1);

  await copyWeek(WEEK_START, NEXT_WEEK_START);

  const target = await getOrCreateWeek(NEXT_WEEK_START);
  expect(target.week.note).toBe('');
  expect(target.rows.map((row) => row.label)).toEqual(['Matematik', 'Fizik']);
  expect(target.rows[0].id).toBe(
    deterministicId(COPY_NAMESPACE, `${target.week.id}:${mathRow.id}`),
  );
  expect(target.tasks).toHaveLength(2);
  expect(target.tasks.every((task) => task.completedAt === undefined)).toBe(true);
  expect(target.tasks.map((task) => task.title)).toContain('Deneme çöz');
  expect(target.tasks.map((task) => task.id).sort()).toEqual(
    [bookTask.id, freeTask.id]
      .map((sourceId) => deterministicId(COPY_NAMESPACE, `${target.week.id}:${sourceId}`))
      .sort(),
  );
  for (const task of target.tasks) {
    expect(task.weekId).toBe(target.week.id);
    expect(target.rows.map((row) => row.id)).toContain(task.rowId);
  }
  expect(await db.activityLogs.count()).toBe(logCount);

  await copyWeek(WEEK_START, NEXT_WEEK_START);

  const again = await getOrCreateWeek(NEXT_WEEK_START);
  expect(again.rows).toHaveLength(2);
  expect(again.tasks).toHaveLength(2);
  expect(await db.scheduleRows.where('weekId').equals(target.week.id).count()).toBe(2);
  expect(await db.scheduleTasks.where('weekId').equals(target.week.id).count()).toBe(2);
  expect(await db.activityLogs.count()).toBe(logCount);
});

test('görev silme kaydı korur, satır silme görevleri tombstone eder', async () => {
  const userBookId = await seedShelfBook(400);
  const { weekId, rowId: seedRowId } = await seedWeekAndRow();
  const firstRow = await addRow(weekId, 'Silinecek satır');
  const firstTask = await addTask(bookInput(weekId, firstRow.id, userBookId, 10, 20));
  await toggleTask(firstTask.id, true);
  const progressLog = (await activeTaskLogs(firstTask.id))[0];

  await deleteTask(firstTask.id);

  expect((await db.scheduleTasks.get(firstTask.id))?.deletedAt).toBeDefined();
  expect((await db.activityLogs.get(progressLog.id))?.deletedAt).toBeUndefined();
  expect((await getShelfBook(userBookId))?.progress.currentPage).toBe(20);
  expect(await listBookTasks(userBookId)).toEqual([]);

  const secondRow = await addRow(weekId, 'Kalacak satır');
  const secondTask = await addTask(bookInput(weekId, secondRow.id, userBookId, 30, 40));
  await toggleTask(secondTask.id, true);
  const rowLog = (await activeTaskLogs(secondTask.id))[0];

  await deleteRow(secondRow.id);

  expect((await db.scheduleRows.get(secondRow.id))?.deletedAt).toBeDefined();
  expect((await db.scheduleTasks.get(secondTask.id))?.deletedAt).toBeDefined();
  expect((await db.activityLogs.get(rowLog.id))?.deletedAt).toBeUndefined();
  expect((await getShelfBook(userBookId))?.progress.currentPage).toBe(40);
  expect((await db.scheduleRows.get(firstRow.id))?.deletedAt).toBeUndefined();

  const week = await getWeek(WEEK_START);
  expect(week?.rows.map((row) => row.id)).toEqual([seedRowId, firstRow.id]);
  expect(week?.tasks).toEqual([]);
});

test('kitap görevleri hafta başlangıcıyla listelenir', async () => {
  const userBookId = await seedShelfBook(400);
  const first = await getOrCreateWeek(WEEK_START);
  const firstRow = await addRow(first.week.id, 'Matematik');
  const firstTask = await addTask(
    bookInput(first.week.id, firstRow.id, userBookId, 10, 20, 2),
  );
  const second = await getOrCreateWeek(NEXT_WEEK_START);
  const secondRow = await addRow(second.week.id, 'Matematik');
  const secondTask = await addTask(
    bookInput(second.week.id, secondRow.id, userBookId, 20, 30, 4),
  );
  const removed = await addTask(
    bookInput(second.week.id, secondRow.id, userBookId, 30, 40, 5),
  );
  await deleteTask(removed.id);

  const listed = await listBookTasks(userBookId);
  expect(listed.map((task) => task.id)).toEqual([firstTask.id, secondTask.id]);
  expect(listed.map((task) => task.weekStart)).toEqual([WEEK_START, NEXT_WEEK_START]);
});

test('gün görevleri yalnızca o günün etkin görevlerini döndürür', async () => {
  const { weekId, rowId } = await seedWeekAndRow();
  const monday = await addTask({
    weekId,
    rowId,
    dayIndex: 1,
    type: 'free',
    title: 'Pazartesi bir',
  });
  const mondayTwo = await addTask({
    weekId,
    rowId,
    dayIndex: 1,
    type: 'free',
    title: 'Pazartesi iki',
  });
  const tuesday: ScheduleTask = await addTask({
    weekId,
    rowId,
    dayIndex: 2,
    type: 'free',
    title: 'Salı',
  });

  const mondayTasks = await listTasksForDay(WEEK_START, 1);
  expect(mondayTasks.map((task) => task.id).sort()).toEqual(
    [monday.id, mondayTwo.id].sort(),
  );
  expect((await listTasksForDay(WEEK_START, 2)).map((task) => task.id)).toEqual([
    tuesday.id,
  ]);
  expect(await listTasksForDay(WEEK_START, 7)).toEqual([]);
  expect(await listTasksForDay('2026-11-30', 1)).toEqual([]);
});
