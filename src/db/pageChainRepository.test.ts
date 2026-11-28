import { beforeEach, expect, test } from 'vitest';
import { parseChainSlots } from '@/domain/pageChain';
import type {
  CatalogBook,
  ScheduleRow,
  ScheduleTask,
  ScheduleWeek,
} from '@/domain/types';
import { addCatalogBookToShelf, updateUserBook } from './bookRepositories';
import { db } from './db';
import {
  addUnscheduledChunk,
  createPageChain as createPageChainRaw,
  dissolvePageChain,
  findChainForTask,
  listWeekPageChains,
  reconcileWeekPageChains,
  recomputePageChain,
  skipUnscheduledChunk,
} from './pageChainRepository';
import {
  addTask,
  deleteRow,
  deleteTask,
  setTaskStatus,
} from './scheduleRepository';

const CREATED_AT = '2026-11-01T09:00:00.000Z';
const WEEK_START = '2026-12-07';
/** Before WEEK_START, so the default test chains never auto-miss. */
const PRE_WEEK_NOW = new Date(2026, 11, 1, 12);

/**
 * Keeps every test deterministic: `createPageChain` defaults to the wall clock
 * and would auto-miss the fixed WEEK_START once that Monday is in the past.
 * Tests that need another clock still pass it explicitly.
 */
function createPageChain(
  input: Parameters<typeof createPageChainRaw>[0],
  now: Parameters<typeof createPageChainRaw>[1] = PRE_WEEK_NOW,
): ReturnType<typeof createPageChainRaw> {
  return createPageChainRaw(input, now);
}

let weekId: string;
let rowId: string;
let userBookId: string;

