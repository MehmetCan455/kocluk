import { beforeEach, expect, test } from 'vitest';
import type { ScheduleTask } from '@/domain/types';
import { db } from './db';
import {
  repairScheduleDayIndexes,
  SCHEDULE_DAY_INDEX_VERSION,
  SCHEDULE_DAY_INDEX_VERSION_KEY,
} from './scheduleMigration';

function task(id: string, dayIndex: number): ScheduleTask {
  return {
    id,
    weekId: 'week-1',
    rowId: 'row-1',
    dayIndex,
    type: 'free',
    title: id,
    createdAt: '2026-11-16T10:00:00.000Z',
    updatedAt: '2026-11-16T10:00:00.000Z',
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

test('sıfır tabanlı görevleri bir kez bir tabanlıya kaydırır', async () => {
  await db.scheduleTasks.bulkAdd([task('monday', 0), task('sunday', 6), task('sunday-iso', 7)]);

  await repairScheduleDayIndexes();

  const stored = await db.scheduleTasks.toArray();
  expect(
    stored
      .map((row) => [row.id, row.dayIndex] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
  ).toEqual([
    ['monday', 1],
    ['sunday', 7],
    ['sunday-iso', 7],
  ]);
  expect((await db.settings.get(SCHEDULE_DAY_INDEX_VERSION_KEY))?.value).toBe(
    SCHEDULE_DAY_INDEX_VERSION,
  );

  // A task created after the repair must never move.
  await db.scheduleTasks.add(task('after-repair', 1));
  await repairScheduleDayIndexes();
  expect((await db.scheduleTasks.get('after-repair'))?.dayIndex).toBe(1);
});

test('işaret yokken görev yoksa da işareti yazar', async () => {
  await repairScheduleDayIndexes();
  expect((await db.settings.get(SCHEDULE_DAY_INDEX_VERSION_KEY))?.value).toBe(
    SCHEDULE_DAY_INDEX_VERSION,
  );

  // Written by a stale tab after the repair; the marker deliberately wins.
  await db.scheduleTasks.add(task('stale-zero', 0));
  await repairScheduleDayIndexes();
  expect((await db.scheduleTasks.get('stale-zero'))?.dayIndex).toBe(0);
});
