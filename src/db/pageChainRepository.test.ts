import { beforeEach, expect, test } from 'vitest';
import { parseChainSlots } from '@/domain/pageChain';
import type { CatalogBook, ScheduleRow, ScheduleWeek } from '@/domain/types';
import { addCatalogBookToShelf } from './bookRepositories';
import { db } from './db';
import {
  addUnscheduledChunk,
  createPageChain,
  dissolvePageChain,
  findChainForTask,
  listWeekPageChains,
  reconcileWeekPageChains,
  recomputePageChain,
} from './pageChainRepository';
import { addTask, setTaskStatus } from './scheduleRepository';

const CREATED_AT = '2026-11-01T09:00:00.000Z';
const WEEK_START = '2026-12-07';

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
    [100, 109],
    [110, 119],
    [120, 129],
    [130, 139],
    [140, 150],
  ]);
  expect(view.slots).toHaveLength(5);
  expect(view.unscheduled).toEqual([]);
  expect(await db.schedulePageChains.count()).toBe(1);
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
    fromPage: 110,
    toPage: 119,
  });
  expect(recomputed?.tasks.find((task) => task.dayIndex === 5)).toMatchObject({
    fromPage: 130,
    toPage: 139,
  });
  expect(recomputed?.unscheduled).toEqual([
    { chunkIndex: 4, fromPage: 140, toPage: 150 },
  ]);

  const storedChain = await db.schedulePageChains.get(view.chain.id);
  expect(
    parseChainSlots(storedChain!.slots)?.map((slot) => slot.chunkIndex),
  ).toEqual([0, 1, 1, 2, 3]);
  const third = recomputed?.tasks.find((task) => task.dayIndex === 3);
  expect((await db.scheduleTasks.get(third!.id))?.fromPage).toBe(110);
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
  expect(tasks.find((task) => task.dayIndex === 3)).toMatchObject({ fromPage: 110, toPage: 119 });
  expect(tasks.find((task) => task.dayIndex === 5)).toMatchObject({ fromPage: 130, toPage: 139 });
});

test('sonraki boş güne ekle zincire yeni slot ekler', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3, 4, 5] });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await setTaskStatus(second.id, 'missed', new Date(2026, 11, 1, 12));

  await addUnscheduledChunk(view.chain.id, new Date(2026, 11, 1, 12));

  const chains = await listWeekPageChains(weekId);
  expect(chains[0].slots).toHaveLength(6);
  expect(chains[0].tasks.find((task) => task.dayIndex === 6)).toMatchObject({
    fromPage: 140,
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
  expect(tasks.find((task) => task.dayIndex === 1)).toMatchObject({ fromPage: 100, toPage: 109 });
  expect(tasks.find((task) => task.dayIndex === 1)?.missedAt).toBeUndefined();
  expect(tasks.find((task) => task.dayIndex === 2)).toMatchObject({ fromPage: 100, toPage: 109 });
  expect(tasks.find((task) => task.dayIndex === 5)).toMatchObject({ fromPage: 130, toPage: 139 });
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
