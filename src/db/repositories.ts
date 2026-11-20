import { type Collection } from 'dexie';
import type {
  AppSettings,
  Attachment,
  AytAlan,
  Book,
  CorrectOption,
  Exam,
  ExamResult,
  ExamType,
  Note,
  Photo,
  PhotoFilters,
  PhotoSearch,
  PracticeFilters,
  PracticeOutcome,
  PracticeSession,
  ScheduleEntry,
  ScheduleFile,
  ScheduleTable,
  ScheduleTableDayCells,
  ScheduleTableRow,
  ScheduleTableTotals,
  Subject,
  Topic,
  TopicBook,
} from '@/domain/types';
import { calculateNet } from '@/domain/calculations';
import {
  SCHEDULE_TABLE_CELL_MAX_LENGTH,
  SCHEDULE_TABLE_ID,
  SCHEDULE_TABLE_MAX_ROWS,
  SCHEDULE_TABLE_NOTE_MAX_LENGTH,
  SCHEDULE_TABLE_SUBJECT_MAX_LENGTH,
  SCHEDULE_TABLE_TOTAL_LABEL,
  SCHEDULE_TABLE_TOTAL_MAX_LENGTH,
  emptyScheduleTableDays,
} from '@/domain/scheduleTable';
import { isValidDateString } from '@/lib/date';
import { newId } from '@/lib/id';
import { compressImage } from '@/lib/image';
import { compareHHmm, isHHmm } from '@/lib/time';
import { matchesTokens, tokenizeTr } from '@/lib/normalize';
import { htmlToPlainText, sanitizeHtml } from '@/lib/sanitize';
import { STORAGE_QUOTA_MESSAGE, isStorageQuotaError } from '@/lib/storageError';
import { db } from './db';
import { toPhotoSearch } from './photoSearch';

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
  geometryMode: 'separate',
  scheduleMode: 'manual',
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
  const books = await db.books.toArray();
  return books.sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.name.localeCompare(right.name, 'tr-TR') ||
      left.id.localeCompare(right.id),
  );
}

export async function getBook(id: string): Promise<Book | undefined> {
  return db.books.get(id);
}

export interface UpdateBookInput {
  name: string;
  publisher?: string;
}

export async function updateBook(id: string, input: UpdateBookInput): Promise<void> {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Kitap adı boş olamaz');
  }

  const updated = await db.books.update(id, {
    name,
    publisher: input.publisher?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  });
  if (updated === 0) {
    throw new Error('Kitap bulunamadı');
  }
}

const EXAM_ORDER: Record<ExamType, number> = { TYT: 0, AYT: 1 };

export type BookTopicBookRow = TopicBook & { topic: Topic; subject: Subject };

export function compareBookTopicBookRows(
  left: BookTopicBookRow,
  right: BookTopicBookRow,
): number {
  return (
    EXAM_ORDER[left.subject.exam] - EXAM_ORDER[right.subject.exam] ||
    left.subject.order - right.subject.order ||
    left.subject.name.localeCompare(right.subject.name, 'tr-TR') ||
    left.topic.order - right.topic.order ||
    left.topic.name.localeCompare(right.topic.name, 'tr-TR') ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Joins topic test records with their topic and subject rows. Orphaned records
 * (missing topic or subject) are skipped. The deterministic order is shared by
 * the book detail page and the batched books overview.
 */
export function buildBookTopicBookRows(
  records: TopicBook[],
  topics: readonly Topic[],
  subjects: readonly Subject[],
): BookTopicBookRow[] {
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));

  const rows: BookTopicBookRow[] = [];
  for (const record of records) {
    const topic = topicById.get(record.topicId);
    const subject = topic ? subjectById.get(topic.subjectId) : undefined;
    if (topic && subject) {
      rows.push({ ...record, topic, subject });
    }
  }

  return rows.sort(compareBookTopicBookRows);
}

/** Read-only full-table reads used by the dashboard and batched overviews. */
export async function listAllTopics(): Promise<Topic[]> {
  return db.topics.toArray();
}

export async function listAllTopicBooks(): Promise<TopicBook[]> {
  return db.topicBooks.toArray();
}

/**
 * Joins a book's topic records with their topic and subject rows. The result is
 * ordered by exam, subject and topic so the book detail page is deterministic
 * even when records were added in a different order.
 */
