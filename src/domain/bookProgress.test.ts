import { expect, test } from 'vitest';
import type { ActivityLog, CatalogBook, UserBook } from './types';
import { calculateBookProgress, resolveBookTotalPages } from './bookProgress';

function log(partial: Partial<ActivityLog>): ActivityLog {
  return {
    id: 'log-1',
    type: 'book_pages',
    source: 'manual',
    createdAt: '2026-11-01T10:00:00.000Z',
    ...partial,
  };
}

test('okunan sayfayı aralıkların birleşiminden hesaplar', () => {
  const progress = calculateBookProgress([log({ fromPage: 250, toPage: 255 })], 480);

  expect(progress).toEqual({
    currentPage: 255,
    readPages: 6,
    totalPages: 480,
    percent: 1,
    remaining: 474,
    started: true,
    done: false,
    hasTotalPages: true,
  });
});

test('bitişik aralıkları tek aralık gibi birleştirir', () => {
  const progress = calculateBookProgress(
    [
      log({ id: 'first', fromPage: 1, toPage: 100, createdAt: '2026-11-01T10:00:00.000Z' }),
      log({ id: 'second', fromPage: 101, toPage: 200, createdAt: '2026-11-02T10:00:00.000Z' }),
    ],
    480,
  );

  expect(progress).toMatchObject({
    currentPage: 200,
    readPages: 200,
    percent: 42,
    remaining: 280,
    done: false,
  });
});

test('örtüşen ve tekrar girilen aralıkları çift saymaz', () => {
  const progress = calculateBookProgress(
    [
      log({ id: 'first', fromPage: 50, toPage: 60 }),
      log({ id: 'repeat', fromPage: 50, toPage: 60, createdAt: '2026-11-02T10:00:00.000Z' }),
      log({ id: 'overlap', fromPage: 55, toPage: 70, createdAt: '2026-11-03T10:00:00.000Z' }),
    ],
    100,
  );

  expect(progress).toMatchObject({ currentPage: 70, readPages: 21, percent: 21, done: false });
});

test('kayıt sırasından bağımsız aynı birleşimi verir', () => {
  const logs = [
    log({ id: 'late', fromPage: 300, toPage: 310 }),
    log({ id: 'early', fromPage: 1, toPage: 20, createdAt: '2026-11-02T10:00:00.000Z' }),
    log({ id: 'middle', fromPage: 10, toPage: 30, createdAt: '2026-11-03T10:00:00.000Z' }),
  ];

  expect(calculateBookProgress(logs, 480)).toMatchObject({
    currentPage: 310,
    readPages: 41,
    done: false,
  });
});

test('silinmiş aktivite kayıtlarını yok sayar', () => {
  const progress = calculateBookProgress(
    [
      log({ id: 'kept', fromPage: 1, toPage: 100 }),
      log({
        id: 'deleted-log',
        fromPage: 101,
        toPage: 220,
        createdAt: '2026-11-02T10:00:00.000Z',
        deletedAt: '2026-11-03T10:00:00.000Z',
      }),
      log({
        id: 'deleted-set',
        type: 'page_set',
        toPage: 300,
        createdAt: '2026-11-04T10:00:00.000Z',
        deletedAt: '2026-11-05T10:00:00.000Z',
      }),
    ],
    480,
  );

  expect(progress).toMatchObject({
    currentPage: 100,
    readPages: 100,
    percent: 21,
    remaining: 380,
    done: false,
  });
});

test('page_set kayıtları okunan sayfaya sayılmaz', () => {
  const progress = calculateBookProgress(
    [
      log({ id: 'read', fromPage: 1, toPage: 40 }),
      log({ id: 'set', type: 'page_set', toPage: 300, createdAt: '2026-11-02T10:00:00.000Z' }),
    ],
    480,
  );

  expect(progress).toMatchObject({
    currentPage: 40,
    readPages: 40,
    percent: 8,
    remaining: 440,
    started: true,
  });
});

test('kayıt yoksa ilerleme sıfırdır', () => {
  expect(calculateBookProgress([], 480)).toEqual({
    currentPage: 0,
    readPages: 0,
    totalPages: 480,
    percent: 0,
    remaining: 480,
    started: false,
    done: false,
    hasTotalPages: true,
  });
});