beforeEach(async () => {
  const catalog: CatalogBook = {
    id: 'catalog-book-1',
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    totalPages: 400,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.catalogBooks.add(catalog);
  userBookId = (await addCatalogBookToShelf(catalog.id)).id;

  const week: ScheduleWeek = {
    id: 'week-1',
    weekStart: WEEK_START,
    note: '',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.scheduleWeeks.add(week);
  weekId = week.id;

  const row: ScheduleRow = {
    id: 'row-1',
    weekId,
    label: 'Matematik',
    order: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.scheduleRows.add(row);
  rowId = row.id;
});

async function addWeekRow(
  weekStart: string,
  suffix: string,
): Promise<{ weekId: string; rowId: string }> {
  const week: ScheduleWeek = {
    id: `week-${suffix}`,
    weekStart,
    note: '',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.scheduleWeeks.add(week);
  const row: ScheduleRow = {
    id: `row-${suffix}`,
    weekId: week.id,
    label: 'Matematik',
    order: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.scheduleRows.add(row);
  return { weekId: week.id, rowId: row.id };
}

/**
 * Persists a chain the way the first v7 build wrote it: no `chunkSizes` column
 * at all, an even chunk size and the last day absorbing the remainder. Reads
 * and recomputes must keep those ranges instead of backfilling a balanced
 * distribution.
 */
async function seedLegacyChain(input: {
  startPage: number;
  endPage: number;
  chunkCount: number;
}): Promise<void> {
  const { startPage, endPage, chunkCount } = input;
  const chunkSize = Math.floor((endPage - startPage + 1) / chunkCount);
  const tasks: ScheduleTask[] = Array.from(
    { length: chunkCount },
    (_, index) => {
      const fromPage = startPage + index * chunkSize;
      return {
        id: `legacy-task-${index + 1}`,
        weekId,
        rowId,
        dayIndex: index + 1,
        type: 'book',
        userBookId,
        fromPage,
        toPage: index === chunkCount - 1 ? endPage : fromPage + chunkSize - 1,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      };
    },
  );

  await db.scheduleTasks.bulkAdd(tasks);
  await db.schedulePageChains.add({
    id: 'legacy-chain',
    weekId,
    rowId,
    userBookId,
    startPage,
    endPage,
    chunkSize,
    chunkCount,
    slots: JSON.stringify(
      tasks.map((task, index) => ({
        taskId: task.id,
        slotIndex: index,
        chunkIndex: index,
        dayIndex: task.dayIndex,
      })),
    ),
    skippedChunks: '[]',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
}

test('yeni zincir varsayılan dengeli boyutlarla oluşur', async () => {
  const view = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 1,
    endPage: 20,
    days: [1, 2, 3, 4, 5, 6, 7],
  });

  expect(view.chain.chunkSizes).toBe('[3,3,3,3,3,3,2]');
  expect(view.tasks.map((task) => [task.fromPage, task.toPage])).toEqual([
    [1, 3],
    [4, 6],
    [7, 9],
    [10, 12],
    [13, 15],
    [16, 18],
    [19, 20],
  ]);
});

test('özel boyutlar görev aralıklarına ve görünüme yansır', async () => {
  const view = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 1,
    endPage: 20,
    days: [1, 2, 3, 4],
    chunkSizes: [2, 3, 5, 10],
  });

  expect(view.tasks.map((task) => [task.fromPage, task.toPage])).toEqual([
    [1, 2],
    [3, 5],
    [6, 10],
    [11, 20],
  ]);
});

test('chunkSizes alanı olmayan eski zincir legacy aralıkları korur', async () => {
  const fixedNow = PRE_WEEK_NOW;
  await seedLegacyChain({ startPage: 100, endPage: 150, chunkCount: 5 });

  const [view] = await listWeekPageChains(weekId);
  expect(view.chunks[0]).toMatchObject({ fromPage: 100, toPage: 109 });
  expect(view.chunks[4]).toMatchObject({ fromPage: 140, toPage: 150 });

  await recomputePageChain(view.chain.id, fixedNow);

  const [after] = await listWeekPageChains(weekId);
  expect(after.chunks[0]).toMatchObject({ fromPage: 100, toPage: 109 });
});

test('geçersiz özel boyutlar oluşturmayı reddeder ve satır yazmaz', async () => {
  await expect(
    createPageChain({
      weekId,
      rowId,
      userBookId,
      startPage: 1,
      endPage: 20,
      days: [1, 2, 3, 4, 5, 6, 7],
      chunkSizes: [1, 1],
    }),
  ).rejects.toThrow();

  expect(await db.schedulePageChains.where('weekId').equals(weekId).count()).toBe(0);
  expect(await db.scheduleTasks.where('weekId').equals(weekId).count()).toBe(0);
});

test('beş günlük zincir beş görev ve bir zincir satırı oluşturur', async () => {
  const view = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 150,
    days: [1, 2, 3, 4, 5],
  });

  expect(view.tasks).toHaveLength(5);
  expect(view.tasks.map((task) => [task.fromPage, task.toPage])).toEqual([
    [100, 110],
    [111, 120],
    [121, 130],
    [131, 140],
    [141, 150],
  ]);
  expect(view.slots).toHaveLength(5);
  expect(view.unscheduled).toEqual([]);
  expect(view.skippedChunks).toEqual(new Set());
  expect(view.chain.skippedChunks).toBe('[]');
  expect(await db.schedulePageChains.count()).toBe(1);
});

test('geçmiş günleri olan haftada oluşturulan zincir dönmeden kaydırılır', async () => {
  const past = await addWeekRow('2026-11-16', 'midweek');
  const now = new Date(2026, 10, 18, 12); // Çarşamba; Pzt/Sal geçmiş

  const view = await createPageChain(
    {
      weekId: past.weekId,
      rowId: past.rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3, 4, 5],
    },
    now,
  );

  const byDay = (day: number) =>
    view.tasks.find((task) => task.dayIndex === day)!;
  expect(byDay(1)).toMatchObject({ fromPage: 100, toPage: 110 });
  expect(byDay(2)).toMatchObject({ fromPage: 111, toPage: 120 });
  expect(byDay(3)).toMatchObject({ fromPage: 100, toPage: 110 });
  expect(byDay(4)).toMatchObject({ fromPage: 111, toPage: 120 });
  expect(byDay(5)).toMatchObject({ fromPage: 121, toPage: 130 });
  expect(view.unscheduled).toEqual([
    { chunkIndex: 3, fromPage: 131, toPage: 140 },
    { chunkIndex: 4, fromPage: 141, toPage: 150 },
  ]);
  // Auto-missed days stay "unmarked"; the derived status is not persisted.
  expect(byDay(1).missedAt).toBeUndefined();
  expect(byDay(2).missedAt).toBeUndefined();
});

