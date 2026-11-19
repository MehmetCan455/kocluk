import type { ExamType, Subject, Topic } from '@/domain/types';
import { newId } from '@/lib/id';
import { db } from './db';

export interface CurriculumTopicSeed {
  seedKey: string;
  name: string;
  order: number;
}

export interface CurriculumSubjectSeed {
  seedKey: string;
  exam: ExamType;
  name: string;
  slug: string;
  icon: string;
  order: number;
  topics: CurriculumTopicSeed[];
}

export interface CurriculumSeed {
  version: number;
  subjects: CurriculumSubjectSeed[];
}

/**
 * Adds missing seed subjects and topics; existing records are never overwritten,
 * so renamed subjects/topics survive updates. Removed seed entries are not deleted.
 */
export async function seedCurriculum(seed: CurriculumSeed): Promise<void> {
  await db.transaction('rw', db.subjects, db.topics, db.settings, async () => {
    const subjectsBySeedKey = new Map<string, Subject>();
    for (const subject of await db.subjects.toArray()) {
      subjectsBySeedKey.set(subject.seedKey, subject);
    }

    const topicsBySeedKey = new Map<string, Topic>();
    for (const topic of await db.topics.toArray()) {
      if (topic.seedKey !== undefined) {
        topicsBySeedKey.set(topic.seedKey, topic);
      }
    }

    for (const subjectSeed of seed.subjects) {
      let subject = subjectsBySeedKey.get(subjectSeed.seedKey);

      if (!subject) {
        subject = {
          id: newId(),
          seedKey: subjectSeed.seedKey,
          exam: subjectSeed.exam,
          name: subjectSeed.name,
          slug: subjectSeed.slug,
          icon: subjectSeed.icon,
          order: subjectSeed.order,
        };
        await db.subjects.add(subject);
        subjectsBySeedKey.set(subject.seedKey, subject);
      }

      for (const topicSeed of subjectSeed.topics) {
        if (topicsBySeedKey.has(topicSeed.seedKey)) {
          continue;
        }

        const topic: Topic = {
          id: newId(),
          seedKey: topicSeed.seedKey,
          subjectId: subject.id,
          name: topicSeed.name,
          order: topicSeed.order,
          isCustom: false,
          createdAt: new Date().toISOString(),
        };
        await db.topics.add(topic);
        topicsBySeedKey.set(topicSeed.seedKey, topic);
      }
    }

    await db.settings.put({ key: 'seedVersion', value: seed.version });
  });
}
