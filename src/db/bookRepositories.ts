import type {
  ActivityLog,
  BookProgress,
  CatalogBook,
  ExamType,
  UserBook,
  UserBookStatus,
} from '@/domain/types';
import { calculateBookProgress, resolveBookTotalPages } from '@/domain/bookProgress';
import { deterministicId } from '@/lib/deterministicId';
import { newId } from '@/lib/id';
import { LOCAL_SCOPE, USER_BOOK_NAMESPACE } from '@/lib/namespaces';
import { db } from './db';

/** A shelf row joined with its catalog data and freshly calculated progress. */
export interface ShelfBook {
  userBook: UserBook;
  catalogBook: CatalogBook;
  totalPages: number;
  progress: BookProgress;
}

export interface CustomBookInput {
  title: string;
  publisher?: string;
  exam?: ExamType;
  subjectSlug?: string;
  totalPages: number;
  note?: string;
}

/**
 * `totalPagesOverride: null` clears the override, `undefined` leaves it as-is.
 * Catalog fields only apply to custom (`LOCAL_SCOPE`) books.
 */
export interface UpdateUserBookInput {
  totalPagesOverride?: number | null;
  note?: string;
  status?: UserBookStatus;
  title?: string;
  publisher?: string;
  exam?: ExamType;
  subjectSlug?: string;
}

const TOTAL_PAGES_ERROR = 'Toplam sayfa 0 veya daha büyük tam sayı olmalı';

function assertValidTotalPages(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(TOTAL_PAGES_ERROR);
  }
}

function shelfBookId(bookId: string): string {
  return deterministicId(USER_BOOK_NAMESPACE, `${LOCAL_SCOPE}:${bookId}`);
}

function buildShelfBook(
  userBook: UserBook,
  catalogBook: CatalogBook,
  logs: ActivityLog[],
): ShelfBook {
  const totalPages = resolveBookTotalPages(userBook, catalogBook);
  return {
    userBook,
    catalogBook,
    totalPages,
    progress: calculateBookProgress(logs, totalPages),
  };
}

function activeLogsOf(logs: ActivityLog[]): ActivityLog[] {
  return logs.filter((log) => !log.deletedAt);
}

/**
 * A new range must sort after every earlier log even when two writes land in
 * the same millisecond, so history order stays stable and timestamps are
 * monotonically increasing within a book.
 */