export async function listBookTopicBooks(bookId: string): Promise<BookTopicBookRow[]> {
  const records = await db.topicBooks.where('bookId').equals(bookId).toArray();
  if (records.length === 0) {
    return [];
  }

  const topicIds = [...new Set(records.map((record) => record.topicId))];
  const topics = (await db.topics.bulkGet(topicIds)).filter(
    (topic): topic is Topic => topic !== undefined,
  );
  const subjectIds = [...new Set(topics.map((topic) => topic.subjectId))];
  const subjects = (await db.subjects.bulkGet(subjectIds)).filter(
    (subject): subject is Subject => subject !== undefined,
  );

  return buildBookTopicBookRows(records, topics, subjects);
}

/**
 * Deletes only the book and its topic test records. Topics, notes, photos and
 * exams are deliberately outside the transaction and survive.
 */
export async function deleteBookCascade(bookId: string): Promise<void> {
  await db.transaction('rw', db.books, db.topicBooks, async () => {
    await db.topicBooks.where('bookId').equals(bookId).delete();
    await db.books.delete(bookId);
  });
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

    if (existing && (existing.topicId !== input.topicId || existing.bookId !== input.bookId)) {
      throw new Error('Test kaydı konu veya kitapla eşleşmiyor');
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
  await db.transaction(
    'rw',
    [db.topics, db.topicBooks, db.notes, db.attachments, db.photos, db.photoSearch],
    async () => {
      const topic = await db.topics.get(topicId);
      if (!topic?.isCustom) {
        return;
      }

      await db.topicBooks.where('topicId').equals(topicId).delete();
      await db.notes.delete(topicId);
      await db.attachments.where('topicId').equals(topicId).delete();
      await db.photos.where('topicId').equals(topicId).modify({ topicId: undefined });
      await db.photoSearch.where('topicId').equals(topicId).modify({ topicId: undefined });
      await db.topics.delete(topicId);
    },
  );
}

export async function getNote(topicId: string): Promise<Note | undefined> {
  return db.notes.get(topicId);
}

/**
 * Stores one note per topic. The HTML is sanitized before it reaches IndexedDB
 * and `plainText` is derived from that sanitized markup so global search always
 * matches what the editor shows. The caller-supplied text is only a fallback
 * for markup without text nodes.
 */
export async function saveNote(
  topicId: string,
  contentHtml: string,
  plainText: string,
): Promise<void> {
  const safeHtml = sanitizeHtml(contentHtml);
  const derived = htmlToPlainText(safeHtml).trim();

  await db.notes.put({
    topicId,
    contentHtml: safeHtml,
    plainText: derived || plainText.trim(),
    updatedAt: new Date().toISOString(),
  });
}

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_SIZE_ERROR = 'Dosya boyutu 20 MB sınırını aşıyor';
export const ATTACHMENT_TYPE_ERROR = 'Yalnızca görsel veya PDF dosyası ekleyebilirsin';

/** Newest first, with the id keeping same-millisecond uploads deterministic. */
export async function listAttachments(topicId: string): Promise<Attachment[]> {
  const attachments = await db.attachments.where('topicId').equals(topicId).toArray();
  return attachments.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
  );
}

/**
 * Stores an image or PDF. Images are compressed to a 2000 px JPEG before they
 * reach IndexedDB; PDFs are stored as-is. The 20 MB guard stays here as the
 * final boundary for both kinds.
 */
export async function addAttachment(topicId: string, file: File): Promise<Attachment> {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new Error(ATTACHMENT_SIZE_ERROR);
  }
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
    throw new Error(ATTACHMENT_TYPE_ERROR);
  }

  let blob: Blob = file;
  let mime = file.type;
  if (file.type.startsWith('image/')) {
    const compressed = await compressImage(file, 2000, 0.85);
    blob = compressed.blob;
    mime = compressed.blob.type || 'image/jpeg';
  }

  const attachment: Attachment = {
    id: newId(),
    topicId,
    name: file.name.trim() || 'dosya',
    mime,
    size: blob.size,
    blob,
    createdAt: new Date().toISOString(),
  };
  await db.attachments.add(attachment);
  return attachment;
}

export async function deleteAttachment(id: string): Promise<void> {
  await db.attachments.delete(id);
}

