import type { ActivityLog, BookProgress, CatalogBook, UserBook } from './types';

interface PageRange {
  start: number;
  end: number;
}

/**
 * Reads only active `book_pages` ranges. `page_set` is a legacy position
 * marker: it stays in history but never adds read pages. Ranges are clamped to
 * the known page count, and malformed spans are ignored.
 */
function readPageRanges(logs: ActivityLog[], totalPages: number): PageRange[] {
  const hasTotalPages = totalPages > 0;
  const ranges: PageRange[] = [];

  for (const entry of logs) {
    if (entry.deletedAt || entry.type !== 'book_pages') {
      continue;
    }
    const fromPage = entry.fromPage;
    const toPage = entry.toPage;
    if (
      fromPage === undefined ||
      toPage === undefined ||
      !Number.isInteger(fromPage) ||
      !Number.isInteger(toPage)
    ) {
      continue;
    }

    const start = Math.max(fromPage, 1);
    const end = hasTotalPages ? Math.min(toPage, totalPages) : toPage;
    if (start > end) {
      continue;
    }
    ranges.push({ start, end });
  }

  return ranges;
}

/** Highest valid `toPage` in the active `book_pages` stream. */
function lastPageOf(logs: ActivityLog[], totalPages: number): number {
  let lastPage = 0;
  for (const entry of logs) {
    if (entry.deletedAt || entry.type !== 'book_pages') {
      continue;
    }
    const fromPage = entry.fromPage;
    const toPage = entry.toPage;
    if (
      fromPage === undefined ||
      toPage === undefined ||
      !Number.isInteger(fromPage) ||
      !Number.isInteger(toPage) ||
      fromPage > toPage
    ) {
      continue;
    }
    const capped = totalPages > 0 ? Math.min(toPage, totalPages) : toPage;
    if (capped < 1) {
      continue;
    }
    lastPage = Math.max(lastPage, capped);
  }
  return lastPage;
}

/** Size of the union of inclusive ranges; overlaps and repeats count once. */
function unionSize(ranges: PageRange[]): number {
  if (ranges.length === 0) {
    return 0;
  }

  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let total = 0;
  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].end;

  for (const range of sorted.slice(1)) {
    if (range.start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, range.end);
      continue;
    }
    total += currentEnd - currentStart + 1;
    currentStart = range.start;
    currentEnd = range.end;
  }

  return total + currentEnd - currentStart + 1;
}

/** Progress counts unique pages actually read, not the furthest page reached. */
export function calculateBookProgress(logs: ActivityLog[], totalPages: number): BookProgress {
  const hasTotalPages = totalPages > 0;
  const readPages = unionSize(readPageRanges(logs, totalPages));
  const lastPage = lastPageOf(logs, totalPages);

  const done = hasTotalPages && readPages >= totalPages;
  const percent = !hasTotalPages
    ? 0
    : done
      ? 100
      : Math.min(99, Math.round((readPages / totalPages) * 100));

  return {
    currentPage: lastPage,
    readPages,
    totalPages: hasTotalPages ? totalPages : 0,
    percent,
    remaining: hasTotalPages ? Math.max(totalPages - readPages, 0) : 0,
    started: readPages > 0,
    done,
    hasTotalPages,
  };
}

/** `totalPagesOverride` wins; a missing catalog row leaves the total unknown. */
export function resolveBookTotalPages(
  userBook: UserBook,
  catalogBook: CatalogBook | undefined,
): number {
  return userBook.totalPagesOverride ?? catalogBook?.totalPages ?? 0;
}
