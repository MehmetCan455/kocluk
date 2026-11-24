import type { ActivityLog, TopicProgress } from '@/domain/types';
import { deterministicId } from '@/lib/deterministicId';
import { LOCAL_SCOPE, TOPIC_PROGRESS_NAMESPACE } from '@/lib/namespaces';
import { db } from './db';
import { isActiveRow } from './softDelete';

/** One row per topic, keyed by a deterministic id so writes stay idempotent. */
function topicProgressId(topicId: string): string {
  return deterministicId(TOPIC_PROGRESS_NAMESPACE, `${LOCAL_SCOPE}:${topicId}`);
}

/**
 * Upserts the explicit completion flag. Turning a topic back to "not done"
 * removes `doneAt` so the row never claims a completion it no longer has.
 * Writing the row also clears a previous tombstone, so checking a deleted
 * topic's box again revives it. Tombstones are only written by the topic
 * deletion cascade.
 */
export async function setTopicDone(topicId: string, done: boolean): Promise<TopicProgress> {
  return db.transaction('rw', db.topicProgress, async () => {
    const now = new Date().toISOString();
    const row: TopicProgress = {
      id: topicProgressId(topicId),
      topicId,
      done,
      updatedAt: now,
    };
    if (done) {
      row.doneAt = now;
    }
    await db.topicProgress.put(row);
    return row;
  });
}

export async function getTopicDone(topicId: string): Promise<boolean> {
  const row = await db.topicProgress.get(topicProgressId(topicId));
  return Boolean(row && isActiveRow(row) && row.done);
}

/**
 * `done` is a boolean index and cannot be queried with `where`, so callers read
 * every row and filter tombstones in memory.
 */
export async function listAllTopicProgress(): Promise<TopicProgress[]> {
  const rows = await db.topicProgress.toArray();
  return rows.filter(isActiveRow);
}

/** Active review history for one topic, newest first. */
export async function listTopicReviews(topicId: string): Promise<ActivityLog[]> {
  const logs = await db.activityLogs.where('topicId').equals(topicId).toArray();
  return activeReviews(logs);
}

/** Active review history across every topic, newest first. */
export async function listAllTopicReviews(): Promise<ActivityLog[]> {
  const logs = await db.activityLogs.toArray();
  return activeReviews(logs);
}

function activeReviews(logs: ActivityLog[]): ActivityLog[] {
  return logs
    .filter((log) => log.type === 'topic_review' && isActiveRow(log))
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
    );
}