export const SCHEDULE_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const SCHEDULE_FILE_SIZE_ERROR = 'Dosya boyutu 20 MB sınırını aşıyor';
export const SCHEDULE_FILE_TYPE_ERROR = 'Yalnızca görsel veya PDF dosyası ekleyebilirsin';

/** Monday-first weekly order, then start time, then a stable id tiebreaker. */
export async function listScheduleEntries(): Promise<ScheduleEntry[]> {
  const entries = await db.scheduleEntries.toArray();
  return entries.sort(
    (left, right) =>
      left.day - right.day ||
      compareHHmm(left.startTime, right.startTime) ||
      compareHHmm(left.endTime, right.endTime) ||
      left.title.localeCompare(right.title, 'tr-TR') ||
      left.id.localeCompare(right.id),
  );
}

export interface SaveScheduleEntryInput {
  id?: string;
  day: number;
  startTime: string;
  endTime: string;
  title: string;
  subjectId?: string;
  note?: string;
}

function assertValidScheduleEntry(input: SaveScheduleEntryInput): string {
  const title = input.title.trim();
  if (!title) {
    throw new Error('Program başlığı boş olamaz');
  }
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 7) {
    throw new Error('Gün 1 ile 7 arasında olmalı');
  }
  if (!isHHmm(input.startTime)) {
    throw new Error('Başlangıç saati SS:DD biçiminde olmalı');
  }
  if (!isHHmm(input.endTime)) {
    throw new Error('Bitiş saati SS:DD biçiminde olmalı');
  }
  if (compareHHmm(input.endTime, input.startTime) <= 0) {
    throw new Error('Bitiş saati başlangıçtan sonra olmalı');
  }
  return title;
}

/**
 * Creates or updates a manual schedule row. An `id` that no longer exists is
 * an error rather than a silent create, matching the exam repository.
 */
export async function saveScheduleEntry(input: SaveScheduleEntryInput): Promise<ScheduleEntry> {
  const title = assertValidScheduleEntry(input);
  const requestedSubjectId = input.subjectId?.trim() || undefined;
  const note = input.note?.trim() || undefined;

  return db.transaction('rw', db.scheduleEntries, db.subjects, async () => {
    const existing = input.id ? await db.scheduleEntries.get(input.id) : undefined;
    if (input.id && !existing) {
      throw new Error('Program kaydı bulunamadı');
    }

    // A subject deleted from the curriculum must not leave a dangling id (and
    // an invisible chip) on the schedule row; normalize it to "no subject".
    let subjectId: string | undefined;
    if (requestedSubjectId && (await db.subjects.get(requestedSubjectId))) {
      subjectId = requestedSubjectId;
    }

    const now = new Date().toISOString();
    const entry: ScheduleEntry = {
      id: existing?.id ?? newId(),
      day: input.day,
      startTime: input.startTime,
      endTime: input.endTime,
      title,
      subjectId,
      note,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.scheduleEntries.put(entry);
    return entry;
  });
}

export async function deleteScheduleEntry(id: string): Promise<void> {
  await db.scheduleEntries.delete(id);
}

/** Newest upload first, with the id keeping same-millisecond uploads stable. */
export async function listScheduleFiles(): Promise<ScheduleFile[]> {
  const files = await db.scheduleFiles.toArray();
  return files.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
  );
}

/**
 * Stores a schedule photo or PDF. Photos reuse the note-image pipeline
 * (2000 px, 0.85 JPEG); PDFs are stored byte-for-byte. The size/type guard is
 * the final boundary for both.
 */
export async function addScheduleFile(file: File): Promise<ScheduleFile> {
  if (file.size > SCHEDULE_FILE_MAX_BYTES) {
    throw new Error(SCHEDULE_FILE_SIZE_ERROR);
  }
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
    throw new Error(SCHEDULE_FILE_TYPE_ERROR);
  }

  let blob: Blob = file;
  let mime = file.type;
  if (file.type.startsWith('image/')) {
    const compressed = await compressImage(file, 2000, 0.85);
    blob = compressed.blob;
    mime = compressed.blob.type || 'image/jpeg';
  }

  const scheduleFile: ScheduleFile = {
    id: newId(),
    name: file.name.trim() || 'dosya',
    mime,
    size: blob.size,
    blob,
    createdAt: new Date().toISOString(),
  };
  await db.scheduleFiles.add(scheduleFile);
  return scheduleFile;
}

