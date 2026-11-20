import JSZip from 'jszip';
import { z } from 'zod';
import { CURRICULUM } from '@/data/curriculum';
import { db, type SettingsRow } from '@/db/db';
import { toPhotoSearch } from '@/db/photoSearch';
import { seedCurriculum } from '@/db/seed';
import type {
  AppSettings,
  Attachment,
  Note,
  Photo,
  PhotoSearch,
  PracticeSession,
  ScheduleEntry,
  ScheduleFile,
  ScheduleTable,
} from '@/domain/types';
import { calculateNet } from '@/domain/calculations';
import {
  SCHEDULE_TABLE_CELL_MAX_LENGTH,
  SCHEDULE_TABLE_ID,
  SCHEDULE_TABLE_MAX_ROWS,
  SCHEDULE_TABLE_NOTE_MAX_LENGTH,
  SCHEDULE_TABLE_SUBJECT_MAX_LENGTH,
  SCHEDULE_TABLE_TOTAL_MAX_LENGTH,
} from '@/domain/scheduleTable';
import { isValidDateString } from '@/lib/date';
import { htmlToPlainText, sanitizeHtml } from '@/lib/sanitize';
import { compareHHmm, isHHmm } from '@/lib/time';
import { isStorageQuotaError, STORAGE_QUOTA_MESSAGE } from '@/lib/storageError';
import { readBlobAsArrayBuffer } from '@/lib/zip';

/**
 * Backup format version. Version 4 adds the manual schedule table; version 3
 * added the weekly program tables, version 2 the blob-free `photoSearch`
 * projection, and version 1 predates it. Missing tables in older archives are
 * read as empty lists.
 */
export const BACKUP_SCHEMA_VERSION = 4;
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

const examSchema = z.object({
  id: idSchema,
  type: examTypeSchema,
  name: z.string(),
  date: z.string(),
  alan: aytAlanSchema.optional(),
  note: z.string(),
  createdAt: z.string(),
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
  exams: z.infer<typeof examSchema>[];
  examResults: z.infer<typeof examResultSchema>[];
  photos: Photo[];
  photoSearch: PhotoSearch[];
  notes: Note[];
  attachments: Attachment[];
  practiceSessions: PracticeSession[];
  scheduleEntries: ScheduleEntry[];
  scheduleFiles: ScheduleFile[];
  scheduleTables: ScheduleTable[];
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
  };
}

function migrateBackupData(data: BackupData, fromVersion: number): BackupData {
  if (fromVersion < 2) {
    // Version 1 stores the same rows but no photoSearch projection. The
    // projection is always rebuilt from restored photos below, so the only
    // migration needed is accepting the missing table.
    return { ...data, photoSearch: data.photoSearch ?? [] };
  }
  // The schedule tables added in v3/v4 are optional in the schema and default
  // to empty, so an older archive needs no row-level migration.
  return data;
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
  const normalizedExams = data.exams.map((exam) => {
    if (!isValidDateString(exam.date)) {
      throw new Error(`${INVALID_BACKUP_MESSAGE}: deneme tarihi geçersiz.`);
    }
    return exam;
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
  };
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
