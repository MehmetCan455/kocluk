import Dexie from 'dexie';
import type { Table } from 'dexie';
import { CATALOG_SEED } from '@/data/catalogBooks';
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
  markRemoteTransaction,
  setSettingsSyncEnabled,
  whenQueueIdle,
} from './sync/queue';

/**
 * One-time transfer of the pre-account `kocluk` database into the signed-in
 * account's database (design §9.3).
 *
 * Rules that are not negotiable:
 *   * the legacy database is only read; it is never deleted, cleared or
 *     rewritten;
 *   * row identities are preserved so every local reference stays valid;
 *   * the operation is idempotent: `bulkPut` by identity plus a `seedKey`
 *     reconciliation cannot create duplicates;
 *   * photos, attachments and other blobs are copied locally and never sent to
 *     the API (they are not synced tables);
 *   * a non-empty cloud account is never merged automatically.
 */

/** Written after a successful transfer; also stops the first-login prompt. */
export const TRANSFER_DONE_KEY = 'legacyTransferDone';

/** `done` or `dismissed` after the user answered the first-login prompt. */
export const TRANSFER_PROMPT_KEY = 'legacyTransferPrompt';

export type TransferDecision = 'none' | 'offer' | 'cloud-full' | 'unavailable';

/**
 * The transfer gate. A `null` cloud state means the status request failed, so
 * the client cannot prove the account is empty and must not merge.
 */
export function transferDecision(
  legacyHasData: boolean,
  cloudHasData: boolean | null,
): TransferDecision {
  if (!legacyHasData) {
    return 'none';
  }
  if (cloudHasData === null) {
    return 'unavailable';
  }
  return cloudHasData ? 'cloud-full' : 'offer';
}

