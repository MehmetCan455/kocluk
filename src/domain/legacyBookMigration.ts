import { catalogBookId, type CatalogBookSeed } from '@/data/catalogBooks';
import {
  CATALOG_NAMESPACE,
  LOCAL_SCOPE,
  TOPIC_PROGRESS_NAMESPACE,
  USER_BOOK_NAMESPACE,
} from '@/lib/namespaces';
import { deterministicId } from '@/lib/deterministicId';
import { normalizeTr } from '@/lib/normalize';
import type {
  Book,
  CatalogBook,
  Subject,
  Topic,
  TopicBook,
  TopicProgress,
  UserBook,
} from './types';

export interface LegacyBookMigrationInput {
  books: readonly Book[];
  topicBooks: readonly TopicBook[];
  topics: readonly Topic[];
  subjects: readonly Subject[];
  catalogSeed: readonly CatalogBookSeed[];
  /** Test hook; production calls leave it at the current clock. */
  now?: string;
}

export interface LegacyBookMigrationResult {
  catalogBooks: CatalogBook[];
  userBooks: UserBook[];
  topicProgress: TopicProgress[];
}

/** Private legacy rows get a stable catalog id derived from the old book id. */
function legacyCatalogBookId(bookId: string): string {
  return deterministicId(CATALOG_NAMESPACE, `${LOCAL_SCOPE}:legacy:${bookId}`);
}

function legacyUserBookId(catalogId: string): string {
  return deterministicId(USER_BOOK_NAMESPACE, `${LOCAL_SCOPE}:${catalogId}`);
}

function legacyTopicProgressId(topicId: string): string {
  return deterministicId(TOPIC_PROGRESS_NAMESPACE, `${LOCAL_SCOPE}:${topicId}`);
}

function isNewerSeed(candidate: CatalogBookSeed, current: CatalogBookSeed): boolean {
  if (candidate.edition !== current.edition) {
    return candidate.edition > current.edition;
  }
  // Equal editions cannot occur in the shipped seed, but the tie must still
  // resolve to a single row deterministically.
  return (
    catalogBookId(candidate.title, candidate.publisher, candidate.edition) <
    catalogBookId(current.title, current.publisher, current.edition)
  );
}

/**
 * Legacy books carry no catalog id, so their normalized title+publisher is
 * matched against the provided seed. The newest edition wins and the catalog
 * id breaks a same-edition tie.
 */
function matchCatalogSeed(
  book: Book,
  catalogSeed: readonly CatalogBookSeed[],
): CatalogBookSeed | undefined {
  const title = normalizeTr(book.name);
  const publisher = normalizeTr(book.publisher ?? '');
  let best: CatalogBookSeed | undefined;
  for (const seed of catalogSeed) {
    if (normalizeTr(seed.title) !== title || normalizeTr(seed.publisher) !== publisher) {
      continue;
    }
    if (!best || isNewerSeed(seed, best)) {
      best = seed;
    }
  }
  return best;
}