test('dolu günü zincire eklemez', async () => {
  await addTask({ weekId, rowId, dayIndex: 2, type: 'free', title: 'Dolu' });
  await expect(
    createPageChain({
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3],
    }),
  ).rejects.toThrow('Bu güne zaten bir görev eklenmiş.');
});

test('kaçırılan gün sonraki günü kaydırır ve taşan aralığı bildirir', async () => {
  const view = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 150,
    days: [1, 2, 3, 4, 5],
  });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await db.scheduleTasks.update(second.id, {
    missedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Seed the week as a future week (ör. 2026-12-07) so no task is auto-missed;
  // alternatively pass a fixed `now` before the week.
  const recomputed = await recomputePageChain(view.chain.id, new Date(2026, 11, 1, 12));

  expect(recomputed?.tasks.find((task) => task.dayIndex === 3)).toMatchObject({
    fromPage: 111,
    toPage: 120,
  });
  expect(recomputed?.tasks.find((task) => task.dayIndex === 5)).toMatchObject({
    fromPage: 131,
    toPage: 140,
  });
  expect(recomputed?.unscheduled).toEqual([
    { chunkIndex: 4, fromPage: 141, toPage: 150 },
  ]);

  const storedChain = await db.schedulePageChains.get(view.chain.id);
  expect(
    parseChainSlots(storedChain!.slots)?.map((slot) => slot.chunkIndex),
  ).toEqual([0, 1, 1, 2, 3]);
  const third = recomputed?.tasks.find((task) => task.dayIndex === 3);
  expect((await db.scheduleTasks.get(third!.id))?.fromPage).toBe(111);
});

test('liste görünümü slotları, görevleri ve sonraki boş günü döndürür', async () => {
  const created = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 120,
    days: [1, 2, 3],
  });

  const chains = await listWeekPageChains(weekId);

  expect(chains).toHaveLength(1);
  expect(chains[0].chain.id).toBe(created.chain.id);
  expect(chains[0].slots).toHaveLength(3);
  expect(chains[0].tasks.map((task) => task.dayIndex)).toEqual([1, 2, 3]);
  expect(chains[0].chunks.map((chunk) => [chunk.fromPage, chunk.toPage])).toEqual([
    [100, 106],
    [107, 113],
    [114, 120],
  ]);
  expect(chains[0].unscheduled).toEqual([]);
  expect(chains[0].incomplete).toBe(false);
  expect(chains[0].nextEmptyDay).toBe(4);
});

test('silinmiş zincir görevi zinciri eksik gösterir ve görev listesinden çıkar', async () => {
  const view = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 120,
    days: [1, 2, 3],
  });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await db.scheduleTasks.update(second.id, {
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const [listed] = await listWeekPageChains(weekId);

  expect(listed.incomplete).toBe(true);
  expect(listed.tasks.map((task) => task.dayIndex)).toEqual([1, 3]);
});

test('kayıp zincir görevi zinciri eksik gösterir', async () => {
  const view = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 120,
    days: [1, 2, 3],
  });
  await db.scheduleTasks.delete(view.tasks[0].id);

  const [listed] = await listWeekPageChains(weekId);

  expect(listed.incomplete).toBe(true);
  expect(listed.tasks).toHaveLength(2);
});

test('sonraki boş gün dolu günleri atlar', async () => {
  await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 120,
    days: [1, 2, 3],
  });
  await addTask({ weekId, rowId, dayIndex: 4, type: 'free', title: 'Dolu' });

  const [listed] = await listWeekPageChains(weekId);

  expect(listed.nextEmptyDay).toBe(5);
});

