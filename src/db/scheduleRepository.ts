import { resolveBookTotalPages } from '@/domain/bookProgress';
import { validateTaskPages } from '@/domain/schedule';
import type {
  ActivityLog,
  ScheduleRow,
  ScheduleTask,
  ScheduleTaskType,
  ScheduleWeek,
} from '@/domain/types';
import { deterministicId } from '@/lib/deterministicId';
import { newId } from '@/lib/id';
import { COPY_NAMESPACE, LOCAL_SCOPE, WEEK_NAMESPACE } from '@/lib/namespaces';
import { db } from './db';

export interface WeekData {
  week: ScheduleWeek;
  rows: ScheduleRow[];
  tasks: ScheduleTask[];
}

export interface CreateScheduleTaskInput {
  weekId: string;
  rowId: string;
  dayIndex: number;
  type: ScheduleTaskType;
  userBookId?: string;
  fromPage?: number;
  toPage?: number;
  topicId?: string;
  title?: string;
}

/** A task never moves to another week; its row and day can change. */
export type UpdateScheduleTaskInput = Omit<CreateScheduleTaskInput, 'weekId'>;

/** The validated, type-specific fields stored on a task. */
interface TaskFields {
  type: ScheduleTaskType;
  userBookId?: string;
  fromPage?: number;
  toPage?: number;
  topicId?: string;
  title?: string;
}

function weekId(weekStart: string): string {
  return deterministicId(WEEK_NAMESPACE, `${LOCAL_SCOPE}:${weekStart}`);
}

function copiedId(targetWeekId: string, sourceId: string): string {
  return deterministicId(COPY_NAMESPACE, `${targetWeekId}:${sourceId}`);
}

function activeLogs(logs: ActivityLog[]): ActivityLog[] {
  return logs.filter((log) => !log.deletedAt);
}

/**
 * Activity must sort after every earlier log even when two writes land in the
 * same millisecond, because the calculator picks the latest baseline by
 * `createdAt` and a same-millisecond page set could otherwise hide a tick.
 */