export async function deleteScheduleFile(id: string): Promise<void> {
  await db.scheduleFiles.delete(id);
}

export interface SaveScheduleTableInput {
  rows: ScheduleTableRow[];
  totals?: ScheduleTableTotals;
  note?: string;
}

function assertScheduleText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} metin olmalı`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label} en fazla ${maxLength} karakter olabilir`);
  }
  return trimmed;
}

function parseScheduleDays(value: unknown, label: string): ScheduleTableDayCells {
  if (!Array.isArray(value) || value.length !== 7) {
    throw new Error(`${label} yedi gün hücresi içermeli`);
  }
  return value.map((cell, index) =>
    assertScheduleText(cell, `${label} ${index + 1}. gün`, SCHEDULE_TABLE_CELL_MAX_LENGTH),
  ) as ScheduleTableDayCells;
}

function parseScheduleRows(value: unknown): ScheduleTableRow[] {
  if (!Array.isArray(value)) {
    throw new Error('Çizelge satırları geçersiz');
  }
  if (value.length > SCHEDULE_TABLE_MAX_ROWS) {
    throw new Error(`Çizelge en fazla ${SCHEDULE_TABLE_MAX_ROWS} satır olabilir`);
  }

  const rowIds = new Set<string>();
  return value.map((row, index) => {
    if (typeof row !== 'object' || row === null) {
      throw new Error(`${index + 1}. çizelge satırı geçersiz`);
    }
    const candidate = row as Partial<ScheduleTableRow>;
    const id = assertScheduleText(candidate.id, 'Çizelge satırı kimliği', 200);
    if (!id) {
      throw new Error('Çizelge satırı kimliği boş olamaz');
    }
    if (rowIds.has(id)) {
      throw new Error('Çizelge satırı kimliği tekrar ediyor');
    }
    rowIds.add(id);

    return {
      id,
      subject: assertScheduleText(
        candidate.subject ?? '',
        'Ders adı',
        SCHEDULE_TABLE_SUBJECT_MAX_LENGTH,
      ),
      days: parseScheduleDays(candidate.days, 'Ders satırı'),
      total: assertScheduleText(
        candidate.total ?? '',
        'Ders toplamı',
        SCHEDULE_TABLE_TOTAL_MAX_LENGTH,
      ),
    };
  });
}

function parseScheduleTotals(value: unknown): ScheduleTableTotals {
  const candidate =
    typeof value === 'object' && value !== null
      ? (value as Partial<ScheduleTableTotals>)
      : {};
  const label = assertScheduleText(
    candidate.label ?? SCHEDULE_TABLE_TOTAL_LABEL,
    'Toplam satırı başlığı',
    SCHEDULE_TABLE_TOTAL_MAX_LENGTH,
  );

  return {
    label: label || SCHEDULE_TABLE_TOTAL_LABEL,
    days: parseScheduleDays(
      candidate.days ?? emptyScheduleTableDays(),
      'Toplam satırı',
    ),
    total: assertScheduleText(
      candidate.total ?? '',
      'Genel toplam',
      SCHEDULE_TABLE_TOTAL_MAX_LENGTH,
    ),
  };
}

export async function getScheduleTable(): Promise<ScheduleTable | undefined> {
  return db.scheduleTables.get(SCHEDULE_TABLE_ID);
}

/**
 * Upserts the single `main` table. Rows and cells are free text, but row ids
 * must be unique and every field has a length cap so a malformed import or a
 * pasted essay cannot bloat the record.
 */
export async function saveScheduleTable(
  input: SaveScheduleTableInput,
): Promise<ScheduleTable> {
  const table: ScheduleTable = {
    id: SCHEDULE_TABLE_ID,
    rows: parseScheduleRows(input.rows),
    totals: parseScheduleTotals(input.totals),
    note: assertScheduleText(
      input.note ?? '',
      'Haftanın notu',
      SCHEDULE_TABLE_NOTE_MAX_LENGTH,
    ),
    updatedAt: new Date().toISOString(),
  };
  await db.scheduleTables.put(table);
  return table;
}

