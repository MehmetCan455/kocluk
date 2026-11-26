import type { ScheduleTaskStatus } from './schedule';

export interface PageChainSlot {
  taskId: string;
  slotIndex: number;
  chunkIndex: number;
  dayIndex: number;
}

export interface PageChainChunk {
  chunkIndex: number;
  fromPage: number;
  toPage: number;
}

export interface AssignChainChunksInput {
  slots: PageChainSlot[];
  statuses: ReadonlyMap<string, ScheduleTaskStatus>;
  startPage: number;
  endPage: number;
  chunkSize: number;
  chunkCount: number;
}

export interface AssignChainChunksResult {
  chunks: PageChainChunk[];
  assignments: Map<string, PageChainChunk>;
  unscheduled: PageChainChunk[];
}

/** Smallest and largest number of days a chain can spread a book range over. */
const PAGE_CHAIN_MIN_CHUNKS = 2;
const PAGE_CHAIN_MAX_CHUNKS = 7;

function isValidChunkIndex(chunkIndex: number, chunkCount: number): boolean {
  return Number.isInteger(chunkIndex) && chunkIndex >= 0 && chunkIndex < chunkCount;
}

/**
 * Pages per chunk, with the last chunk absorbing the remainder. The page span
 * is inclusive, so a 20-page range over two days splits 10/10 rather than 9/11.
 */
export function pageChunkSize(startPage: number, endPage: number, chunkCount: number): number {
  return Math.max(1, Math.floor((endPage - startPage + 1) / chunkCount));
}

/**
 * Contiguous, inclusive page ranges. `chunkCount` is authoritative: the last
 * chunk always ends at `endPage` even when it is longer than the others.
 */
export function splitPageRange(
  startPage: number,
  endPage: number,
  chunkCount: number,
): PageChainChunk[] {
  if (
    !Number.isInteger(startPage) ||
    !Number.isInteger(endPage) ||
    !Number.isInteger(chunkCount)
  ) {
    throw new Error('Sayfa aralığı ve parça sayısı tam sayı olmalı.');
  }
  if (chunkCount < PAGE_CHAIN_MIN_CHUNKS || chunkCount > PAGE_CHAIN_MAX_CHUNKS) {
    throw new Error('Parça sayısı 2 ile 7 arasında olmalı.');
  }
  if (startPage < 1 || endPage <= startPage) {
    throw new Error('Geçersiz sayfa aralığı.');
  }
  if (endPage - startPage + 1 < chunkCount) {
    throw new Error('Sayfa aralığı parça sayısına yetmiyor.');
  }

  const chunkSize = pageChunkSize(startPage, endPage, chunkCount);
  return Array.from({ length: chunkCount }, (_, chunkIndex) => {
    const fromPage = startPage + chunkIndex * chunkSize;
    const toPage =
      chunkIndex === chunkCount - 1 ? endPage : Math.min(fromPage + chunkSize - 1, endPage);
    return { chunkIndex, fromPage, toPage };
  });
}

/**
 * Keeps done ranges fixed, shifts waiting ranges into the lowest free chunk
 * and reports the chunks no slot holds at all. Missed slots keep their
 * historical chunk but release it for a waiting day to take over.
 */
export function assignChainChunks(input: AssignChainChunksInput): AssignChainChunksResult {
  const { slots, statuses, startPage, endPage, chunkSize, chunkCount } = input;
  const chunks = splitPageRange(startPage, endPage, chunkCount);

  if (chunkSize !== pageChunkSize(startPage, endPage, chunkCount)) {
    throw new Error('Parça boyu sayfa aralığıyla uyuşmuyor.');
  }

  const ordered = [...slots].sort((left, right) => left.slotIndex - right.slotIndex);
  const consumed = new Set<number>();
  for (const item of ordered) {
    const status = statuses.get(item.taskId) ?? 'pending';
    if (status === 'done' && isValidChunkIndex(item.chunkIndex, chunkCount)) {
      consumed.add(item.chunkIndex);
    }
  }

  const assignments = new Map<string, PageChainChunk>();
  const reserved = new Set<number>();

  for (const item of ordered) {
    const status = statuses.get(item.taskId) ?? 'pending';
    const keepsChunk = isValidChunkIndex(item.chunkIndex, chunkCount);

    if (status === 'done') {
      if (keepsChunk) {
        assignments.set(item.taskId, chunks[item.chunkIndex]);
      }
      continue;
    }

    if (status === 'missed') {
      if (keepsChunk) {
        assignments.set(item.taskId, chunks[item.chunkIndex]);
      }
      continue;
    }

    let nextChunk = -1;
    for (let index = 0; index < chunkCount; index += 1) {
      if (!consumed.has(index) && !reserved.has(index)) {
        nextChunk = index;
        break;
      }
    }
    if (nextChunk === -1) {
      continue;
    }
    reserved.add(nextChunk);
    assignments.set(item.taskId, chunks[nextChunk]);
  }

  const assignedChunkIndexes = new Set(
    [...assignments.values()].map((chunk) => chunk.chunkIndex),
  );
  const unscheduled = chunks.filter((chunk) => !assignedChunkIndexes.has(chunk.chunkIndex));

  return { chunks, assignments, unscheduled };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Strict read of the stored chain slots: malformed JSON, missing or out of
 * range fields, repeated task/slot ids and more than seven slots all make the
 * whole chain invalid. A repeated `chunkIndex` is expected after a miss.
 */
export function parseChainSlots(value: string): PageChainSlot[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length < PAGE_CHAIN_MIN_CHUNKS) {
    return null;
  }
  if (parsed.length > PAGE_CHAIN_MAX_CHUNKS) {
    return null;
  }

  const slots: PageChainSlot[] = [];
  const taskIds = new Set<string>();
  const slotIndexes = new Set<number>();

  for (const entry of parsed) {
    if (!isObject(entry)) {
      return null;
    }
    const { taskId, slotIndex, chunkIndex, dayIndex } = entry;
    if (typeof taskId !== 'string' || taskId.trim() === '') {
      return null;
    }
    if (!isInteger(slotIndex) || slotIndex < 0 || slotIndex > PAGE_CHAIN_MAX_CHUNKS - 1) {
      return null;
    }
    if (!isInteger(chunkIndex) || chunkIndex < 0) {
      return null;
    }
    if (!isInteger(dayIndex) || dayIndex < 1 || dayIndex > 7) {
      return null;
    }
    if (taskIds.has(taskId) || slotIndexes.has(slotIndex)) {
      return null;
    }

    taskIds.add(taskId);
    slotIndexes.add(slotIndex);
    slots.push({ taskId, slotIndex, chunkIndex, dayIndex });
  }

  return slots;
}

/** Stable storage format: slots are ordered by `slotIndex` before encoding. */
export function serializeChainSlots(slots: PageChainSlot[]): string {
  return JSON.stringify([...slots].sort((left, right) => left.slotIndex - right.slotIndex));
}
