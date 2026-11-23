import { useLiveQuery } from 'dexie-react-hooks';
import { listShelfBooks, type ShelfBook } from '@/db/bookRepositories';
import {
  getSubject,
  getTopic,
  listAllTopicBooks,
  listTopics,
} from '@/db/repositories';
import {
  getTopicDone,
  listAllTopicProgress,
  listAllTopicReviews,
  listTopicReviews,
} from '@/db/topicProgressRepository';
import {
  calculateSubjectProgress,
  countsForSubject,
  effectiveTopicPercent,
  subjectBookEstimate,
} from '@/domain/subjectEstimate';
import type { Progress, Subject, Topic } from '@/domain/types';

export interface TopicProgressRow {
  topic: Topic;
  progress: Progress;
  /** Topic percentage contributed by shelf books alone. */
  bookPercent: number;
  /** Explicit completion; always 100 and never overwritten by a book. */
  manualDone: boolean;
  /** Active `topic_review` logs; a review starts a topic but never finishes it. */
  reviewCount: number;
  /** Legacy `topicBooks` rows, kept only for the read-only archive. */
  legacyTestRecordCount: number;
}

export interface SubjectOverview {
  progress: Progress;
  topics: TopicProgressRow[];
  /** First topic that has started but is not finished, in curriculum order. */
  continuingTopic: Topic | undefined;
  /** Round-share of the subject implied by shelf books alone. */
  bookEstimate: number;
  /** Topics the student finished by hand. */
  manualDoneCount: number;
}

export interface TopicEstimate {
  progress: Progress;
  bookPercent: number;
  manualDone: boolean;
}

/** A topic is one unit; its `percent` is the effective (manual + book) share. */
function topicEstimateProgress(effective: number, started: boolean): Progress {
  const done = effective >= 100;
  return {
    solved: done ? 1 : 0,
    total: 1,
    percent: effective,
    remaining: done ? 0 : 1,
    started,
    done,
  };
}

/** Archived/deleted books never reach `listShelfBooks`; page-less books are skipped. */
function shelfBooksForSubject(
  books: readonly ShelfBook[],
  subject: Subject | undefined,
): ShelfBook[] {
  if (!subject) {
    return [];
  }
  return books.filter(
    (book) =>
      book.progress.hasTotalPages &&
      countsForSubject(
        {
          title: book.catalogBook.title,
          exam: book.catalogBook.exam,
          subjectSlug: book.catalogBook.subjectSlug,
        },
        subject,
      ),
  );
}

/**
 * Live subject summary from explicit topic completion plus the shelf-book
 * estimate. Legacy test records are counted for the read-only archive only and
 * never affect the percentage. The aggregate and the per-topic rows come from
 * one query so they never disagree.
 */
export function useSubjectOverview(subjectId: string): SubjectOverview | undefined {
  return useLiveQuery(async () => {
    const [subject, topics, progressRows, reviews, legacyRecords, shelfBooks] =
      await Promise.all([
        getSubject(subjectId),
        listTopics(subjectId),
        listAllTopicProgress(),
        listAllTopicReviews(),
        listAllTopicBooks(),
        listShelfBooks(),
      ]);

    const doneByTopic = new Map(progressRows.map((row) => [row.topicId, row.done]));
    const reviewCountByTopic = new Map<string, number>();
    for (const review of reviews) {
      if (review.topicId) {
        reviewCountByTopic.set(review.topicId, (reviewCountByTopic.get(review.topicId) ?? 0) + 1);
      }
    }
    const legacyCountByTopic = new Map<string, number>();
    for (const record of legacyRecords) {
      legacyCountByTopic.set(record.topicId, (legacyCountByTopic.get(record.topicId) ?? 0) + 1);
    }

    const subjectBooks = shelfBooksForSubject(shelfBooks, subject);
    const { byTopic, estimate: bookEstimate } = subjectBookEstimate(
      topics.map((topic) => topic.id),
      subjectBooks.map((book) => ({ percent: book.progress.percent })),
    );

    const rows = topics.map((topic) => {
      const manualDone = doneByTopic.get(topic.id) === true;
      const reviewCount = reviewCountByTopic.get(topic.id) ?? 0;
      const bookPercent = byTopic.get(topic.id) ?? 0;
      const effective = effectiveTopicPercent(manualDone, bookPercent);
      return {
        topic,
        progress: topicEstimateProgress(
          effective,
          manualDone || reviewCount > 0 || bookPercent > 0,
        ),
        bookPercent,
        manualDone,
        reviewCount,
        legacyTestRecordCount: legacyCountByTopic.get(topic.id) ?? 0,
      };
    });

    return {
      progress: calculateSubjectProgress(
        rows.map((row) => row.progress.percent),
        rows.some((row) => row.progress.started),
      ),
      topics: rows,
      continuingTopic: rows.find((row) => row.progress.started && !row.progress.done)?.topic,
      bookEstimate,
      manualDoneCount: rows.filter((row) => row.manualDone).length,
    };
  }, [subjectId]);
}

/**
 * Aggregate progress for a subject. Status decisions must use `started`/`done`,
 * never the rounded `percent`.
 */
export function useSubjectProgress(subjectId: string): Progress | undefined {
  return useSubjectOverview(subjectId)?.progress;
}

/**
 * One topic's progress with the book contribution kept separate so the UI can
 * explain where the percentage comes from.
 */
export function useTopicEstimate(topicId: string): TopicEstimate | undefined {
  return useLiveQuery(async () => {
    const topic = await getTopic(topicId);
    if (!topic) {
      return undefined;
    }

    const [subject, topics, shelfBooks, manualDone, reviews] = await Promise.all([
      getSubject(topic.subjectId),
      listTopics(topic.subjectId),
      listShelfBooks(),
      getTopicDone(topicId),
      listTopicReviews(topicId),
    ]);

    const subjectBooks = shelfBooksForSubject(shelfBooks, subject);
    const { byTopic } = subjectBookEstimate(
      topics.map((item) => item.id),
      subjectBooks.map((book) => ({ percent: book.progress.percent })),
    );
    const bookPercent = byTopic.get(topicId) ?? 0;
    const effective = effectiveTopicPercent(manualDone, bookPercent);

    return {
      progress: topicEstimateProgress(
        effective,
        manualDone || reviews.length > 0 || bookPercent > 0,
      ),
      bookPercent,
      manualDone,
    };
  }, [topicId]);
}

export function useTopicProgress(topicId: string): Progress | undefined {
  return useTopicEstimate(topicId)?.progress;
}
