import type {
  ActivityLog,
  ScheduleTask,
  UserBook,
  UserBookStatus,
} from '@/domain/types';
import { calculateBookProgress, resolveBookTotalPages } from '@/domain/bookProgress';
import { newId } from '@/lib/id';
import type { KoclukDB } from '../db';

/**
 * Task/activity reconciliation (design §8.4).
 *
 * Every device derives the same progress from the plan: a completed book/topic
 * task must have exactly one active activity log, and an unticked or missed
 * task must not keep one. Pull applies task and activity rows independently,
 * so a conflict between two devices can leave the pair inconsistent; this pass
 * runs after each pull/full snapshot and repairs it.
 *
 * Deliberate exception: a tombstoned task (a plan edit) keeps its activity.
 * `deleteTask` documents that plan history survives deletion, and reconciling
 * it away would erase page history the user did not remove.
 */

function activeLogs(logs: ActivityLog[]): ActivityLog[] {
  return logs.filter((log) => !log.deletedAt);
}

function nextLogTimestamp(logs: ActivityLog[]): string {
  const latest = logs.reduce(
    (max, log) => Math.max(max, Date.parse(log.createdAt) || 0),
    0,
  );
  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

function statusFor(userBook: UserBook, done: boolean): UserBookStatus {
  if (userBook.status === 'archived') {
    return 'archived';
  }
  return done ? 'completed' : 'active';
}

async function refreshBookStatus(db: KoclukDB, userBookId: string): Promise<void> {
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
  const status = statusFor(userBook, progress.done);
  if (status !== userBook.status) {
    await db.userBooks.update(userBookId, {
      status,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Repairs the task/activity pair and returns how many rows were written.
 * Writes go through the normal hooks, so the derived activity is pushed on the
 * next sync run.
 */
export async function reconcileTaskActivities(db: KoclukDB): Promise<number> {
  return db.transaction(
    'rw',
    db.scheduleTasks,
    db.activityLogs,
    db.userBooks,
    db.catalogBooks,
    async () => {
      const tasks = (await db.scheduleTasks.toArray()).filter(
        (task) => !task.deletedAt,
      );
      const allLogs = await db.activityLogs.toArray();
      const logsByTask = new Map<string, ActivityLog[]>();
      for (const log of allLogs) {
        if (!log.taskId) {
          continue;
        }
        const bucket = logsByTask.get(log.taskId);
        if (bucket) {
          bucket.push(log);
        } else {
          logsByTask.set(log.taskId, [log]);
        }
      }

      let written = 0;
      const now = new Date().toISOString();
      const affectedBooks = new Set<string>();

      for (const task of tasks) {
        const logs = logsByTask.get(task.id) ?? [];
        const active = activeLogs(logs);

        if (task.completedAt) {
          if (active.length > 1) {
            const keep = [...active].sort(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt) ||
                right.id.localeCompare(left.id),
            )[0];
            const stale = active.filter((log) => log.id !== keep.id);
            await db.activityLogs.bulkPut(
              stale.map((log) => ({ ...log, deletedAt: now })),
            );
            written += stale.length;
            if (keep.userBookId) {
              affectedBooks.add(keep.userBookId);
            }
            continue;
          }

          if (active.length === 0) {
            const log = await taskActivity(task, db);
            if (log !== null) {
              await db.activityLogs.add(log);
              written += 1;
              if (log.userBookId) {
                affectedBooks.add(log.userBookId);
              }
            }
          }
          continue;
        }

        // Unticked or missed: the visible state owns the progress record.
        if (active.length > 0) {
          await db.activityLogs.bulkPut(
            active.map((log) => ({ ...log, deletedAt: now })),
          );
          written += active.length;
          for (const log of active) {
            if (log.userBookId) {
              affectedBooks.add(log.userBookId);
            }
          }
        }
      }

      for (const userBookId of affectedBooks) {
        await refreshBookStatus(db, userBookId);
      }

      return written;
    },
  );
}

function taskActivity(
  task: ScheduleTask,
  db: KoclukDB,
): Promise<ActivityLog | null> | ActivityLog | null {
  if (task.type === 'book') {
    if (!task.userBookId) {
      return null;
    }
    return db.activityLogs
      .where('userBookId')
      .equals(task.userBookId)
      .toArray()
      .then((rows) => {
        const bookLogs = activeLogs(rows);
        return {
          id: newId(),
          type: 'book_pages',
          userBookId: task.userBookId,
          fromPage: task.fromPage,
          toPage: task.toPage,
          taskId: task.id,
          source: 'task',
          createdAt: nextLogTimestamp(bookLogs),
        } satisfies ActivityLog;
      });
  }

  if (task.type === 'topic') {
    if (!task.topicId) {
      return null;
    }
    return {
      id: newId(),
      type: 'topic_review',
      topicId: task.topicId,
      taskId: task.id,
      source: 'task',
      createdAt: task.completedAt ?? new Date().toISOString(),
    };
  }

  // A free task has no progress model to attach.
  return null;
}
