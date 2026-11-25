import Dexie from 'dexie';
import type { Table } from 'dexie';
import { CATALOG_SEED, isSharedCatalogBook } from '@/data/catalogBooks';
import { CURRICULUM } from '@/data/curriculum';
import { buildNewModelFromLegacy } from '@/domain/legacyBookMigration';
import type {
  ActivityLog,
  Attachment,
  Book,
  CatalogBook,
  Exam,
  ExamResult,
  Note,
  Photo,
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
import { api } from '@/lib/api';
import { notifySettingsUpdated } from '@/lib/events';
import { getActiveDb, type KoclukDB, type SettingsRow } from './db';
import { LEGACY_DB_NAME, openLegacyDb, userDbName } from './dbManager';
import { toPhotoSearch } from './photoSearch';
import { seedCurriculum } from './seed';
import { isActiveRow } from './softDelete';
import { STATUS_PATH } from './sync/constants';
import { INITIAL_PULL_DONE_KEY, setMeta } from './sync/meta';
import {
  enqueueChange,
  setSettingsSyncEnabled,
  whenQueueIdle,
} from './sync/queue';

/**
 * One-time transfer of the pre-account `kocluk` database into the signed-in
 * account's database (design §9.3).
 *
 * Rules that are not negotiable:
 *   * legacy rows are never deleted, cleared or rewritten; opening the old
 *     database may upgrade its schema, and the backup export updates only its
 *     `lastBackupAt` setting;
 *   * row identities are preserved so every local reference stays valid;
 *   * the copy is one transaction: a failed attempt leaves the target
 *     seed-only and can be retried after the old data is backed up;
 *   * photos, attachments and other blobs are copied locally and never sent to
 *     the API (they are not synced tables);
 *   * a cloud account or a local account with real user data is never merged
 *     automatically.
 */

/** Written after a successful transfer; also stops the first-login prompt. */
export const TRANSFER_DONE_KEY = 'legacyTransferDone';

/** `done` or `dismissed` after the user answered the first-login prompt. */
export const TRANSFER_PROMPT_KEY = 'legacyTransferPrompt';

export type TransferDecision =
  | 'none'
  | 'offer'
  | 'cloud-full'
  | 'local-full'
  | 'unavailable';

/**
 * The transfer gate. A `null` cloud state means the status request failed, so
 * the client cannot prove the account has no user data and must not merge. A
 * local account with real user data is also refused: merging into it would
 * require deleting or rewriting rows the user already owns.
 */
export function transferDecision(
  legacyHasData: boolean,
  cloudHasUserData: boolean | null,
  localHasUserData = false,
): TransferDecision {
  if (!legacyHasData) {
    return 'none';
  }
  if (localHasUserData) {
    return 'local-full';
  }
  if (cloudHasUserData === null) {
    return 'unavailable';
  }
  return cloudHasUserData ? 'cloud-full' : 'offer';
}

/**
 * Reads `hasUserData` from the sync status endpoint (design §8.5).
 *
 * `hasData` is deliberately not used for the transfer gate: it counts the
 * seeded curriculum, which every device pushes on first sync. `hasUserData`
 * ignores seed subjects/topics/settings and stays false until the account has
 * real user content.
 */
export async function fetchCloudHasUserData(): Promise<boolean> {
  const status = await api.get<{ hasUserData?: unknown }>(STATUS_PATH);
  if (
    typeof status !== 'object' ||
    status === null ||
    typeof status.hasUserData !== 'boolean'
  ) {
    // An unreadable status is not proof that the account has no user data; the
    // gate must treat it as unavailable instead of offering a merge.
    throw new Error('Senkron durumu okunamadı.');
  }
  return status.hasUserData;
}

/** Counts non-tombstoned rows for the "meaningful legacy data" check. */
function countActive<T>(table: Table<T, string>): Promise<number> {
  return table.filter((row) => isActiveRow(row)).count();
}

/**
 * True when the old `kocluk` database holds data the user would miss.
 *
 * Seeded curriculum and the shipped catalog are not personal data: an old
 * install that was only opened once must not trigger the transfer prompt. A
 * non-empty profile name, user-created topics, exams, notes, photos, books,
 * plans, practice sessions and progress all count.
 */
export async function hasLegacyData(): Promise<boolean> {
  if (!(await Dexie.exists(LEGACY_DB_NAME))) {
    return false;
  }

  const legacy = await openLegacyDb();
  try {
    const profile = await legacy.settings.get('profileName');
    if (typeof profile?.value === 'string' && profile.value.trim() !== '') {
      return true;
    }

    const [exams, results, notes, photos, attachments, sessions] = await Promise.all([
      countActive(legacy.exams),
      countActive(legacy.examResults),
      countActive(legacy.notes),
      legacy.photos.count(),
      legacy.attachments.count(),
      legacy.practiceSessions.count(),
    ]);
    if (exams + results + notes + photos + attachments + sessions > 0) {
      return true;
    }

    const [books, topicBooks, customCatalog, customTopics] = await Promise.all([
      legacy.books.count(),
      legacy.topicBooks.count(),
      legacy.catalogBooks
        .filter(
          (row) =>
            isActiveRow(row) && typeof row.ownerId === 'string' && row.ownerId !== '',
        )
        .count(),
      legacy.topics.filter((row) => isActiveRow(row) && row.isCustom === true).count(),
    ]);
    if (books + topicBooks + customCatalog + customTopics > 0) {
      return true;
    }

    const [userBooks, activity, weeks, rows, tasks, progress, entries, files, tables] =
      await Promise.all([
        countActive(legacy.userBooks),
        countActive(legacy.activityLogs),
        countActive(legacy.scheduleWeeks),
        countActive(legacy.scheduleRows),
        countActive(legacy.scheduleTasks),
        countActive(legacy.topicProgress),
        legacy.scheduleEntries.count(),
        legacy.scheduleFiles.count(),
        legacy.scheduleTables.count(),
      ]);
    return userBooks + activity + weeks + rows + tasks + progress + entries + files + tables > 0;
  } finally {
    legacy.close();
  }
}

export interface TransferSummary {
  total: number;
  skipped: number;
  settings: number;
  subjects: number;
  topics: number;
  exams: number;
  examResults: number;
  notes: number;
  catalogBooks: number;
  userBooks: number;
  activityLogs: number;
  scheduleWeeks: number;
  scheduleRows: number;
  scheduleTasks: number;
  topicProgress: number;
  books: number;
  topicBooks: number;
  photos: number;
  attachments: number;
  practiceSessions: number;
  scheduleEntries: number;
  scheduleFiles: number;
  scheduleTables: number;
}

/** Local rows that mean the account database is no longer a fresh target. */
export interface LocalUserDataSummary {
  hasUserData: boolean;
  total: number;
  counts: Record<string, number>;
}

/**
 * Thrown before any write when the active local account already holds user
 * data. Merging into it would require deleting or rewriting rows the user
 * owns, so the transfer is refused instead.
 */
export class LocalDataTransferBlockedError extends Error {
  readonly summary: LocalUserDataSummary;

  constructor(summary: LocalUserDataSummary) {
    super(
      'Bu hesapta zaten yerel veriler var. Taşıma yalnızca boş ya da yalnızca tohum verisi olan bir hesaba yapılabilir. Önce Ayarlar → Yedekleme bölümünden yedek indirip yerel verileri temizle.',
    );
    this.name = 'LocalDataTransferBlockedError';
    this.summary = summary;
  }
}

/**
 * Counts everything the user created in the active account database. Seed
 * subjects/topics and the shipped catalog are allowed; any note, exam, shelf
 * book, plan, custom topic/book, photo or attachment means the account is in
 * use and must not be overwritten by a legacy transfer.
 */
export async function localUserDataSummary(
  database: KoclukDB,
): Promise<LocalUserDataSummary> {
  const counts: Record<string, number> = {};
  const [
    notes,
    topicProgress,
    exams,
    examResults,
    userBooks,
    activityLogs,
    scheduleWeeks,
    scheduleRows,
    scheduleTasks,
    photos,
    attachments,
    practiceSessions,
    scheduleEntries,
    scheduleFiles,
    scheduleTables,
    books,
    topicBooks,
    customTopics,
    customCatalog,
  ] = await Promise.all([
    database.notes.count(),
    database.topicProgress.count(),
    database.exams.count(),
    database.examResults.count(),
    database.userBooks.count(),
    database.activityLogs.count(),
    database.scheduleWeeks.count(),
    database.scheduleRows.count(),
    database.scheduleTasks.count(),
    database.photos.count(),
    database.attachments.count(),
    database.practiceSessions.count(),
    database.scheduleEntries.count(),
    database.scheduleFiles.count(),
    database.scheduleTables.count(),
    database.books.count(),
    database.topicBooks.count(),
    database.topics.filter((row) => row.isCustom === true).count(),
    database.catalogBooks
      .filter((row) => !isSharedCatalogBook(row.id))
      .count(),
  ]);

  const values: Array<[string, number]> = [
    ['notes', notes],
    ['topicProgress', topicProgress],
    ['exams', exams],
    ['examResults', examResults],
    ['userBooks', userBooks],
    ['activityLogs', activityLogs],
    ['scheduleWeeks', scheduleWeeks],
    ['scheduleRows', scheduleRows],
    ['scheduleTasks', scheduleTasks],
    ['photos', photos],
    ['attachments', attachments],
    ['practiceSessions', practiceSessions],
    ['scheduleEntries', scheduleEntries],
    ['scheduleFiles', scheduleFiles],
    ['scheduleTables', scheduleTables],
    ['books', books],
    ['topicBooks', topicBooks],
    ['customTopics', customTopics],
    ['customCatalogBooks', customCatalog],
  ];

  let total = 0;
  for (const [name, count] of values) {
    counts[name] = count;
    total += count;
  }

  return { hasUserData: total > 0, total, counts };
}

export type TransferProgress = (done: number, total: number) => void;

interface LegacySnapshot {
  settings: SettingsRow[];
  subjects: Subject[];
  topics: Topic[];
  exams: Exam[];
  examResults: ExamResult[];
  notes: Note[];
  catalogBooks: CatalogBook[];
  userBooks: UserBook[];
  activityLogs: ActivityLog[];
  scheduleWeeks: ScheduleWeek[];
  scheduleRows: ScheduleRow[];
  scheduleTasks: ScheduleTask[];
  topicProgress: TopicProgress[];
  books: Book[];
  topicBooks: TopicBook[];
  photos: Photo[];
  attachments: Attachment[];
  practiceSessions: PracticeSession[];
  scheduleEntries: ScheduleEntry[];
  scheduleFiles: ScheduleFile[];
  scheduleTables: ScheduleTable[];
}

async function readLegacy(legacy: KoclukDB): Promise<LegacySnapshot> {
  const [
    settings,
    subjects,
    topics,
    exams,
    examResults,
    notes,
    catalogBooks,
    userBooks,
    activityLogs,
    scheduleWeeks,
    scheduleRows,
    scheduleTasks,
    topicProgress,
    books,
    topicBooks,
    photos,
    attachments,
    practiceSessions,
    scheduleEntries,
    scheduleFiles,
    scheduleTables,
  ] = await Promise.all([
    legacy.settings.toArray(),
    legacy.subjects.toArray(),
    legacy.topics.toArray(),
    legacy.exams.toArray(),
    legacy.examResults.toArray(),
    legacy.notes.toArray(),
    legacy.catalogBooks.toArray(),
    legacy.userBooks.toArray(),
    legacy.activityLogs.toArray(),
    legacy.scheduleWeeks.toArray(),
    legacy.scheduleRows.toArray(),
    legacy.scheduleTasks.toArray(),
    legacy.topicProgress.toArray(),
    legacy.books.toArray(),
    legacy.topicBooks.toArray(),
    legacy.photos.toArray(),
    legacy.attachments.toArray(),
    legacy.practiceSessions.toArray(),
    legacy.scheduleEntries.toArray(),
    legacy.scheduleFiles.toArray(),
    legacy.scheduleTables.toArray(),
  ]);

  return {
    settings,
    subjects,
    topics,
    exams,
    examResults,
    notes,
    catalogBooks,
    userBooks,
    activityLogs,
    scheduleWeeks,
    scheduleRows,
    scheduleTasks,
    topicProgress,
    books,
    topicBooks,
    photos,
    attachments,
    practiceSessions,
    scheduleEntries,
    scheduleFiles,
    scheduleTables,
  };
}

function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  if (extra.length === 0) {
    return base;
  }
  const merged = new Map(base.map((row) => [row.id, row]));
  for (const row of extra) {
    merged.set(row.id, row);
  }
  return [...merged.values()];
}