test('görevden zincir bulunur ve zincir çözülünce kaybolur', async () => {
  const view = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 120,
    days: [1, 2],
  });

  expect(await findChainForTask(weekId, view.tasks[0].id)).toBe(view.chain.id);
  expect(await findChainForTask(weekId, 'başka-görev')).toBeNull();

  await dissolvePageChain(view.chain.id);

  expect(await findChainForTask(weekId, view.tasks[0].id)).toBeNull();
  expect(await listWeekPageChains(weekId)).toEqual([]);
  expect((await db.schedulePageChains.get(view.chain.id))?.deletedAt).toBeTruthy();
});

test('olmayan zincir yeniden hesaplanmaz', async () => {
  expect(await recomputePageChain('olmayan-zincir')).toBeNull();
});

test('durum değişikliği zinciri kaydırır', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3, 4, 5] });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;

  await setTaskStatus(second.id, 'missed', new Date(2026, 11, 1, 12));

  const tasks = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
  expect(tasks.find((task) => task.dayIndex === 3)).toMatchObject({ fromPage: 111, toPage: 120 });
  expect(tasks.find((task) => task.dayIndex === 5)).toMatchObject({ fromPage: 131, toPage: 140 });
});

test('yapıldı işaretlenen kaçırılmış gün zinciri eski sırasına döndürür, nötr tekrar kaydırır', async () => {
  const now = new Date(2026, 11, 7, 12); // Haftanın Pazartesi günü, gün içi
  const view = await createPageChain(
    {
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3, 4, 5],
    },
    now,
  );
  const first = view.tasks.find((task) => task.dayIndex === 1)!;
  const second = view.tasks.find((task) => task.dayIndex === 2)!;

  // Monday is done in the spec table; a pending Monday would take the free
  // chunk back on the final undo.
  await setTaskStatus(first.id, 'done', now);
  await setTaskStatus(second.id, 'missed', now);
  const shifted = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
  expect(shifted.find((task) => task.dayIndex === 3)).toMatchObject({
    fromPage: 111,
    toPage: 120,
  });

  await setTaskStatus(second.id, 'done', now);
  const restored = (
    await db.scheduleTasks.where('weekId').equals(weekId).toArray()
  ).sort((left, right) => left.dayIndex - right.dayIndex);
  expect(restored.map((task) => [task.fromPage, task.toPage])).toEqual([
    [100, 110],
    [111, 120],
    [121, 130],
    [131, 140],
    [141, 150],
  ]);

  await setTaskStatus(second.id, 'pending', now);
  const cleared = (
    await db.scheduleTasks.where('weekId').equals(weekId).toArray()
  ).sort((left, right) => left.dayIndex - right.dayIndex);
  // The pending Tuesday holds 111–120 again; later days stay in their
  // original slots and nothing is unscheduled.
  expect(cleared.map((task) => [task.fromPage, task.toPage])).toEqual([
    [100, 110],
    [111, 120],
    [121, 130],
    [131, 140],
    [141, 150],
  ]);
  expect(cleared.find((task) => task.dayIndex === 2)?.completedAt).toBeUndefined();
  expect(cleared.find((task) => task.dayIndex === 2)?.missedAt).toBeUndefined();
});

test('arka arkaya iki kaçırma bekleyen günleri aynı aralığa toplar', async () => {
  const now = new Date(2026, 11, 7, 12);
  const view = await createPageChain(
    {
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3, 4, 5],
    },
    now,
  );
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  const third = view.tasks.find((task) => task.dayIndex === 3)!;

  await setTaskStatus(second.id, 'missed', now);
  // The third day now holds the range shifted from the second day.
  await setTaskStatus(third.id, 'missed', now);

  const tasks = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
  expect(tasks.find((task) => task.dayIndex === 2)).toMatchObject({
    fromPage: 111,
    toPage: 120,
    missedAt: expect.any(String),
  });
  expect(tasks.find((task) => task.dayIndex === 3)).toMatchObject({
    fromPage: 111,
    toPage: 120,
    missedAt: expect.any(String),
  });
  expect(tasks.find((task) => task.dayIndex === 4)).toMatchObject({
    fromPage: 111,
    toPage: 120,
  });
  expect(tasks.find((task) => task.dayIndex === 5)).toMatchObject({
    fromPage: 121,
    toPage: 130,
  });

  const [listed] = await listWeekPageChains(weekId);
  expect(listed.unscheduled).toEqual([
    { chunkIndex: 3, fromPage: 131, toPage: 140 },
    { chunkIndex: 4, fromPage: 141, toPage: 150 },
  ]);
});

