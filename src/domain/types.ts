export type ExamType = 'TYT' | 'AYT';

export type AytAlan = 'sayisal' | 'ea' | 'sozel' | 'tumu';

/** A full mock exam, or a single-branch mock exam. */
export type ExamKind = 'full' | 'branch';

/** The fixed branch catalog; each key maps to one row in `branchConfig.ts`. */
export type BranchExamKey =
  | 'tyt-turkce'
  | 'tyt-sosyal'
  | 'tyt-matematik'
  | 'tyt-fen'
  | 'ayt-sayisal-matematik'
  | 'ayt-sayisal-fen'
  | 'ayt-ea-matematik'
  | 'ayt-ea-edebiyat-sosyal-1'
  | 'ayt-sozel-edebiyat-sosyal-1'
  | 'ayt-sozel-sosyal-2';

/**
 * Geometry is a separate subject in topic/book tracking. Exam entry can merge
 * it into the maths row instead, which this setting controls.
 */
export type GeometryMode = 'separate' | 'combined';

export interface Subject {
  id: string;
  seedKey: string;
  exam: ExamType;
  name: string;
  slug: string;
  icon: string;
  order: number;
  updatedAt?: string;
  deletedAt?: string;
}

export interface Topic {
  id: string;
  seedKey?: string;
  subjectId: string;
  name: string;
  order: number;
  isCustom: boolean;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
}