interface CopyPlan {
  snapshot: LegacySnapshot;
  catalogBooks: CatalogBook[];
  userBooks: UserBook[];
  topicProgress: TopicProgress[];
}

function buildCopyPlan(snapshot: LegacySnapshot): CopyPlan {
  let catalogBooks = snapshot.catalogBooks;
  let userBooks = snapshot.userBooks;
  let topicProgress = snapshot.topicProgress;

  // A pre-v6 database has books/topicBooks but no page-based shelf yet. The
  // old rows are still copied as an archive; the derived rows make them usable
  // immediately instead of waiting for the next app start.
  if (snapshot.userBooks.length === 0 && snapshot.books.length > 0) {
    const derived = buildNewModelFromLegacy({
      books: snapshot.books,
      topicBooks: snapshot.topicBooks,
      topics: snapshot.topics,
      subjects: snapshot.subjects,
      catalogSeed: CATALOG_SEED,
    });
    catalogBooks = mergeById(catalogBooks, derived.catalogBooks);
    userBooks = mergeById(userBooks, derived.userBooks);
    const takenTopics = new Set(topicProgress.map((row) => row.topicId));
    topicProgress = [
      ...topicProgress,
      ...derived.topicProgress.filter((row) => !takenTopics.has(row.topicId)),
    ];
  }

  return { snapshot, catalogBooks, userBooks, topicProgress };
}

