import type { KoclukDB } from '../db';
import type { Note } from '@/domain/types';
import { deterministicId } from '@/lib/deterministicId';
import { LOCAL_SCOPE, TOPIC_PROGRESS_NAMESPACE } from '@/lib/namespaces';
import { apiRowId, type SyncedTable } from './constants';
import {
  applyServerRow,
  enqueueChange,
  nextTimestamp,
  syncUserId,
  withApplyingRemote,
} from './queue';

/**
 * Local natural-key conflict resolution (design §6.5).
 *
 * The server may already own a row with the same natural key under a different
 * id. Push returns that canonical row; `rekeyRow` replaces the local id and
 * repairs every reference in one Dexie transaction, so a half-rekeyed account
 * cannot exist. The server row itself is applied with hooks disabled; changed
 * references are queued explicitly because the server has not seen them yet.
 *
 * Device-only tables (photos, attachments, the legacy topic/book join) follow
 * the id as well: they never sync, but leaving them behind would detach the
 * user's photos from the rekeyed topic.
 */

interface QueuedReference {
  table: SyncedTable;
  rowId: string;
  op: 'upsert' | 'delete';
}

function rekeyStores(db: KoclukDB) {
  return [
    db.subjects,
    db.topics,
    db.exams,
    db.examResults,
    db.notes,
    db.catalogBooks,
    db.userBooks,
    db.activityLogs,
    db.scheduleWeeks,
    db.scheduleRows,
    db.scheduleTasks,
    db.topicProgress,
    db.settings,
    db.photos,
    db.photoSearch,
    db.attachments,
    db.topicBooks,
  ];
}

function topicProgressId(topicId: string): string {
  return deterministicId(TOPIC_PROGRESS_NAMESPACE, `${LOCAL_SCOPE}:${topicId}`);
}

