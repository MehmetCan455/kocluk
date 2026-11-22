import { beforeEach, expect, test } from 'vitest';
import { db } from './db';
import { getCatalogBook, listCatalogBooks, seedCatalog, searchCatalog } from './catalogRepository';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

test('katalog tohumu idempotenttir ve arama yapar', async () => {
  await seedCatalog();
  const firstCount = await db.catalogBooks.count();
  await seedCatalog();
  expect(await db.catalogBooks.count()).toBe(firstCount);

  const books = await listCatalogBooks();
  // Dört eski kitap korunur, 26 yeni satır eklenir.
  expect(books).toHaveLength(30);
  expect(new Set(books.map((book) => book.id)).size).toBe(books.length);
  expect(books.some((book) => book.publisher === 'Karekök')).toBe(true);

  // Yayınevi ayrı alandır; arama yayınevi + ders + sınav üzerinden de eşleşir.
  const results = await searchCatalog('bilgi sarmal matematik');
  expect(results.some((book) => book.publisher === 'Bilgi Sarmal')).toBe(true);

  const biyotik = await searchCatalog('biyotik');
  expect(biyotik).toHaveLength(2);
  expect(biyotik.every((book) => book.publisher === 'Biyotik')).toBe(true);
  expect(biyotik.map((book) => book.title).sort()).toEqual([
    'AYT Biyoloji Soru Bankası',
    'TYT Biyoloji Soru Bankası',
  ]);

  // Apotemi AYT bir fasikül setidir; katalogda tek TYT kitabı vardır.
  const apotemi = await searchCatalog('apotemi');
  expect(apotemi).toHaveLength(1);
  expect(apotemi[0]).toMatchObject({
    title: 'TYT Matematik Soru Bankası',
    exam: 'TYT',
    totalPages: 400,
  });

  const book = await getCatalogBook(results[0].id);
  expect(book?.totalPages).toBeGreaterThan(0);
});
