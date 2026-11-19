import { useLiveQuery } from 'dexie-react-hooks';
import { listTopicBooks, listTopics } from '@/db/repositories';
import { calculateProgress } from '@/domain/calculations';
import type { Progress, Topic } from '@/domain/types';

export interface TopicProgressRow {
  topic: Topic;
  progress: Progress;
  /** Number of book/test records attached to the topic. */
  testRecordCount: number;
}

export interface SubjectOverview {
  progress: Progress;
  topics: TopicProgressRow[];
  /** First topic that has started but is not finished, in curriculum order. */
  continuingTopic: Topic | undefined;
}

/**
 * Live subject summary with per-topic progress. The aggregate and the
 * per-topic rows come from one query so the list and header never disagree.
 */
export function useSubjectOverview(subjectId: string): SubjectOverview | undefined {
  return useLiveQuery(async () => {
    const topics = await listTopics(subjectId);
    const booksByTopic = await Promise.all(topics.map((topic) => listTopicBooks(topic.id)));

    const rows = topics.map((topic, index) => {
      const books = booksByTopic[index] ?? [];
      return {
        topic,
        progress: calculateProgress(books),
        testRecordCount: books.length,
      };
    });

    return {
      progress: calculateProgress(booksByTopic.flat()),
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
  return useLiveQuery(async () => calculateProgress(await listTopicBooks(topicId)), [topicId]);
}
