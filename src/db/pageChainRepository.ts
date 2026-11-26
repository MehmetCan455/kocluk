import {
  assignChainChunks,
  pageChunkSize,
  parseChainSlots,
  serializeChainSlots,
  splitPageRange,
  type PageChainChunk,
  type PageChainSlot,
} from '@/domain/pageChain';
import { scheduleTaskStatus, type ScheduleTaskStatus } from '@/domain/schedule';
import type { SchedulePageChain, ScheduleTask } from '@/domain/types';
import { newId } from '@/lib/id';
import { db } from './db';
import { validateTaskFields } from './scheduleTaskFields';

export interface CreatePageChainInput {
  weekId: string;
  rowId: string;
  userBookId: string;
  startPage: number;
  endPage: number;
  days: number[];
}

export interface PageChainView {
  chain: SchedulePageChain;
  slots: PageChainSlot[];
  tasks: ScheduleTask[];
  chunks: PageChainChunk[];
  unscheduled: PageChainChunk[];
  incomplete: boolean;
  nextEmptyDay: number | null;
}

/** A chain spreads one book range over at least two and at most seven days. */
const PAGE_CHAIN_MIN_DAYS = 2;
const PAGE_CHAIN_MAX_DAYS = 7;

/** ISO weekdays, Monday = 1 … Sunday = 7. */
function normalizeDays(days: number[]): number[] {
  if (
    !Array.isArray(days) ||
    days.length < PAGE_CHAIN_MIN_DAYS ||
    days.length > PAGE_CHAIN_MAX_DAYS
  ) {
    throw new Error('Gün sayısı 2 ile 7 arasında olmalı.');
  }

  const sorted = [...days].sort((left, right) => left - right);
  for (let index = 0; index < sorted.length; index += 1) {
    const day = sorted[index];
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw new Error('Gün 1 ile 7 arasında olmalı.');
    }
    if (index > 0 && sorted[index - 1] === day) {
      throw new Error('Günler tekrar edemez.');
    }
  }
  return sorted;
}

function sortTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  return tasks.sort(
    (left, right) =>
      left.dayIndex - right.dayIndex ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function slotTaskIds(slots: PageChainSlot[]): string[] {
  return slots.map((slot) => slot.taskId);
}

async function taskMapFor(ids: string[]): Promise<Map<string, ScheduleTask>> {
  const rows = await db.scheduleTasks.bulkGet([...new Set(ids)]);
  const tasks = new Map<string, ScheduleTask>();
  for (const row of rows) {
    if (row) {
      tasks.set(row.id, row);
    }
  }
  return tasks;
}

function chunksFor(chain: SchedulePageChain): PageChainChunk[] {
  return splitPageRange(chain.startPage, chain.endPage, chain.chunkCount);
}

/** A chunk with no slot holding it is unscheduled; a missed slot keeps its chunk. */
function unscheduledChunks(
  chunks: PageChainChunk[],
  slots: PageChainSlot[],
): PageChainChunk[] {
  const assigned = new Set(slots.map((slot) => slot.chunkIndex));
  return chunks.filter((chunk) => !assigned.has(chunk.chunkIndex));
}

/** The first free day after the last slot, within the chain's own plan row. */
async function nextEmptyDay(
  chain: SchedulePageChain,
  slots: PageChainSlot[],
): Promise<number | null> {
  const lastDay = slots.reduce((max, slot) => Math.max(max, slot.dayIndex), 0);
  if (lastDay >= 7) {
    return null;
  }

  const rowTasks = await db.scheduleTasks
    .where('rowId')
    .equals(chain.rowId)
    .toArray();
  const occupied = new Set(
    rowTasks
      .filter((task) => !task.deletedAt)
      .map((task) => task.dayIndex),
  );
  for (let day = lastDay + 1; day <= 7; day += 1) {
    if (!occupied.has(day)) {
      return day;
    }
  }
  return null;
}

async function buildView(
  chain: SchedulePageChain,
  slots: PageChainSlot[],
  tasks: Map<string, ScheduleTask>,
  chunks: PageChainChunk[],
  unscheduled: PageChainChunk[],
): Promise<PageChainView> {
  const activeTasks = slots.flatMap((slot) => {
    const task = tasks.get(slot.taskId);
    return task && !task.deletedAt ? [task] : [];
  });
  const incomplete = slots.some((slot) => {
    const task = tasks.get(slot.taskId);
    return !task || Boolean(task.deletedAt);
  });

  return {
    chain,
    slots,
    tasks: sortTasks(activeTasks),
    chunks,
    unscheduled,
    incomplete,
    nextEmptyDay: await nextEmptyDay(chain, slots),
  };
}

export async function createPageChain(
  input: CreatePageChainInput,
): Promise<PageChainView> {
  const days = normalizeDays(input.days);

  return db.transaction(
    'rw',
    [
      db.scheduleTasks,
      db.schedulePageChains,
      db.scheduleRows,
      db.scheduleWeeks,
      db.userBooks,
      db.catalogBooks,
      db.topics,
    ],
    async () => {
      const week = await db.scheduleWeeks.get(input.weekId);
      if (!week || week.deletedAt) {
        throw new Error('Hafta bulunamadı');
      }
      const row = await db.scheduleRows.get(input.rowId);
      if (!row || row.deletedAt || row.weekId !== week.id) {
        throw new Error('Satır bulunamadı');
      }

      const occupied = new Set(
        (
          await db.scheduleTasks.where('weekId').equals(week.id).toArray()
        )
          .filter((task) => !task.deletedAt && task.rowId === row.id)
          .map((task) => task.dayIndex),
      );
      if (days.some((day) => occupied.has(day))) {
        throw new Error('Bu güne zaten bir görev eklenmiş.');
      }

      const chunkSize = pageChunkSize(
        input.startPage,
        input.endPage,
        days.length,
      );
      const chunks = splitPageRange(
        input.startPage,
        input.endPage,
        days.length,
      );

      const now = new Date().toISOString();
      const tasks: ScheduleTask[] = [];
      for (let index = 0; index < days.length; index += 1) {
        const day = days[index];
        const chunk = chunks[index];
        const fields = await validateTaskFields({
          weekId: week.id,
          rowId: row.id,
          dayIndex: day,
          type: 'book',
          userBookId: input.userBookId,
          fromPage: chunk.fromPage,
          toPage: chunk.toPage,
        });
        tasks.push({
          id: newId(),
          weekId: week.id,
          rowId: row.id,
          dayIndex: day,
          ...fields,
          createdAt: now,
          updatedAt: now,
        });
      }

      const slots: PageChainSlot[] = tasks.map((task, index) => ({
        taskId: task.id,
        slotIndex: index,
        chunkIndex: index,
        dayIndex: task.dayIndex,
      }));
      const chain: SchedulePageChain = {
        id: newId(),
        weekId: week.id,
        rowId: row.id,
        userBookId: input.userBookId,
        startPage: input.startPage,
        endPage: input.endPage,
        chunkSize,
        chunkCount: days.length,
        slots: serializeChainSlots(slots),
        createdAt: now,
        updatedAt: now,
      };

      await db.scheduleTasks.bulkAdd(tasks);
      await db.schedulePageChains.add(chain);

      return buildView(
        chain,
        slots,
        await taskMapFor(slotTaskIds(slots)),
        chunks,
        [],
      );
    },
  );
}

export async function listWeekPageChains(
  weekId: string,
): Promise<PageChainView[]> {
  const chains = (
    await db.schedulePageChains.where('weekId').equals(weekId).toArray()
  )
    .filter((chain) => !chain.deletedAt)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );

  const views: PageChainView[] = [];
  for (const chain of chains) {
    const slots = parseChainSlots(chain.slots);
    if (!slots) {
      continue;
    }
    const chunks = chunksFor(chain);
    views.push(
      await buildView(
        chain,
        slots,
        await taskMapFor(slotTaskIds(slots)),
        chunks,
        unscheduledChunks(chunks, slots),
      ),
    );
  }
  return views;
}

