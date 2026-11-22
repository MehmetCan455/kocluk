import JSZip from 'jszip';
import { z } from 'zod';
import { CATALOG_SEED, catalogBookId, type CatalogBookSeed } from '@/data/catalogBooks';
import { CURRICULUM } from '@/data/curriculum';
import { seedCatalog } from '@/db/catalogRepository';
import { db, type SettingsRow } from '@/db/db';
import { toPhotoSearch } from '@/db/photoSearch';
import { seedCurriculum } from '@/db/seed';
import type {
  ActivityLog,
  AppSettings,
  Attachment,
  CatalogBook,
  Exam,
  Note,
  Photo,
  PhotoSearch,
  PracticeSession,
  ScheduleEntry,
  ScheduleFile,
  ScheduleRow,
  ScheduleTask,
  ScheduleTable,
  ScheduleWeek,
  TopicProgress,
  UserBook,
} from '@/domain/types';
import { calculateNet } from '@/domain/calculations';
import { getBranchExam } from '@/features/exams/branchConfig';
import {
  SCHEDULE_TABLE_CELL_MAX_LENGTH,
  SCHEDULE_TABLE_ID,
  SCHEDULE_TABLE_MAX_ROWS,
  SCHEDULE_TABLE_NOTE_MAX_LENGTH,
  SCHEDULE_TABLE_SUBJECT_MAX_LENGTH,
  SCHEDULE_TABLE_TOTAL_MAX_LENGTH,
  emptyScheduleTableDoneCells,
} from '@/domain/scheduleTable';
import { isValidDateString } from '@/lib/date';
import { deterministicId } from '@/lib/deterministicId';
import {
  CATALOG_NAMESPACE,
  LOCAL_SCOPE,
  TOPIC_PROGRESS_NAMESPACE,
  USER_BOOK_NAMESPACE,
} from '@/lib/namespaces';
import { normalizeTr } from '@/lib/normalize';
import { htmlToPlainText, sanitizeHtml } from '@/lib/sanitize';
import { compareHHmm, isHHmm } from '@/lib/time';
import { isStorageQuotaError, STORAGE_QUOTA_MESSAGE } from '@/lib/storageError';
import { readBlobAsArrayBuffer } from '@/lib/zip';

/**
 * Backup format version. Version 6 adds page-based book tracking and the dated
 * weekly plan; version 5 added the branch exam `kind`/`branch` fields (a
 * missing `kind` is a full exam); version 4 added the manual schedule table,
 * version 3 the weekly program tables, version 2 the blob-free `photoSearch`
 * projection, and version 1 predates it. Missing tables in older archives are
 * read as empty lists.
 */
export const BACKUP_SCHEMA_VERSION = 6;
const MIN_BACKUP_SCHEMA_VERSION = 1;
export const INVALID_BACKUP_MESSAGE = 'Geçersiz yedek dosyası';
const NEWER_BACKUP_MESSAGE =
  'Daha yeni sürüm: Yedek bu uygulamanın desteklediğinden yeni. Lütfen uygulamayı güncelle.';

export interface BackupManifest {
  app: 'kocluk';
  schemaVersion: number;
  exportedAt: string;
  counts: Record<string, number>;
}

export interface BackupSummary {
  exportedAt: string;
  counts: Record<string, number>;
}

export type ImportBackupResult = BackupSummary;

export interface BackupProgress {
  phase: 'reading' | 'blobs' | 'zip';
  /** Overall percent, 0-100. */
  percent: number;
  /** Files written so far during the blob/zip phases. */
  current?: number;
  /** Total files that will be written. */
  total?: number;
}

export type BackupProgressHandler = (progress: BackupProgress) => void;

const idSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.includes('/') && !value.includes('\\'), 'Geçersiz kimlik');
const examTypeSchema = z.enum(['TYT', 'AYT']);
const aytAlanSchema = z.enum(['sayisal', 'ea', 'sozel', 'tumu']);
/** A branch exam needs a concrete AYT field; `tumu` is full-exam only. */
const AYT_BRANCH_ALAN_VALUES: ReadonlySet<string> = new Set(['sayisal', 'ea', 'sozel']);
const practiceOutcomeSchema = z.enum(['correct', 'wrong', 'blank']);
const exportedAtSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Geçersiz tarih');

const settingsRowSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

const SETTING_VALUE_SCHEMAS = {
  profileName: z.string(),
  accent: z.string(),
  examDate: z.string(),
  examName: z.string(),
  onboardingDone: z.boolean(),
  lastBackupAt: z.string(),
  schemaVersion: z.number().int().nonnegative(),
  seedVersion: z.number().int().nonnegative(),
  aytAlan: aytAlanSchema,
  hiddenSubjects: z.array(z.string()),
  geometryMode: z.enum(['separate', 'combined']),
  scheduleMode: z.enum(['upload', 'manual']),
} satisfies Record<keyof AppSettings, z.ZodType>;

type SettingKey = keyof typeof SETTING_VALUE_SCHEMAS;

const DANGEROUS_SETTING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const settingsSchema = z.array(settingsRowSchema).superRefine((rows, context) => {
  for (const [index, row] of rows.entries()) {
    if (DANGEROUS_SETTING_KEYS.has(row.key)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'key'],
        message: 'Ayar anahtarı kullanılamaz',
      });
      continue;
    }

    const valueSchema = Object.prototype.hasOwnProperty.call(SETTING_VALUE_SCHEMAS, row.key)
      ? SETTING_VALUE_SCHEMAS[row.key as SettingKey]
      : undefined;
    if (!valueSchema) {
      context.addIssue({
        code: 'custom',
        path: [index, 'key'],
        message: 'Bilinmeyen ayar anahtarı',
      });
      continue;
    }
    if (!valueSchema.safeParse(row.value).success) {
      context.addIssue({
        code: 'custom',
        path: [index, 'value'],
        message: 'Ayar değeri geçersiz',
      });
    }
  }
});

const subjectSchema = z.object({
  id: idSchema,
  seedKey: z.string().min(1),
  exam: examTypeSchema,
  name: z.string(),
  slug: z.string(),
  icon: z.string(),
  order: z.number().int(),
});

const topicSchema = z.object({
  id: idSchema,
  seedKey: z.string().min(1).optional(),
  subjectId: idSchema,
  name: z.string(),
  order: z.number().int(),
  isCustom: z.boolean(),
  createdAt: z.string(),
});