export interface Book {
  id: string;
  name: string;
  publisher?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TopicBook {
  id: string;
  topicId: string;
  bookId: string;
  totalTests: number;
  solvedTests: number;
  createdAt: string;
  updatedAt: string;
}

export interface Exam {
  id: string;
  type: ExamType;
  name: string;
  date: string;
  alan?: AytAlan;
  /** Missing on old records, which are full exams. */
  kind?: ExamKind;
  /** Only present when `kind === 'branch'`. */
  branch?: BranchExamKey;
  note: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
}

export interface ExamResult {
  id: string;
  examId: string;
  subjectId: string;
  correct: number;
  wrong: number;
  blank: number;
  net: number;
  updatedAt?: string;
  deletedAt?: string;
}

export interface Photo {
  id: string;
  examId?: string;
  examType: ExamType;
  subjectId: string;
  topicId?: string;
  note: string;
  /** The correct choice entered with the question; practice tests need it. */
  correctOption?: CorrectOption;
  blob: Blob;
  thumbBlob: Blob;
  width: number;
  height: number;
  mastered: boolean;
  practiceCount: number;
  lastPracticedAt?: string;
  createdAt: string;
}

export type CorrectOption = 'A' | 'B' | 'C' | 'D' | 'E';

export interface PhotoFilters {
  examType?: ExamType;
  subjectId?: string;
  topicId?: string;
  examId?: string;
  mastered?: boolean;
  from?: string;
  to?: string;
  query?: string;
}

/**
 * Blob-free projection of a photo used by global search and by the practice
 * flow. It is kept in sync by the photo repository so list screens never need
 * to read the full-size image blobs.
 */
export interface PhotoSearch {
  id: string;
  examId?: string;
  examType: ExamType;
  subjectId: string;
  topicId?: string;
  note: string;
  correctOption?: CorrectOption;
  mastered: boolean;
  createdAt: string;
}

export interface Note {
  topicId: string;
  contentHtml: string;
  plainText: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Attachment {
  id: string;
  topicId: string;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

/**
 * Manual weekly schedule row. `day` is 1–7 with Monday as 1 (ISO weekday);
 * `startTime`/`endTime` are zero-padded HH:mm strings so lexical order matches
 * chronological order.
 */
export interface ScheduleEntry {
  id: string;
  day: number;
  startTime: string;
  endTime: string;
  title: string;
  subjectId?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** An uploaded schedule photo or PDF, stored as a blob like note attachments. */
export interface ScheduleFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

/** How the schedule page is shown: a free-text table or photo/PDF uploads. */
export type ScheduleMode = 'upload' | 'manual';

/** Seven free-text cells, Monday first. Totals are not calculated automatically. */
export type ScheduleTableDayCells = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/** Seven day-completion flags, Monday first, matching the day cells. */
export type ScheduleTableDoneCells = [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
];

export interface ScheduleTableRow {
  id: string;
  subject: string;
  days: ScheduleTableDayCells;
  done: ScheduleTableDoneCells;
  total: string;
}

export interface ScheduleTableTotals {
  label: string;
  days: ScheduleTableDayCells;
  total: string;
}

/** The single manual weekly table (`id: 'main'`), saved as one record. */
export interface ScheduleTable {
  id: string;
  rows: ScheduleTableRow[];
  totals: ScheduleTableTotals;
  note: string;
  updatedAt: string;
}

export type PracticeOutcome = 'correct' | 'wrong' | 'blank';

export interface PracticeFilters {
  examType?: ExamType;
  subjectIds?: string[];
  topicIds?: string[];
  examId?: string;
  onlyUnmastered?: boolean;
  count?: number;
}

export interface PracticeSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  filters: PracticeFilters;
  photoIds: string[];
  results: Record<string, PracticeOutcome>;
  /** The A-E choice the student picked; 'blank' for skipped questions. */
  choices?: Record<string, CorrectOption | 'blank'>;
}

export interface AppSettings {
  profileName: string;
  accent: string;
  examDate: string;
  examName: string;
  onboardingDone: boolean;
  lastBackupAt?: string;
  schemaVersion: number;
  seedVersion: number;
  aytAlan: AytAlan;
  hiddenSubjects: string[];
  geometryMode: GeometryMode;
  scheduleMode: ScheduleMode;
}

export interface Progress {
  solved: number;
  total: number;
  percent: number;
  remaining: number;
  started: boolean;
  done: boolean;
}

export type UserBookStatus = 'active' | 'completed' | 'archived';
export type ActivityType = 'book_pages' | 'page_set' | 'topic_review';
export type ScheduleTaskType = 'book' | 'topic' | 'free';

export interface CatalogBook {
  id: string;
  ownerId?: string;
  title: string;
  publisher?: string;
  exam?: ExamType;
  subjectSlug?: string;
  totalPages: number;
  edition?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface UserBook {
  id: string;
  bookId: string;
  totalPagesOverride?: number;
  note?: string;
  status: UserBookStatus;
  startedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ActivityLog {
  id: string;
  type: ActivityType;
  userBookId?: string;
  topicId?: string;
  fromPage?: number;
  toPage?: number;
  taskId?: string;
  source: 'task' | 'manual';
  createdAt: string;
  deletedAt?: string;
}

export interface ScheduleWeek {
  id: string;
  weekStart: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ScheduleRow {
  id: string;
  weekId: string;
  subjectId?: string;
  label: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ScheduleTask {
  id: string;
  weekId: string;
  rowId: string;
  dayIndex: number;
  type: ScheduleTaskType;
  userBookId?: string;
  fromPage?: number;
  toPage?: number;
  topicId?: string;
  title?: string;
  completedAt?: string;
  /** Mutually exclusive with `completedAt`; set when the task was missed. */
  missedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface SchedulePageChain {
  id: string;
  weekId: string;
  rowId: string;
  userBookId: string;
  startPage: number;
  endPage: number;
  chunkSize: number;
  chunkCount: number;
  slots: string;
  /** JSON array of chunk indexes the user chose to ignore, e.g. "[4]". */
  skippedChunks: string;
  /**
   * JSON array of page counts per chunk, e.g. "[3,3,3,3,3,3,2]". Absent or null
   * marks a legacy chain that keeps its even split with the last chunk long.
   */
  chunkSizes?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface TopicProgress {
  id: string;
  topicId: string;
  done: boolean;
  doneAt?: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface BookProgress {
  /** Highest `toPage` in the active `book_pages` stream; display only. */
  currentPage: number;
  /** Unique pages covered by the union of active read ranges. */
  readPages: number;
  totalPages: number;
  percent: number;
  remaining: number;
  started: boolean;
  done: boolean;
  hasTotalPages: boolean;
}

export type SyncQueueStatus = 'pending' | 'dead';

/** One local mutation waiting to be pushed to the sync API. */
export interface SyncQueueRow {
  /** `${table}:${rowId}`; a row can only have one queued mutation. */
  id: string;
  table: string;
  rowId: string;
  op: 'upsert' | 'delete';
  createdAt: string;
  updatedAt: string;
  attempts: number;
  status: SyncQueueStatus;
  lastError?: string | null;
}

/** Local sync bookkeeping such as the last seen change cursor. */
export interface SyncMetaRow {
  key: string;
  value: unknown;
}
