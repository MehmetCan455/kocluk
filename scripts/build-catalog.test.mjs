import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { mevcutKeySet, parseMevcutSource } from './build-catalog.mjs';

const MEVCUT_FILE = path.resolve(process.cwd(), 'src/data/catalog/mevcut.ts');

/** @param {string} value */
function quote(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** @param {Array<{ title: string, publisher: string }>} rows */
function makeMevcutSource(rows) {
  const body = rows
    .map(
      (row) => `  {
    title: ${quote(row.title)},
    publisher: ${quote(row.publisher)},
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 100,
    edition: '2026',
  },`,
    )
    .join('\n');
  return `export const MEVCUT: readonly CatalogBookSeed[] = [\n${body}\n];\n`;
}

/** @param {number} count */
function makeRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    title: `Kitap ${index + 1}`,
    publisher: `Yayınevi ${index + 1}`,
  }));
}

test('gerçek mevcut.ts 80 benzersiz title|publisher çifti verir', async () => {
  const keys = mevcutKeySet(parseMevcutSource(await readFile(MEVCUT_FILE, 'utf8')));
  expect(keys.size).toBe(80);
});

test('kaçışlı tırnak ve ters bölü doğru çözülür', () => {
  const rows = makeRows(80);
  rows[0] = { title: "Yazar'ın \\ Kitabı", publisher: 'A\\B' };
  const keys = mevcutKeySet(parseMevcutSource(makeMevcutSource(rows)));

  expect(keys.has("Yazar'ın \\ Kitabı|A\\B")).toBe(true);
});

test('eksik satır hata verir', () => {
  expect(() => mevcutKeySet(parseMevcutSource(makeMevcutSource(makeRows(79))))).toThrow(/80/);
});

test('tekrar eden title|publisher çifti hata verir', () => {
  const rows = makeRows(80);
  rows[1] = { ...rows[0] };

  expect(() => mevcutKeySet(parseMevcutSource(makeMevcutSource(rows)))).toThrow(/tekrar/);
});

test('kesik mevcut.ts hata verir', async () => {
  const source = await readFile(MEVCUT_FILE, 'utf8');
  const truncated = source.slice(0, source.lastIndexOf('  {') + 20);

  expect(() => parseMevcutSource(truncated)).toThrow();
});

test('eksik alan hata verir', () => {
  const source = `export const MEVCUT: readonly CatalogBookSeed[] = [
  {
    title: 'Kitap',
    exam: 'TYT',
  },
];
`;

  expect(() => parseMevcutSource(source)).toThrow(/eksik/);
});