interface SeedRemap {
  /** Target (device-seeded) subject id -> transferred legacy subject id. */
  subject: Map<string, string>;
  /** Target (device-seeded) topic id -> transferred legacy topic id. */
  topic: Map<string, string>;
  staleSubjects: Set<string>;
  staleTopics: Set<string>;
  /** Target topics that survive and only need a subject reference update. */
  keptTopics: Topic[];
}

/**
 * Reconciles the target's seeded rows with the transferred ones. The legacy
 * identity always wins for a `seedKey`; every target row that is deleted is
 * recorded in the remap so its dependent references can be rewritten in the
 * same transaction.
 */
function buildSeedRemap(
  targetSubjects: Subject[],
  targetTopics: Topic[],
  legacySubjects: Subject[],
  legacyTopics: Topic[],
): SeedRemap {
  const legacySubjectIds = new Set(legacySubjects.map((row) => row.id));
  const legacyBySeedKey = new Map(legacySubjects.map((row) => [row.seedKey, row]));
  const subject = new Map<string, string>();
  const staleSubjects = new Set<string>();
  for (const existing of targetSubjects) {
    const legacy = legacyBySeedKey.get(existing.seedKey);
    if (legacy && legacy.id !== existing.id && !legacySubjectIds.has(existing.id)) {
      subject.set(existing.id, legacy.id);
      staleSubjects.add(existing.id);
    }
  }

  const legacyTopicIds = new Set(legacyTopics.map((row) => row.id));
  const legacyTopicBySeedKey = new Map(
    legacyTopics
      .filter((row) => typeof row.seedKey === 'string' && row.seedKey !== '')
      .map((row) => [row.seedKey as string, row]),
  );
  const topic = new Map<string, string>();
  const staleTopics = new Set<string>();
  const keptTopics: Topic[] = [];
  for (const existing of targetTopics) {
    if (legacyTopicIds.has(existing.id)) {
      // The transferred row has the same identity and will replace this one.
      continue;
    }
    const legacy = existing.isCustom
      ? undefined
      : existing.seedKey
        ? legacyTopicBySeedKey.get(existing.seedKey)
        : undefined;
    if (legacy && legacy.id !== existing.id) {
      topic.set(existing.id, legacy.id);
      staleTopics.add(existing.id);
      continue;
    }
    const subjectId = subject.get(existing.subjectId) ?? existing.subjectId;
    if (subjectId !== existing.subjectId) {
      keptTopics.push({ ...existing, subjectId });
    }
  }

  return { subject, topic, staleSubjects, staleTopics, keptTopics };
}

