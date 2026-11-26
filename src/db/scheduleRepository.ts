import { calculateBookProgress, resolveBookTotalPages } from '@/domain/bookProgress';
import type { ScheduleTaskStatus } from '@/domain/schedule';
import type {
  ActivityLog,
  ScheduleRow,
  ScheduleTask,
  ScheduleTaskType,
  ScheduleWeek,
  UserBook,
  UserBookStatus,
} from '@/domain/types';
import { deterministicId } from '@/lib/deterministicId';
import { newId } from '@/lib/id';
import { COPY_NAMESPACE, LOCAL_SCOPE, WEEK_NAMESPACE } from '@/lib/namespaces';
import { db } from './db';
import { validateTaskFields, type TaskFields } from './scheduleTaskFields';

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

/** The stored plan uses ISO weekdays (Monday = 1 … Sunday = 7). */
function validateDayIndex(dayIndex: number): void {
  if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > 7) {
    throw new Error('Gün 1 ile 7 arasında olmalı.');
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
      validateDayIndex(input.dayIndex);
      const existing = (
        await db.scheduleTasks.where('weekId').equals(input.weekId).toArray()
      ).filter(
        (task) =>
          !task.deletedAt &&
          task.rowId === input.rowId &&
          task.dayIndex === input.dayIndex,
      );
      if (existing.length > 0) {
        throw new Error('Bu güne zaten bir görev eklenmiş.');
      }
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

/**
 * Recalculates the stored shelf status after task-driven activity changes.
 * Archiving stays an explicit user choice; `updatedAt` only moves when the
 * status or `startedAt` actually changes. A missing user/catalog row is a
 * no-op, matching the defensive behavior of `deleteActivityLog`.
 */
async function refreshBookStatus(userBookId: string): Promise<void> {
  const userBook = await db.userBooks.get(userBookId);
  if (!userBook || userBook.deletedAt) {
    return;
  }
  const catalogBook = await db.catalogBooks.get(userBook.bookId);
  if (!catalogBook || catalogBook.deletedAt) {
    return;
  }

  const logs = activeLogs(
    await db.activityLogs.where('userBookId').equals(userBookId).toArray(),
  );
  const progress = calculateBookProgress(
    logs,
    resolveBookTotalPages(userBook, catalogBook),
  );

  const status: UserBookStatus =
    userBook.status === 'archived'
      ? 'archived'
      : progress.done
        ? 'completed'
        : 'active';
  const now = new Date().toISOString();
  const startedAt = userBook.startedAt ?? (progress.started ? now : undefined);
  const startedAtChanged =
    userBook.startedAt === undefined && startedAt !== undefined;

  if (status === userBook.status && !startedAtChanged) {
    return;
  }

  const next: UserBook = { ...userBook, status, updatedAt: now };
  if (startedAt !== undefined) {
    next.startedAt = startedAt;
  }
  await db.userBooks.put(next);
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

      validateDayIndex(input.dayIndex);
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
      } else if (task.missedAt !== undefined) {
        // A missed task must not keep a progress record. Editing keeps the
        // missed state; only an explicit tick can complete it again.
        next.missedAt = task.missedAt;
        const active = activeLogs(
          await db.activityLogs.where('taskId').equals(taskId).toArray(),
        );
        if (active.length > 0) {
          await db.activityLogs.bulkPut(
            active.map((log) => ({ ...log, deletedAt: now })),
          );
        }
      }

      await db.scheduleTasks.put(next);

      // Replacing the linked activity can move either book in or out of 100%.
      if (task.completedAt !== undefined) {
        const affectedBookIds = new Set<string>();
        if (task.userBookId !== undefined) {
          affectedBookIds.add(task.userBookId);
        }
        if (fields.userBookId !== undefined) {
          affectedBookIds.add(fields.userBookId);
        }
        for (const userBookId of affectedBookIds) {
          await refreshBookStatus(userBookId);
        }
      }
    },
  );
}

export async function toggleTask(taskId: string, done: boolean): Promise<void> {
  await setTaskStatus(taskId, done ? 'done' : 'pending');
}

/**
 * Sets the tick-mode status. `completedAt` and `missedAt` are mutually
 * exclusive; marking done keeps (or creates) the linked activity, while missed
 * and pending tombstone it so progress follows the visible state.
 */
