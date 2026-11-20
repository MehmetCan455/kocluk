export type ExamType = 'TYT' | 'AYT';

export type AytAlan = 'sayisal' | 'ea' | 'sozel' | 'tumu';

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
}

export interface Topic {
  id: string;
  seedKey?: string;
  subjectId: string;
  name: string;
  order: number;
  isCustom: boolean;
  createdAt: string;
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
  note: string;
  createdAt: string;
}

export interface ExamResult {
  id: string;
  examId: string;
  subjectId: string;
  correct: number;
  wrong: number;
  blank: number;
  net: number;
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
}

export interface Progress {
  solved: number;
  total: number;
  percent: number;
  remaining: number;
  started: boolean;
  done: boolean;
}
