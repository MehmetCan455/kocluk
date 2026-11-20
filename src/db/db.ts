import Dexie, { type Table } from 'dexie';
import type {
  Attachment,
  Book,
  Exam,
  ExamResult,
  Note,
  Photo,
  PhotoSearch,
  PracticeSession,
  Subject,
  Topic,
  TopicBook,
} from '@/domain/types';
import { PHOTO_SEARCH_SCHEMA, toPhotoSearch } from './photoSearch';

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
  photoSearch!: Table<PhotoSearch, string>;
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

    // v2 adds the blob-free search projection. Existing photos are copied in a
    // read-only upgrade transaction; the photos table itself is untouched.
    this.version(2)
      .stores({
        photoSearch: PHOTO_SEARCH_SCHEMA,
      })
      .upgrade(async (transaction) => {
        const photos = await transaction.table<Photo, string>('photos').toArray();
        if (photos.length > 0) {
          await transaction
            .table<PhotoSearch, string>('photoSearch')
            .bulkPut(photos.map(toPhotoSearch));
        }
      });
  }
}

export const db = new KoclukDB();
