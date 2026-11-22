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

test('sayfa kayıtlarından okunan sayfayı hesaplar', () => {
  const progress = calculateBookProgress(
    [
      log({ id: 'first', fromPage: 1, toPage: 100, createdAt: '2026-11-01T10:00:00.000Z' }),
      log({ id: 'second', fromPage: 101, toPage: 220, createdAt: '2026-11-02T10:00:00.000Z' }),
    ],
    480,
  );

  expect(progress).toEqual({
    currentPage: 220,
    totalPages: 480,
    percent: 46,
    remaining: 260,
    started: true,
    done: false,
    hasTotalPages: true,
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

  expect(progress).toMatchObject({ currentPage: 100, percent: 21, remaining: 380, done: false });
});

test('page_set tabanı aşağı doğru düzeltir ve sonraki kayıtlar yeni tabandan sayar', () => {
  const logs = [
    log({ id: 'read', fromPage: 1, toPage: 220, createdAt: '2026-11-01T10:00:00.000Z' }),
    log({ id: 'set', type: 'page_set', toPage: 180, createdAt: '2026-11-02T10:00:00.000Z' }),
  ];

  expect(calculateBookProgress(logs, 480).currentPage).toBe(180);

  logs.push(
    log({ id: 'after', fromPage: 181, toPage: 200, createdAt: '2026-11-03T10:00:00.000Z' }),
  );
  expect(calculateBookProgress(logs, 480).currentPage).toBe(200);
});

test('silinen page_set kaydı önceki okumaya geri döner', () => {
  const logs = [
    log({ id: 'read', fromPage: 1, toPage: 220, createdAt: '2026-11-01T10:00:00.000Z' }),
    log({ id: 'set', type: 'page_set', toPage: 180, createdAt: '2026-11-02T10:00:00.000Z' }),
  ];

  expect(calculateBookProgress(logs, 480).currentPage).toBe(180);

  const deleted = logs.map((entry) =>
    entry.id === 'set' ? { ...entry, deletedAt: '2026-11-04T10:00:00.000Z' } : entry,
  );

  expect(calculateBookProgress(deleted, 480)).toMatchObject({ currentPage: 220, percent: 46 });
});

test('kayıt yoksa ilerleme sıfırdır', () => {
  expect(calculateBookProgress([], 480)).toEqual({
    currentPage: 0,
    totalPages: 480,
    percent: 0,
    remaining: 480,
    started: false,
    done: false,
    hasTotalPages: true,
  });
});

test('toplam sayfa yoksa yüzdeyi 0 verir', () => {
  expect(calculateBookProgress([log({ toPage: 50 })], 0)).toEqual({
    currentPage: 50,
    totalPages: 0,
    percent: 0,
    remaining: 0,
    started: true,
    done: false,
    hasTotalPages: false,
  });
});

test('toplam sayfaya ulaşınca yüzde 100 ve bitti olur', () => {
  expect(calculateBookProgress([log({ toPage: 220 })], 220)).toMatchObject({
    currentPage: 220,
    percent: 100,
    remaining: 0,
    done: true,
  });
});

test('toplam sayfayı aşan okumayı gösterimde toplam sayfaya sınırlar', () => {
  expect(calculateBookProgress([log({ toPage: 240 })], 220)).toMatchObject({
    currentPage: 220,
    percent: 100,
    remaining: 0,
    done: true,
  });
});

test('tamamlanmadan yüzde 100 olmaz', () => {
  expect(calculateBookProgress([log({ toPage: 479 })], 480)).toMatchObject({
    currentPage: 479,
    percent: 99,
    remaining: 1,
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
