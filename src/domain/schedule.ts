import { addDays, addWeeks, format, parseISO, startOfWeek } from 'date-fns';
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
 * Counts the active tasks of a week and the pages they plan and read. Deleted
 * tasks and logs never count, and only logs attached to active tasks do.
 */
export function summarizeWeek(tasks: ScheduleTask[], logs: ActivityLog[]): WeekSummary {
  const activeTasks = tasks.filter((task) => !task.deletedAt);
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));

  return {
    taskCount: activeTasks.length,
    doneCount: activeTasks.filter((task) => Boolean(task.completedAt)).length,
    plannedPages: activeTasks.reduce(
      (sum, task) =>
        task.type === 'book' ? sum + pageSpan(task.fromPage, task.toPage) : sum,
      0,
    ),
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