function nextActivityTimestamp(logs: ActivityLog[]): string {
  const latest = logs.reduce(
    (max, log) => Math.max(max, Date.parse(log.createdAt) || 0),
    0,
  );
  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

function sortRows(rows: ScheduleRow[]): ScheduleRow[] {
  return rows.sort(
    (left, right) =>
      left.order - right.order ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function sortTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  return tasks.sort(
    (left, right) =>
      left.dayIndex - right.dayIndex ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

async function findActiveWeek(weekStart: string): Promise<ScheduleWeek | undefined> {
  const week = await db.scheduleWeeks.where('weekStart').equals(weekStart).first();
  return week && !week.deletedAt ? week : undefined;
}

/** Reuses a soft-deleted week row instead of violating the unique `weekStart`. */
async function ensureWeek(weekStart: string): Promise<ScheduleWeek> {
  const existing = await db.scheduleWeeks
    .where('weekStart')
    .equals(weekStart)
    .first();
  const now = new Date().toISOString();

  if (existing) {
    if (!existing.deletedAt) {
      return existing;
    }
    const revived: ScheduleWeek = { ...existing, updatedAt: now };
    delete revived.deletedAt;
    await db.scheduleWeeks.put(revived);
    return revived;
  }

  const created: ScheduleWeek = {
    id: weekId(weekStart),
    weekStart,
    note: '',
    createdAt: now,
    updatedAt: now,
  };
  await db.scheduleWeeks.put(created);
  return created;
}

async function loadWeekData(week: ScheduleWeek): Promise<WeekData> {
  const [rows, tasks] = await Promise.all([
    db.scheduleRows.where('weekId').equals(week.id).toArray(),
    db.scheduleTasks.where('weekId').equals(week.id).toArray(),
  ]);

  return {
    week,
    rows: sortRows(rows.filter((row) => !row.deletedAt)),
    tasks: sortTasks(tasks.filter((task) => !task.deletedAt)),
  };
}

export async function getWeek(weekStart: string): Promise<WeekData | undefined> {
  const week = await findActiveWeek(weekStart);
  return week ? loadWeekData(week) : undefined;
}

export async function getOrCreateWeek(weekStart: string): Promise<WeekData> {
  return db.transaction(
    'rw',
    db.scheduleWeeks,
    db.scheduleRows,
    db.scheduleTasks,
    async () => {
      const week = await ensureWeek(weekStart);
      return loadWeekData(week);
    },
  );
}

export async function saveWeekNote(weekId: string, note: string): Promise<void> {
  await db.scheduleWeeks.update(weekId, {
    note: note.trim(),
    updatedAt: new Date().toISOString(),
  });
}

export async function addRow(
  weekId: string,
  label: string,
  subjectId?: string,
): Promise<ScheduleRow> {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new Error('Satır adı boş olamaz.');
  }

  return db.transaction('rw', db.scheduleRows, async () => {
    const rows = await db.scheduleRows.where('weekId').equals(weekId).toArray();
    const nextOrder =
      rows
        .filter((row) => !row.deletedAt)
        .reduce((max, row) => Math.max(max, row.order), -1) + 1;
    const now = new Date().toISOString();
    const row: ScheduleRow = {
      id: newId(),
      weekId,
      subjectId: subjectId?.trim() || undefined,
      label: trimmedLabel,
      order: nextOrder,
      createdAt: now,
      updatedAt: now,
    };
    await db.scheduleRows.add(row);
    return row;
  });
}

export async function renameRow(rowId: string, label: string): Promise<void> {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new Error('Satır adı boş olamaz.');
  }

  const row = await db.scheduleRows.get(rowId);
  if (!row || row.deletedAt) {
    return;
  }
  await db.scheduleRows.put({
    ...row,
    label: trimmedLabel,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Tombstones the row and its tasks. Their activity logs stay active so book and
 * topic history is not rewritten by a plan edit.
 */
export async function deleteRow(rowId: string): Promise<void> {
  await db.transaction('rw', db.scheduleRows, db.scheduleTasks, async () => {
    const row = await db.scheduleRows.get(rowId);
    if (!row || row.deletedAt) {
      return;
    }

    const now = new Date().toISOString();
    await db.scheduleRows.put({ ...row, deletedAt: now, updatedAt: now });

    const tasks = (
      await db.scheduleTasks.where('rowId').equals(rowId).toArray()
    ).filter((task) => !task.deletedAt);
    if (tasks.length > 0) {
      await db.scheduleTasks.bulkPut(
        tasks.map((task) => ({ ...task, deletedAt: now, updatedAt: now })),
      );
    }
  });
}

function invalidPageNumber(value: number | undefined): boolean {
  return value !== undefined && !Number.isInteger(value);
}

/**
 * Validates and normalizes the type-specific fields. Blank page inputs must
 * arrive as `undefined`, never `NaN`.
 */
async function validateTaskFields(
  input: CreateScheduleTaskInput | UpdateScheduleTaskInput,
): Promise<TaskFields> {
  switch (input.type) {
    case 'book': {
      if (!input.userBookId) {
        throw new Error('Kitap seçilmeli.');
      }
      const userBook = await db.userBooks.get(input.userBookId);
      if (!userBook || userBook.deletedAt) {
        throw new Error('Raf kitabı bulunamadı');
      }
      const catalogBook = await db.catalogBooks.get(userBook.bookId);
      if (!catalogBook || catalogBook.deletedAt) {
        throw new Error('Kitap bulunamadı');
      }
      if (invalidPageNumber(input.fromPage) || invalidPageNumber(input.toPage)) {
        throw new Error('Sayfa numaraları tam sayı olmalı.');
      }
      const error = validateTaskPages(
        input.fromPage,
        input.toPage,
        resolveBookTotalPages(userBook, catalogBook),
      );
      if (error) {
        throw new Error(error);
      }
      return {
        type: 'book',
        userBookId: input.userBookId,
        fromPage: input.fromPage,
        toPage: input.toPage,
      };
    }
    case 'topic': {
      if (!input.topicId) {
        throw new Error('Konu seçilmeli.');
      }
      const topic = await db.topics.get(input.topicId);
      if (!topic) {
        throw new Error('Konu bulunamadı');
      }
      return { type: 'topic', topicId: input.topicId };
    }
    case 'free': {
      const title = input.title?.trim();
      if (!title) {
        throw new Error('Görev adı boş olamaz.');
      }
      return { type: 'free', title };
    }
  }
}

export async function addTask(
  input: CreateScheduleTaskInput,
): Promise<ScheduleTask> {
  return db.transaction(
    'rw',
    db.scheduleTasks,
    db.userBooks,
    db.catalogBooks,
    db.topics,
    async () => {
      const fields = await validateTaskFields(input);
      const now = new Date().toISOString();
      const task: ScheduleTask = {
        id: newId(),
        weekId: input.weekId,
        rowId: input.rowId,
        dayIndex: input.dayIndex,
        ...fields,
        createdAt: now,
        updatedAt: now,
      };
      await db.scheduleTasks.add(task);
      return task;
    },
  );
}

/**
 * Replaces the linked activity with a fresh record. The old record is
 * tombstoned instead of deleted so progress history stays append-only.
 */
async function replaceTaskActivity(
  taskId: string,
  fields: TaskFields,
  now: string,
): Promise<void> {
  const previous = activeLogs(
    await db.activityLogs.where('taskId').equals(taskId).toArray(),
  );
  if (previous.length > 0) {
    await db.activityLogs.bulkPut(
      previous.map((log) => ({ ...log, deletedAt: now })),
    );
  }

  if (fields.type === 'book') {
    const userBookId = fields.userBookId;
    if (!userBookId) {
      throw new Error('Raf kitabı bulunamadı');
    }
    const bookLogs = activeLogs(
      await db.activityLogs.where('userBookId').equals(userBookId).toArray(),
    );
    const log: ActivityLog = {
      id: newId(),
      type: 'book_pages',
      userBookId,
      fromPage: fields.fromPage,
      toPage: fields.toPage,
      taskId,
      source: 'task',
      createdAt: nextActivityTimestamp(bookLogs),
    };
    await db.activityLogs.add(log);
  } else if (fields.type === 'topic') {
    const log: ActivityLog = {
      id: newId(),
      type: 'topic_review',
      topicId: fields.topicId,
      taskId,
      source: 'task',
      createdAt: now,
    };
    await db.activityLogs.add(log);
  }
}

export async function updateTask(
  taskId: string,
  input: UpdateScheduleTaskInput,
): Promise<void> {
  await db.transaction(
    'rw',
    db.scheduleTasks,
    db.activityLogs,
    db.userBooks,
    db.catalogBooks,
    db.topics,
    async () => {
      const task = await db.scheduleTasks.get(taskId);
      if (!task || task.deletedAt) {
        throw new Error('Görev bulunamadı');
      }

      const fields = await validateTaskFields(input);
      const now = new Date().toISOString();
      const next: ScheduleTask = {
        id: task.id,
        weekId: task.weekId,
        rowId: input.rowId,
        dayIndex: input.dayIndex,
        type: fields.type,
        createdAt: task.createdAt,
        updatedAt: now,
      };
      if (fields.userBookId !== undefined) {
        next.userBookId = fields.userBookId;
      }
      if (fields.fromPage !== undefined) {
        next.fromPage = fields.fromPage;
      }
      if (fields.toPage !== undefined) {
        next.toPage = fields.toPage;
      }
      if (fields.topicId !== undefined) {
        next.topicId = fields.topicId;
      }
      if (fields.title !== undefined) {
        next.title = fields.title;
      }
      if (task.completedAt !== undefined) {
        next.completedAt = task.completedAt;
        await replaceTaskActivity(taskId, fields, now);
      }

      await db.scheduleTasks.put(next);
    },
  );
}

export async function toggleTask(taskId: string, done: boolean): Promise<void> {
  await db.transaction(
    'rw',
    db.scheduleTasks,
    db.activityLogs,
    db.userBooks,
    db.catalogBooks,
    db.topics,
    async () => {
      const task = await db.scheduleTasks.get(taskId);
      if (!task || task.deletedAt) {
        throw new Error('Görev bulunamadı');
      }

      const existing = activeLogs(
        await db.activityLogs.where('taskId').equals(taskId).toArray(),
      );
      const now = new Date().toISOString();

      if (!done) {
        if (!task.completedAt && existing.length === 0) {
          return;
        }
        if (existing.length > 0) {
          await db.activityLogs.bulkPut(
            existing.map((log) => ({ ...log, deletedAt: now })),
          );
        }
        const next: ScheduleTask = { ...task, updatedAt: now };
        delete next.completedAt;
        await db.scheduleTasks.put(next);
        return;
      }

      if (task.completedAt) {
        return;
      }

      // Ticking re-validates against the book's current total pages, not the
      // total that was present when the task was created.
      const fields = await validateTaskFields(task);
      await replaceTaskActivity(taskId, fields, now);
      await db.scheduleTasks.put({
        ...task,
        completedAt: now,
        updatedAt: now,
      });
    },
  );
}

/**
 * Tombstones the task but keeps its active activity log, so book progress and
 * history remain after a plan edit. Only unticking removes the activity.
 */
export async function deleteTask(taskId: string): Promise<void> {
  await db.transaction('rw', db.scheduleTasks, async () => {
    const task = await db.scheduleTasks.get(taskId);
    if (!task || task.deletedAt) {
      return;
    }
    const now = new Date().toISOString();
    await db.scheduleTasks.put({ ...task, deletedAt: now, updatedAt: now });
  });
}

export async function copyWeek(
  sourceWeekStart: string,
  targetWeekStart: string,
): Promise<void> {
  if (sourceWeekStart === targetWeekStart) {
    return;
  }

  await db.transaction(
    'rw',
    db.scheduleWeeks,
    db.scheduleRows,
    db.scheduleTasks,
    async () => {
      const source = await findActiveWeek(sourceWeekStart);
      if (!source) {
        return;
      }

      const target = await ensureWeek(targetWeekStart);
      const now = new Date().toISOString();
      const rows = sortRows(
        (
          await db.scheduleRows.where('weekId').equals(source.id).toArray()
        ).filter((row) => !row.deletedAt),
      );
      const tasks = (
        await db.scheduleTasks.where('weekId').equals(source.id).toArray()
      ).filter((task) => !task.deletedAt);

      const rowIdBySource = new Map<string, string>();
      const rowsToAdd: ScheduleRow[] = [];
      for (const row of rows) {
        const id = copiedId(target.id, row.id);
        rowIdBySource.set(row.id, id);
        if (await db.scheduleRows.get(id)) {
          continue;
        }
        const copy: ScheduleRow = {
          id,
          weekId: target.id,
          label: row.label,
          order: row.order,
          createdAt: now,
          updatedAt: now,
        };
        if (row.subjectId !== undefined) {
          copy.subjectId = row.subjectId;
        }
        rowsToAdd.push(copy);
      }
      if (rowsToAdd.length > 0) {
        await db.scheduleRows.bulkAdd(rowsToAdd);
      }

      const tasksToAdd: ScheduleTask[] = [];
      for (const task of tasks) {
        const rowId = rowIdBySource.get(task.rowId);
        if (!rowId) {
          continue;
        }
        const id = copiedId(target.id, task.id);
        if (await db.scheduleTasks.get(id)) {
          continue;
        }
        const copy: ScheduleTask = {
          id,
          weekId: target.id,
          rowId,
          dayIndex: task.dayIndex,
          type: task.type,
          createdAt: now,
          updatedAt: now,
        };
        if (task.userBookId !== undefined) {
          copy.userBookId = task.userBookId;
        }
        if (task.fromPage !== undefined) {
          copy.fromPage = task.fromPage;
        }
        if (task.toPage !== undefined) {
          copy.toPage = task.toPage;
        }
        if (task.topicId !== undefined) {
          copy.topicId = task.topicId;
        }
        if (task.title !== undefined) {
          copy.title = task.title;
        }
        tasksToAdd.push(copy);
      }
      if (tasksToAdd.length > 0) {
        await db.scheduleTasks.bulkAdd(tasksToAdd);
      }
    },
  );
}

/** Active book tasks joined with their week start, newest week last. */
export async function listBookTasks(
  userBookId: string,
): Promise<Array<ScheduleTask & { weekStart: string }>> {
  // `userBookId` is not indexed on `scheduleTasks`, so the scan is in memory.
  const tasks = (await db.scheduleTasks.toArray()).filter(
    (task) => task.userBookId === userBookId && !task.deletedAt,
  );
  if (tasks.length === 0) {
    return [];
  }

  const weeks = await db.scheduleWeeks.bulkGet([
    ...new Set(tasks.map((task) => task.weekId)),
  ]);
  const weekStartById = new Map<string, string>();
  for (const week of weeks) {
    if (week && !week.deletedAt) {
      weekStartById.set(week.id, week.weekStart);
    }
  }

  return tasks
    .flatMap((task) => {
      const weekStart = weekStartById.get(task.weekId);
      return weekStart === undefined ? [] : [{ ...task, weekStart }];
    })
    .sort(
      (left, right) =>
        left.weekStart.localeCompare(right.weekStart) ||
        left.dayIndex - right.dayIndex ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

export async function listTasksForDay(
  weekStart: string,
  dayIndex: number,
): Promise<ScheduleTask[]> {
  const week = await findActiveWeek(weekStart);
  if (!week) {
    return [];
  }

  const [rows, tasks] = await Promise.all([
    db.scheduleRows.where('weekId').equals(week.id).toArray(),
    db.scheduleTasks.where('weekId').equals(week.id).toArray(),
  ]);
  const rowOrder = new Map(
    rows.filter((row) => !row.deletedAt).map((row) => [row.id, row.order]),
  );

  return tasks
    .filter((task) => !task.deletedAt && task.dayIndex === dayIndex)
    .sort(
      (left, right) =>
        (rowOrder.get(left.rowId) ?? Number.MAX_SAFE_INTEGER) -
          (rowOrder.get(right.rowId) ?? Number.MAX_SAFE_INTEGER) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}