export interface AddPhotoInput {
  file: File;
  examId?: string;
  examType: ExamType;
  subjectId: string;
  topicId?: string;
  note?: string;
  correctOption?: CorrectOption;
  /** Capture date; defaults to the upload time. */
  createdAt?: string;
}

/**
 * Verifies every linked exam before compression so a mismatched exam type or a
 * stale exam link fails without doing expensive image work.
 */
async function assertPhotoExams(inputs: readonly AddPhotoInput[]): Promise<void> {
  const examIds = [
    ...new Set(
      inputs
        .map((input) => input.examId)
        .filter((examId): examId is string => Boolean(examId)),
    ),
  ];
  if (examIds.length === 0) {
    return;
  }

  const exams = await db.exams.bulkGet(examIds);
  const examById = new Map(
    exams.filter((exam): exam is Exam => exam !== undefined).map((exam) => [exam.id, exam]),
  );
  for (const input of inputs) {
    if (!input.examId) {
      continue;
    }
    const exam = examById.get(input.examId);
    if (!exam) {
      throw new Error('Deneme bulunamadı');
    }
    if (exam.type !== input.examType) {
      throw new Error('Deneme türü fotoğraf türüyle uyuşmuyor');
    }
  }
}

/**
 * Compresses and stores wrong-answer photos together with their blob-free
 * search projection. Compression happens before the transaction; the
 * transaction itself only writes, so a quota failure rolls back both tables
 * and never leaves a photo without a projection (or vice versa).
 */
export async function addPhotos(inputs: AddPhotoInput[]): Promise<Photo[]> {
  if (inputs.length === 0) {
    return [];
  }
  for (const input of inputs) {
    if (!input.subjectId.trim()) {
      throw new Error('Ders seçilmedi');
    }
  }
  await assertPhotoExams(inputs);

  const createdAt = new Date().toISOString();
  const photos: Photo[] = [];
  for (const input of inputs) {
    const image = await compressImage(input.file);
    photos.push({
      id: newId(),
      examId: input.examId,
      examType: input.examType,
      subjectId: input.subjectId,
      topicId: input.topicId,
      note: input.note?.trim() ?? '',
      correctOption: input.correctOption,
      blob: image.blob,
      thumbBlob: image.thumbBlob,
      width: image.width,
      height: image.height,
      mastered: false,
      practiceCount: 0,
      createdAt: input.createdAt ?? createdAt,
    });
  }

  try {
    await db.transaction('rw', db.photos, db.photoSearch, async () => {
      await db.photos.bulkAdd(photos);
      await db.photoSearch.bulkAdd(photos.map(toPhotoSearch));
    });
  } catch (caught: unknown) {
    if (isStorageQuotaError(caught)) {
      throw new Error(STORAGE_QUOTA_MESSAGE);
    }
    throw caught;
  }

  return photos;
}

export async function getPhoto(id: string): Promise<Photo | undefined> {
  return db.photos.get(id);
}

/**
 * The blob-free photo projection, newest first. Practice screens use it for
 * ids, notes, subject/topic, exam link and mastery so a session never loads the
 * whole archive's image data.
 */