interface ParentRemap {
  legacyUserBookToTarget: Map<string, string>;
  legacyWeekToTarget: Map<string, string>;
}

/**
 * Filters legacy user books and plan weeks whose natural key already exists in
 * the target under another identity. With the local-user-data refusal this is
 * normally empty; keeping the remap makes the copy safe if that guard is ever
 * relaxed.
 */
function filterParentConflicts(
  plan: CopyPlan,
  targetUserBooks: UserBook[],
  targetWeeks: ScheduleWeek[],
): { userBooks: UserBook[]; weeks: ScheduleWeek[]; remap: ParentRemap; skipped: number } {
  const targetBookId = new Map(targetUserBooks.map((row) => [row.bookId, row.id]));
  const legacyUserBookToTarget = new Map<string, string>();
  const userBooks = plan.userBooks.filter((row) => {
    const existing = targetBookId.get(row.bookId);
    if (existing !== undefined && existing !== row.id) {
      legacyUserBookToTarget.set(row.id, existing);
      return false;
    }
    return true;
  });

  const targetWeekStart = new Map(targetWeeks.map((row) => [row.weekStart, row.id]));
  const legacyWeekToTarget = new Map<string, string>();
  const weeks = plan.snapshot.scheduleWeeks.filter((row) => {
    const existing = targetWeekStart.get(row.weekStart);
    if (existing !== undefined && existing !== row.id) {
      legacyWeekToTarget.set(row.id, existing);
      return false;
    }
    return true;
  });

  return {
    userBooks,
    weeks,
    remap: { legacyUserBookToTarget, legacyWeekToTarget },
    skipped:
      plan.userBooks.length - userBooks.length +
      plan.snapshot.scheduleWeeks.length - weeks.length,
  };
}

