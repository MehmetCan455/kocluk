import { beforeEach, expect, test } from 'vitest';
import { CATALOG_SEED } from '@/data/catalogBooks';
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
  // 30 eski kitap korunur, onaylanmış 50 yeni satır eklenir.
  expect(CATALOG_SEED).toHaveLength(80);
  expect(books).toHaveLength(CATALOG_SEED.length);
  expect(new Set(books.map((book) => book.id)).size).toBe(books.length);
  expect(books.some((book) => book.publisher === 'Karekök')).toBe(true);

  // Yayınevi ayrı alandır; arama yayınevi + ders + sınav üzerinden de eşleşir.
  const results = await searchCatalog('bilgi sarmal matematik');
  expect(results.some((book) => book.publisher === 'Bilgi Sarmal')).toBe(true);

  const biyotik = await searchCatalog('biyotik');
  expect(biyotik).toHaveLength(6);
  expect(biyotik.every((book) => book.publisher === 'Biyotik')).toBe(true);
  expect(biyotik.map((book) => book.title).sort()).toEqual([
    '2028 Üniversiteye Hazırlık Biyoloji Maarif Model Soru Bankası',
    'AYT Biyoloji Soru Bankası',
    'AYT Biyoloji Soru Kampı',
    'TYT Biyoloji Soru Bankası',
    'TYT Biyoloji Soru Kampı',
    'TYT-AYT Biyoloji Sistemler İnsan Fizyolojisi Konu Anlatımlı Soru Bankası',
  ]);

  // Apotemi AYT fasikül setleri katalogda yok; tek cilt kitaplar vardır.
  const apotemi = await searchCatalog('apotemi');
  expect(apotemi).toHaveLength(7);
  expect(apotemi).toContainEqual(
    expect.objectContaining({
      title: 'TYT Matematik Soru Bankası',
      exam: 'TYT',
      totalPages: 400,
    }),
  );

  const book = await getCatalogBook(results[0].id);
  expect(book?.totalPages).toBeGreaterThan(0);
});

test('tohum mevcut satırı ezmez ve yalnızca eksikleri ekler', async () => {
  await seedCatalog();
  const first = (await listCatalogBooks())[0];
  await db.catalogBooks.update(first.id, { title: 'Kullanıcı düzenlemesi' });

  await seedCatalog();

  expect((await db.catalogBooks.get(first.id))?.title).toBe('Kullanıcı düzenlemesi');
  expect(await db.catalogBooks.count()).toBe(CATALOG_SEED.length);
});