const bookSchema = z.object({
  id: idSchema,
  name: z.string(),
  publisher: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const topicBookSchema = z
  .object({
    id: idSchema,
    topicId: idSchema,
    bookId: idSchema,
    totalTests: z.number().int().nonnegative(),
    solvedTests: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .refine((row) => row.solvedTests <= row.totalTests, {
    message: 'Çözülen test sayısı toplamdan fazla olamaz',
  });

const examSchema = z
  .object({
    id: idSchema,
    type: examTypeSchema,
    name: z.string(),
    date: z.string(),
    alan: aytAlanSchema.optional(),
    // v4 backups predate branch exams; a missing kind is a full exam.
    kind: z.enum(['full', 'branch']).default('full'),
    branch: z.string().optional(),
    note: z.string(),
    createdAt: z.string(),
  })
  .superRefine((exam, context) => {
    if (exam.kind === 'full') {
      if (exam.branch !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['branch'],
          message: 'Tam denemede branş seçilemez',
        });
      }
      return;
    }

    if (!exam.branch) {
      context.addIssue({
        code: 'custom',
        path: ['branch'],
        message: 'Branş seçilmedi',
      });
      return;
    }
    const config = getBranchExam(exam.branch);
    if (!config) {
      context.addIssue({
        code: 'custom',
        path: ['branch'],
        message: 'Branş seçimi geçersiz',
      });
      return;
    }
    if (config.type !== exam.type) {
      context.addIssue({
        code: 'custom',
        path: ['branch'],
        message: 'Branş deneme türüyle eşleşmiyor',
      });
      return;
    }
    if (config.type === 'TYT') {
      if (exam.alan !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['alan'],
          message: 'TYT branşında alan seçilemez',
        });
      }
    } else if (!AYT_BRANCH_ALAN_VALUES.has(exam.alan ?? 'tumu')) {
      context.addIssue({
        code: 'custom',
        path: ['alan'],
        message: 'Branş için AYT alanı seçilmeli',
      });
    } else if (config.alan !== exam.alan) {
      context.addIssue({
        code: 'custom',
        path: ['alan'],
        message: 'Branş AYT alanıyla eşleşmiyor',
      });
    }
  });

const examResultSchema = z.object({
  id: idSchema,
  examId: idSchema,
  subjectId: idSchema,
  correct: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  blank: z.number().int().nonnegative(),
  net: z.number(),
});

export function photoBackupPaths(id: string): { blobPath: string; thumbBlobPath: string } {
  return {
    blobPath: `fotograflar/yanlislar/${id}.jpg`,
    thumbBlobPath: `fotograflar/yanlislar/${id}-thumb.jpg`,
  };
}

