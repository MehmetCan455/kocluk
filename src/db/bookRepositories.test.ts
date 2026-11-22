import { beforeEach, expect, test } from 'vitest';
import type { CatalogBook, ScheduleTask } from '@/domain/types';
import { deterministicId } from '@/lib/deterministicId';
import { LOCAL_SCOPE, USER_BOOK_NAMESPACE } from '@/lib/namespaces';
import { db } from './db';
import {
  addBookPageRange,
  addCatalogBookToShelf,
  addCustomBook,
  deleteActivityLog,
  deleteShelfBook,
  getShelfBook,
  listBookActivity,
  listShelfBooks,
  updateUserBook,
} from './bookRepositories';

const CREATED_AT = '2026-11-01T09:00:00.000Z';

async function insertCatalogBook(overrides: Partial<CatalogBook> = {}): Promise<CatalogBook> {
  const book: CatalogBook = {
    id: 'catalog-book-1',
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    totalPages: 400,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
  await db.catalogBooks.add(book);
  return book;
}

async function insertTask(userBookId: string): Promise<ScheduleTask> {
  const task: ScheduleTask = {
    id: `task-${userBookId}`,
    weekId: 'week-1',
    rowId: 'row-1',
    dayIndex: 0,
    type: 'book',
    userBookId,
    fromPage: 1,
    toPage: 10,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await db.scheduleTasks.add(task);
  return task;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

test('katalog kitabı rafa tek satır olarak eklenir ve yeniden ekleme etkinleştirir', async () => {
  const catalog = await insertCatalogBook();

  const first = await addCatalogBookToShelf(catalog.id);
  const second = await addCatalogBookToShelf(catalog.id);

  expect(second.id).toBe(first.id);
  expect(second.id).toBe(
    deterministicId(USER_BOOK_NAMESPACE, `${LOCAL_SCOPE}:${catalog.id}`),
  );
  expect(await db.userBooks.count()).toBe(1);

  await db.userBooks.update(first.id, { status: 'archived', deletedAt: CREATED_AT });
  const reactivated = await addCatalogBookToShelf(catalog.id);

  expect(reactivated.status).toBe('active');
  expect(reactivated.deletedAt).toBeUndefined();
  expect(await db.userBooks.count()).toBe(1);
});

test('özel kitap yerel katalog sahibiyle oluşturulur', async () => {
  const userBook = await addCustomBook({
    title: 'Kendi Fizik Kitabım',
    publisher: 'Özel Yayınevi',
    exam: 'AYT',
    subjectSlug: 'fizik',
    totalPages: 250,
  });

  const catalog = await db.catalogBooks.get(userBook.bookId);
  expect(catalog).toMatchObject({
    ownerId: LOCAL_SCOPE,
    title: 'Kendi Fizik Kitabım',
    publisher: 'Özel Yayınevi',
    exam: 'AYT',
    subjectSlug: 'fizik',
    totalPages: 250,
  });
  expect(userBook.status).toBe('active');

  const shelf = await listShelfBooks();
  expect(shelf).toHaveLength(1);
  expect(shelf[0].catalogBook.id).toBe(catalog?.id);
});

test('özel kitapta ad zorunludur ve toplam sayfa tam sayı olmalıdır', async () => {
  await expect(addCustomBook({ title: '   ', totalPages: 100 })).rejects.toThrow(
    'Kitap adı boş olamaz',
  );
  await expect(addCustomBook({ title: 'Eksik Sayfa', totalPages: 1.5 })).rejects.toThrow(
    'Toplam sayfa 0 veya daha büyük tam sayı olmalı',
  );
});

test('sayfa aralığı ekleme manuel book_pages kaydı oluşturur', async () => {
  const catalog = await insertCatalogBook();
  const userBook = await addCatalogBookToShelf(catalog.id);

  await addBookPageRange(userBook.id, 100, 140);
  await addBookPageRange(userBook.id, 100, 140);

  const logs = await listBookActivity(userBook.id);
  expect(logs).toHaveLength(2);
  expect(logs[0]).toMatchObject({
    type: 'book_pages',
    source: 'manual',
    userBookId: userBook.id,
    fromPage: 100,
    toPage: 140,
  });

  const shelf = await getShelfBook(userBook.id);
  expect(shelf?.progress).toEqual({
    currentPage: 140,
    readPages: 41,
    totalPages: 400,
    percent: 10,
    remaining: 359,
    started: true,
    done: false,
    hasTotalPages: true,
  });
  expect(shelf?.userBook.startedAt).toBeDefined();
});

test('geçersiz sayfa aralıkları reddedilir', async () => {
  const catalog = await insertCatalogBook();
  const userBook = await addCatalogBookToShelf(catalog.id);

  await expect(addBookPageRange(userBook.id, 0, 10)).rejects.toThrow(
    'Başlangıç sayfası 1 veya daha büyük olmalı',
  );
  await expect(addBookPageRange(userBook.id, 1.5, 10)).rejects.toThrow(
    'Sayfa aralığı tam sayı olmalı',
  );
  await expect(addBookPageRange(userBook.id, 10, 5)).rejects.toThrow(
    'Başlangıç sayfası bitiş sayfasından büyük olamaz',
  );
  await expect(addBookPageRange(userBook.id, 1, 401)).rejects.toThrow(
    'Bitiş sayfası toplam sayfayı aşamaz',
  );
  expect(await db.activityLogs.count()).toBe(0);
});

test('toplam sayfası bilinmeyen kitapta sayfa aralığı eklenemez', async () => {
  const userBook = await addCustomBook({ title: 'Sayfasız Kitap', totalPages: 0 });

  await expect(addBookPageRange(userBook.id, 1, 10)).rejects.toThrow(
    'Önce toplam sayfa sayısını gir',
  );
  expect(await db.activityLogs.count()).toBe(0);
});

test('tüm sayfalar okununca tamamlar, kayıt silinince yeniden etkin yapar', async () => {
  const catalog = await insertCatalogBook();
  const userBook = await addCatalogBookToShelf(catalog.id);

  await addBookPageRange(userBook.id, 1, 400);
  expect((await db.userBooks.get(userBook.id))?.status).toBe('completed');

  // Aynı aralığı tekrar girmek birleşimi büyütmez, kitap tamamlanmış kalır.
  await addBookPageRange(userBook.id, 1, 200);
  expect((await db.userBooks.get(userBook.id))?.status).toBe('completed');

  const fullRange = (await listBookActivity(userBook.id)).find(
    (log) => log.fromPage === 1 && log.toPage === 400,
  );
  await deleteActivityLog(fullRange!.id);
  expect((await db.userBooks.get(userBook.id))?.status).toBe('active');
});

test('arşivlenen kitap yeni sayfa aralığıyla arşivde kalır', async () => {
  const catalog = await insertCatalogBook();
  const userBook = await addCatalogBookToShelf(catalog.id);

  await db.userBooks.update(userBook.id, { status: 'archived' });
  await addBookPageRange(userBook.id, 1, 400);

  const book = await db.userBooks.get(userBook.id);
  expect(book?.status).toBe('archived');
  expect(book?.startedAt).toBeDefined();
});

test('kitap toplam sayfa geçersiz kılması ayarlanır ve temizlenir', async () => {
  const catalog = await insertCatalogBook();
  const userBook = await addCatalogBookToShelf(catalog.id);
  await addBookPageRange(userBook.id, 1, 100);

  await updateUserBook(userBook.id, { totalPagesOverride: 200, note: '  Yaz tatili  ' });
  let shelf = await getShelfBook(userBook.id);
  expect(shelf?.totalPages).toBe(200);
  expect(shelf?.progress.percent).toBe(50);
  expect(shelf?.userBook.note).toBe('Yaz tatili');

  await updateUserBook(userBook.id, { totalPagesOverride: null });
  shelf = await getShelfBook(userBook.id);
  expect(shelf?.totalPages).toBe(400);
  expect(shelf?.userBook.totalPagesOverride).toBeUndefined();
});

test('özel kitabın katalog alanları düzenlenir, ortak katalog alanları korunur', async () => {
  const custom = await addCustomBook({ title: 'Eski Ad', totalPages: 300 });
  await updateUserBook(custom.id, {
    title: 'Yeni Ad',
    publisher: 'Yeni Yayınevi',
    exam: 'AYT',
    subjectSlug: 'kimya',
    totalPagesOverride: 320,
  });

  const customShelf = await getShelfBook(custom.id);
  expect(customShelf?.catalogBook).toMatchObject({
    title: 'Yeni Ad',
    publisher: 'Yeni Yayınevi',
    exam: 'AYT',
    subjectSlug: 'kimya',
  });
  expect(customShelf?.totalPages).toBe(320);

  const catalog = await insertCatalogBook({ id: 'shared-book', title: 'Ortak Kitap' });
  const shared = await addCatalogBookToShelf(catalog.id);
  await updateUserBook(shared.id, { title: 'Değişmemeli', totalPagesOverride: 410 });

  const sharedShelf = await getShelfBook(shared.id);
  expect(sharedShelf?.catalogBook.title).toBe('Ortak Kitap');
  expect(sharedShelf?.totalPages).toBe(410);
});

test('raf listesi ilerlemeyi hesaplar ve arşiv ile silinmişleri ayıklar', async () => {
  const firstCatalog = await insertCatalogBook({
    id: 'book-a',
    title: 'A Kitabı',
    totalPages: 200,
  });
  const secondCatalog = await insertCatalogBook({
    id: 'book-b',
    title: 'B Kitabı',
    totalPages: 100,
  });
  const first = await addCatalogBookToShelf(firstCatalog.id);
  const second = await addCatalogBookToShelf(secondCatalog.id);

  await addBookPageRange(first.id, 1, 50);
  await addBookPageRange(second.id, 1, 100);

  const active = await listShelfBooks();
  expect(active).toHaveLength(2);
  expect(active.find((row) => row.userBook.id === first.id)?.progress).toMatchObject({
    currentPage: 50,
    readPages: 50,
    totalPages: 200,
    percent: 25,
  });
  expect(active.find((row) => row.userBook.id === second.id)?.progress).toMatchObject({
    currentPage: 100,
    readPages: 100,
    percent: 100,
    done: true,
  });

  await db.userBooks.update(second.id, { status: 'archived' });
  expect((await listShelfBooks()).map((row) => row.userBook.id)).toEqual([first.id]);
  expect(await listShelfBooks(true)).toHaveLength(2);

  await db.userBooks.update(first.id, { deletedAt: CREATED_AT });
  expect((await listShelfBooks(true)).map((row) => row.userBook.id)).toEqual([second.id]);
});

test('silinen aktivite kaydı birleşimden düşer ve durumu yeniler', async () => {
  const catalog = await insertCatalogBook();
  const userBook = await addCatalogBookToShelf(catalog.id);
  await addBookPageRange(userBook.id, 1, 220);
  await addBookPageRange(userBook.id, 200, 300);

  expect((await getShelfBook(userBook.id))?.progress).toMatchObject({
    currentPage: 300,
    readPages: 300,
    percent: 75,
  });

  const overlap = (await listBookActivity(userBook.id)).find(
    (log) => log.fromPage === 200 && log.toPage === 300,
  );
  expect(overlap).toBeDefined();

  await deleteActivityLog(overlap!.id);

  const logs = await listBookActivity(userBook.id);
  expect(logs.map((log) => log.toPage)).toEqual([220]);
  expect((await db.activityLogs.get(overlap!.id))?.deletedAt).toBeDefined();
  expect((await getShelfBook(userBook.id))?.progress).toMatchObject({
    currentPage: 220,
    readPages: 220,
    percent: 55,
  });
});

test('kitap silme kitabı, kayıtlarını ve plan görevlerini tombstone eder', async () => {
  const catalog = await insertCatalogBook();
  const userBook = await addCatalogBookToShelf(catalog.id);
  const other = await addCustomBook({ title: 'Diğer Kitap', totalPages: 100 });
  await addBookPageRange(userBook.id, 40, 60);

  const ownTask = await insertTask(userBook.id);
  const otherTask = await insertTask(other.id);

  await deleteShelfBook(userBook.id);

  expect((await db.userBooks.get(userBook.id))?.deletedAt).toBeDefined();

  const logs = await db.activityLogs.where('userBookId').equals(userBook.id).toArray();
  expect(logs).toHaveLength(1);
  expect(logs[0].deletedAt).toBeDefined();

  expect((await db.scheduleTasks.get(ownTask.id))?.deletedAt).toBeDefined();
  expect((await db.scheduleTasks.get(otherTask.id))?.deletedAt).toBeUndefined();
  expect((await db.catalogBooks.get(catalog.id))?.deletedAt).toBeUndefined();

  expect(await getShelfBook(userBook.id)).toBeUndefined();
  expect((await listShelfBooks(true)).map((row) => row.userBook.id)).toEqual([other.id]);
});

test('özel kitap silinince yerel katalog kaydı da tombstone edilir', async () => {
  const custom = await addCustomBook({ title: 'Silinecek Özel Kitap', totalPages: 120 });

  await deleteShelfBook(custom.id);

  expect((await db.catalogBooks.get(custom.bookId))?.deletedAt).toBeDefined();
  expect(await listShelfBooks(true)).toEqual([]);
});