function timestampValue(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** True when `left` is strictly newer; unparseable values lose. */
function isNewer(left: unknown, right: unknown): boolean {
  const leftAt = timestampValue(left);
  const rightAt = timestampValue(right);
  if (leftAt === null) {
    return false;
  }
  if (rightAt === null) {
    return true;
  }
  return leftAt > rightAt;
}

/**
 * A reference rewrite must always be newer than the row it rewrites, even if
 * the device clock lags behind a server timestamp already on the row.
 */
function bumpedTimestamp(previous: unknown): string {
  const now = nextTimestamp();
  const previousAt = timestampValue(previous);
  if (previousAt === null) {
    return now;
  }
  const nowAt = timestampValue(now);
  if (nowAt !== null && nowAt > previousAt) {
    return now;
  }
  return new Date(previousAt + 1).toISOString();
}

async function rekeySubjectReferences(
  db: KoclukDB,
  oldId: string,
  newId: string,
  writes: QueuedReference[],
): Promise<void> {
  for (const topic of await db.topics.where('subjectId').equals(oldId).toArray()) {
    await db.topics.put({
      ...topic,
      subjectId: newId,
      updatedAt: bumpedTimestamp(topic.updatedAt),
    });
    writes.push({ table: 'topics', rowId: topic.id, op: 'upsert' });
  }

  for (const result of await db.examResults.where('subjectId').equals(oldId).toArray()) {
    await db.examResults.put({
      ...result,
      subjectId: newId,
      updatedAt: bumpedTimestamp(result.updatedAt),
    });
    writes.push({ table: 'examResults', rowId: result.id, op: 'upsert' });
  }

  const scheduleRows = await db.scheduleRows.toArray();
  for (const row of scheduleRows.filter((entry) => entry.subjectId === oldId)) {
    await db.scheduleRows.put({
      ...row,
      subjectId: newId,
      updatedAt: bumpedTimestamp(row.updatedAt),
    });
    writes.push({ table: 'scheduleRows', rowId: row.id, op: 'upsert' });
  }

  const hidden = await db.settings.get('hiddenSubjects');
  if (Array.isArray(hidden?.value) && hidden.value.includes(oldId)) {
    const next = Array.from(new Set(hidden.value.map((id) => (id === oldId ? newId : id))));
    await db.settings.put({ key: 'hiddenSubjects', value: next });
    const userId = syncUserId(db);
    if (userId !== null) {
      writes.push({ table: 'settings', rowId: userId, op: 'upsert' });
    }
  }

  await db.photos.where('subjectId').equals(oldId).modify({ subjectId: newId });
  await db.photoSearch.where('subjectId').equals(oldId).modify({ subjectId: newId });
}

async function rekeyTopicReferences(
  db: KoclukDB,
  oldId: string,
  newId: string,
  writes: QueuedReference[],
): Promise<void> {
  // notes is keyed by topicId, so moving a topic means moving its note and
  // tombstoning the server's old note key.
  const oldNote = await db.notes.get(oldId);
  if (oldNote) {
    const existing = await db.notes.get(newId);
    await db.notes.delete(oldId);
    if (!existing || isNewer(oldNote.updatedAt, existing.updatedAt)) {
      const moved: Note = {
        ...oldNote,
        topicId: newId,
        updatedAt: bumpedTimestamp(oldNote.updatedAt),
      };
      await db.notes.put(moved);
    }
    writes.push({ table: 'notes', rowId: newId, op: 'upsert' });
    writes.push({ table: 'notes', rowId: oldId, op: 'delete' });
  }

  // One progress row per topic, keyed by a deterministic id derived from the
  // topic id; the id has to move with the topic or lookups break silently.
  const targetProgressId = topicProgressId(newId);
  for (const progress of await db.topicProgress.where('topicId').equals(oldId).toArray()) {
    await db.topicProgress.delete(progress.id);
    const existing = await db.topicProgress.get(targetProgressId);
    if (!existing || isNewer(progress.updatedAt, existing.updatedAt)) {
      await db.topicProgress.put({
        ...progress,
        id: targetProgressId,
        topicId: newId,
        updatedAt: bumpedTimestamp(progress.updatedAt),
      });
      writes.push({ table: 'topicProgress', rowId: targetProgressId, op: 'upsert' });
    }
  }

  for (const log of await db.activityLogs.where('topicId').equals(oldId).toArray()) {
    await db.activityLogs.put({ ...log, topicId: newId });
    writes.push({ table: 'activityLogs', rowId: log.id, op: 'upsert' });
  }

  const tasks = await db.scheduleTasks.toArray();
  for (const task of tasks.filter((entry) => entry.topicId === oldId)) {
    await db.scheduleTasks.put({
      ...task,
      topicId: newId,
      updatedAt: bumpedTimestamp(task.updatedAt),
    });
    writes.push({ table: 'scheduleTasks', rowId: task.id, op: 'upsert' });
  }

  await db.photos.where('topicId').equals(oldId).modify({ topicId: newId });
  await db.photoSearch.where('topicId').equals(oldId).modify({ topicId: newId });
  await db.attachments.where('topicId').equals(oldId).modify({ topicId: newId });
  await db.topicBooks.where('topicId').equals(oldId).modify({ topicId: newId });
}

async function rekeyUserBookReferences(
  db: KoclukDB,
  oldId: string,
  newId: string,
  writes: QueuedReference[],
): Promise<void> {
  for (const log of await db.activityLogs.where('userBookId').equals(oldId).toArray()) {
    await db.activityLogs.put({ ...log, userBookId: newId });
    writes.push({ table: 'activityLogs', rowId: log.id, op: 'upsert' });
  }

  const tasks = await db.scheduleTasks.toArray();
  for (const task of tasks.filter((entry) => entry.userBookId === oldId)) {
    await db.scheduleTasks.put({
      ...task,
      userBookId: newId,
      updatedAt: bumpedTimestamp(task.updatedAt),
    });
    writes.push({ table: 'scheduleTasks', rowId: task.id, op: 'upsert' });
  }
}

async function rekeyScheduleWeekReferences(
  db: KoclukDB,
  oldId: string,
  newId: string,
  writes: QueuedReference[],
): Promise<void> {
  for (const row of await db.scheduleRows.where('weekId').equals(oldId).toArray()) {
    await db.scheduleRows.put({
      ...row,
      weekId: newId,
      updatedAt: bumpedTimestamp(row.updatedAt),
    });
    writes.push({ table: 'scheduleRows', rowId: row.id, op: 'upsert' });
  }

  for (const task of await db.scheduleTasks.where('weekId').equals(oldId).toArray()) {
    await db.scheduleTasks.put({
      ...task,
      weekId: newId,
      updatedAt: bumpedTimestamp(task.updatedAt),
    });
    writes.push({ table: 'scheduleTasks', rowId: task.id, op: 'upsert' });
  }
}

/**
 * Replaces `oldId` with the canonical row's identity and repairs references.
 * When the identity is unchanged this only applies the canonical row.
 * Throws (and lets push mark the row dead) if the canonical row has no id.
 */
export async function rekeyRow(
  db: KoclukDB,
  table: SyncedTable,
  oldId: string,
  canonicalRow: Record<string, unknown>,
): Promise<void> {
  const newId = apiRowId(table, canonicalRow);

  if (newId === null) {
    throw new Error('Kanonik satır kimliği bulunamadı');
  }

  if (table === 'settings' || newId === oldId) {
    await applyServerRow(db, table, canonicalRow);
    return;
  }

  await withApplyingRemote(async () => {
    const writes: QueuedReference[] = [];

    await db.transaction('rw', rekeyStores(db), async () => {
      await db.table(table).delete(oldId);
      await applyServerRow(db, table, canonicalRow);

      switch (table) {
        case 'subjects':
          await rekeySubjectReferences(db, oldId, newId, writes);
          break;
        case 'topics':
          await rekeyTopicReferences(db, oldId, newId, writes);
          break;
        case 'userBooks':
          await rekeyUserBookReferences(db, oldId, newId, writes);
          break;
        case 'scheduleWeeks':
          await rekeyScheduleWeekReferences(db, oldId, newId, writes);
          break;
        default:
          break;
      }
    });

    for (const write of writes) {
      await enqueueChange(db, write.table, write.rowId, write.op);
    }
  });
}