function remapped(
  map: ReadonlyMap<string, string>,
  value: string | undefined,
): string | undefined {
  return value === undefined ? undefined : (map.get(value) ?? value);
}

interface ResolvedRows {
  subjects: Subject[];
  topics: Topic[];
  exams: Exam[];
  examResults: ExamResult[];
  notes: Note[];
  userBooks: UserBook[];
  activityLogs: ActivityLog[];
  scheduleWeeks: ScheduleWeek[];
  scheduleRows: ScheduleRow[];
  scheduleTasks: ScheduleTask[];
  topicProgress: TopicProgress[];
  photos: Photo[];
  attachments: Attachment[];
  practiceSessions: PracticeSession[];
  scheduleEntries: ScheduleEntry[];
  catalogBooks: CatalogBook[];
  keptTargetTopics: Topic[];
  skipped: number;
}

/**
 * Rewrites every dependent reference and drops children whose required parent
 * is not part of the transfer. Optional topic/book references on schedule
 * tasks are cleared rather than losing the task's own content.
 */
function resolveReferences(
  plan: CopyPlan,
  seed: SeedRemap,
  parent: ParentRemap,
  userBooks: UserBook[],
  weeks: ScheduleWeek[],
  targetSubjects: Subject[],
  targetTopicProgress: TopicProgress[],
): ResolvedRows {
  const snapshot = plan.snapshot;
  let skipped = 0;

  const copiedUserBookIds = new Set(userBooks.map((row) => row.id));
  for (const targetId of parent.legacyUserBookToTarget.values()) {
    copiedUserBookIds.add(targetId);
  }
  const copiedWeekIds = new Set(weeks.map((row) => row.id));
  for (const targetId of parent.legacyWeekToTarget.values()) {
    copiedWeekIds.add(targetId);
  }

  const availableSubjectIds = new Set(snapshot.subjects.map((row) => row.id));
  const keptSubjects = targetSubjects.filter((row) => !seed.staleSubjects.has(row.id));
  for (const row of keptSubjects) {
    availableSubjectIds.add(row.id);
  }
  const availableTopicIds = new Set(snapshot.topics.map((row) => row.id));
  for (const row of seed.keptTopics) {
    availableTopicIds.add(row.id);
  }
  const availableExamIds = new Set(snapshot.exams.map((row) => row.id));
  const branchExams = new Set(
    snapshot.exams.filter((row) => row.kind === 'branch').map((row) => row.id),
  );

  const subjects = snapshot.subjects;
  const topics = snapshot.topics.map((row) => ({
    ...row,
    subjectId: remapped(seed.subject, row.subjectId) as string,
  }));
  const exams = snapshot.exams;

  const examResults: ExamResult[] = [];
  for (const row of snapshot.examResults) {
    const subjectId = remapped(seed.subject, row.subjectId) as string;
    const examExists = availableExamIds.has(row.examId);
    const subjectExists =
      branchExams.has(row.examId) || availableSubjectIds.has(subjectId);
    if (!examExists || !subjectExists) {
      skipped += 1;
      continue;
    }
    examResults.push({ ...row, subjectId });
  }

  const notes: Note[] = [];
  for (const row of snapshot.notes) {
    const topicId = remapped(seed.topic, row.topicId) as string;
    if (!availableTopicIds.has(topicId)) {
      skipped += 1;
      continue;
    }
    notes.push({ ...row, topicId });
  }

  const activityLogs: ActivityLog[] = [];
  for (const row of snapshot.activityLogs) {
    const userBookId = remapped(
      parent.legacyUserBookToTarget,
      row.userBookId,
    );
    const topicId = remapped(seed.topic, row.topicId);
    if (userBookId !== undefined && !copiedUserBookIds.has(userBookId)) {
      skipped += 1;
      continue;
    }
    if (topicId !== undefined && !availableTopicIds.has(topicId)) {
      skipped += 1;
      continue;
    }
    activityLogs.push({ ...row, userBookId, topicId });
  }

  const scheduleRows: ScheduleRow[] = [];
  for (const row of snapshot.scheduleRows) {
    const weekId = remapped(parent.legacyWeekToTarget, row.weekId) as string;
    if (!copiedWeekIds.has(weekId)) {
      skipped += 1;
      continue;
    }
    const subjectId = remapped(seed.subject, row.subjectId);
    scheduleRows.push({
      ...row,
      weekId,
      subjectId:
        subjectId !== undefined && availableSubjectIds.has(subjectId)
          ? subjectId
          : undefined,
    });
  }
  const copiedRowIds = new Set(scheduleRows.map((row) => row.id));

  const scheduleTasks: ScheduleTask[] = [];
  for (const row of snapshot.scheduleTasks) {
    const weekId = remapped(parent.legacyWeekToTarget, row.weekId) as string;
    if (!copiedWeekIds.has(weekId) || !copiedRowIds.has(row.rowId)) {
      skipped += 1;
      continue;
    }
    const topicId = remapped(seed.topic, row.topicId);
    const userBookId = remapped(parent.legacyUserBookToTarget, row.userBookId);
    scheduleTasks.push({
      ...row,
      weekId,
      topicId:
        topicId !== undefined && availableTopicIds.has(topicId) ? topicId : undefined,
      userBookId:
        userBookId !== undefined && copiedUserBookIds.has(userBookId)
          ? userBookId
          : undefined,
    });
  }

  const targetByTopic = new Map(targetTopicProgress.map((row) => [row.topicId, row.id]));
  const topicProgress: TopicProgress[] = [];
  for (const row of plan.topicProgress) {
    const topicId = remapped(seed.topic, row.topicId) as string;
    if (!availableTopicIds.has(topicId)) {
      skipped += 1;
      continue;
    }
    const existing = targetByTopic.get(topicId);
    if (existing !== undefined && existing !== row.id) {
      skipped += 1;
      continue;
    }
    topicProgress.push({ ...row, topicId });
  }

  const photos: Photo[] = snapshot.photos.map((row) => {
    const topicId = remapped(seed.topic, row.topicId);
    return {
      ...row,
      subjectId: remapped(seed.subject, row.subjectId) as string,
      topicId:
        topicId !== undefined && availableTopicIds.has(topicId) ? topicId : undefined,
    };
  });

  const attachments = snapshot.attachments.map((row) => ({
    ...row,
    topicId: remapped(seed.topic, row.topicId) as string,
  }));

  const practiceSessions = snapshot.practiceSessions.map((row) => ({
    ...row,
    filters: {
      ...row.filters,
      subjectIds: row.filters.subjectIds?.map(
        (id) => remapped(seed.subject, id) as string,
      ),
      topicIds: row.filters.topicIds?.map((id) => remapped(seed.topic, id) as string),
    },
  }));

  const scheduleEntries = snapshot.scheduleEntries.map((row) => ({
    ...row,
    subjectId: remapped(seed.subject, row.subjectId),
  }));

  return {
    subjects,
    topics,
    exams,
    examResults,
    notes,
    userBooks,
    activityLogs,
    scheduleWeeks: weeks,
    scheduleRows,
    scheduleTasks,
    topicProgress,
    photos,
    attachments,
    practiceSessions,
    scheduleEntries,
    // The shared catalog ships with the app; only private rows are synced.
    catalogBooks: plan.catalogBooks.filter((row) => !isSharedCatalogBook(row.id)),
    keptTargetTopics: seed.keptTopics,
    skipped,
  };
}