const photoSchema = z
  .object({
    id: idSchema,
    examId: idSchema.optional(),
    examType: examTypeSchema,
    subjectId: idSchema,
    topicId: idSchema.optional(),
    note: z.string(),
    correctOption: z.enum(['A', 'B', 'C', 'D', 'E']).optional(),
    blobPath: z.string(),
    thumbBlobPath: z.string(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    mastered: z.boolean(),
    practiceCount: z.number().int().nonnegative(),
    lastPracticedAt: z.string().optional(),
    createdAt: z.string(),
  })
  .superRefine((photo, context) => {
    const expected = photoBackupPaths(photo.id);
    if (photo.blobPath !== expected.blobPath) {
      context.addIssue({
        code: 'custom',
        path: ['blobPath'],
        message: 'Fotoğraf yolu geçersiz',
      });
    }
    if (photo.thumbBlobPath !== expected.thumbBlobPath) {
      context.addIssue({
        code: 'custom',
        path: ['thumbBlobPath'],
        message: 'Küçük fotoğraf yolu geçersiz',
      });
    }
  });

const photoSearchSchema = z.object({
  id: idSchema,
  examId: idSchema.optional(),
  examType: examTypeSchema,
  subjectId: idSchema,
  topicId: idSchema.optional(),
  note: z.string(),
  // Optional: v2 backups predate these fields. Import always rebuilds the
  // projection from the photos table, so their absence is harmless.
  correctOption: z.enum(['A', 'B', 'C', 'D', 'E']).optional(),
  mastered: z.boolean().optional(),
  createdAt: z.string(),
});

const noteSchema = z.object({
  topicId: idSchema,
  contentHtml: z.string(),
  plainText: z.string(),
  updatedAt: z.string(),
});

const attachmentSchema = z.object({
  id: idSchema,
  topicId: idSchema,
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  blobPath: z
    .string()
    .regex(/^ekler\/[^/\\]+$/, 'Ek yolu geçersiz')
    .refine((value) => !value.includes('..'), 'Ek yolu geçersiz'),
  createdAt: z.string(),
});

const hhmmSchema = z.string().refine(isHHmm, 'Saat SS:DD biçiminde olmalı');

const scheduleEntrySchema = z
  .object({
    id: idSchema,
    day: z.number().int().min(1).max(7),
    startTime: hhmmSchema,
    endTime: hhmmSchema,
    title: z.string().refine((value) => value.trim().length > 0, 'Başlık boş olamaz'),
    subjectId: idSchema.optional(),
    note: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .refine((entry) => compareHHmm(entry.endTime, entry.startTime) > 0, {
    path: ['endTime'],
    message: 'Bitiş saati başlangıçtan sonra olmalı',
  });

const scheduleFileSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    mime: z.string(),
    size: z.number().int().nonnegative(),
    filePath: z
      .string()
      .regex(/^program\/[^/\\]+$/, 'Çizelge dosyası yolu geçersiz')
      .refine((value) => !value.includes('..'), 'Çizelge dosyası yolu geçersiz'),
    createdAt: z.string(),
  })
  .superRefine((file, context) => {
    if (file.filePath !== scheduleFileBackupPath(file)) {
      context.addIssue({
        code: 'custom',
        path: ['filePath'],
        message: 'Çizelge dosyası yolu geçersiz',
      });
    }
  });

const scheduleDayCellsSchema = z.tuple([
  z.string().max(SCHEDULE_TABLE_CELL_MAX_LENGTH),
  z.string().max(SCHEDULE_TABLE_CELL_MAX_LENGTH),
  z.string().max(SCHEDULE_TABLE_CELL_MAX_LENGTH),
  z.string().max(SCHEDULE_TABLE_CELL_MAX_LENGTH),
  z.string().max(SCHEDULE_TABLE_CELL_MAX_LENGTH),
  z.string().max(SCHEDULE_TABLE_CELL_MAX_LENGTH),
  z.string().max(SCHEDULE_TABLE_CELL_MAX_LENGTH),
]);

const scheduleTableRowSchema = z.object({
  id: idSchema,
  subject: z.string().max(SCHEDULE_TABLE_SUBJECT_MAX_LENGTH),
  days: scheduleDayCellsSchema,
  done: z
    .tuple([
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
    ])
    .default(emptyScheduleTableDoneCells()),
  total: z.string().max(SCHEDULE_TABLE_TOTAL_MAX_LENGTH),
});

const scheduleTableSchema = z
  .object({
    id: z.literal(SCHEDULE_TABLE_ID),
    rows: z.array(scheduleTableRowSchema).max(SCHEDULE_TABLE_MAX_ROWS),
    totals: z.object({
      label: z.string().min(1).max(SCHEDULE_TABLE_TOTAL_MAX_LENGTH),
      days: scheduleDayCellsSchema,
      total: z.string().max(SCHEDULE_TABLE_TOTAL_MAX_LENGTH),
    }),
    note: z.string().max(SCHEDULE_TABLE_NOTE_MAX_LENGTH),
    updatedAt: z.string(),
  })
  .superRefine((table, context) => {
    const rowIds = new Set<string>();
    for (const [index, row] of table.rows.entries()) {
      if (rowIds.has(row.id)) {
        context.addIssue({
          code: 'custom',
          path: ['rows', index, 'id'],
          message: 'Çizelge satırı kimliği tekrar ediyor',
        });
      }
      rowIds.add(row.id);
    }
  });

const practiceFiltersSchema = z.object({
  examType: examTypeSchema.optional(),
  subjectIds: z.array(idSchema).optional(),
  topicIds: z.array(idSchema).optional(),
  examId: idSchema.optional(),
  onlyUnmastered: z.boolean().optional(),
  count: z.number().int().nonnegative().optional(),
});

const practiceSessionSchema = z.object({
  id: idSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  filters: practiceFiltersSchema,
  photoIds: z.array(idSchema),
  results: z.record(z.string(), practiceOutcomeSchema),
  choices: z
    .record(z.string(), z.union([z.enum(['A', 'B', 'C', 'D', 'E']), z.literal('blank')]))
    .optional(),
});

const userBookStatusSchema = z.enum(['active', 'completed', 'archived']);
const activityTypeSchema = z.enum(['book_pages', 'page_set', 'topic_review']);
const scheduleTaskTypeSchema = z.enum(['book', 'topic', 'free']);

/**
 * Version 6 tables. Every soft-deletable row keeps its `deletedAt` tombstone
 * so restoring a backup never resurrects data the user deleted.
 */
const catalogBookSchema = z.object({
  id: idSchema,
  ownerId: z.string().optional(),
  title: z.string(),
  publisher: z.string().optional(),
  exam: examTypeSchema.optional(),
  subjectSlug: z.string().optional(),
  totalPages: z.number().int().nonnegative(),
  edition: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const userBookSchema = z.object({
  id: idSchema,
  bookId: idSchema,
  totalPagesOverride: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
  status: userBookStatusSchema,
  startedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const activityLogSchema = z.object({
  id: idSchema,
  type: activityTypeSchema,
  userBookId: idSchema.optional(),
  topicId: idSchema.optional(),
  fromPage: z.number().int().nonnegative().optional(),
  toPage: z.number().int().nonnegative().optional(),
  taskId: idSchema.optional(),
  source: z.enum(['task', 'manual']),
  createdAt: z.string(),
  deletedAt: z.string().optional(),
});

const scheduleWeekSchema = z.object({
  id: idSchema,
  weekStart: z.string().min(1),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const scheduleRowSchema = z.object({
  id: idSchema,
  weekId: idSchema,
  subjectId: idSchema.optional(),
  label: z.string(),
  order: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const scheduleTaskSchema = z.object({
  id: idSchema,
  weekId: idSchema,
  rowId: idSchema,
  dayIndex: z.number().int(),
  type: scheduleTaskTypeSchema,
  userBookId: idSchema.optional(),
  fromPage: z.number().int().nonnegative().optional(),
  toPage: z.number().int().nonnegative().optional(),
  topicId: idSchema.optional(),
  title: z.string().optional(),
  completedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const topicProgressSchema = z.object({
  id: idSchema,
  topicId: idSchema,
  done: z.boolean(),
  doneAt: z.string().optional(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

const backupDataSchema = z.object({
  settings: settingsSchema,
  subjects: z.array(subjectSchema),
  topics: z.array(topicSchema),
  books: z.array(bookSchema),
  topicBooks: z.array(topicBookSchema),
  exams: z.array(examSchema),
  examResults: z.array(examResultSchema),
  photos: z.array(photoSchema),
  // Version 1 backups do not have this derived table.
  photoSearch: z.array(photoSearchSchema).optional(),
  notes: z.array(noteSchema),
  attachments: z.array(attachmentSchema),
  practiceSessions: z.array(practiceSessionSchema),
  // Backups written before v3 simply do not have these tables.
  scheduleEntries: z.array(scheduleEntrySchema).default([]),
  scheduleFiles: z.array(scheduleFileSchema).default([]),
  // v4 adds the single manual table; older archives read it as empty.
  scheduleTables: z.array(scheduleTableSchema).max(1).default([]),
  // v6 adds page-based books and the dated weekly plan. A v5 archive simply
  // does not have these tables, so it parses with empty lists.
  catalogBooks: z.array(catalogBookSchema).default([]),
  userBooks: z.array(userBookSchema).default([]),
  activityLogs: z.array(activityLogSchema).default([]),
  scheduleWeeks: z.array(scheduleWeekSchema).default([]),
  scheduleRows: z.array(scheduleRowSchema).default([]),
  scheduleTasks: z.array(scheduleTaskSchema).default([]),
  topicProgress: z.array(topicProgressSchema).default([]),
});

const manifestSchema = z.object({
  app: z.literal('kocluk'),
  schemaVersion: z.number().int().nonnegative(),
  exportedAt: exportedAtSchema,
  counts: z.record(z.string(), z.number().int().nonnegative()),
});

type BackupData = z.infer<typeof backupDataSchema>;
type SerializedPhoto = z.infer<typeof photoSchema>;
type SerializedAttachment = z.infer<typeof attachmentSchema>;

interface Archive {
  zip: JSZip;
  manifest: BackupManifest;
  data: BackupData;
}

interface RestoredData {
  settings: SettingsRow[];
  subjects: z.infer<typeof subjectSchema>[];
  topics: z.infer<typeof topicSchema>[];
  books: z.infer<typeof bookSchema>[];
  topicBooks: z.infer<typeof topicBookSchema>[];
  exams: Exam[];
  examResults: z.infer<typeof examResultSchema>[];
  photos: Photo[];
  photoSearch: PhotoSearch[];
  notes: Note[];
  attachments: Attachment[];
  practiceSessions: PracticeSession[];
  scheduleEntries: ScheduleEntry[];
  scheduleFiles: ScheduleFile[];
  scheduleTables: ScheduleTable[];
  catalogBooks: CatalogBook[];
  userBooks: UserBook[];
  activityLogs: ActivityLog[];
  scheduleWeeks: ScheduleWeek[];
  scheduleRows: ScheduleRow[];
  scheduleTasks: ScheduleTask[];
  topicProgress: TopicProgress[];
}

function invalidBackup(): Error {
  return new Error(INVALID_BACKUP_MESSAGE);
}

function extensionForFile(file: Pick<ScheduleFile, 'name' | 'mime'>): string {
  const name = file.name.trim();
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    const extension = name.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,12}$/.test(extension)) {
      return extension;
    }
  }

  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
  };
  return byMime[file.mime] ?? 'bin';
}

function attachmentBackupPath(attachment: Pick<Attachment, 'id' | 'name' | 'mime'>): string {
  return `ekler/${attachment.id}.${extensionForFile(attachment)}`;
}

export function scheduleFileBackupPath(
  file: Pick<ScheduleFile, 'id' | 'name' | 'mime'>,
): string {
  return `program/${file.id}.${extensionForFile(file)}`;
}

function countTables(data: BackupData): Record<string, number> {
  return {
    settings: data.settings.length,
    subjects: data.subjects.length,
    topics: data.topics.length,
    books: data.books.length,
    topicBooks: data.topicBooks.length,
    exams: data.exams.length,
    examResults: data.examResults.length,
    photos: data.photos.length,
    // Import always rebuilds this projection from the photos table.
    photoSearch: data.photos.length,
    notes: data.notes.length,
    attachments: data.attachments.length,
    practiceSessions: data.practiceSessions.length,
    scheduleEntries: data.scheduleEntries.length,
    scheduleFiles: data.scheduleFiles.length,
    scheduleTables: data.scheduleTables.length,
    catalogBooks: data.catalogBooks.length,
    userBooks: data.userBooks.length,
    activityLogs: data.activityLogs.length,
    scheduleWeeks: data.scheduleWeeks.length,
    scheduleRows: data.scheduleRows.length,
    scheduleTasks: data.scheduleTasks.length,
    topicProgress: data.topicProgress.length,
  };
}

function migrateBackupData(data: BackupData, fromVersion: number): BackupData {
  if (fromVersion < 2) {
    // Version 1 stores the same rows but no photoSearch projection. The
    // projection is always rebuilt from restored photos below, so the only
    // migration needed is accepting the missing table.
    return { ...data, photoSearch: data.photoSearch ?? [] };
  }
  // The schedule tables added in v3/v4, the exam `kind`/`branch` fields added
  // in v5 and the page-based book/weekly plan tables added in v6 default
  // themselves in the schema. The v5→v6 book conversion needs the built
  // RestoredData, so importBackup owns it via buildNewModelFromLegacy.
  return data;
}

type RestoredBook = RestoredData['books'][number];
type RestoredTopicBook = RestoredData['topicBooks'][number];
type RestoredTopic = RestoredData['topics'][number];
type RestoredSubject = RestoredData['subjects'][number];

interface NewModelRows {
  catalogBooks: CatalogBook[];
  userBooks: UserBook[];
  topicProgress: TopicProgress[];
}

/** Private legacy rows get a stable catalog id derived from the old book id. */
function legacyCatalogBookId(bookId: string): string {
  return deterministicId(CATALOG_NAMESPACE, `${LOCAL_SCOPE}:legacy:${bookId}`);
}

function legacyUserBookId(catalogId: string): string {
  return deterministicId(USER_BOOK_NAMESPACE, `${LOCAL_SCOPE}:${catalogId}`);
}

function legacyTopicProgressId(topicId: string): string {
  return deterministicId(TOPIC_PROGRESS_NAMESPACE, `${LOCAL_SCOPE}:${topicId}`);
}

function isNewerSeed(candidate: CatalogBookSeed, current: CatalogBookSeed): boolean {
  if (candidate.edition !== current.edition) {
    return candidate.edition > current.edition;
  }
  // Equal editions cannot occur in the shipped seed, but the tie must still
  // resolve to a single row deterministically.
  return (
    catalogBookId(candidate.title, candidate.publisher, candidate.edition) <
    catalogBookId(current.title, current.publisher, current.edition)
  );
}

/**
 * Legacy books carry no catalog id, so their normalized title+publisher is
 * matched against the in-memory seed: the restore transaction clears every
 * table before the derived rows are written. The newest edition wins and the
 * catalog id breaks a same-edition tie.
 */
function matchCatalogSeed(book: RestoredBook): CatalogBookSeed | undefined {
  const title = normalizeTr(book.name);
  const publisher = normalizeTr(book.publisher ?? '');
  let best: CatalogBookSeed | undefined;
  for (const seed of CATALOG_SEED) {
    if (normalizeTr(seed.title) !== title || normalizeTr(seed.publisher) !== publisher) {
      continue;
    }
    if (!best || isNewerSeed(seed, best)) {
      best = seed;
    }
  }
  return best;
}

function catalogBookFromSeed(seed: CatalogBookSeed, now: string): CatalogBook {
  return {
    id: catalogBookId(seed.title, seed.publisher, seed.edition),
    title: seed.title,
    publisher: seed.publisher,
    exam: seed.exam,
    subjectSlug: seed.subjectSlug,
    totalPages: seed.totalPages,
    edition: seed.edition,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A custom book's subject/exam comes from the strict majority of its old topic
 * records (topics → subjects). A tie or no records leaves both fields empty,
 * which the UI labels "Genel".
 */
function deriveLegacySubject(
  bookId: string,
  topicBooks: readonly RestoredTopicBook[],
  topicsById: ReadonlyMap<string, RestoredTopic>,
  subjectsById: ReadonlyMap<string, RestoredSubject>,
): Pick<CatalogBook, 'subjectSlug' | 'exam'> {
  const counts = new Map<string, number>();
  for (const record of topicBooks) {
    if (record.bookId !== bookId) {
      continue;
    }
    const topic = topicsById.get(record.topicId);
    if (!topic) {
      continue;
    }
    counts.set(topic.subjectId, (counts.get(topic.subjectId) ?? 0) + 1);
  }

  let leader: { subjectId: string; count: number } | undefined;
  let tied = false;
  for (const [subjectId, count] of counts) {
    if (!leader || count > leader.count) {
      leader = { subjectId, count };
      tied = false;
    } else if (count === leader.count) {
      tied = true;
    }
  }

  const subject = leader && !tied ? subjectsById.get(leader.subjectId) : undefined;
  return subject ? { subjectSlug: subject.slug, exam: subject.exam } : {};
}

/**
 * Converts the pre-v6 `books`/`topicBooks` archive into the page-based model.
 * The legacy rows stay in the restored data as a read-only archive.
 *
 * - A book matching the catalog seed (normalized title+publisher, newest
 *   edition) reuses that catalog row; otherwise it becomes a private row with
 *   `totalPages: 0`, for the user to complete later.
 * - Every catalog id gets exactly one shelf row, so books matching the same
 *   seed merge, and no `userBooks.bookId` can dangle.
 * - A topic starts done only when all of its old records are fully solved.
 */
function buildNewModelFromLegacy(restored: RestoredData): NewModelRows {
  const now = new Date().toISOString();
  const topicsById = new Map(restored.topics.map((topic) => [topic.id, topic]));
  const subjectsById = new Map(restored.subjects.map((subject) => [subject.id, subject]));

  // Sorting by id makes the merged note and timestamps deterministic.
  const legacyBooks = [...restored.books].sort((left, right) => left.id.localeCompare(right.id));
  const catalogById = new Map<string, CatalogBook>();
  const mergedBooks = new Map<string, RestoredBook[]>();
  for (const book of legacyBooks) {
    const seed = matchCatalogSeed(book);
    const catalogBook: CatalogBook = seed
      ? catalogBookFromSeed(seed, now)
      : {
          id: legacyCatalogBookId(book.id),
          ownerId: LOCAL_SCOPE,
          title: book.name,
          publisher: book.publisher,
          totalPages: 0,
          ...deriveLegacySubject(book.id, restored.topicBooks, topicsById, subjectsById),
          createdAt: book.createdAt,
          updatedAt: book.updatedAt,
        };
    catalogById.set(catalogBook.id, catalogBook);
    const group = mergedBooks.get(catalogBook.id);
    if (group) {
      group.push(book);
    } else {
      mergedBooks.set(catalogBook.id, [book]);
    }
  }

  const userBooks: UserBook[] = [];
  for (const [catalogId, books] of mergedBooks) {
    const note = books
      .map((book) => book.note?.trim())
      .find((value): value is string => Boolean(value));
    const createdAt = books.reduce(
      (earliest, book) => (book.createdAt < earliest ? book.createdAt : earliest),
      books[0].createdAt,
    );
    const updatedAt = books.reduce(
      (latest, book) => (book.updatedAt > latest ? book.updatedAt : latest),
      books[0].updatedAt,
    );
    const userBook: UserBook = {
      id: legacyUserBookId(catalogId),
      bookId: catalogId,
      status: 'active',
      createdAt,
      updatedAt,
    };
    if (note) {
      userBook.note = note;
    }
    userBooks.push(userBook);
  }
  userBooks.sort((left, right) => left.id.localeCompare(right.id));

  // A topic is done only when every old record for it is fully solved. Partial
  // topics get no row; their legacy records remain visible in the archive.
  const recordsByTopic = new Map<string, RestoredTopicBook[]>();
  for (const record of restored.topicBooks) {
    const group = recordsByTopic.get(record.topicId);
    if (group) {
      group.push(record);
    } else {
      recordsByTopic.set(record.topicId, [record]);
    }
  }
  const topicProgress: TopicProgress[] = [];
  for (const [topicId, records] of recordsByTopic) {
    if (!topicsById.has(topicId)) {
      continue;
    }
    const fullySolved = records.every(
      (record) => record.totalTests > 0 && record.solvedTests >= record.totalTests,
    );
    if (!fullySolved) {
      continue;
    }
    const updatedAt = records.reduce(
      (latest, record) => (record.updatedAt > latest ? record.updatedAt : latest),
      records[0].updatedAt,
    );
    topicProgress.push({
      id: legacyTopicProgressId(topicId),
      topicId,
      done: true,
      doneAt: updatedAt,
      updatedAt,
    });
  }
  topicProgress.sort((left, right) => left.topicId.localeCompare(right.topicId));

  return {
    catalogBooks: [...catalogById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    userBooks,
    topicProgress,
  };
}

function assertUnique(label: string, values: Iterable<string>): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${INVALID_BACKUP_MESSAGE}: ${label} tekrar ediyor.`);
    }
    seen.add(value);
  }
}

function compositeKey(...values: string[]): string {
  return JSON.stringify(values);
}

function assertUniqueBackupKeys(data: BackupData): void {
  assertUnique('settings.key', data.settings.map((row) => row.key));
  assertUnique('subjects.id', data.subjects.map((row) => row.id));
  assertUnique('subjects.seedKey', data.subjects.map((row) => row.seedKey));
  assertUnique('topics.id', data.topics.map((row) => row.id));
  assertUnique(
    'topics.seedKey',
    data.topics
      .map((row) => row.seedKey)
      .filter((value): value is string => value !== undefined),
  );
  assertUnique('books.id', data.books.map((row) => row.id));
  assertUnique('topicBooks.id', data.topicBooks.map((row) => row.id));
  assertUnique(
    'topicBooks.(topicId, bookId)',
    data.topicBooks.map((row) => compositeKey(row.topicId, row.bookId)),
  );
  assertUnique('exams.id', data.exams.map((row) => row.id));
  assertUnique('examResults.id', data.examResults.map((row) => row.id));
  assertUnique(
    'examResults.(examId, subjectId)',
    data.examResults.map((row) => compositeKey(row.examId, row.subjectId)),
  );
  assertUnique('photos.id', data.photos.map((row) => row.id));
  assertUnique('notes.topicId', data.notes.map((row) => row.topicId));
  assertUnique('attachments.id', data.attachments.map((row) => row.id));
  assertUnique('practiceSessions.id', data.practiceSessions.map((row) => row.id));
  assertUnique('scheduleEntries.id', data.scheduleEntries.map((row) => row.id));
  assertUnique('scheduleFiles.id', data.scheduleFiles.map((row) => row.id));
  assertUnique('scheduleTables.id', data.scheduleTables.map((row) => row.id));
  assertUnique('catalogBooks.id', data.catalogBooks.map((row) => row.id));
  assertUnique('userBooks.id', data.userBooks.map((row) => row.id));
  // `bookId` backs a unique index, so duplicates must fail before any clear.
  assertUnique('userBooks.bookId', data.userBooks.map((row) => row.bookId));
  assertUnique('activityLogs.id', data.activityLogs.map((row) => row.id));
  assertUnique('scheduleWeeks.id', data.scheduleWeeks.map((row) => row.id));
  assertUnique('scheduleWeeks.weekStart', data.scheduleWeeks.map((row) => row.weekStart));
  assertUnique('scheduleRows.id', data.scheduleRows.map((row) => row.id));
  assertUnique('scheduleTasks.id', data.scheduleTasks.map((row) => row.id));
  assertUnique('topicProgress.id', data.topicProgress.map((row) => row.id));
  assertUnique('topicProgress.topicId', data.topicProgress.map((row) => row.topicId));
}

/**
 * Branch exams keep at most one result row: the branch itself (its
 * `subjectId` is the branch key) with counts that fit the catalog question
 * count. The exam schema only proves the branch metadata; without this
 * cross-table check an imported archive could create an impossible total that
 * the branch tab and detail page would happily sum.
 */
function assertBranchExamResults(data: BackupData): void {
  const resultsByExam = new Map<string, BackupData['examResults']>();
  for (const row of data.examResults) {
    const rows = resultsByExam.get(row.examId);
    if (rows) {
      rows.push(row);
    } else {
      resultsByExam.set(row.examId, [row]);
    }
  }

  for (const exam of data.exams) {
    if (exam.kind !== 'branch') {
      continue;
    }
    const config = exam.branch ? getBranchExam(exam.branch) : undefined;
    const rows = resultsByExam.get(exam.id) ?? [];
    if (rows.length > 1) {
      throw invalidBackup();
    }
    const row = rows[0];
    if (!row) {
      continue;
    }
    if (!config || row.subjectId !== exam.branch) {
      throw invalidBackup();
    }
    if (row.correct + row.wrong + row.blank > config.questionCount) {
      throw invalidBackup();
    }
  }
}

async function readJson(zip: JSZip, path: string): Promise<unknown> {
  const entry = zip.file(path);
  if (!entry) {
    throw invalidBackup();
  }
  try {
    return JSON.parse(await entry.async('string')) as unknown;
  } catch {
    throw invalidBackup();
  }
}

function assertArchiveBlobs(zip: JSZip, data: BackupData): void {
  const missing: string[] = [];
  for (const photo of data.photos) {
    if (!zip.file(photo.blobPath)) {
      missing.push(photo.blobPath);
    }
    if (!zip.file(photo.thumbBlobPath)) {
      missing.push(photo.thumbBlobPath);
    }
  }
  for (const attachment of data.attachments) {
    if (!zip.file(attachment.blobPath)) {
      missing.push(attachment.blobPath);
    }
  }
  for (const file of data.scheduleFiles) {
    if (!zip.file(file.filePath)) {
      missing.push(file.filePath);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${INVALID_BACKUP_MESSAGE}: yedekte eksik dosya var (${missing[0]}).`,
    );
  }
}

async function readArchive(file: File): Promise<Archive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readBlobAsArrayBuffer(file));
  } catch {
    throw invalidBackup();
  }

  const manifestResult = manifestSchema.safeParse(await readJson(zip, 'manifest.json'));
  if (!manifestResult.success) {
    throw invalidBackup();
  }

  const manifest = manifestResult.data as BackupManifest;
  if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error(NEWER_BACKUP_MESSAGE);
  }
  if (manifest.schemaVersion < MIN_BACKUP_SCHEMA_VERSION) {
    throw invalidBackup();
  }

  const dataResult = backupDataSchema.safeParse(await readJson(zip, 'veri.json'));
  if (!dataResult.success) {
    throw invalidBackup();
  }

  const data = migrateBackupData(dataResult.data, manifest.schemaVersion);
  assertUniqueBackupKeys(data);
  assertBranchExamResults(data);
  assertArchiveBlobs(zip, data);

  return {
    zip,
    manifest,
    data,
  };
}

async function readBinary(zip: JSZip, path: string): Promise<ArrayBuffer> {
  const entry = zip.file(path);
  if (!entry) {
    throw invalidBackup();
  }
  try {
    return await entry.async('arraybuffer');
  } catch {
    throw invalidBackup();
  }
}

async function restorePhotos(
  zip: JSZip,
  photos: SerializedPhoto[],
): Promise<{ photos: Photo[]; photoSearch: PhotoSearch[] }> {
  const restored: Photo[] = [];
  for (const photo of photos) {
    const [blobBytes, thumbBytes] = await Promise.all([
      readBinary(zip, photo.blobPath),
      readBinary(zip, photo.thumbBlobPath),
    ]);
    restored.push({
      id: photo.id,
      examId: photo.examId,
      examType: photo.examType,
      subjectId: photo.subjectId,
      topicId: photo.topicId,
      note: photo.note,
      correctOption: photo.correctOption,
      blob: new Blob([blobBytes], { type: 'image/jpeg' }),
      thumbBlob: new Blob([thumbBytes], { type: 'image/jpeg' }),
      width: photo.width,
      height: photo.height,
      mastered: photo.mastered,
      practiceCount: photo.practiceCount,
      lastPracticedAt: photo.lastPracticedAt,
      createdAt: photo.createdAt,
    });
  }

  // This table is a projection of `photos`, never an independent source of
  // truth. Rebuilding it also covers v1 backups that did not contain it.
  return { photos: restored, photoSearch: restored.map(toPhotoSearch) };
}

async function restoreAttachments(
  zip: JSZip,
  attachments: SerializedAttachment[],
): Promise<Attachment[]> {
  const restored: Attachment[] = [];
  for (const attachment of attachments) {
    const bytes = await readBinary(zip, attachment.blobPath);
    const blob = new Blob([bytes], {
      type: attachment.mime || 'application/octet-stream',
    });
    restored.push({
      id: attachment.id,
      topicId: attachment.topicId,
      name: attachment.name,
      mime: attachment.mime || blob.type,
      size: blob.size,
      blob,
      createdAt: attachment.createdAt,
    });
  }
  return restored;
}

async function restoreScheduleFiles(
  zip: JSZip,
  files: z.infer<typeof scheduleFileSchema>[],
): Promise<ScheduleFile[]> {
  const restored: ScheduleFile[] = [];
  for (const file of files) {
    const bytes = await readBinary(zip, file.filePath);
    const blob = new Blob([bytes], { type: file.mime || 'application/octet-stream' });
    restored.push({
      id: file.id,
      name: file.name,
      mime: file.mime || blob.type,
      size: blob.size,
      blob,
      createdAt: file.createdAt,
    });
  }
  return restored;
}

/**
 * Validates a backup without replacing anything. The settings panel uses this
 * for the summary shown before the destructive confirmation.
 */
export async function readBackupSummary(file: File): Promise<BackupSummary> {
  const { manifest, data } = await readArchive(file);
  return { exportedAt: manifest.exportedAt, counts: countTables(data) };
}

/**
 * Replaces every table in one Dexie transaction. All validation, blob loading,
 * sanitizing and projection rebuilding happens before the transaction starts;
 * a failure at any point leaves the current database untouched.
 */
export async function importBackup(file: File): Promise<ImportBackupResult> {
  const { zip, manifest, data } = await readArchive(file);

  const [photos, attachments, scheduleFiles] = await Promise.all([
    restorePhotos(zip, data.photos),
    restoreAttachments(zip, data.attachments),
    restoreScheduleFiles(zip, data.scheduleFiles),
  ]);
  const notes = data.notes.map((note) => {
    const contentHtml = sanitizeHtml(note.contentHtml);
    return {
      ...note,
      contentHtml,
      plainText: htmlToPlainText(contentHtml) || note.plainText.trim(),
    };
  });

  // `net` is derived data: never trust a modified/stale backup value.
  // Exam dates are used for charts and sorting, so they must be real days.
  const normalizedExams: Exam[] = data.exams.map((exam) => {
    if (!isValidDateString(exam.date)) {
      throw new Error(`${INVALID_BACKUP_MESSAGE}: deneme tarihi geçersiz.`);
    }
    // The schema already proved a branch key is in the catalog; re-resolve it
    // so the stored row carries the narrow `BranchExamKey` union.
    const branch = exam.branch ? getBranchExam(exam.branch) : undefined;
    return {
      ...exam,
      branch: branch?.key,
    };
  });
  const normalizedExamResults = data.examResults.map((row) => ({
    ...row,
    net: calculateNet(row.correct, row.wrong),
  }));

  const restored: RestoredData = {
    settings: data.settings as SettingsRow[],
    subjects: data.subjects,
    topics: data.topics,
    books: data.books,
    topicBooks: data.topicBooks,
    exams: normalizedExams,
    examResults: normalizedExamResults,
    photos: photos.photos,
    photoSearch: photos.photoSearch,
    notes,
    attachments,
    practiceSessions: data.practiceSessions as PracticeSession[],
    scheduleEntries: data.scheduleEntries,
    scheduleFiles,
    scheduleTables: data.scheduleTables as ScheduleTable[],
    catalogBooks: data.catalogBooks as CatalogBook[],
    userBooks: data.userBooks as UserBook[],
    activityLogs: data.activityLogs as ActivityLog[],
    scheduleWeeks: data.scheduleWeeks as ScheduleWeek[],
    scheduleRows: data.scheduleRows as ScheduleRow[],
    scheduleTasks: data.scheduleTasks as ScheduleTask[],
    topicProgress: data.topicProgress as TopicProgress[],
  };

  // A v1–v5 archive predates the page-based model. Convert its legacy books
  // before the destructive transaction; the catalog match uses the in-memory
  // seed because the transaction clears every table. v6 archives keep their
  // own new-model rows untouched.
  if (manifest.schemaVersion < 6) {
    const derived = buildNewModelFromLegacy(restored);
    restored.catalogBooks = derived.catalogBooks;
    restored.userBooks = derived.userBooks;
    restored.topicProgress = derived.topicProgress;
  }

  const counts = countTables(data);

  try {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
      await db.settings.bulkPut(restored.settings);
      await db.subjects.bulkPut(restored.subjects);
      await db.topics.bulkPut(restored.topics);
      await db.books.bulkPut(restored.books);
      await db.topicBooks.bulkPut(restored.topicBooks);
      await db.exams.bulkPut(restored.exams);
      await db.examResults.bulkPut(restored.examResults);
      await db.photos.bulkPut(restored.photos);
      await db.photoSearch.bulkPut(restored.photoSearch);
      await db.notes.bulkPut(restored.notes);
      await db.attachments.bulkPut(restored.attachments);
      await db.practiceSessions.bulkPut(restored.practiceSessions);
      await db.scheduleEntries.bulkPut(restored.scheduleEntries);
      await db.scheduleFiles.bulkPut(restored.scheduleFiles);
      await db.scheduleTables.bulkPut(restored.scheduleTables);
      await db.catalogBooks.bulkPut(restored.catalogBooks);
      await db.userBooks.bulkPut(restored.userBooks);
      await db.activityLogs.bulkPut(restored.activityLogs);
      await db.scheduleWeeks.bulkPut(restored.scheduleWeeks);
      await db.scheduleRows.bulkPut(restored.scheduleRows);
      await db.scheduleTasks.bulkPut(restored.scheduleTasks);
      await db.topicProgress.bulkPut(restored.topicProgress);
      // patchSettings intentionally skips undefined values. Delete the row so
      // a restored device never shows a backup date it did not create.
      await db.settings.delete('lastBackupAt');
    });
  } catch (error: unknown) {
    if (isStorageQuotaError(error)) {
      throw new Error(STORAGE_QUOTA_MESSAGE);
    }
    throw new Error('Yedek geri yüklenemedi. Mevcut veriler değiştirilmedi.', {
      cause: error,
    });
  }

  // Catalog rows have no version marker, so seed missing starter books on
  // every import. The seed never overwrites existing rows, including user
  // edits and soft-deleted tombstones.
  await seedCatalog();

  // A backup taken before a curriculum update would otherwise leave the app
  // with missing seed topics until the next SettingsProvider mount. The seed
  // is idempotent and only adds missing seed entries, never overwriting user
  // renames. Restored data is already committed at this point.
  const restoredSeed = restored.settings.find((row) => row.key === 'seedVersion');
  const restoredSeedVersion =
    typeof restoredSeed?.value === 'number' ? restoredSeed.value : 0;
  if (restoredSeedVersion < CURRICULUM.version) {
    await seedCurriculum(CURRICULUM);
  }

  return { exportedAt: manifest.exportedAt, counts };
}

/** Clears every table atomically, including settings and lastBackupAt. */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

async function addBlob(
  zip: JSZip,
  path: string,
  blob: Blob,
  compression: 'STORE' | 'DEFLATE' = 'STORE',
): Promise<void> {
  zip.file(path, await readBlobAsArrayBuffer(blob), { binary: true, compression });
}

/**
 * Creates a portable zip with every table and every photo/attachment blob.
 * `lastBackupAt` is written only after the zip is fully generated, so a failed
 * export never claims to be a successful backup.
 *
 * The whole archive is still built in memory (streaming is out of scope for
 * v1). `onProgress` lets the settings panel show reading/blob/zip progress and
 * warn about large archives.
 */
export async function exportBackup(
  onProgress?: BackupProgressHandler,
): Promise<Blob> {
  const report = (progress: BackupProgress) => {
    onProgress?.(progress);
  };
  report({ phase: 'reading', percent: 0 });

  // One read transaction keeps the exported tables mutually consistent.
  const snapshot = await db.transaction('r', db.tables, async () => ({
    settings: await db.settings.toArray(),
    subjects: await db.subjects.toArray(),
    topics: await db.topics.toArray(),
    books: await db.books.toArray(),
    topicBooks: await db.topicBooks.toArray(),
    exams: await db.exams.toArray(),
    examResults: await db.examResults.toArray(),
    photos: await db.photos.toArray(),
    photoSearch: await db.photoSearch.toArray(),
    notes: await db.notes.toArray(),
    attachments: await db.attachments.toArray(),
    practiceSessions: await db.practiceSessions.toArray(),
    scheduleEntries: await db.scheduleEntries.toArray(),
    scheduleFiles: await db.scheduleFiles.toArray(),
    scheduleTables: await db.scheduleTables.toArray(),
    catalogBooks: await db.catalogBooks.toArray(),
    userBooks: await db.userBooks.toArray(),
    activityLogs: await db.activityLogs.toArray(),
    scheduleWeeks: await db.scheduleWeeks.toArray(),
    scheduleRows: await db.scheduleRows.toArray(),
    scheduleTasks: await db.scheduleTasks.toArray(),
    topicProgress: await db.topicProgress.toArray(),
  }));

  const {
    settings,
    subjects,
    topics,
    books,
    topicBooks,
    exams,
    examResults,
    photos,
    photoSearch,
    notes,
    attachments,
    practiceSessions,
    scheduleEntries,
    scheduleFiles,
    scheduleTables,
    catalogBooks,
    userBooks,
    activityLogs,
    scheduleWeeks,
    scheduleRows,
    scheduleTasks,
    topicProgress,
  } = snapshot;

  const serializedPhotos = photos.map(({ blob, thumbBlob, ...photo }) => ({
    ...photo,
    ...photoBackupPaths(photo.id),
  }));
  const serializedAttachments = attachments.map(({ blob, ...attachment }) => ({
    ...attachment,
    blobPath: attachmentBackupPath(attachment),
  }));
  const serializedScheduleFiles = scheduleFiles.map(({ blob, ...file }) => ({
    ...file,
    filePath: scheduleFileBackupPath(file),
  }));
  const data = {
    settings,
    subjects,
    topics,
    books,
    topicBooks,
    exams,
    examResults,
    photos: serializedPhotos,
    photoSearch,
    notes,
    attachments: serializedAttachments,
    practiceSessions,
    scheduleEntries,
    scheduleFiles: serializedScheduleFiles,
    scheduleTables,
    catalogBooks,
    userBooks,
    activityLogs,
    scheduleWeeks,
    scheduleRows,
    scheduleTasks,
    topicProgress,
  };
  const counts: Record<string, number> = {
    settings: settings.length,
    subjects: subjects.length,
    topics: topics.length,
    books: books.length,
    topicBooks: topicBooks.length,
    exams: exams.length,
    examResults: examResults.length,
    photos: photos.length,
    photoSearch: photoSearch.length,
    notes: notes.length,
    attachments: attachments.length,
    practiceSessions: practiceSessions.length,
    scheduleEntries: scheduleEntries.length,
    scheduleFiles: scheduleFiles.length,
    scheduleTables: scheduleTables.length,
    catalogBooks: catalogBooks.length,
    userBooks: userBooks.length,
    activityLogs: activityLogs.length,
    scheduleWeeks: scheduleWeeks.length,
    scheduleRows: scheduleRows.length,
    scheduleTasks: scheduleTasks.length,
    topicProgress: topicProgress.length,
  };
  const exportedAt = new Date().toISOString();
  const manifest: BackupManifest = {
    app: 'kocluk',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    counts,
  };

  const zip = new JSZip();
  const totalFiles =
    photos.length * 2 + attachments.length + scheduleFiles.length + 2;
  let written = 0;
  const advance = () => {
    written += 1;
    report({
      phase: 'blobs',
      percent: 5 + Math.round((written / totalFiles) * 65),
      current: written,
      total: totalFiles,
    });
  };

  zip.file('manifest.json', JSON.stringify(manifest), { compression: 'DEFLATE' });
  advance();
  zip.file('veri.json', JSON.stringify(data), { compression: 'DEFLATE' });
  advance();

  report({ phase: 'reading', percent: 5 });

  for (const photo of photos) {
    const paths = photoBackupPaths(photo.id);
    await addBlob(zip, paths.blobPath, photo.blob);
    advance();
    await addBlob(zip, paths.thumbBlobPath, photo.thumbBlob);
    advance();
  }
  for (const attachment of attachments) {
    await addBlob(zip, attachmentBackupPath(attachment), attachment.blob);
    advance();
  }
  for (const file of scheduleFiles) {
    await addBlob(zip, scheduleFileBackupPath(file), file.blob);
    advance();
  }

  report({
    phase: 'zip',
    percent: 70,
    current: written,
    total: totalFiles,
  });

  const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
    report({
      phase: 'zip',
      percent: 70 + Math.round(metadata.percent * 0.3),
      current: written,
      total: totalFiles,
    });
  });

  await db.settings.put({ key: 'lastBackupAt', value: exportedAt });
  report({ phase: 'zip', percent: 100, current: totalFiles, total: totalFiles });
  return blob;
}