export async function listPhotoSearch(): Promise<PhotoSearch[]> {
  const rows = await db.photoSearch.toArray();
  return rows.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

/**
 * Uses one Dexie index for the most selective filter and applies the remaining
 * filters in memory. `examType` and `mastered` are not indexed on `photos`, so
 * they are always filtered in memory; note search is Turkish-case-insensitive.
 */
export async function listPhotos(filters: PhotoFilters = {}): Promise<Photo[]> {
  let collection: Collection<Photo, string>;
  if (filters.examId) {
    collection = db.photos.where('examId').equals(filters.examId);
  } else if (filters.topicId) {
    collection = db.photos.where('topicId').equals(filters.topicId);
  } else if (filters.subjectId) {
    collection = db.photos.where('subjectId').equals(filters.subjectId);
  } else if (filters.from && filters.to) {
    collection = db.photos
      .where('createdAt')
      .between(
        `${filters.from.slice(0, 10)}T00:00:00.000Z`,
        `${filters.to.slice(0, 10)}T23:59:59.999Z`,
        true,
        true,
      );
  } else if (filters.from) {
    collection = db.photos
      .where('createdAt')
      .aboveOrEqual(`${filters.from.slice(0, 10)}T00:00:00.000Z`);
  } else if (filters.to) {
    collection = db.photos
      .where('createdAt')
      .belowOrEqual(`${filters.to.slice(0, 10)}T23:59:59.999Z`);
  } else {
    collection = db.photos.toCollection();
  }

  const rows = await collection.toArray();
  const tokens = filters.query ? tokenizeTr(filters.query) : [];
  const from = filters.from?.slice(0, 10);
  const to = filters.to?.slice(0, 10);

  return rows
    .filter((photo) => {
      if (filters.examId && photo.examId !== filters.examId) {
        return false;
      }
      if (filters.topicId && photo.topicId !== filters.topicId) {
        return false;
      }
      if (filters.subjectId && photo.subjectId !== filters.subjectId) {
        return false;
      }
      if (filters.examType && photo.examType !== filters.examType) {
        return false;
      }
      if (filters.mastered !== undefined && photo.mastered !== filters.mastered) {
        return false;
      }
      const day = photo.createdAt.slice(0, 10);
      if (from && day < from) {
        return false;
      }
      if (to && day > to) {
        return false;
      }
      if (tokens.length > 0 && !matchesTokens(photo.note, tokens)) {
        return false;
      }
      return true;
    })
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
}

/**
 * Updates the photo and rewrites its search projection in the same transaction
 * so search never sees a stale note, subject or topic.
 */
export async function updatePhoto(id: string, patch: Partial<Photo>): Promise<void> {
  const changes: Partial<Photo> = { ...patch };
  delete changes.id;
  if (Object.keys(changes).length === 0) {
    return;
  }

  await db.transaction('rw', db.photos, db.photoSearch, async () => {
    const updated = await db.photos.update(id, changes);
    if (updated === 0) {
      throw new Error('Fotoğraf bulunamadı');
    }
    const photo = await db.photos.get(id);
    if (photo) {
      await db.photoSearch.put(toPhotoSearch(photo));
    }
  });
}

/**
 * Applies the same tags to several photos in one transaction. Used by the
 * gallery's bulk "Etiket değiştir" action; the search projection is rewritten
 * for each photo so filters and search stay in sync.
 */
export async function updatePhotoTags(
  ids: string[],
  tags: Pick<Photo, 'examType' | 'subjectId' | 'topicId' | 'examId'>,
): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) {
    return;
  }
  if (!tags.subjectId.trim()) {
    throw new Error('Ders seçilmedi');
  }

  await db.transaction('rw', db.photos, db.photoSearch, async () => {
    for (const id of uniqueIds) {
      await updatePhoto(id, {
        examType: tags.examType,
        subjectId: tags.subjectId,
        topicId: tags.topicId,
        examId: tags.examId,
      });
    }
  });
}

/**
 * Deletes photos and their search projections. Practice sessions keep the
 * historical photo ids; the session viewer skips ids whose photo is gone.
 */
export async function deletePhotos(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await db.transaction('rw', db.photos, db.photoSearch, async () => {
    await db.photos.bulkDelete(ids);
    await db.photoSearch.bulkDelete(ids);
  });
}

export interface SaveExamInput {
  id?: string;
  type: ExamType;
  name: string;
  date: string;
  alan?: AytAlan;
  note?: string;
  results: Array<{
    subjectId: string;
    correct: number;
    wrong: number;
    blank: number;
  }>;
}

interface ExamResultInput {
  subjectId: string;
  correct: number;
  wrong: number;
  blank: number;
}

const AYT_ALAN_VALUES: ReadonlySet<AytAlan> = new Set(['sayisal', 'ea', 'sozel', 'tumu']);

function parseExamResults(rows: ExamResultInput[]): ExamResultInput[] {
  const parsed: ExamResultInput[] = [];
  const subjectIds = new Set<string>();

  for (const row of rows) {
    const subjectId = row.subjectId.trim();
    if (!subjectId) {
      throw new Error('Ders seçilmedi');
    }

    for (const count of [row.correct, row.wrong, row.blank]) {
      if (!Number.isInteger(count) || count < 0) {
        throw new Error('Doğru, yanlış ve boş sayıları 0 veya daha büyük tam sayı olmalı');
      }
    }

    // A row where every field is zero is treated as "not entered" and is
    // omitted so empty form rows never create results.
    if (row.correct === 0 && row.wrong === 0 && row.blank === 0) {
      continue;
    }
    if (subjectIds.has(subjectId)) {
      throw new Error('Aynı ders birden fazla kez girilemez');
    }

    subjectIds.add(subjectId);
    parsed.push({ subjectId, correct: row.correct, wrong: row.wrong, blank: row.blank });
  }

  return parsed;
}