function totalRows(rows: ResolvedRows, snapshot: LegacySnapshot): number {
  return (
    snapshot.settings.length +
    rows.subjects.length +
    rows.topics.length +
    rows.exams.length +
    rows.examResults.length +
    rows.notes.length +
    rows.catalogBooks.length +
    rows.userBooks.length +
    rows.activityLogs.length +
    rows.scheduleWeeks.length +
    rows.scheduleRows.length +
    rows.scheduleTasks.length +
    rows.topicProgress.length +
    snapshot.books.length +
    snapshot.topicBooks.length +
    rows.photos.length +
    rows.attachments.length +
    rows.practiceSessions.length +
    rows.scheduleEntries.length +
    snapshot.scheduleFiles.length +
    snapshot.scheduleTables.length
  );
}

/**
 * Copies the legacy database into `kocluk-u-<userId>` (design §9.3).
 *
 * The cloud must be proven free of user data by the caller
 * (`transferDecision`); the active local account must also be fresh or hold
 * only seed rows. Everything else is refused before a single write.
 *
 * For an allowed target, the seed reconciliation, every dependent-reference
 * rewrite and the copy run in one transaction. The function makes no network
 * request; copied synced rows enter the queue through the installed hooks and
 * are pushed afterwards.
 */
export async function transferLegacyData(
  userId: string,
  onProgress?: TransferProgress,
): Promise<TransferSummary> {
  const target = getActiveDb();
  if (target.name !== userDbName(userId)) {
    throw new Error('Taşıma yalnızca açık hesabın yerel veritabanına yapılabilir.');
  }
  if (!(await Dexie.exists(LEGACY_DB_NAME))) {
    throw new Error('Bu cihazda eski veri bulunamadı.');
  }

  // Cheap early refusal before opening the legacy database; the transaction
  // repeats it atomically so a concurrent write cannot slip in.
  const preflight = await localUserDataSummary(target);
  if (preflight.hasUserData) {
    throw new LocalDataTransferBlockedError(preflight);
  }

  const legacy = await openLegacyDb();
  try {
    const raw = await readLegacy(legacy);
    const plan = buildCopyPlan(raw);

    let summary: TransferSummary | null = null;

    await target.transaction(
      'rw',
      [
        target.settings,
        target.subjects,
        target.topics,
        target.exams,
        target.examResults,
        target.notes,
        target.catalogBooks,
        target.userBooks,
        target.activityLogs,
        target.scheduleWeeks,
        target.scheduleRows,
        target.scheduleTasks,
        target.topicProgress,
        target.books,
        target.topicBooks,
        target.photos,
        target.photoSearch,
        target.attachments,
        target.practiceSessions,
        target.scheduleEntries,
        target.scheduleFiles,
        target.scheduleTables,
      ],
      async () => {
        const local = await localUserDataSummary(target);
        if (local.hasUserData) {
          throw new LocalDataTransferBlockedError(local);
        }

        const [targetSubjects, targetTopics, targetUserBooks, targetWeeks, targetTopicProgress] =
          await Promise.all([
            target.subjects.toArray(),
            target.topics.toArray(),
            target.userBooks.toArray(),
            target.scheduleWeeks.toArray(),
            target.topicProgress.toArray(),
          ]);

        const seed = buildSeedRemap(
          targetSubjects,
          targetTopics,
          raw.subjects,
          raw.topics,
        );
        const parent = filterParentConflicts(plan, targetUserBooks, targetWeeks);
        const rows = resolveReferences(
          plan,
          seed,
          parent.remap,
          parent.userBooks,
          parent.weeks,
          targetSubjects,
          targetTopicProgress,
        );
        const skipped = parent.skipped + rows.skipped;
        const total = totalRows(rows, raw);

        let done = 0;
        const report = (count: number) => {
          done += count;
          onProgress?.(done, total);
        };
        onProgress?.(0, total);

        // The target seed rows are deleted first. Their queue entries are real:
        // the server may already hold the same seedKeys, and a delete before
        // the transferred upsert keeps the legacy ids canonical there too.
        if (seed.staleTopics.size > 0) {
          await target.topics.bulkDelete([...seed.staleTopics]);
        }
        if (seed.staleSubjects.size > 0) {
          await target.subjects.bulkDelete([...seed.staleSubjects]);
        }
        if (seed.keptTopics.length > 0) {
          await target.topics.bulkPut(seed.keptTopics);
        }

        const writes: Array<[number, () => Promise<unknown>]> = [
          [raw.settings.length, () => target.settings.bulkPut(raw.settings)],
          [rows.subjects.length, () => target.subjects.bulkPut(rows.subjects)],
          [rows.topics.length, () => target.topics.bulkPut(rows.topics)],
          [rows.exams.length, () => target.exams.bulkPut(rows.exams)],
          [rows.examResults.length, () => target.examResults.bulkPut(rows.examResults)],
          [rows.notes.length, () => target.notes.bulkPut(rows.notes)],
          [rows.catalogBooks.length, () => target.catalogBooks.bulkPut(rows.catalogBooks)],
          [rows.userBooks.length, () => target.userBooks.bulkPut(rows.userBooks)],
          [rows.activityLogs.length, () => target.activityLogs.bulkPut(rows.activityLogs)],
          [rows.scheduleWeeks.length, () => target.scheduleWeeks.bulkPut(rows.scheduleWeeks)],
          [rows.scheduleRows.length, () => target.scheduleRows.bulkPut(rows.scheduleRows)],
          [rows.scheduleTasks.length, () => target.scheduleTasks.bulkPut(rows.scheduleTasks)],
          [rows.topicProgress.length, () => target.topicProgress.bulkPut(rows.topicProgress)],
          [raw.books.length, () => target.books.bulkPut(raw.books)],
          [raw.topicBooks.length, () => target.topicBooks.bulkPut(raw.topicBooks)],
          [rows.photos.length, () => target.photos.bulkPut(rows.photos)],
          [0, () => target.photoSearch.bulkPut(rows.photos.map(toPhotoSearch))],
          [rows.attachments.length, () => target.attachments.bulkPut(rows.attachments)],
          [
            rows.practiceSessions.length,
            () => target.practiceSessions.bulkPut(rows.practiceSessions),
          ],
          [
            rows.scheduleEntries.length,
            () => target.scheduleEntries.bulkPut(rows.scheduleEntries),
          ],
          [raw.scheduleFiles.length, () => target.scheduleFiles.bulkPut(raw.scheduleFiles)],
          [raw.scheduleTables.length, () => target.scheduleTables.bulkPut(raw.scheduleTables)],
        ];

        for (const [count, write] of writes) {
          await write();
          if (count > 0) {
            report(count);
          }
        }

        // Settings are replaced/merged above; remap any hidden subject ids
        // that still point at a deleted target seed row.
        const hidden = await target.settings.get('hiddenSubjects');
        const hiddenValue = hidden?.value;
        if (Array.isArray(hiddenValue)) {
          const next = hiddenValue.map((value) =>
            typeof value === 'string' ? remapped(seed.subject, value) : value,
          );
          if (next.some((value, index) => value !== hiddenValue[index])) {
            await target.settings.put({ key: 'hiddenSubjects', value: next });
          }
        }

        summary = {
          total,
          skipped,
          settings: raw.settings.length,
          subjects: rows.subjects.length,
          topics: rows.topics.length,
          exams: rows.exams.length,
          examResults: rows.examResults.length,
          notes: rows.notes.length,
          catalogBooks: rows.catalogBooks.length,
          userBooks: rows.userBooks.length,
          activityLogs: rows.activityLogs.length,
          scheduleWeeks: rows.scheduleWeeks.length,
          scheduleRows: rows.scheduleRows.length,
          scheduleTasks: rows.scheduleTasks.length,
          topicProgress: rows.topicProgress.length,
          books: raw.books.length,
          topicBooks: raw.topicBooks.length,
          photos: rows.photos.length,
          attachments: rows.attachments.length,
          practiceSessions: rows.practiceSessions.length,
          scheduleEntries: rows.scheduleEntries.length,
          scheduleFiles: raw.scheduleFiles.length,
          scheduleTables: raw.scheduleTables.length,
        };
      },
    );

    // Fill gaps in the curriculum without touching transferred rows: the seed
    // matches by `seedKey` and only adds what is missing. A seed failure must
    // not turn a committed transfer into an apparent failure; SettingsProvider
    // retries the same idempotent seed on its next mount.
    try {
      await seedCurriculum(CURRICULUM);
    } catch {
      // No row content is logged; the next mount retries.
    }
    // The Settings screen may already be mounted (manual transfer); reload the
    // transferred profile/exam values without a page refresh.
    notifySettingsUpdated();

    // The cloud has no user-created rows, but it may have a settings row.
    // The transferred profile/exam values intentionally replace it; there is
    // no user content to merge. Opening the settings gate and writing the
    // explicit queue entry makes them part of the first push.
    setSettingsSyncEnabled(target, true);
    await setMeta(target, INITIAL_PULL_DONE_KEY, true);
    await enqueueChange(target, 'settings', userId);
    await setMeta(target, TRANSFER_DONE_KEY, true);
    await whenQueueIdle();

    if (summary === null) {
      throw new Error('Taşıma tamamlanamadı.');
    }
    return summary;
  } finally {
    legacy.close();
  }
}

/**
 * Downloads the legacy database as the regular v6 zip backup, blobs included.
 * The heavy zip modules are imported on demand so the initial bundle does not
 * carry them.
 */
export async function downloadLegacyBackup(): Promise<void> {
  if (!(await Dexie.exists(LEGACY_DB_NAME))) {
    throw new Error('Bu cihazda eski veri bulunamadı.');
  }
  const [{ exportDatabaseBackup }, { backupFileName, saveBlob }] = await Promise.all([
    import('./backup'),
    import('@/lib/zip'),
  ]);
  const legacy = await openLegacyDb();
  try {
    const blob = await exportDatabaseBackup(legacy);
    saveBlob(blob, backupFileName());
  } finally {
    legacy.close();
  }
}