function catalogBookFromSeed(seed: CatalogBookSeed, now: string): CatalogBook {
  return {
    id: catalogBookId(seed.title, seed.publisher, seed.edition),
    title: seed.title,
    publisher: seed.publisher,
    exam: seed.exam,
    subjectSlug: seed.subjectSlug,
    totalPages: seed.totalPages,
    edition: seed.edition,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A custom book's subject/exam comes from the strict majority of its old topic
 * records (topics → subjects). A tie or no records leaves both fields empty,
 * which the UI labels "Genel".
 */
function deriveLegacySubject(
  bookId: string,
  topicBooks: readonly TopicBook[],
  topicsById: ReadonlyMap<string, Topic>,
  subjectsById: ReadonlyMap<string, Subject>,
): Pick<CatalogBook, 'subjectSlug' | 'exam'> {
  const counts = new Map<string, number>();
  for (const record of topicBooks) {
    if (record.bookId !== bookId) {
      continue;
    }
    const topic = topicsById.get(record.topicId);
    if (!topic) {
      continue;
    }
    counts.set(topic.subjectId, (counts.get(topic.subjectId) ?? 0) + 1);
  }

  let leader: { subjectId: string; count: number } | undefined;
  let tied = false;
  for (const [subjectId, count] of counts) {
    if (!leader || count > leader.count) {
      leader = { subjectId, count };
      tied = false;
    } else if (count === leader.count) {
      tied = true;
    }
  }

  const subject = leader && !tied ? subjectsById.get(leader.subjectId) : undefined;
  return subject ? { subjectSlug: subject.slug, exam: subject.exam } : {};
}

/**
 * Converts the pre-v6 `books`/`topicBooks` archive into the page-based model.
 * The legacy rows stay in place as a read-only archive.
 *
 * - A book matching the catalog seed (normalized title+publisher, newest
 *   edition) reuses that catalog row; otherwise it becomes a private row with
 *   `totalPages: 0`, for the user to complete later.
 * - Every catalog id gets exactly one shelf row, so books matching the same
 *   seed merge, and no `userBooks.bookId` can dangle.
 * - A topic starts done only when all of its old records are fully solved.
 *
 * Both the v5 zip import and the startup migration call this function, so the
 * two paths cannot drift apart.
 */
export function buildNewModelFromLegacy({
  books,
  topicBooks,
  topics,
  subjects,
  catalogSeed,
  now = new Date().toISOString(),
}: LegacyBookMigrationInput): LegacyBookMigrationResult {
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));

  // Sorting by id makes the merged note and timestamps deterministic.
  const legacyBooks = [...books].sort((left, right) => left.id.localeCompare(right.id));
  const catalogById = new Map<string, CatalogBook>();
  const mergedBooks = new Map<string, Book[]>();
  for (const book of legacyBooks) {
    const seed = matchCatalogSeed(book, catalogSeed);
    const catalogBook: CatalogBook = seed
      ? catalogBookFromSeed(seed, now)
      : {
          id: legacyCatalogBookId(book.id),
          ownerId: LOCAL_SCOPE,
          title: book.name,
          publisher: book.publisher,
          totalPages: 0,
          ...deriveLegacySubject(book.id, topicBooks, topicsById, subjectsById),
          createdAt: book.createdAt,
          updatedAt: book.updatedAt,
        };
    catalogById.set(catalogBook.id, catalogBook);
    const group = mergedBooks.get(catalogBook.id);
    if (group) {
      group.push(book);
    } else {
      mergedBooks.set(catalogBook.id, [book]);
    }
  }

  const userBooks: UserBook[] = [];
  for (const [catalogId, matchingBooks] of mergedBooks) {
    const note = matchingBooks
      .map((book) => book.note?.trim())
      .find((value): value is string => Boolean(value));
    const createdAt = matchingBooks.reduce(
      (earliest, book) => (book.createdAt < earliest ? book.createdAt : earliest),
      matchingBooks[0].createdAt,
    );
    const updatedAt = matchingBooks.reduce(
      (latest, book) => (book.updatedAt > latest ? book.updatedAt : latest),
      matchingBooks[0].updatedAt,
    );
    const userBook: UserBook = {
      id: legacyUserBookId(catalogId),
      bookId: catalogId,
      status: 'active',
      createdAt,
      updatedAt,
    };
    if (note) {
      userBook.note = note;
    }
    userBooks.push(userBook);
  }
  userBooks.sort((left, right) => left.id.localeCompare(right.id));

  // A topic is done only when every old record for it is fully solved. Partial
  // topics get no row; their legacy records remain visible in the archive.
  const recordsByTopic = new Map<string, TopicBook[]>();
  for (const record of topicBooks) {
    const group = recordsByTopic.get(record.topicId);
    if (group) {
      group.push(record);
    } else {
      recordsByTopic.set(record.topicId, [record]);
    }
  }
  const topicProgress: TopicProgress[] = [];
  for (const [topicId, records] of recordsByTopic) {
    if (!topicsById.has(topicId)) {
      continue;
    }
    const fullySolved = records.every(
      (record) => record.totalTests > 0 && record.solvedTests >= record.totalTests,
    );
    if (!fullySolved) {
      continue;
    }
    const updatedAt = records.reduce(
      (latest, record) => (record.updatedAt > latest ? record.updatedAt : latest),
      records[0].updatedAt,
    );
    topicProgress.push({
      id: legacyTopicProgressId(topicId),
      topicId,
      done: true,
      doneAt: updatedAt,
      updatedAt,
    });
  }
  topicProgress.sort((left, right) => left.topicId.localeCompare(right.topicId));

  return {
    catalogBooks: [...catalogById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    userBooks,
    topicProgress,
  };
}