/**
 * Lists exams newest first. Dates are stored as `YYYY-MM-DD`, so a lexical
 * comparison is also chronological; `createdAt` and `id` keep the order stable
 * for several exams entered on the same day.
 */
export async function listExams(type?: ExamType): Promise<Exam[]> {
  const exams = type
    ? await db.exams.where('type').equals(type).toArray()
    : await db.exams.toArray();

  return exams.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export async function getExam(id: string): Promise<Exam | undefined> {
  return db.exams.get(id);
}

export async function listExamResults(examId: string): Promise<ExamResult[]> {
  return db.examResults.where('examId').equals(examId).toArray();
}

/** One table read for callers that need nets across many exams (charts, dashboard). */
export async function listAllExamResults(): Promise<ExamResult[]> {
  return db.examResults.toArray();
}

/**
 * Creates or updates an exam and fully replaces its subject results in one
 * transaction. Net is recomputed and stored on every result. An `id` that no
 * longer exists is an error rather than a silent create.
 */
export async function saveExam(input: SaveExamInput): Promise<Exam> {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Deneme adı boş olamaz');
  }
  if (!input.date) {
    throw new Error('Tarih boş olamaz');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error('Tarih YYYY-MM-DD biçiminde olmalı');
  }
  if (!isValidDateString(input.date)) {
    throw new Error('Geçerli bir tarih gir');
  }
  if (input.alan !== undefined && !AYT_ALAN_VALUES.has(input.alan)) {
    throw new Error('AYT alanı geçersiz');
  }

  const results = parseExamResults(input.results);
  const alan = input.type === 'AYT' ? input.alan : undefined;
  const note = input.note?.trim() ?? '';

  return db.transaction('rw', db.exams, db.examResults, async () => {
    const existing = input.id ? await db.exams.get(input.id) : undefined;
    if (input.id && !existing) {
      throw new Error('Deneme bulunamadı');
    }

    const exam: Exam = {
      id: existing?.id ?? newId(),
      type: input.type,
      name,
      date: input.date,
      alan,
      note,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    await db.exams.put(exam);
    await db.examResults.where('examId').equals(exam.id).delete();

    if (results.length > 0) {
      await db.examResults.bulkAdd(
        results.map((row) => ({
          id: newId(),
          examId: exam.id,
          subjectId: row.subjectId,
          correct: row.correct,
          wrong: row.wrong,
          blank: row.blank,
          net: calculateNet(row.correct, row.wrong),
        })),
      );
    }

    return exam;
  });
}

/**
 * Deletes the exam and its results but keeps wrong-answer photos. Photos are
 * only unlinked (`examId` cleared) so they remain in the Yanlışlar gallery.
 * Everything runs in one transaction so a failure cannot leave photo links
 * pointing at a missing exam.
 */
export async function deleteExamUnlinkPhotos(examId: string): Promise<void> {
  await db.transaction('rw', db.exams, db.examResults, db.photos, db.photoSearch, async () => {
    await db.photos.where('examId').equals(examId).modify({ examId: undefined });
    await db.photoSearch
      .where('examId')
      .equals(examId)
      .modify({ examId: undefined });
    await db.examResults.where('examId').equals(examId).delete();
    await db.exams.delete(examId);
  });
}

/**
 * Canonical stored form of the wizard's filters: a shallow copy with the
 * multi-select ids deduplicated and `count` coerced to a non-negative integer.
 * Absent fields stay absent, so `examType` absent still reads as mixed, `count`
 * absent as all matching photos and `onlyUnmastered` absent as true.
 */
function normalizePracticeFilters(filters: PracticeFilters): PracticeFilters {
  const normalized: PracticeFilters = { ...filters };

  if (filters.subjectIds) {
    normalized.subjectIds = [...new Set(filters.subjectIds)];
  }
  if (filters.topicIds) {
    normalized.topicIds = [...new Set(filters.topicIds)];
  }
  if (filters.count !== undefined) {
    normalized.count = Math.max(0, Math.floor(filters.count));
  }

  return normalized;
}

export interface CreatePracticeSessionInput {
  filters: PracticeFilters;
  photoIds: string[];
}

/**
 * Creates an open session with an immutable photo order. Duplicate ids are
 * removed so one photo never contributes twice to the same session.
 */
export async function createPracticeSession(
  input: CreatePracticeSessionInput,
): Promise<PracticeSession> {
  const photoIds = [
    ...new Set(input.photoIds.map((photoId) => photoId.trim()).filter(Boolean)),
  ];
  if (photoIds.length === 0) {
    throw new Error('Test için fotoğraf bulunamadı');
  }

  const now = new Date().toISOString();
  const session: PracticeSession = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    filters: normalizePracticeFilters(input.filters),
    photoIds,
    results: {},
    choices: {},
  };
  await db.practiceSessions.add(session);
  return session;
}

