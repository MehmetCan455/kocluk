import { useLiveQuery } from 'dexie-react-hooks';
import {
  getTopicDone,
  listAllTopicProgress,
  listAllTopicReviews,
  listTopicReviews,
} from '@/db/topicProgressRepository';
import { listAllTopicBooks, listTopics } from '@/db/repositories';
import { calculateCountProgress } from '@/domain/calculations';
import type { Progress, Topic } from '@/domain/types';

export interface TopicProgressRow {
  topic: Topic;
  progress: Progress;
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
}

/** A review is a "started" signal; only the explicit flag finishes a topic. */
function topicProgress(done: boolean, reviewCount: number): Progress {
  const progress = calculateCountProgress(done ? 1 : 0, 1);
  return { ...progress, started: progress.started || reviewCount > 0 };
}

/**
 * Live subject summary from explicit topic completion. Legacy test records are
 * counted for the read-only archive only and never affect the percentage. The
 * aggregate and the per-topic rows come from one query so they never disagree.
 */
export function useSubjectOverview(subjectId: string): SubjectOverview | undefined {
  return useLiveQuery(async () => {
    const [topics, progressRows, reviews, legacyRecords] = await Promise.all([
      listTopics(subjectId),
      listAllTopicProgress(),
      listAllTopicReviews(),
      listAllTopicBooks(),
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

    const rows = topics.map((topic) => {
      const done = doneByTopic.get(topic.id) === true;
      const reviewCount = reviewCountByTopic.get(topic.id) ?? 0;
      return {
        topic,
        progress: topicProgress(done, reviewCount),
        reviewCount,
        legacyTestRecordCount: legacyCountByTopic.get(topic.id) ?? 0,
      };
    });

    const doneCount = rows.filter((row) => row.progress.done).length;

    return {
      progress: calculateCountProgress(doneCount, rows.length),
      topics: rows,
      continuingTopic: rows.find((row) => row.progress.started && !row.progress.done)?.topic,
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

export function useTopicProgress(topicId: string): Progress | undefined {
  return useLiveQuery(async () => {
    const [done, reviews] = await Promise.all([
      getTopicDone(topicId),
      listTopicReviews(topicId),
    ]);
    return topicProgress(done, reviews.length);
  }, [topicId]);
}
