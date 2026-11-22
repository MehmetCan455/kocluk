import Dexie, { type Table } from 'dexie';
import type {
  ActivityLog,
  Attachment,
  Book,
  CatalogBook,
  Exam,
  ExamResult,
  Note,
  Photo,
  PhotoSearch,
  PracticeSession,
  ScheduleEntry,
  ScheduleFile,
  ScheduleRow,
  ScheduleTable,
  ScheduleTask,
  ScheduleWeek,
  Subject,
  Topic,
  TopicBook,
  TopicProgress,
  UserBook,
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
  scheduleEntries!: Table<ScheduleEntry, string>;
  scheduleFiles!: Table<ScheduleFile, string>;
  scheduleTables!: Table<ScheduleTable, string>;
  catalogBooks!: Table<CatalogBook, string>;
  userBooks!: Table<UserBook, string>;
  activityLogs!: Table<ActivityLog, string>;
  scheduleWeeks!: Table<ScheduleWeek, string>;
  scheduleRows!: Table<ScheduleRow, string>;
  scheduleTasks!: Table<ScheduleTask, string>;
  topicProgress!: Table<TopicProgress, string>;

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

    // v3 adds `examId` and `mastered` to the projection so the practice flow
    // can filter without loading full photo rows. Existing projections are
    // rebuilt from the photos table.
    this.version(3)
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

    // v4 adds the weekly program tables. Both are new, so the upgrade is purely
    // additive: no existing table is dropped, reindexed or rewritten.
    this.version(4).stores({
      scheduleEntries: 'id, day, startTime, updatedAt',
      scheduleFiles: 'id, createdAt',
    });

    // v5 adds the single manual schedule table. The old schedule entries and
    // files stay in place; only the new table is used by the manual UI.
    this.version(5).stores({
      scheduleTables: 'id',
    });

    // v6 adds page-based book tracking and the dated weekly plan. Every store
    // is new, so the upgrade is purely additive: the legacy books, topicBooks
    // and scheduleTables tables keep their data and indexes untouched.
    this.version(6).stores({
      catalogBooks: 'id, ownerId, title, exam, subjectSlug, updatedAt, deletedAt',
      userBooks: 'id, &bookId, status, updatedAt, deletedAt',
      activityLogs: 'id, userBookId, topicId, taskId, createdAt, deletedAt',
      scheduleWeeks: 'id, &weekStart, updatedAt, deletedAt',
      scheduleRows: 'id, weekId, order',
      scheduleTasks: 'id, weekId, rowId, dayIndex, completedAt, updatedAt, deletedAt',
      topicProgress: 'id, &topicId, done, updatedAt, deletedAt',
    });
  }
}

export const db = new KoclukDB();