function nextLogTimestamp(logs: ActivityLog[]): string {
  const latest = logs.reduce(
    (max, log) => Math.max(max, Date.parse(log.createdAt) || 0),
    0,
  );
  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

function statusFor(userBook: UserBook, done: boolean): UserBookStatus {
  // Archiving is an explicit user choice; automatic completion must not undo it.
  if (userBook.status === 'archived') {
    return 'archived';
  }
  return done ? 'completed' : 'active';
}

/** Non-deleted shelf rows, newest activity first. Archived rows are opt-in. */
export async function listShelfBooks(includeArchived = false): Promise<ShelfBook[]> {
  const userBooks = (await db.userBooks.toArray()).filter(
    (book) => !book.deletedAt && (includeArchived || book.status !== 'archived'),
  );
  if (userBooks.length === 0) {
    return [];
  }

  const catalogBooks = await db.catalogBooks.bulkGet([
    ...new Set(userBooks.map((book) => book.bookId)),
  ]);
  const catalogById = new Map(
    catalogBooks
      .filter((book): book is CatalogBook => book !== undefined && !book.deletedAt)
      .map((book) => [book.id, book]),
  );

  const logs = activeLogsOf(
    await db.activityLogs
      .where('userBookId')
      .anyOf(userBooks.map((book) => book.id))
      .toArray(),
  );
  const logsByBook = new Map<string, ActivityLog[]>();
  for (const log of logs) {
    if (!log.userBookId) {
      continue;
    }
    const bucket = logsByBook.get(log.userBookId);
    if (bucket) {
      bucket.push(log);
    } else {
      logsByBook.set(log.userBookId, [log]);
    }
  }

  const shelf: ShelfBook[] = [];
  for (const userBook of userBooks) {
    const catalogBook = catalogById.get(userBook.bookId);
    if (catalogBook) {
      shelf.push(buildShelfBook(userBook, catalogBook, logsByBook.get(userBook.id) ?? []));
    }
  }

  return shelf.sort(
    (left, right) =>
      right.userBook.updatedAt.localeCompare(left.userBook.updatedAt) ||
      left.catalogBook.title.localeCompare(right.catalogBook.title, 'tr-TR') ||
      left.userBook.id.localeCompare(right.userBook.id),
  );
}

export async function getShelfBook(id: string): Promise<ShelfBook | undefined> {
  const userBook = await db.userBooks.get(id);
  if (!userBook || userBook.deletedAt) {
    return undefined;
  }

  const catalogBook = await db.catalogBooks.get(userBook.bookId);
  if (!catalogBook || catalogBook.deletedAt) {
    return undefined;
  }

  const logs = activeLogsOf(
    await db.activityLogs.where('userBookId').equals(id).toArray(),
  );
  return buildShelfBook(userBook, catalogBook, logs);
}

/**
 * Adds a catalog book once. A soft-deleted or archived row for the same book is
 * reused and reactivated, so the unique `bookId` index is never violated.
 */
export async function addCatalogBookToShelf(
  catalogBookId: string,
  totalPagesOverride?: number,
): Promise<UserBook> {
  if (totalPagesOverride !== undefined) {
    assertValidTotalPages(totalPagesOverride);
  }

  return db.transaction('rw', db.catalogBooks, db.userBooks, async () => {
    const catalogBook = await db.catalogBooks.get(catalogBookId);
    if (!catalogBook || catalogBook.deletedAt) {
      throw new Error('Kitap bulunamadı');
    }

    const now = new Date().toISOString();
    const existing = await db.userBooks.where('bookId').equals(catalogBookId).first();

    if (existing) {
      const updated: UserBook = {
        ...existing,
        totalPagesOverride:
          totalPagesOverride === undefined ? existing.totalPagesOverride : totalPagesOverride,
        status: 'active',
        updatedAt: now,
      };
      delete updated.deletedAt;
      await db.userBooks.put(updated);
      return updated;
    }

    const userBook: UserBook = {
      id: shelfBookId(catalogBookId),
      bookId: catalogBookId,
      totalPagesOverride,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await db.userBooks.add(userBook);
    return userBook;
  });
}

/** A custom book lives in the catalog only for the local user. */
export async function addCustomBook(input: CustomBookInput): Promise<UserBook> {
  const title = input.title.trim();
  if (!title) {
    throw new Error('Kitap adı boş olamaz');
  }
  assertValidTotalPages(input.totalPages);

  const now = new Date().toISOString();
  const catalogBook: CatalogBook = {
    id: newId(),
    ownerId: LOCAL_SCOPE,
    title,
    publisher: input.publisher?.trim() || undefined,
    exam: input.exam,
    subjectSlug: input.subjectSlug?.trim() || undefined,
    totalPages: input.totalPages,
    createdAt: now,
    updatedAt: now,
  };
  const userBook: UserBook = {
    id: shelfBookId(catalogBook.id),
    bookId: catalogBook.id,
    note: input.note?.trim() || undefined,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction('rw', db.catalogBooks, db.userBooks, async () => {
    await db.catalogBooks.add(catalogBook);
    await db.userBooks.add(userBook);
  });
  return userBook;
}

/**
 * Updates the user-specific fields. Shared catalog rows are read-only, so title
 * and publisher edits are ignored unless the book is the user's own custom row.
 */
export async function updateUserBook(id: string, input: UpdateUserBookInput): Promise<void> {
  const trimmedTitle = input.title?.trim();
  if (input.title !== undefined && !trimmedTitle) {
    throw new Error('Kitap adı boş olamaz');
  }
  if (input.totalPagesOverride !== undefined && input.totalPagesOverride !== null) {
    assertValidTotalPages(input.totalPagesOverride);
  }

  await db.transaction('rw', db.userBooks, db.catalogBooks, db.activityLogs, async () => {
    const userBook = await db.userBooks.get(id);
    if (!userBook || userBook.deletedAt) {
      throw new Error('Raf kitabı bulunamadı');
    }

    const catalogBook = await db.catalogBooks.get(userBook.bookId);
    if (!catalogBook) {
      throw new Error('Kitap bulunamadı');
    }

    const now = new Date().toISOString();
    const nextUserBook: UserBook = { ...userBook, updatedAt: now };

    if (input.totalPagesOverride !== undefined) {
      if (input.totalPagesOverride === null) {
        delete nextUserBook.totalPagesOverride;
      } else {
        nextUserBook.totalPagesOverride = input.totalPagesOverride;
      }
    }
    if (input.note !== undefined) {
      const note = input.note.trim();
      if (note) {
        nextUserBook.note = note;
      } else {
        delete nextUserBook.note;
      }
    }
    if (input.status !== undefined) {
      nextUserBook.status = input.status;
    }

    // A changed total can move the book in or out of the 100% state. An explicit
    // status wins; otherwise keep a completed book in step with its percentage.
    if (input.status === undefined && input.totalPagesOverride !== undefined) {
      const logs = activeLogsOf(
        await db.activityLogs.where('userBookId').equals(id).toArray(),
      );
      const progress = calculateBookProgress(
        logs,
        resolveBookTotalPages(nextUserBook, catalogBook),
      );
      nextUserBook.status = statusFor(nextUserBook, progress.done);
    }

    await db.userBooks.put(nextUserBook);

    if (catalogBook.ownerId !== LOCAL_SCOPE) {
      return;
    }

    const nextCatalog: CatalogBook = { ...catalogBook, updatedAt: now };
    let catalogChanged = false;
    if (trimmedTitle !== undefined) {
      nextCatalog.title = trimmedTitle;
      catalogChanged = true;
    }
    if (input.publisher !== undefined) {
      nextCatalog.publisher = input.publisher.trim() || undefined;
      catalogChanged = true;
    }
    if (input.exam !== undefined) {
      nextCatalog.exam = input.exam;
      catalogChanged = true;
    }
    if (input.subjectSlug !== undefined) {
      nextCatalog.subjectSlug = input.subjectSlug.trim() || undefined;
      catalogChanged = true;
    }
    if (catalogChanged) {
      await db.catalogBooks.put(nextCatalog);
    }
  });
}

/**
 * Adds one inclusive page range as a manual `book_pages` log. Progress is the
 * union of every active range, so re-entering a read range is harmless while
 * the history still records the entry. The status follows the fresh percentage
 * unless the user archived the book.
 */
export async function addBookPageRange(
  userBookId: string,
  fromPage: number,
  toPage: number,
): Promise<void> {
  if (!Number.isInteger(fromPage) || !Number.isInteger(toPage)) {
    throw new Error('Sayfa aralığı tam sayı olmalı');
  }
  if (fromPage < 1) {
    throw new Error('Başlangıç sayfası 1 veya daha büyük olmalı');
  }
  if (fromPage > toPage) {
    throw new Error('Başlangıç sayfası bitiş sayfasından büyük olamaz');
  }

  await db.transaction('rw', db.userBooks, db.catalogBooks, db.activityLogs, async () => {
    const userBook = await db.userBooks.get(userBookId);
    if (!userBook || userBook.deletedAt) {
      throw new Error('Raf kitabı bulunamadı');
    }

    const catalogBook = await db.catalogBooks.get(userBook.bookId);
    if (!catalogBook || catalogBook.deletedAt) {
      throw new Error('Kitap bulunamadı');
    }

    const totalPages = resolveBookTotalPages(userBook, catalogBook);
    if (totalPages <= 0) {
      throw new Error('Önce toplam sayfa sayısını gir');
    }
    if (toPage > totalPages) {
      throw new Error('Bitiş sayfası toplam sayfayı aşamaz');
    }

    const logs = activeLogsOf(
      await db.activityLogs.where('userBookId').equals(userBookId).toArray(),
    );

    const createdAt = nextLogTimestamp(logs);
    const log: ActivityLog = {
      id: newId(),
      type: 'book_pages',
      userBookId,
      fromPage,
      toPage,
      source: 'manual',
      createdAt,
    };
    await db.activityLogs.add(log);

    const progress = calculateBookProgress([...logs, log], totalPages);
    await db.userBooks.put({
      ...userBook,
      status: statusFor(userBook, progress.done),
      startedAt: userBook.startedAt ?? createdAt,
      updatedAt: createdAt,
    });
  });
}

/** One inclusive page range read in a book. */
export interface BookPageRange {
  fromPage: number;
  toPage: number;
}

/**
 * Active `book_pages` ranges for the given shelf books, grouped by book id.
 * Legacy `page_set` rows record a position rather than read pages, and deleted
 * logs never count, so both are skipped.
 */
export async function listBookReadRanges(
  userBookIds: readonly string[],
): Promise<Map<string, BookPageRange[]>> {
  const uniqueIds = [...new Set(userBookIds)];
  const rangesByBook = new Map<string, BookPageRange[]>();
  if (uniqueIds.length === 0) {
    return rangesByBook;
  }

  const logs = await db.activityLogs.where('userBookId').anyOf(uniqueIds).toArray();
  for (const log of logs) {
    if (log.deletedAt || log.type !== 'book_pages' || !log.userBookId) {
      continue;
    }
    const { fromPage, toPage } = log;
    if (
      fromPage === undefined ||
      toPage === undefined ||
      !Number.isInteger(fromPage) ||
      !Number.isInteger(toPage) ||
      fromPage < 1 ||
      toPage < fromPage
    ) {
      continue;
    }
    const bucket = rangesByBook.get(log.userBookId);
    if (bucket) {
      bucket.push({ fromPage, toPage });
    } else {
      rangesByBook.set(log.userBookId, [{ fromPage, toPage }]);
    }
  }

  for (const ranges of rangesByBook.values()) {
    ranges.sort((left, right) => left.fromPage - right.fromPage || left.toPage - right.toPage);
  }
  return rangesByBook;
}

/** Active activity for one book, newest first. */
export async function listBookActivity(userBookId: string): Promise<ActivityLog[]> {
  const logs = await db.activityLogs.where('userBookId').equals(userBookId).toArray();
  return activeLogsOf(logs).sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

/**
 * Tombstones one log. Deleting the last range that completed a book drops it
 * below 100%, so the stored status is refreshed with the same archive rule as
 * `addBookPageRange`.
 */
export async function deleteActivityLog(id: string): Promise<void> {
  await db.transaction('rw', db.activityLogs, db.userBooks, db.catalogBooks, async () => {
    const log = await db.activityLogs.get(id);
    if (!log || log.deletedAt) {
      return;
    }

    const now = new Date().toISOString();
    await db.activityLogs.update(id, { deletedAt: now });

    if (!log.userBookId) {
      return;
    }
    const userBook = await db.userBooks.get(log.userBookId);
    if (!userBook || userBook.deletedAt) {
      return;
    }
    const catalogBook = await db.catalogBooks.get(userBook.bookId);
    if (!catalogBook || catalogBook.deletedAt) {
      return;
    }

    const logs = activeLogsOf(
      await db.activityLogs.where('userBookId').equals(userBook.id).toArray(),
    );
    const progress = calculateBookProgress(
      logs,
      resolveBookTotalPages(userBook, catalogBook),
    );
    const status = statusFor(userBook, progress.done);
    if (status !== userBook.status) {
      await db.userBooks.update(userBook.id, { status, updatedAt: now });
    }
  });
}

/**
 * Soft-deletes the shelf row, its activity and its plan tasks. `userBookId` is
 * intentionally not indexed on `scheduleTasks`, so the task scan is in memory.
 */
export async function deleteShelfBook(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.userBooks,
    db.catalogBooks,
    db.activityLogs,
    db.scheduleTasks,
    async () => {
      const userBook = await db.userBooks.get(id);
      if (!userBook || userBook.deletedAt) {
        return;
      }

      const now = new Date().toISOString();
      await db.userBooks.update(id, { deletedAt: now, updatedAt: now });

      const logs = (
        await db.activityLogs.where('userBookId').equals(id).toArray()
      ).filter((log) => !log.deletedAt);
      if (logs.length > 0) {
        await db.activityLogs.bulkPut(
          logs.map((log) => ({ ...log, deletedAt: now })),
        );
      }

      const tasks = (await db.scheduleTasks.toArray()).filter(
        (task) => task.userBookId === id && !task.deletedAt,
      );
      if (tasks.length > 0) {
        await db.scheduleTasks.bulkPut(
          tasks.map((task) => ({ ...task, deletedAt: now, updatedAt: now })),
        );
      }

      const catalogBook = await db.catalogBooks.get(userBook.bookId);
      if (catalogBook?.ownerId === LOCAL_SCOPE && !catalogBook.deletedAt) {
        await db.catalogBooks.update(catalogBook.id, {
          deletedAt: now,
          updatedAt: now,
        });
      }
    },
  );
}
