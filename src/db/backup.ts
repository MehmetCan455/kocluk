import JSZip from 'jszip';
import { z } from 'zod';
import { db, type SettingsRow } from '@/db/db';
import { toPhotoSearch } from '@/db/photoSearch';
import type {
  Attachment,
  Note,
  Photo,
  PhotoSearch,
  PracticeSession,
} from '@/domain/types';
import { htmlToPlainText, sanitizeHtml } from '@/lib/sanitize';
import { isStorageQuotaError, STORAGE_QUOTA_MESSAGE } from '@/lib/storageError';
import { readBlobAsArrayBuffer } from '@/lib/zip';

/**
 * Backup format version. Version 2 is the current format; version 1 backups
 * predate the blob-free `photoSearch` projection and are migrated on import.
 */
export const BACKUP_SCHEMA_VERSION = 2;
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

const settingsSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
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
  examType: examTypeSchema,
  subjectId: idSchema,
  topicId: idSchema.optional(),
  note: z.string(),
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
});

const backupDataSchema = z.object({
  settings: z.array(settingsSchema),
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
}

function invalidBackup(): Error {
  return new Error(INVALID_BACKUP_MESSAGE);
}

function extensionForAttachment(attachment: Pick<Attachment, 'name' | 'mime'>): string {
  const name = attachment.name.trim();
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
  return byMime[attachment.mime] ?? 'bin';
}

function attachmentBackupPath(attachment: Pick<Attachment, 'id' | 'name' | 'mime'>): string {
  return `ekler/${attachment.id}.${extensionForAttachment(attachment)}`;
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
  };
}

function migrateBackupData(data: BackupData, fromVersion: number): BackupData {
  if (fromVersion < 2) {
    // Version 1 stores the same rows but no photoSearch projection. The
    // projection is always rebuilt from restored photos below, so the only
    // migration needed is accepting the missing table.
    return { ...data, photoSearch: data.photoSearch ?? [] };
  }
  return data;
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

  return {
    zip,
    manifest,
    data: migrateBackupData(dataResult.data, manifest.schemaVersion),
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

  const [photos, attachments] = await Promise.all([
    restorePhotos(zip, data.photos),
    restoreAttachments(zip, data.attachments),
  ]);
  const notes = data.notes.map((note) => {
    const contentHtml = sanitizeHtml(note.contentHtml);
    return {
      ...note,
      contentHtml,
      plainText: htmlToPlainText(contentHtml) || note.plainText.trim(),
    };
  });

  const restored: RestoredData = {
    settings: data.settings as SettingsRow[],
    subjects: data.subjects,
    topics: data.topics,
    books: data.books,
    topicBooks: data.topicBooks,
    exams: data.exams,
    examResults: data.examResults,
    photos: photos.photos,
    photoSearch: photos.photoSearch,
    notes,
    attachments,
    practiceSessions: data.practiceSessions as PracticeSession[],
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
 */
export async function exportBackup(): Promise<Blob> {
  const [
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
  ] = await Promise.all([
    db.settings.toArray(),
    db.subjects.toArray(),
    db.topics.toArray(),
    db.books.toArray(),
    db.topicBooks.toArray(),
    db.exams.toArray(),
    db.examResults.toArray(),
    db.photos.toArray(),
    db.photoSearch.toArray(),
    db.notes.toArray(),
    db.attachments.toArray(),
    db.practiceSessions.toArray(),
  ]);

  const serializedPhotos = photos.map(({ blob, thumbBlob, ...photo }) => ({
    ...photo,
    ...photoBackupPaths(photo.id),
  }));
  const serializedAttachments = attachments.map(({ blob, ...attachment }) => ({
    ...attachment,
    blobPath: attachmentBackupPath(attachment),
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
  };
  const exportedAt = new Date().toISOString();
  const manifest: BackupManifest = {
    app: 'kocluk',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    counts,
  };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest), { compression: 'DEFLATE' });
  zip.file('veri.json', JSON.stringify(data), { compression: 'DEFLATE' });
  for (const photo of photos) {
    const paths = photoBackupPaths(photo.id);
    await addBlob(zip, paths.blobPath, photo.blob);
    await addBlob(zip, paths.thumbBlobPath, photo.thumbBlob);
  }
  for (const attachment of attachments) {
    await addBlob(zip, attachmentBackupPath(attachment), attachment.blob);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  await db.settings.put({ key: 'lastBackupAt', value: exportedAt });
  return blob;
}
