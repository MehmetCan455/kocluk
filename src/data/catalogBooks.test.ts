import { expect, test } from 'vitest';
import { CATALOG_SEED, catalogBookId } from './catalogBooks';
import { MEVCUT } from './catalog/mevcut';

test('mevcut 80 kitap korunur ve kimlikleri benzersizdir', () => {
  expect(MEVCUT).toHaveLength(80);
  expect(CATALOG_SEED.length).toBeGreaterThanOrEqual(80);

  const ids = new Set(CATALOG_SEED.map((book) => catalogBookId(book.title, book.publisher, book.edition)));
  expect(ids.size).toBe(CATALOG_SEED.length);

  expect(CATALOG_SEED).toContainEqual(
    expect.objectContaining({
      title: 'TYT Matematik Soru Bankası',
      publisher: 'Bilgi Sarmal',
      totalPages: 400,
    }),
  );
});
