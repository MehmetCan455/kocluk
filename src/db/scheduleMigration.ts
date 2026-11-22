import { db } from './db';

/**
 * Marks the weekly plan as using ISO day indexes (Monday = 1 … Sunday = 7).
 * Older preview builds stored the zero-based index of the visible day column,
 * so installed databases need one repair pass.
 */
export const SCHEDULE_DAY_INDEX_VERSION_KEY = 'scheduleDayIndexVersion';
export const SCHEDULE_DAY_INDEX_VERSION = 1;

/**
 * Shifts pre-fix tasks from 0–6 to 1–7 exactly once. The marker is written even
 * when there are no tasks yet: later tasks are created with the fixed UI and
 * must never be shifted. A task that already carries 7 is left alone so a
 * hand-created Sunday row cannot become the invalid index 8.
 */
export async function repairScheduleDayIndexes(): Promise<void> {
  await db.transaction('rw', db.scheduleTasks, db.settings, async () => {
    const marker = await db.settings.get(SCHEDULE_DAY_INDEX_VERSION_KEY);
    if (
      typeof marker?.value === 'number' &&
      marker.value >= SCHEDULE_DAY_INDEX_VERSION
    ) {
      return;
    }

    const tasks = await db.scheduleTasks.toArray();
    const shifted = tasks
      .filter((task) => task.dayIndex >= 0 && task.dayIndex <= 6)
      .map((task) => ({ ...task, dayIndex: task.dayIndex + 1 }));
    if (shifted.length > 0) {
      await db.scheduleTasks.bulkPut(shifted);
    }

    await db.settings.put({
      key: SCHEDULE_DAY_INDEX_VERSION_KEY,
      value: SCHEDULE_DAY_INDEX_VERSION,
    });
  });
}
