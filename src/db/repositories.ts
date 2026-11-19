import type { AppSettings, ExamType, Subject, Topic, TopicBook } from '@/domain/types';
import { newId } from '@/lib/id';
import { db } from './db';

export { seedCurriculum } from './seed';
export type { CurriculumSeed, CurriculumSubjectSeed, CurriculumTopicSeed } from './seed';

export const DEFAULT_SETTINGS: AppSettings = {
  profileName: '',
  accent: '#3B82F6',
  examDate: '2027-06-19',
  examName: 'YKS 2027',
  onboardingDone: false,
  schemaVersion: 1,
  seedVersion: 1,
  aytAlan: 'tumu',
  hiddenSubjects: [],
};

export async function getSettings(): Promise<AppSettings> {
  const settings: Record<string, unknown> = {
    ...DEFAULT_SETTINGS,
    hiddenSubjects: [...DEFAULT_SETTINGS.hiddenSubjects],
  };
  for (const row of await db.settings.toArray()) {
    settings[row.key] = row.value;
  }
  return settings as unknown as AppSettings;
}

export async function patchSettings(patch: Partial<AppSettings>): Promise<void> {
  const rows: Array<{ key: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      rows.push({ key, value });
    }
  }
  if (rows.length === 0) {
    return;
  }
  await db.settings.bulkPut(rows);
}

export async function listSubjects(exam?: ExamType): Promise<Subject[]> {
  if (exam) {
    return db.subjects.where('exam').equals(exam).sortBy('order');
  }
  return db.subjects.orderBy('order').toArray();
}

export async function listTopics(subjectId: string): Promise<Topic[]> {
  return db.topics.where('subjectId').equals(subjectId).sortBy('order');
}

export async function listTopicBooks(topicId: string): Promise<TopicBook[]> {
  return db.topicBooks.where('topicId').equals(topicId).toArray();
}

export async function addCustomTopic(subjectId: string, name: string): Promise<Topic> {
  return db.transaction('rw', db.topics, async () => {
    const topicCount = await db.topics.where('subjectId').equals(subjectId).count();
    const topic: Topic = {
      id: newId(),
      seedKey: undefined,
      subjectId,
      name,
      order: topicCount + 1,
      isCustom: true,
      createdAt: new Date().toISOString(),
    };
    await db.topics.add(topic);
    return topic;
  });
}

export async function renameTopic(topicId: string, name: string): Promise<void> {
  await db.topics.update(topicId, { name });
}

export async function deleteCustomTopicCascade(topicId: string): Promise<void> {
  await db.transaction('rw', db.topics, db.topicBooks, db.notes, db.attachments, db.photos, async () => {
    const topic = await db.topics.get(topicId);
    if (!topic?.isCustom) {
      return;
    }

    await db.topicBooks.where('topicId').equals(topicId).delete();
    await db.notes.delete(topicId);
    await db.attachments.where('topicId').equals(topicId).delete();
    await db.photos.where('topicId').equals(topicId).modify({ topicId: undefined });
    await db.topics.delete(topicId);
  });
}
