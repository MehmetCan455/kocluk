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
  expect(await listCatalogBooks()).toHaveLength(firstCount);

  // Yayınevi ayrı alandır; arama yayınevi + ders + sınav üzerinden de eşleşir.
  const results = await searchCatalog('bilgi sarmal matematik');
  expect(results.some((book) => book.publisher === 'Bilgi Sarmal')).toBe(true);

  const book = await getCatalogBook(results[0].id);
  expect(book?.totalPages).toBeGreaterThan(0);
});