test('aynı haftadaki iki zincir birbirinin aralıklarını değiştirmez', async () => {
  const now = new Date(2026, 11, 7, 12);
  const row: ScheduleRow = {
    id: 'row-second-chain',
    weekId,
    label: 'Fizik',
    order: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.scheduleRows.add(row);

  const first = await createPageChain(
    {
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3, 4, 5],
    },
    now,
  );
  const second = await createPageChain(
    {
      weekId,
      rowId: row.id,
      userBookId,
      startPage: 200,
      endPage: 219,
      days: [1, 2],
    },
    now,
  );
  const firstSecond = first.tasks.find((task) => task.dayIndex === 2)!;

  await setTaskStatus(firstSecond.id, 'missed', now);

  const secondTasks = (
    await db.scheduleTasks.where('rowId').equals(row.id).toArray()
  ).sort((left, right) => left.dayIndex - right.dayIndex);
  expect(secondTasks.map((task) => [task.fromPage, task.toPage])).toEqual([
    [200, 209],
    [210, 219],
  ]);
  expect(
    (await listWeekPageChains(weekId))
      .map((item) => item.chain.id)
      .sort(),
  ).toEqual([first.chain.id, second.chain.id].sort());
});

test('geçmiş gündeki normal görev kaymaz ve otomatik kaçırma saklanmaz', async () => {
  const past = await addWeekRow('2026-11-16', 'normal-past');
  const normal = await addTask({
    weekId: past.weekId,
    rowId: past.rowId,
    dayIndex: 1,
    type: 'book',
    userBookId,
    fromPage: 10,
    toPage: 20,
  });

  await reconcileWeekPageChains(past.weekId, new Date(2026, 10, 18, 12));

  const stored = await db.scheduleTasks.get(normal.id);
  expect(stored).toMatchObject({
    dayIndex: 1,
    fromPage: 10,
    toPage: 20,
  });
  expect(stored?.missedAt).toBeUndefined();
});

test('boş gün kalmayınca planlanmamış aralık eklenemez', async () => {
  const now = new Date(2026, 11, 7, 12);
  const view = await createPageChain(
    {
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3, 4, 5],
    },
    now,
  );
  await addTask({ weekId, rowId, dayIndex: 6, type: 'free', title: 'Cumartesi' });
  await addTask({ weekId, rowId, dayIndex: 7, type: 'free', title: 'Pazar' });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await setTaskStatus(second.id, 'missed', now);

  await expect(addUnscheduledChunk(view.chain.id, now)).rejects.toThrow(
    'Bu haftada boş gün kalmadı.',
  );
});

test('zincir görevi ve zincir satırı silinince zincir çözülür', async () => {
  const first = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 120,
    days: [1, 2],
  });
  await deleteTask(first.tasks[0].id);
  expect(
    (await db.schedulePageChains.get(first.chain.id))?.deletedAt,
  ).toBeTruthy();

  const row: ScheduleRow = {
    id: 'row-delete-chain',
    weekId,
    label: 'Fizik',
    order: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.scheduleRows.add(row);
  const second = await createPageChain({
    weekId,
    rowId: row.id,
    userBookId,
    startPage: 200,
    endPage: 220,
    days: [1, 2],
  });

  await deleteRow(row.id);

  expect(
    (await db.schedulePageChains.get(second.chain.id))?.deletedAt,
  ).toBeTruthy();
});

