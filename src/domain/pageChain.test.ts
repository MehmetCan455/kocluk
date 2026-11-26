import { describe, expect, test } from 'vitest';
import {
  assignChainChunks,
  pageChunkSize,
  parseChainSlots,
  parseSkippedChunks,
  serializeChainSlots,
  splitPageRange,
  type PageChainSlot,
} from './pageChain';
import type { ScheduleTaskStatus } from './schedule';

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

  test.each([
    {
      name: 'Sal yapıldı (geri): kaçırılan gün yapılınca sıra eski haline döner',
      slots: [
        slot('t0', 0, 0, 1),
        slot('t1', 1, 1, 2),
        slot('t2', 2, 1, 3),
        slot('t3', 3, 2, 4),
        slot('t4', 4, 3, 5),
      ],
      statuses: [
        ['t0', 'done'],
        ['t1', 'done'],
        ['t2', 'pending'],
        ['t3', 'pending'],
        ['t4', 'pending'],
      ],
      expected: [
        [100, 109],
        [110, 119],
        [120, 129],
        [130, 139],
        [140, 150],
      ],
      unscheduled: [],
    },
    {
      name: 'Çar da yapılmadı: iki kaçırma aynı aralığı tutar, kalanlar kayar',
      slots: [
        slot('t0', 0, 0, 1),
        slot('t1', 1, 1, 2),
        slot('t2', 2, 1, 3),
        slot('t3', 3, 2, 4),
        slot('t4', 4, 3, 5),
      ],
      statuses: [
        ['t0', 'done'],
        ['t1', 'missed'],
        ['t2', 'missed'],
        ['t3', 'pending'],
        ['t4', 'pending'],
      ],
      expected: [
        [100, 109],
        [110, 119],
        [110, 119],
        [110, 119],
        [120, 129],
      ],
      unscheduled: [
        [130, 139],
        [140, 150],
      ],
    },
    {
      name: 'Per yapıldı (Çar kaçtı): yapılan gün aralığını korur, kalan kayar',
      slots: [
        slot('t0', 0, 0, 1),
        slot('t1', 1, 1, 2),
        slot('t2', 2, 1, 3),
        slot('t3', 3, 1, 4),
        slot('t4', 4, 2, 5),
      ],
      statuses: [
        ['t0', 'done'],
        ['t1', 'missed'],
        ['t2', 'missed'],
        ['t3', 'done'],
        ['t4', 'pending'],
      ],
      expected: [
        [100, 109],
        [110, 119],
        [110, 119],
        [110, 119],
        [120, 129],
      ],
      unscheduled: [
        [130, 139],
        [140, 150],
      ],
    },
  ] satisfies ReadonlyArray<{
    name: string;
    slots: PageChainSlot[];
    statuses: ReadonlyArray<readonly [string, ScheduleTaskStatus]>;
    expected: ReadonlyArray<readonly [number, number]>;
    unscheduled: ReadonlyArray<readonly [number, number]>;
  }>)('$name', ({ slots, statuses, expected, unscheduled }) => {
    const result = assignChainChunks({
      ...base,
      slots,
      statuses: new Map(statuses),
    });

    expect(
      slots.map((item) => {
        const assignment = result.assignments.get(item.taskId)!;
        return [assignment.fromPage, assignment.toPage];
      }),
    ).toEqual(expected);
    expect(
      result.unscheduled.map((chunk) => [chunk.fromPage, chunk.toPage]),
    ).toEqual(unscheduled);
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

  test('yok sayılan parça bekleyen güne atanmaz ve planlanmamış sayılmaz', () => {
    const slots = [1, 2, 3, 4, 5].map((day, index) => slot(`t${index}`, index, index, day));
    const statuses = new Map(slots.map((item) => [item.taskId, 'pending' as const]));
    const result = assignChainChunks({
      ...base,
      slots,
      statuses,
      skipped: new Set([2]),
    });

    expect(result.assignments.get('t2')).toEqual({
      chunkIndex: 3,
      fromPage: 130,
      toPage: 139,
    });
    expect(result.assignments.get('t3')).toEqual({
      chunkIndex: 4,
      fromPage: 140,
      toPage: 150,
    });
    expect(result.assignments.has('t4')).toBe(false);
    expect(result.unscheduled).toEqual([]);
  });
});

describe('parseSkippedChunks', () => {
  test('geçerli tam sayıları okur, aralık dışı ve bozuk girdileri atar', () => {
    expect(parseSkippedChunks('[1,3]', 5)).toEqual(new Set([1, 3]));
    expect(parseSkippedChunks('[3,1,3]', 5)).toEqual(new Set([1, 3]));
    expect(parseSkippedChunks('[0,4]', 5)).toEqual(new Set([0, 4]));
    expect(parseSkippedChunks('[5,-1,1.5,"2",2]', 5)).toEqual(new Set([2]));
  });

  test('boş ya da bozuk değer boş küme döndürür', () => {
    for (const value of [undefined, null, '', '[]', '{}', '{', '"1"', 4]) {
      expect(parseSkippedChunks(value, 5)).toEqual(new Set());
    }
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
