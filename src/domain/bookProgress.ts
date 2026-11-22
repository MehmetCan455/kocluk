import type { ActivityLog, BookProgress, CatalogBook, UserBook } from './types';

/**
 * Page-based progress from append-only activity logs. A `page_set` corrects
 * the baseline: only `book_pages` logs created after the latest active
 * baseline count, so a downward correction sticks.
 */
export function calculateBookProgress(logs: ActivityLog[], totalPages: number): BookProgress {
  const active = logs.filter(
    (entry) => !entry.deletedAt && (entry.type === 'book_pages' || entry.type === 'page_set'),
  );
  const pageSets = active
    .filter((entry) => entry.type === 'page_set')
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  const baseline = pageSets.at(-1);
  const pageLogs = active.filter(
    (entry) => entry.type === 'book_pages' && (!baseline || entry.createdAt > baseline.createdAt),
  );
  const reached = Math.max(baseline?.toPage ?? 0, ...pageLogs.map((entry) => entry.toPage ?? 0));

  const hasTotalPages = totalPages > 0;
  const done = hasTotalPages && reached >= totalPages;
  const percent = !hasTotalPages
    ? 0
    : done
      ? 100
      : Math.min(99, Math.round((reached / totalPages) * 100));

  return {
    currentPage: hasTotalPages ? Math.min(reached, totalPages) : reached,
    totalPages: hasTotalPages ? totalPages : 0,
    percent,
    remaining: hasTotalPages ? Math.max(totalPages - reached, 0) : 0,
    started: reached > 0,
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