test('silinmiş satıra planlanmamış aralık eklenemez', async () => {
  const now = new Date(2026, 11, 7, 12);
  const view = await createPageChain(
    {
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3, 4, 5],
    },
    now,
  );
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await setTaskStatus(second.id, 'missed', now);
  await db.scheduleRows.update(rowId, {
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await expect(addUnscheduledChunk(view.chain.id, now)).rejects.toThrow(
    'Satır bulunamadı',
  );
});

test('arşivlenmiş kitap yeni zincire eklenemez', async () => {
  await updateUserBook(userBookId, { status: 'archived' });

  await expect(
    createPageChain({
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 120,
      days: [1, 2],
    }),
  ).rejects.toThrow('Arşivlenmiş kitap yeni göreve eklenemez.');
  expect(await db.schedulePageChains.count()).toBe(0);
  expect(await db.scheduleTasks.count()).toBe(0);
});

test('sonraki boş güne ekle zincire yeni slot ekler', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3, 4, 5] });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await setTaskStatus(second.id, 'missed', new Date(2026, 11, 1, 12));

  await addUnscheduledChunk(view.chain.id, new Date(2026, 11, 1, 12));

  const chains = await listWeekPageChains(weekId);
  expect(chains[0].slots).toHaveLength(6);
  expect(chains[0].tasks.find((task) => task.dayIndex === 6)).toMatchObject({
    fromPage: 141,
    toPage: 150,
  });
  expect(chains[0].unscheduled).toEqual([]);
});

test('eksik zincire yeni gün eklenmez', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3] });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await db.scheduleTasks.update(second.id, {
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await expect(
    addUnscheduledChunk(view.chain.id, new Date(2026, 11, 1, 12)),
  ).rejects.toThrow('Zincirde eksik görev var; yeni gün eklenemez.');

  const chains = await listWeekPageChains(weekId);
  expect(chains[0].slots).toHaveLength(3);
  expect(await db.scheduleTasks.where('weekId').equals(weekId).count()).toBe(3);
});

test('eksik görev zinciri çözmez, tombstone çözer', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3] });
  const first = view.tasks[0];
  await db.scheduleTasks.delete(first.id);

  await reconcileWeekPageChains(weekId);
  expect((await db.schedulePageChains.get(view.chain.id))?.deletedAt).toBeUndefined();

  const restored = { ...first, id: first.id };
  await db.scheduleTasks.put(restored);
  await db.scheduleTasks.update(first.id, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await reconcileWeekPageChains(weekId);
  expect((await db.schedulePageChains.get(view.chain.id))?.deletedAt).toBeTruthy();
});

test('kimlik uyuşmazlığı zinciri çözer', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3] });
  const first = view.tasks[0];
  await db.scheduleTasks.update(first.id, { dayIndex: 4, updatedAt: new Date().toISOString() });

  await reconcileWeekPageChains(weekId);
  expect((await db.schedulePageChains.get(view.chain.id))?.deletedAt).toBeTruthy();
});

test('geçmiş gün otomatik yapılmadı sayılır ve kaydırır', async () => {
  const pastWeek: ScheduleWeek = {
    id: 'week-past',
    weekStart: '2026-11-16',
    note: '',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.scheduleWeeks.add(pastWeek);
  const pastRow: ScheduleRow = {
    id: 'row-past',
    weekId: pastWeek.id,
    label: 'Matematik',
    order: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.scheduleRows.add(pastRow);

  const view = await createPageChain({ weekId: pastWeek.id, rowId: pastRow.id, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3, 4, 5] });
  const now = new Date(2026, 10, 17, 12); // Salı; Pazartesi geçmiş
  await reconcileWeekPageChains(pastWeek.id, now);

  const tasks = await db.scheduleTasks.where('weekId').equals(pastWeek.id).toArray();
  expect(tasks.find((task) => task.dayIndex === 1)).toMatchObject({ fromPage: 100, toPage: 110 });
  expect(tasks.find((task) => task.dayIndex === 1)?.missedAt).toBeUndefined();
  expect(tasks.find((task) => task.dayIndex === 2)).toMatchObject({ fromPage: 100, toPage: 110 });
  expect(tasks.find((task) => task.dayIndex === 5)).toMatchObject({ fromPage: 131, toPage: 140 });
  expect(view.chain).toBeTruthy();
});

test('bozuk zincir satırı listeyi patlatmaz', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3] });
  await db.schedulePageChains.update(view.chain.id, { chunkCount: 99 });

  await expect(listWeekPageChains(weekId)).resolves.toEqual([]);
});