export async function setTaskStatus(
  taskId: string,
  status: ScheduleTaskStatus,
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

      const existing = activeLogs(
        await db.activityLogs.where('taskId').equals(taskId).toArray(),
      );
      const now = new Date().toISOString();

      if (status === 'pending') {
        if (!task.completedAt && !task.missedAt && existing.length === 0) {
          return;
        }
        if (existing.length > 0) {
          await db.activityLogs.bulkPut(
            existing.map((log) => ({ ...log, deletedAt: now })),
          );
        }
        const next: ScheduleTask = { ...task, updatedAt: now };
        delete next.completedAt;
        delete next.missedAt;
        await db.scheduleTasks.put(next);
        if (task.userBookId !== undefined) {
          await refreshBookStatus(task.userBookId);
        }
        return;
      }

      if (status === 'missed') {
        if (task.missedAt && !task.completedAt && existing.length === 0) {
          return;
        }
        if (existing.length > 0) {
          await db.activityLogs.bulkPut(
            existing.map((log) => ({ ...log, deletedAt: now })),
          );
        }
        const next: ScheduleTask = {
          ...task,
          missedAt: now,
          updatedAt: now,
        };
        delete next.completedAt;
        await db.scheduleTasks.put(next);
        if (task.userBookId !== undefined) {
          await refreshBookStatus(task.userBookId);
        }
        return;
      }

      // Already done with its activity in place: nothing to rewrite.
      if (task.completedAt && existing.length > 0) {
        return;
      }

      // Ticking re-validates against the book's current total pages, not the
      // total that was present when the task was created.
      const fields = await validateTaskFields(task);
      if (existing.length === 0) {
        await replaceTaskActivity(taskId, fields, now);
      }
      const next: ScheduleTask = {
        ...task,
        completedAt: now,
        updatedAt: now,
      };
      delete next.missedAt;
      await db.scheduleTasks.put(next);
      if (fields.userBookId !== undefined) {
        await refreshBookStatus(fields.userBookId);
      }
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
      const tasks = sortTasks(
        (
          await db.scheduleTasks.where('weekId').equals(source.id).toArray()
        ).filter((task) => !task.deletedAt),
      );

      const rowIdBySource = new Map<string, string>();
      const rowsToAdd: ScheduleRow[] = [];
      for (const row of rows) {
        const id = copiedId(target.id, row.id);
        rowIdBySource.set(row.id, id);
        const existing = await db.scheduleRows.get(id);
        if (existing) {
          // A copied row the user later deleted in the target week must be
          // revived before its new tasks arrive; otherwise they would be
          // inserted under a tombstoned row and disappear from the plan.
          if (existing.deletedAt) {
            const revived: ScheduleRow = {
              ...existing,
              label: row.label,
              order: row.order,
              updatedAt: now,
            };
            if (row.subjectId !== undefined) {
              revived.subjectId = row.subjectId;
            } else {
              delete revived.subjectId;
            }
            delete revived.deletedAt;
            await db.scheduleRows.put(revived);
          }
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
      // Eski veride bir hücrede birden çok görev olabilir. Kopya her satır/gün
      // için en fazla bir görev taşır; ilk kayıt (sortTasks sırası) kazanır.
      const sourceSlots = new Set<string>();
      // Hedefte dolu bir hücreye kopya eklenmez; tekrar kopyalama var olan
      // görevi çoğaltmaz.
      const occupiedSlots = new Set(
        (
          await db.scheduleTasks.where('weekId').equals(target.id).toArray()
        )
          .filter((task) => !task.deletedAt)
          .map((task) => `${task.rowId}:${task.dayIndex}`),
      );
      for (const task of tasks) {
        const rowId = rowIdBySource.get(task.rowId);
        if (!rowId) {
          continue;
        }
        const sourceSlot = `${task.rowId}:${task.dayIndex}`;
        if (sourceSlots.has(sourceSlot)) {
          continue;
        }
        sourceSlots.add(sourceSlot);
        const slot = `${rowId}:${task.dayIndex}`;
        if (occupiedSlots.has(slot)) {
          continue;
        }
        const id = copiedId(target.id, task.id);
        if (await db.scheduleTasks.get(id)) {
          continue;
        }
        occupiedSlots.add(slot);
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
    .filter(
      (task) =>
        !task.deletedAt &&
        task.dayIndex === dayIndex &&
        // Defensive: a task whose row was tombstoned (including rows left
        // behind by an old copy bug) must not appear in today's plan.
        rowOrder.has(task.rowId),
    )
    .sort(
      (left, right) =>
        (rowOrder.get(left.rowId) ?? Number.MAX_SAFE_INTEGER) -
          (rowOrder.get(right.rowId) ?? Number.MAX_SAFE_INTEGER) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}