export async function recomputePageChain(
  chainId: string,
  now: Date = new Date(),
): Promise<PageChainView | null> {
  const chain = await db.schedulePageChains.get(chainId);
  if (!chain || chain.deletedAt) {
    return null;
  }
  const week = await db.scheduleWeeks.get(chain.weekId);
  if (!week || week.deletedAt) {
    return null;
  }
  const slots = parseChainSlots(chain.slots);
  if (!slots) {
    return null;
  }

  const tasks = await taskMapFor(slotTaskIds(slots));
  const statuses = new Map<string, ScheduleTaskStatus>();
  for (const slot of slots) {
    const task = tasks.get(slot.taskId);
    if (task && !task.deletedAt) {
      statuses.set(task.id, scheduleTaskStatus(task, week.weekStart, now));
    }
  }

  const result = assignChainChunks({
    slots,
    statuses,
    startPage: chain.startPage,
    endPage: chain.endPage,
    chunkSize: chain.chunkSize,
    chunkCount: chain.chunkCount,
  });

  const timestamp = new Date().toISOString();
  const changedTasks: ScheduleTask[] = [];
  let slotsChanged = false;
  const nextSlots = slots.map((slot) => {
    const task = tasks.get(slot.taskId);
    const assignment = result.assignments.get(slot.taskId);
    if (!task || task.deletedAt || !assignment) {
      return slot;
    }
    if ((statuses.get(task.id) ?? 'pending') !== 'pending') {
      return slot;
    }

    const rangeChanged =
      task.fromPage !== assignment.fromPage ||
      task.toPage !== assignment.toPage;
    const chunkChanged = slot.chunkIndex !== assignment.chunkIndex;
    if (!rangeChanged && !chunkChanged) {
      return slot;
    }

    changedTasks.push({
      ...task,
      fromPage: assignment.fromPage,
      toPage: assignment.toPage,
      updatedAt: timestamp,
    });
    if (chunkChanged) {
      slotsChanged = true;
      return { ...slot, chunkIndex: assignment.chunkIndex };
    }
    return slot;
  });

  const updatedChain: SchedulePageChain = slotsChanged
    ? {
        ...chain,
        slots: serializeChainSlots(nextSlots),
        updatedAt: timestamp,
      }
    : chain;

  if (changedTasks.length > 0 || slotsChanged) {
    await db.transaction(
      'rw',
      db.scheduleTasks,
      db.schedulePageChains,
      async () => {
        if (changedTasks.length > 0) {
          await db.scheduleTasks.bulkPut(changedTasks);
        }
        if (slotsChanged) {
          await db.schedulePageChains.put(updatedChain);
        }
      },
    );
  }

  const nextTasks = new Map(tasks);
  for (const task of changedTasks) {
    nextTasks.set(task.id, task);
  }

  return buildView(
    updatedChain,
    nextSlots,
    nextTasks,
    result.chunks,
    result.unscheduled,
  );
}

export async function dissolvePageChain(chainId: string): Promise<void> {
  await db.transaction('rw', db.schedulePageChains, async () => {
    const chain = await db.schedulePageChains.get(chainId);
    if (!chain || chain.deletedAt) {
      return;
    }
    const now = new Date().toISOString();
    await db.schedulePageChains.put({
      ...chain,
      deletedAt: now,
      updatedAt: now,
    });
  });
}

export async function findChainForTask(
  weekId: string,
  taskId: string,
): Promise<string | null> {
  const chains = (
    await db.schedulePageChains.where('weekId').equals(weekId).toArray()
  ).filter((chain) => !chain.deletedAt);

  for (const chain of chains) {
    const slots = parseChainSlots(chain.slots);
    if (slots?.some((slot) => slot.taskId === taskId)) {
      return chain.id;
    }
  }
  return null;
}