test('tombstone slot recompute etmez', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3] });
  const first = view.tasks[0];
  await db.scheduleTasks.update(first.id, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  await expect(recomputePageChain(view.chain.id)).resolves.toBeNull();
});

test('planlanmamış aralık silinince yok sayılır, görevler ve zincir kalır', async () => {
  const now = new Date(2026, 11, 7, 12);
  const view = await createPageChain(
    {
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3, 4, 5],
    },
    now,
  );
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  const third = view.tasks.find((task) => task.dayIndex === 3)!;
  await setTaskStatus(second.id, 'missed', now);
  await setTaskStatus(third.id, 'missed', now);

  let [listed] = await listWeekPageChains(weekId);
  expect(listed.unscheduled.map((chunk) => chunk.chunkIndex)).toEqual([3, 4]);

  await skipUnscheduledChunk(view.chain.id, now);

  [listed] = await listWeekPageChains(weekId);
  expect(listed.unscheduled.map((chunk) => chunk.chunkIndex)).toEqual([4]);
  expect(listed.skippedChunks).toEqual(new Set([3]));
  expect(listed.tasks).toHaveLength(5);
  expect(
    listed.tasks.some((task) => task.fromPage === 130 && task.toPage === 139),
  ).toBe(false);
  expect((await db.schedulePageChains.get(view.chain.id))?.deletedAt).toBeUndefined();
  let stored = await db.schedulePageChains.get(view.chain.id);
  expect(JSON.parse(stored!.skippedChunks)).toEqual([3]);

  await skipUnscheduledChunk(view.chain.id, now);

  [listed] = await listWeekPageChains(weekId);
  expect(listed.unscheduled).toEqual([]);
  expect(listed.skippedChunks).toEqual(new Set([3, 4]));
  stored = await db.schedulePageChains.get(view.chain.id);
  expect(JSON.parse(stored!.skippedChunks)).toEqual([3, 4]);
  expect(await db.scheduleTasks.where('weekId').equals(weekId).count()).toBe(5);
});

test('yok sayılan aralık sonraki boş güne eklenmez', async () => {
  const now = new Date(2026, 11, 7, 12);
  const view = await createPageChain(
    {
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3, 4, 5],
    },
    now,
  );
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  const third = view.tasks.find((task) => task.dayIndex === 3)!;
  await setTaskStatus(second.id, 'missed', now);
  await setTaskStatus(third.id, 'missed', now);
  await skipUnscheduledChunk(view.chain.id, now);

  await addUnscheduledChunk(view.chain.id, now);

  const [listed] = await listWeekPageChains(weekId);
  expect(listed.slots).toHaveLength(6);
  expect(listed.tasks.find((task) => task.dayIndex === 6)).toMatchObject({
    fromPage: 141,
    toPage: 150,
  });
  expect(
    listed.tasks.some((task) => task.fromPage === 131 && task.toPage === 140),
  ).toBe(false);
  expect(listed.unscheduled).toEqual([]);
});

test('eksik zincirde planlanmamış aralık silinmez', async () => {
  const now = new Date(2026, 11, 7, 12);
  const view = await createPageChain(
    {
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3],
    },
    now,
  );
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await setTaskStatus(second.id, 'missed', now);
  const third = view.tasks.find((task) => task.dayIndex === 3)!;
  await db.scheduleTasks.update(third.id, {
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await skipUnscheduledChunk(view.chain.id, now);

  const stored = await db.schedulePageChains.get(view.chain.id);
  expect(stored?.skippedChunks).toBe('[]');
});
