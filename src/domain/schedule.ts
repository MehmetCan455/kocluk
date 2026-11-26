import { addDays, addWeeks, format, parseISO, startOfDay, startOfWeek } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { ActivityLog, ScheduleTask } from './types';

export interface WeekSummary {
  taskCount: number;
  doneCount: number;
  plannedPages: number;
  readPages: number;
}

/** The Monday of the date's local week as `YYYY-MM-DD`. */
export function weekStartOf(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** Moves a week start by whole weeks, crossing month and year boundaries. */
export function shiftWeek(weekStart: string, weeks: number): string {
  return format(addWeeks(parseISO(weekStart), weeks), 'yyyy-MM-dd');
}

/** A Turkish range such as `16–23 Kasım 2026` or `28 Aralık 2026 – 3 Ocak 2027`. */
export function weekLabel(weekStart: string): string {
  const start = parseISO(weekStart);
  const end = addDays(start, 6);

  if (start.getFullYear() !== end.getFullYear()) {
    return `${format(start, 'd MMMM yyyy', { locale: tr })} – ${format(end, 'd MMMM yyyy', { locale: tr })}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${format(start, 'd MMMM', { locale: tr })} – ${format(end, 'd MMMM yyyy', { locale: tr })}`;
  }
  return `${format(start, 'd')}–${format(end, 'd MMMM yyyy', { locale: tr })}`;
}

/** The Turkish weekday and date for an ISO day index (1 = Monday, 7 = Sunday). */
export function dayLabel(weekStart: string, dayIndex: number): string {
  return format(addDays(parseISO(weekStart), dayIndex - 1), 'EEEE d MMMM', { locale: tr });
}

/**
 * Returns the first Turkish validation error for a book task's page range,
 * or `null` when the range is usable.
 */
export function validateTaskPages(
  from: number | undefined,
  to: number | undefined,
  totalPages: number,
): string | null {
  if (from === undefined || to === undefined) {
    return 'Başlangıç ve bitiş sayfası gerekli.';
  }
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return 'Sayfa numaraları tam sayı olmalı.';
  }
  if (from <= 0 || to <= 0) {
    return 'Sayfa numaraları 1 veya daha büyük olmalı.';
  }
  if (from > to) {
    return 'Başlangıç sayfası bitiş sayfasından büyük olamaz.';
  }
  if (totalPages <= 0) {
    return 'Kitabın toplam sayfa sayısı bilinmiyor.';
  }
  if (to > totalPages) {
    return 'Bitiş sayfası toplam sayfa sayısını aşamaz.';
  }
  return null;
}

function pageSpan(fromPage: number | undefined, toPage: number | undefined): number {
  if (fromPage === undefined || toPage === undefined || toPage < fromPage) {
    return 0;
  }
  return toPage - fromPage + 1;
}

/**
 * The union length of the active book ranges. A shifted page chain can leave
 * the same pages on two tasks, and those pages are still planned once.
 */
function uniquePlannedPages(tasks: ScheduleTask[]): number {
  const ranges = tasks
    .filter(
      (task) =>
        task.type === 'book' &&
        task.fromPage !== undefined &&
        task.toPage !== undefined &&
        task.toPage >= task.fromPage,
    )
    .map((task) => ({ from: task.fromPage as number, to: task.toPage as number }))
    .sort((left, right) => left.from - right.from);

  let total = 0;
  let rangeStart: number | undefined;
  let rangeEnd = 0;
  for (const range of ranges) {
    if (rangeStart === undefined) {
      rangeStart = range.from;
      rangeEnd = range.to;
    } else if (range.from <= rangeEnd + 1) {
      rangeEnd = Math.max(rangeEnd, range.to);
    } else {
      total += rangeEnd - rangeStart + 1;
      rangeStart = range.from;
      rangeEnd = range.to;
    }
  }
  if (rangeStart !== undefined) {
    total += rangeEnd - rangeStart + 1;
  }
  return total;
}

export type ScheduleTaskStatus = 'done' | 'missed' | 'pending';

/**
 * An explicit tick wins. An unmarked task is derived as missed once its own
 * calendar day is over, so yesterday's plan never looks still open; the
 * stored task stays pending.
 */
export function scheduleTaskStatus(
  task: ScheduleTask,
  weekStart: string,
  now: Date = new Date(),
): ScheduleTaskStatus {
  if (task.completedAt) {
    return 'done';
  }
  if (task.missedAt) {
    return 'missed';
  }
  const taskDay = addDays(parseISO(weekStart), task.dayIndex - 1);
  return startOfDay(taskDay) < startOfDay(now) ? 'missed' : 'pending';
}

export interface ScheduleTaskContent {
  /** Book/topic/free title; the chip shows it truncated. */
  title: string;
  /** Konu (book), subject + Tekrar (topic) or the row label. */
  subtitle: string;
  /** Page range for book tasks. */
  detail: string;
}

export interface ScheduleTaskContentContext {
  rowLabel?: string;
  bookTitle?: string;
  /** Prefixes the book chip title so long titles keep the publisher visible. */
  bookPublisher?: string;
  topicName?: string;
  subjectName?: string;
}

/**
 * Builds the three chip lines. The caller supplies looked-up names so the
 * domain stays independent of Dexie.
 */
export function scheduleTaskContent(
  task: ScheduleTask,
  context: ScheduleTaskContentContext = {},
): ScheduleTaskContent {
  const rowLabel = context.rowLabel?.trim() ?? '';

  if (task.type === 'book') {
    const from = task.fromPage;
    const to = task.toPage;
    const bookTitle = context.bookTitle ?? 'Kitap';
    const publisher = context.bookPublisher?.trim();
    return {
      // Publisher first: truncation on narrow cells must not hide it.
      title: publisher ? `${publisher} · ${bookTitle}` : bookTitle,
      subtitle: task.title?.trim() || rowLabel,
      detail:
        from !== undefined && to !== undefined ? `Syf. ${from}–${to}` : '',
    };
  }

  if (task.type === 'topic') {
    return {
      title: context.topicName ?? 'Konu tekrarı',
      subtitle: context.subjectName
        ? `${context.subjectName} · Tekrar`
        : 'Tekrar',
      detail: '',
    };
  }

  return {
    title: task.title?.trim() || 'Serbest görev',
    subtitle: rowLabel,
    detail: '',
  };
}

/**
 * Counts the active tasks of a week and the pages they plan and read. Planned
 * pages are the unique union of the book ranges, so overlapping tasks count
 * once. Deleted tasks and logs never count, and only logs attached to active
 * tasks do.
 */
export function summarizeWeek(tasks: ScheduleTask[], logs: ActivityLog[]): WeekSummary {
  const activeTasks = tasks.filter((task) => !task.deletedAt);
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));

  return {
    taskCount: activeTasks.length,
    doneCount: activeTasks.filter((task) => Boolean(task.completedAt)).length,
    plannedPages: uniquePlannedPages(activeTasks),
    readPages: logs.reduce(
      (sum, entry) =>
        !entry.deletedAt &&
        entry.type === 'book_pages' &&
        entry.taskId !== undefined &&
        activeTaskIds.has(entry.taskId)
          ? sum + pageSpan(entry.fromPage, entry.toPage)
          : sum,
      0,
    ),
  };
}
