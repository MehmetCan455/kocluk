import { expect, test } from 'vitest';
import { countsForSubject } from '@/domain/subjectEstimate';
import { CATALOG_SEED, catalogBookId } from './catalogBooks';
import { MEVCUT } from './catalog/mevcut';
import { CURRICULUM } from './curriculum';

const SUBJECT_SLUGS = new Set(CURRICULUM.subjects.map((subject) => subject.slug));

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

test('katalog en az 500 geçerli kitap içerir', () => {
  expect(CATALOG_SEED.length).toBeGreaterThanOrEqual(500);

  for (const book of CATALOG_SEED) {
    expect(['TYT', 'AYT']).toContain(book.exam);
    expect(SUBJECT_SLUGS.has(book.subjectSlug)).toBe(true);
    expect(Number.isInteger(book.totalPages)).toBe(true);
    expect(book.totalPages).toBeGreaterThan(0);
    expect(book.title.trim()).not.toBe('');
    expect(book.publisher.trim()).not.toBe('');
    expect(book.edition).toMatch(/^\d{4}$/);
  }
});

test('aynı title + publisher ikinci kez geçmez', () => {
  const keys = CATALOG_SEED.map((book) => `${book.title}|${book.publisher}`);
  expect(new Set(keys).size).toBe(keys.length);
});

test('her ders için en az 5 eşleşen kitap var', () => {
  for (const subject of CURRICULUM.subjects) {
    const matches = CATALOG_SEED.filter((book) =>
      countsForSubject(book, { exam: subject.exam, slug: subject.slug }),
    );
    expect(matches.length).toBeGreaterThanOrEqual(5);
  }
});

test('fasikül, problem ve paragraf kapsamı yeterli', () => {
  const titles = CATALOG_SEED.map((book) => book.title.toLocaleLowerCase('tr-TR'));
  // 23: plan hedefi 25'ti; controller ruling'i ile doğrulanabilir üst sınır 23'e çekildi.
  expect(titles.filter((title) => title.includes('fasikül')).length).toBeGreaterThanOrEqual(23);
  expect(titles.filter((title) => title.includes('problem')).length).toBeGreaterThanOrEqual(15);
  expect(titles.filter((title) => title.includes('paragraf')).length).toBeGreaterThanOrEqual(15);
});