/**
 * Persists one answer and the resulting mastery transition atomically. The
 * session result is written even when the photo row was deleted; only the
 * photo update is skipped. Re-answering is intentional and increments
 * `practiceCount` again, while a blank answer never changes `mastered`.
 */
export async function recordPracticeAnswer(
  sessionId: string,
  photoId: string,
  outcome: PracticeOutcome,
  choice?: CorrectOption | 'blank',
): Promise<void> {
  await db.transaction('rw', db.practiceSessions, db.photos, db.photoSearch, async () => {
    const session = await db.practiceSessions.get(sessionId);
    if (!session) {
      throw new Error('Test oturumu bulunamadı');
    }
    if (session.completedAt) {
      throw new Error('Test zaten tamamlandı');
    }

    const now = new Date().toISOString();
    await db.practiceSessions.update(sessionId, {
      results: { ...session.results, [photoId]: outcome },
      choices: choice
        ? { ...(session.choices ?? {}), [photoId]: choice }
        : session.choices,
      updatedAt: now,
    });

    const photo = await db.photos.get(photoId);
    if (!photo) {
      return;
    }

    const changes: Partial<Photo> = {
      practiceCount: photo.practiceCount + 1,
      lastPracticedAt: now,
    };
    if (outcome === 'correct') {
      changes.mastered = true;
    } else if (outcome === 'wrong') {
      // Wrong reverts a previously solved photo, as the mastery machine says.
      changes.mastered = false;
    }
    await db.photos.update(photoId, changes);

    // Keep the blob-free practice projection in step with mastery. Without
    // this the "only unmastered" filter would still see the old state.
    if (changes.mastered !== undefined) {
      const projection = await db.photoSearch.get(photoId);
      if (projection) {
        await db.photoSearch.put({ ...projection, mastered: changes.mastered });
      }
    }
  });
}

/** Idempotent: a second call keeps the original completion time. */
export async function completePracticeSession(sessionId: string): Promise<void> {
  const session = await db.practiceSessions.get(sessionId);
  if (!session) {
    throw new Error('Test oturumu bulunamadı');
  }
  if (session.completedAt) {
    return;
  }

  const now = new Date().toISOString();
  await db.practiceSessions.update(sessionId, { completedAt: now, updatedAt: now });
}

/**
 * Cancels an open session by removing it from the open list. Answers already
 * recorded on the session and the resulting photo mastery/practice counters are
 * deliberately kept, matching the spec's "iptal edilmiş cevaplar geri alınmaz".
 */
export async function cancelPracticeSession(sessionId: string): Promise<void> {
  await db.practiceSessions.delete(sessionId);
}

/** Completed sessions, newest first. The default history size is 10. */
export async function listPracticeSessions(limit = 10): Promise<PracticeSession[]> {
  const sessions = await db.practiceSessions
    .filter((session) => Boolean(session.completedAt))
    .toArray();

  return sessions
    .sort(
      (left, right) =>
        (right.completedAt ?? '').localeCompare(left.completedAt ?? '') ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}

/** Open sessions, newest first, used by the "Devam eden test" card. */
export async function listOpenPracticeSessions(): Promise<PracticeSession[]> {
  const sessions = await db.practiceSessions
    .filter((session) => !session.completedAt)
    .toArray();

  return sessions.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
  );
}

export async function getPracticeSession(id: string): Promise<PracticeSession | undefined> {
  return db.practiceSessions.get(id);
}
