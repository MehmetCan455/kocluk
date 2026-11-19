import Dexie, { type Table } from 'dexie';
import type {
  Attachment,
  Book,
  Exam,
  ExamResult,
  Note,
  Photo,
  PracticeSession,
  Subject,
  Topic,
  TopicBook,
} from '@/domain/types';

export interface SettingsRow {
  key: string;
  value: unknown;
}

export class KoclukDB extends Dexie {
  settings!: Table<SettingsRow, string>;
  subjects!: Table<Subject, string>;
  topics!: Table<Topic, string>;
  books!: Table<Book, string>;
  topicBooks!: Table<TopicBook, string>;
  exams!: Table<Exam, string>;
  examResults!: Table<ExamResult, string>;
  photos!: Table<Photo, string>;
  notes!: Table<Note, string>;
  attachments!: Table<Attachment, string>;
  practiceSessions!: Table<PracticeSession, string>;

  constructor() {
    super('kocluk');

    this.version(1).stores({
      settings: 'key',
      subjects: 'id, &seedKey, exam, order',
      topics: 'id, &seedKey, subjectId, order',
      books: 'id, name, updatedAt',
      topicBooks: 'id, topicId, bookId',
      exams: 'id, type, date',
      examResults: 'id, examId, subjectId',
      photos: 'id, examId, subjectId, topicId, createdAt',
      notes: 'topicId',
      attachments: 'id, topicId',
      practiceSessions: 'id, createdAt, completedAt',
    });
  }
}

export const db = new KoclukDB();
