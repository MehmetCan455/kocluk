import type { AppSettings, Book, ExamType, Subject, Topic, TopicBook } from '@/domain/types';
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

export async function listBooks(): Promise<Book[]> {
  return db.books.orderBy('updatedAt').reverse().toArray();
}

export interface CreateBookInput {
  name: string;
  publisher?: string;
}

export async function createBook(input: CreateBookInput): Promise<Book> {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Kitap adı boş olamaz');
  }

  const publisher = input.publisher?.trim() || undefined;
  const now = new Date().toISOString();
  const book: Book = {
    id: newId(),
    name,
    publisher,
    createdAt: now,
    updatedAt: now,
  };
  await db.books.add(book);
  return book;
}

export interface UpsertTopicBookInput {
  id?: string;
  topicId: string;
  bookId: string;
  totalTests: number;
  solvedTests: number;
}

function assertValidTestCounts(totalTests: number, solvedTests: number): void {
  if (!Number.isInteger(totalTests)) {
    throw new Error('Toplam test sayısı tam sayı olmalı');
  }
  if (totalTests < 1) {
    throw new Error('Toplam test sayısı en az 1 olmalı');
  }
  if (!Number.isInteger(solvedTests)) {
    throw new Error('Çözülen test sayısı tam sayı olmalı');
  }
  if (solvedTests < 0) {
    throw new Error('Çözülen test sayısı negatif olamaz');
  }
  if (solvedTests > totalTests) {
    throw new Error('Çözülen test sayısı toplamdan fazla olamaz');
  }
}

/**
 * Creates or updates the test record for a topic+book pair. Without an `id`,
 * an existing record for the same pair is updated instead of duplicated.
 * With an `id`, that record is updated in place and keeps its topic and book.
 * Books and topics are never modified beyond the book's `updatedAt` touch.
 */
export async function upsertTopicBook(input: UpsertTopicBookInput): Promise<TopicBook> {
  assertValidTestCounts(input.totalTests, input.solvedTests);

  return db.transaction('rw', db.topics, db.books, db.topicBooks, async () => {
    const existing = input.id
      ? await db.topicBooks.get(input.id)
      : await db.topicBooks
          .where('topicId')
          .equals(input.topicId)
          .filter((record) => record.bookId === input.bookId)
          .first();

    if (input.id && !existing) {
      throw new Error('Test kaydı bulunamadı');
    }

    const topicId = existing?.topicId ?? input.topicId;
    const bookId = existing?.bookId ?? input.bookId;

    if (!(await db.topics.get(topicId))) {
      throw new Error('Konu bulunamadı');
    }
    if (!(await db.books.get(bookId))) {
      throw new Error('Kitap bulunamadı');
    }

    const now = new Date().toISOString();
    const record: TopicBook = existing
      ? {
          ...existing,
          totalTests: input.totalTests,
          solvedTests: input.solvedTests,
          updatedAt: now,
        }
      : {
          id: newId(),
          topicId,
          bookId,
          totalTests: input.totalTests,
          solvedTests: input.solvedTests,
          createdAt: now,
          updatedAt: now,
        };

    await db.topicBooks.put(record);
    await db.books.update(bookId, { updatedAt: now });
    return record;
  });
}

export async function deleteTopicBook(id: string): Promise<void> {
  await db.topicBooks.delete(id);
}

export async function addCustomTopic(subjectId: string, name: string): Promise<Topic> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Konu adı boş olamaz');
  }

  return db.transaction('rw', db.subjects, db.topics, async () => {
    const subject = await db.subjects.get(subjectId);
    if (!subject) {
      throw new Error('Ders bulunamadı');
    }

    const topics = await db.topics.where('subjectId').equals(subjectId).toArray();
    const maxOrder = topics.reduce((max, topic) => Math.max(max, topic.order), 0);
    const topic: Topic = {
      id: newId(),
      seedKey: undefined,
      subjectId,
      name: trimmedName,
      order: maxOrder + 1,
      isCustom: true,
      createdAt: new Date().toISOString(),
    };
    await db.topics.add(topic);
    return topic;
  });
}

export async function renameTopic(topicId: string, name: string): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Konu adı boş olamaz');
  }
  await db.topics.update(topicId, { name: trimmedName });
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