test('toplam sayfa yoksa yüzdeyi 0 verir', () => {
  const progress = calculateBookProgress(
    [log({ id: 'first', fromPage: 10, toPage: 20 }), log({ id: 'second', fromPage: 30, toPage: 35 })],
    0,
  );

  expect(progress).toEqual({
    currentPage: 35,
    readPages: 17,
    totalPages: 0,
    percent: 0,
    remaining: 0,
    started: true,
    done: false,
    hasTotalPages: false,
  });
});

test('tüm sayfalar okunmadan yüzde 100 olmaz', () => {
  expect(calculateBookProgress([log({ fromPage: 1, toPage: 479 })], 480)).toMatchObject({
    currentPage: 479,
    readPages: 479,
    percent: 99,
    remaining: 1,
    done: false,
  });
});

test('tüm sayfalar okununca yüzde 100 ve bitti olur', () => {
  expect(calculateBookProgress([log({ fromPage: 1, toPage: 480 })], 480)).toMatchObject({
    currentPage: 480,
    readPages: 480,
    percent: 100,
    remaining: 0,
    done: true,
  });
});

test('aralıkları toplam sayfaya kırpar', () => {
  expect(calculateBookProgress([log({ fromPage: 200, toPage: 240 })], 220)).toMatchObject({
    currentPage: 220,
    readPages: 21,
    percent: 10,
    remaining: 199,
    done: false,
  });

  expect(calculateBookProgress([log({ fromPage: 1, toPage: 300 })], 220)).toMatchObject({
    currentPage: 220,
    readPages: 220,
    percent: 100,
    remaining: 0,
    done: true,
  });
});

test('geçersiz ve eksik aralıkları yok sayar ve girdiyi değiştirmez', () => {
  const logs = [
    log({ id: 'valid', fromPage: 5, toPage: 8 }),
    log({ id: 'no-from', toPage: 20 }),
    log({ id: 'no-to', fromPage: 30 }),
    log({ id: 'reversed', fromPage: 50, toPage: 40 }),
    log({ id: 'fraction', fromPage: 1.5, toPage: 2 }),
    log({ id: 'negative', fromPage: -10, toPage: -1 }),
  ];
  const snapshot = structuredClone(logs);

  expect(calculateBookProgress(logs, 100)).toMatchObject({
    currentPage: 8,
    readPages: 4,
    percent: 4,
  });
  expect(logs).toEqual(snapshot);
});

test('son sayfa en büyük bitiş sayfasıdır, okunan sayfa birleşimdir', () => {
  const progress = calculateBookProgress(
    [
      log({ id: 'wide', fromPage: 100, toPage: 150 }),
      log({ id: 'narrow', fromPage: 120, toPage: 130, createdAt: '2026-11-02T10:00:00.000Z' }),
    ],
    400,
  );

  expect(progress).toMatchObject({ currentPage: 150, readPages: 51, percent: 13 });
});

test('480 sayfalık kitapta 250–255 sonra 1–250 birleşimi 255 sayfadır', () => {
  const logs = [log({ id: 'chunk', fromPage: 250, toPage: 255 })];

  expect(calculateBookProgress(logs, 480)).toMatchObject({ readPages: 6, percent: 1 });

  logs.push(
    log({ id: 'start', fromPage: 1, toPage: 250, createdAt: '2026-11-02T10:00:00.000Z' }),
  );

  expect(calculateBookProgress(logs, 480)).toMatchObject({
    currentPage: 255,
    readPages: 255,
    percent: 53,
    done: false,
  });
});

test('kitap toplam sayfası önce kullanıcı geçersiz kılmasını kullanır', () => {
  const userBook: UserBook = {
    id: 'user-book-1',
    bookId: 'book-1',
    status: 'active',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
  const catalogBook: CatalogBook = {
    id: 'book-1',
    title: 'TYT Matematik Soru Bankası',
    totalPages: 480,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };

  expect(resolveBookTotalPages({ ...userBook, totalPagesOverride: 500 }, catalogBook)).toBe(500);
  expect(resolveBookTotalPages(userBook, catalogBook)).toBe(480);
  expect(resolveBookTotalPages(userBook, undefined)).toBe(0);
});
