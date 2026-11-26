import { describe, expect, test } from 'vitest';
import {
  assignChainChunks,
  pageChunkSize,
  parseChainSlots,
  serializeChainSlots,
  splitPageRange,
  type PageChainSlot,
} from './pageChain';

function slot(taskId: string, slotIndex: number, chunkIndex: number, dayIndex: number): PageChainSlot {
  return { taskId, slotIndex, chunkIndex, dayIndex };
}

describe('splitPageRange', () => {
  test('100-150 beş güne bitişik bölünür', () => {
    expect(splitPageRange(100, 150, 5)).toEqual([
      { chunkIndex: 0, fromPage: 100, toPage: 109 },
      { chunkIndex: 1, fromPage: 110, toPage: 119 },
      { chunkIndex: 2, fromPage: 120, toPage: 129 },
      { chunkIndex: 3, fromPage: 130, toPage: 139 },
      { chunkIndex: 4, fromPage: 140, toPage: 150 },
    ]);
  });

  test('az sayfada her güne bir sayfa düşer', () => {
    expect(splitPageRange(100, 104, 5).map((chunk) => [chunk.fromPage, chunk.toPage])).toEqual([
      [100, 100],
      [101, 101],
      [102, 102],
      [103, 103],
      [104, 104],
    ]);
  });

  test('geçersiz aralıkları reddeder', () => {
    expect(() => splitPageRange(100, 100, 2)).toThrow();
    expect(() => splitPageRange(100, 101, 5)).toThrow();
    expect(() => splitPageRange(100, 150, 1)).toThrow();
  });

  test('parça boyu formülü', () => {
    expect(pageChunkSize(100, 150, 5)).toBe(10);
    expect(pageChunkSize(100, 119, 2)).toBe(10);
    expect(pageChunkSize(100, 104, 5)).toBe(1);
  });
});

describe('assignChainChunks', () => {
  const base = {
    startPage: 100,
    endPage: 150,
    chunkSize: 10,
    chunkCount: 5,
  };

  test('başlangıçta her görev kendi parçasını alır', () => {
    const slots = [1, 2, 3, 4, 5].map((day, index) => slot(`t${index}`, index, index, day));
    const statuses = new Map(slots.map((item) => [item.taskId, 'pending' as const]));
    const result = assignChainChunks({ ...base, slots, statuses });

    expect(result.assignments.get('t0')).toEqual({ chunkIndex: 0, fromPage: 100, toPage: 109 });
    expect(result.assignments.get('t4')).toEqual({ chunkIndex: 4, fromPage: 140, toPage: 150 });
    expect(result.unscheduled).toEqual([]);
  });

  test('ikinci gün kaçırılınca sonraki gün aynı aralığı alır', () => {
    const slots = [1, 2, 3, 4, 5].map((day, index) => slot(`t${index}`, index, index, day));
    const statuses = new Map([
      ['t0', 'done'],
      ['t1', 'missed'],
      ['t2', 'pending'],
      ['t3', 'pending'],
      ['t4', 'pending'],
    ] as const);
    const result = assignChainChunks({ ...base, slots, statuses });

    expect(result.assignments.get('t1')).toEqual({ chunkIndex: 1, fromPage: 110, toPage: 119 });
    expect(result.assignments.get('t2')).toEqual({ chunkIndex: 1, fromPage: 110, toPage: 119 });
    expect(result.assignments.get('t4')).toEqual({ chunkIndex: 3, fromPage: 130, toPage: 139 });
    expect(result.unscheduled).toEqual([{ chunkIndex: 4, fromPage: 140, toPage: 150 }]);
  });

  test('aynı chunkIndex iki görevde geçerlidir', () => {
    const slots = [slot('t0', 0, 0, 1), slot('t1', 1, 1, 2), slot('t2', 2, 1, 3)];
    const statuses = new Map([
      ['t0', 'done'],
      ['t1', 'missed'],
      ['t2', 'pending'],
    ] as const);
    const result = assignChainChunks({
      startPage: 100,
      endPage: 119,
      chunkSize: 10,
      chunkCount: 2,
      slots,
      statuses,
    });

    expect(result.assignments.get('t1')?.chunkIndex).toBe(1);
    expect(result.assignments.get('t2')?.chunkIndex).toBe(1);
  });
});

describe('chain slots', () => {
  test('serialize/parse gidiş-dönüşü', () => {
    const slots = [slot('t0', 0, 0, 1), slot('t1', 1, 2, 3)];
    expect(parseChainSlots(serializeChainSlots(slots))).toEqual(slots);
  });

  test('bozuk JSON, eksik alan, tekrarlı taskId/slotIndex reddedilir', () => {
    expect(parseChainSlots('{')).toBeNull();
    expect(parseChainSlots('[]')).toBeNull();
    expect(parseChainSlots('[{"taskId":"a","slotIndex":0}]')).toBeNull();
    expect(
      parseChainSlots(
        '[{"taskId":"a","slotIndex":0,"chunkIndex":0,"dayIndex":1},{"taskId":"a","slotIndex":1,"chunkIndex":1,"dayIndex":2}]',
      ),
    ).toBeNull();
    expect(
      parseChainSlots(
        '[{"taskId":"a","slotIndex":0,"chunkIndex":0,"dayIndex":1},{"taskId":"b","slotIndex":0,"chunkIndex":1,"dayIndex":2}]',
      ),
    ).toBeNull();
  });

  test('tekrarlı chunkIndex kabul edilir, 7’den fazla slot reddedilir', () => {
    expect(
      parseChainSlots(JSON.stringify([
        { taskId: 'a', slotIndex: 0, chunkIndex: 0, dayIndex: 1 },
        { taskId: 'b', slotIndex: 1, chunkIndex: 0, dayIndex: 2 },
      ])),
    ).toHaveLength(2);

    const eight = Array.from({ length: 8 }, (_, index) => ({
      taskId: `t${index}`,
      slotIndex: index,
      chunkIndex: 0,
      dayIndex: (index % 7) + 1,
    }));
    expect(parseChainSlots(JSON.stringify(eight))).toBeNull();
  });
});