/** Reads `hasData` from the sync status endpoint (design §8.5). */
export async function fetchCloudHasData(): Promise<boolean> {
  const status = await api.get<{ hasData?: unknown }>(STATUS_PATH);
  if (typeof status !== 'object' || status === null || typeof status.hasData !== 'boolean') {
    // An unreadable status is not proof that the account is empty; the gate
    // must treat it as unavailable instead of offering a merge.
    throw new Error('Senkron durumu okunamadı.');
  }
  return status.hasData;
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

/**
 * Removes seeded rows whose `seedKey` now belongs to a transferred row with a
 * different identity. This is the only place the transfer deletes anything,
 * and it only touches rows this device seeded itself: the account was proven
 * empty (or this is the first write into it), so they have no user content.
 *
 * The delete transaction is marked remote so the temporary seed row never
 * produces a delete entry in the push queue.
 */
async function reconcileSeededCurriculum(
  target: KoclukDB,
  subjects: Subject[],
  topics: Topic[],
): Promise<void> {
  const targetSubjects = await target.subjects.toArray();
  const legacySubjectIds = new Set(subjects.map((row) => row.id));
  const legacyBySeedKey = new Map(subjects.map((row) => [row.seedKey, row]));
  const staleSubjects = new Set<string>();
  // A user-created topic under a replaced seed subject must survive: only its
  // subject reference moves to the transferred subject row.
  const subjectRemap = new Map<string, string>();
  for (const existing of targetSubjects) {
    const legacy = legacyBySeedKey.get(existing.seedKey);
    if (legacy && legacy.id !== existing.id && !legacySubjectIds.has(existing.id)) {
      staleSubjects.add(existing.id);
      subjectRemap.set(existing.id, legacy.id);
    }
  }

  const targetTopics = await target.topics.toArray();
  const legacyTopicIds = new Set(topics.map((row) => row.id));
  const legacyTopicBySeedKey = new Map(
    topics
      .filter((row) => typeof row.seedKey === 'string' && row.seedKey !== '')
      .map((row) => [row.seedKey as string, row]),
  );
  const staleTopics = new Set<string>();
  const remappedTopics: Topic[] = [];
  for (const existing of targetTopics) {
    if (legacyTopicIds.has(existing.id)) {
      continue;
    }
    const remappedSubject = subjectRemap.get(existing.subjectId);
    if (remappedSubject !== undefined) {
      if (existing.isCustom) {
        remappedTopics.push({ ...existing, subjectId: remappedSubject });
      } else {
        staleTopics.add(existing.id);
      }
      continue;
    }
    if (existing.seedKey !== undefined) {
      const legacy = legacyTopicBySeedKey.get(existing.seedKey);
      if (legacy && legacy.id !== existing.id) {
        staleTopics.add(existing.id);
      }
    }
  }

  if (staleSubjects.size === 0 && staleTopics.size === 0 && remappedTopics.length === 0) {
    return;
  }

  await target.transaction('rw', target.subjects, target.topics, async (transaction) => {
    markRemoteTransaction(transaction);
    if (staleSubjects.size > 0) {
      await target.subjects.bulkDelete([...staleSubjects]);
    }
    if (staleTopics.size > 0) {
      await target.topics.bulkDelete([...staleTopics]);
    }
    for (const topic of remappedTopics) {
      await target.topics.put(topic);
    }
  });

  // The remap is a real local change: make sure it reaches the server even
  // when the remote-marked transaction suppressed the hook.
  for (const topic of remappedTopics) {
    await enqueueChange(target, 'topics', topic.id);
  }
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

async function filterUserBooks(
  target: KoclukDB,
  rows: UserBook[],
): Promise<UserBook[]> {
  if (rows.length === 0) {
    return rows;
  }
  const existing = await target.userBooks.toArray();
  const byBookId = new Map(existing.map((row) => [row.bookId, row.id]));
  return rows.filter((row) => {
    const id = byBookId.get(row.bookId);
    return id === undefined || id === row.id;
  });
}

async function filterScheduleWeeks(
  target: KoclukDB,
  rows: ScheduleWeek[],
): Promise<ScheduleWeek[]> {
  if (rows.length === 0) {
    return rows;
  }
  const existing = await target.scheduleWeeks.toArray();
  const byWeekStart = new Map(existing.map((row) => [row.weekStart, row.id]));
  return rows.filter((row) => {
    const id = byWeekStart.get(row.weekStart);
    return id === undefined || id === row.id;
  });
}

async function filterTopicProgress(
  target: KoclukDB,
  rows: TopicProgress[],
): Promise<TopicProgress[]> {
  if (rows.length === 0) {
    return rows;
  }
  const existing = await target.topicProgress.toArray();
  const byTopicId = new Map(existing.map((row) => [row.topicId, row.id]));
  return rows.filter((row) => {
    const id = byTopicId.get(row.topicId);
    return id === undefined || id === row.id;
  });
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

function totalRows(plan: CopyPlan): number {
  const { snapshot } = plan;
  return (
    snapshot.settings.length +
    snapshot.subjects.length +
    snapshot.topics.length +
    snapshot.exams.length +
    snapshot.examResults.length +
    snapshot.notes.length +
    plan.catalogBooks.length +
    plan.userBooks.length +
    snapshot.activityLogs.length +
    snapshot.scheduleWeeks.length +
    snapshot.scheduleRows.length +
    snapshot.scheduleTasks.length +
    plan.topicProgress.length +
    snapshot.books.length +
    snapshot.topicBooks.length +
    snapshot.photos.length +
    snapshot.attachments.length +
    snapshot.practiceSessions.length +
    snapshot.scheduleEntries.length +
    snapshot.scheduleFiles.length +
    snapshot.scheduleTables.length
  );
}

/**
 * Copies the legacy database into `kocluk-u-<userId>`.
 *
 * The cloud must be proven empty by the caller (`transferDecision`). The
 * function itself makes no network request; every copied synced row enters the
 * local queue through the installed Dexie hooks and is pushed by the sync
 * engine afterwards.
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

  const legacy = await openLegacyDb();
  try {
    const raw = await readLegacy(legacy);
    const plan = buildCopyPlan(raw);
    await reconcileSeededCurriculum(target, raw.subjects, raw.topics);

    const [userBooks, scheduleWeeks, topicProgress] = await Promise.all([
      filterUserBooks(target, plan.userBooks),
      filterScheduleWeeks(target, raw.scheduleWeeks),
      filterTopicProgress(target, plan.topicProgress),
    ]);
    const skipped =
      plan.userBooks.length - userBooks.length +
      raw.scheduleWeeks.length - scheduleWeeks.length +
      plan.topicProgress.length - topicProgress.length;
    const snapshot = raw;
    const total = totalRows({ ...plan, userBooks, topicProgress });

    let done = 0;
    const report = (count: number) => {
      done += count;
      onProgress?.(done, total);
    };
    onProgress?.(0, total);

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
        const writes: Array<[number, () => Promise<unknown>]> = [
          [snapshot.settings.length, () => target.settings.bulkPut(snapshot.settings)],
          [snapshot.subjects.length, () => target.subjects.bulkPut(snapshot.subjects)],
          [snapshot.topics.length, () => target.topics.bulkPut(snapshot.topics)],
          [snapshot.exams.length, () => target.exams.bulkPut(snapshot.exams)],
          [snapshot.examResults.length, () => target.examResults.bulkPut(snapshot.examResults)],
          [snapshot.notes.length, () => target.notes.bulkPut(snapshot.notes)],
          [plan.catalogBooks.length, () => target.catalogBooks.bulkPut(plan.catalogBooks)],
          [userBooks.length, () => target.userBooks.bulkPut(userBooks)],
          [snapshot.activityLogs.length, () => target.activityLogs.bulkPut(snapshot.activityLogs)],
          [scheduleWeeks.length, () => target.scheduleWeeks.bulkPut(scheduleWeeks)],
          [snapshot.scheduleRows.length, () => target.scheduleRows.bulkPut(snapshot.scheduleRows)],
          [snapshot.scheduleTasks.length, () => target.scheduleTasks.bulkPut(snapshot.scheduleTasks)],
          [topicProgress.length, () => target.topicProgress.bulkPut(topicProgress)],
          [snapshot.books.length, () => target.books.bulkPut(snapshot.books)],
          [snapshot.topicBooks.length, () => target.topicBooks.bulkPut(snapshot.topicBooks)],
          [snapshot.photos.length, () => target.photos.bulkPut(snapshot.photos)],
          [0, () => target.photoSearch.bulkPut(snapshot.photos.map(toPhotoSearch))],
          [snapshot.attachments.length, () => target.attachments.bulkPut(snapshot.attachments)],
          [
            snapshot.practiceSessions.length,
            () => target.practiceSessions.bulkPut(snapshot.practiceSessions),
          ],
          [
            snapshot.scheduleEntries.length,
            () => target.scheduleEntries.bulkPut(snapshot.scheduleEntries),
          ],
          [snapshot.scheduleFiles.length, () => target.scheduleFiles.bulkPut(snapshot.scheduleFiles)],
          [snapshot.scheduleTables.length, () => target.scheduleTables.bulkPut(snapshot.scheduleTables)],
        ];

        for (const [count, write] of writes) {
          await write();
          if (count > 0) {
            report(count);
          }
        }
      },
    );

    // Fill gaps in the curriculum without touching transferred rows: the seed
    // matches by `seedKey` and only adds what is missing.
    await seedCurriculum(CURRICULUM);
    // The Settings screen may already be mounted (manual transfer); reload the
    // transferred profile/exam values without a page refresh.
    notifySettingsUpdated();

    // The account was empty, so no server settings row can be overwritten.
    // Opening the settings gate and writing the explicit queue entry makes the
    // transferred profile/exam values part of the first push.
    setSettingsSyncEnabled(target, true);
    await setMeta(target, INITIAL_PULL_DONE_KEY, true);
    await enqueueChange(target, 'settings', userId);
    await setMeta(target, TRANSFER_DONE_KEY, true);
    await whenQueueIdle();

    return {
      total: total,
      skipped,
      settings: snapshot.settings.length,
      subjects: snapshot.subjects.length,
      topics: snapshot.topics.length,
      exams: snapshot.exams.length,
      examResults: snapshot.examResults.length,
      notes: snapshot.notes.length,
      catalogBooks: plan.catalogBooks.length,
      userBooks: userBooks.length,
      activityLogs: snapshot.activityLogs.length,
      scheduleWeeks: scheduleWeeks.length,
      scheduleRows: snapshot.scheduleRows.length,
      scheduleTasks: snapshot.scheduleTasks.length,
      topicProgress: topicProgress.length,
      books: snapshot.books.length,
      topicBooks: snapshot.topicBooks.length,
      photos: snapshot.photos.length,
      attachments: snapshot.attachments.length,
      practiceSessions: snapshot.practiceSessions.length,
      scheduleEntries: snapshot.scheduleEntries.length,
      scheduleFiles: snapshot.scheduleFiles.length,
      scheduleTables: snapshot.scheduleTables.length,
    };
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
