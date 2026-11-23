#!/usr/bin/env node
/**
 * Katalog araştırma raporlarını (`docs/superpowers/research/catalog-2026-11-23/*.json`)
 * okuyup ders başına seed modüllerini ve `src/data/catalog/index.ts` dosyasını üretir.
 *
 * Kullanım: `node scripts/build-catalog.mjs`
 *
 * Kurallar:
 * - Zorunlu alanlar ve `confidence` high/medium doğrulanır; hata varsa hiçbir dosya yazılmaz.
 * - `mevcut.ts` içindeki `title|publisher` çifti reddedilir.
 * - Raporlar arası `title|publisher` tekrarı listelenir, ilk satır korunur, sonrakiler çıkarılır.
 * - `src/data/catalog/mevcut.ts` dosyasına hiçbir koşulda yazılmaz.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {object} BookRow
 * @property {string} title
 * @property {string} publisher
 * @property {string} exam
 * @property {string} subjectSlug
 * @property {number} totalPages
 * @property {string} edition
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS_DIR = path.join(ROOT, 'docs', 'superpowers', 'research', 'catalog-2026-11-23');
const CATALOG_DIR = path.join(ROOT, 'src', 'data', 'catalog');
const INDEX_FILE = path.join(CATALOG_DIR, 'index.ts');
const MEVCUT_FILE = path.join(CATALOG_DIR, 'mevcut.ts');

/** [exam, subjectSlug, dosya adı, export sabiti] */
const MODULES = [
  ['TYT', 'turkce', 'tyt-turkce', 'TYT_TURKCE'],
  ['TYT', 'matematik', 'tyt-matematik', 'TYT_MATEMATIK'],
  ['TYT', 'geometri', 'tyt-geometri', 'TYT_GEOMETRI'],
  ['TYT', 'fizik', 'tyt-fizik', 'TYT_FIZIK'],
  ['TYT', 'kimya', 'tyt-kimya', 'TYT_KIMYA'],
  ['TYT', 'biyoloji', 'tyt-biyoloji', 'TYT_BIYOLOJI'],
  ['TYT', 'tarih', 'tyt-tarih', 'TYT_TARIH'],
  ['TYT', 'cografya', 'tyt-cografya', 'TYT_COGRAFYA'],
  ['TYT', 'felsefe', 'tyt-felsefe', 'TYT_FELSEFE'],
  ['TYT', 'din-kulturu', 'tyt-din-kulturu', 'TYT_DIN_KULTURU'],
  ['AYT', 'matematik', 'ayt-matematik', 'AYT_MATEMATIK'],
  ['AYT', 'geometri', 'ayt-geometri', 'AYT_GEOMETRI'],
  ['AYT', 'edebiyat', 'ayt-edebiyat', 'AYT_EDEBIYAT'],
  ['AYT', 'fizik', 'ayt-fizik', 'AYT_FIZIK'],
  ['AYT', 'kimya', 'ayt-kimya', 'AYT_KIMYA'],
  ['AYT', 'biyoloji', 'ayt-biyoloji', 'AYT_BIYOLOJI'],
  ['AYT', 'tarih-1', 'ayt-tarih-1', 'AYT_TARIH_1'],
  ['AYT', 'tarih-2', 'ayt-tarih-2', 'AYT_TARIH_2'],
  ['AYT', 'cografya-1', 'ayt-cografya-1', 'AYT_COGRAFYA_1'],
  ['AYT', 'cografya-2', 'ayt-cografya-2', 'AYT_COGRAFYA_2'],
  ['AYT', 'felsefe-grubu', 'ayt-felsefe-grubu', 'AYT_FELSEFE_GRUBU'],
  ['AYT', 'din-kulturu', 'ayt-din-kulturu', 'AYT_DIN_KULTURU'],
];

if (MODULES.some(([, , file]) => file === 'mevcut')) {
  throw new Error('MODULES listesi mevcut.ts dosyasını içeremez');
}

const EXAMS = new Set(['TYT', 'AYT']);
const SUBJECT_SLUGS = new Set(MODULES.map(([, subjectSlug]) => subjectSlug));
const CONFIDENCES = new Set(['high', 'medium']);
const EDITION_RE = /^\d{4}$/;
const MODULE_BY_KEY = new Map(
  MODULES.map(([exam, subjectSlug, file, constName]) => [
    `${exam}|${subjectSlug}`,
    { exam, subjectSlug, file, constName },
  ]),
);
if (MODULE_BY_KEY.size !== MODULES.length) {
  throw new Error('MODULES listesinde tekrar eden ders var');
}
const COLLATOR = new Intl.Collator('tr', { numeric: true });

/** @param {string} relativePath */
function display(relativePath) {
  return relativePath.split(path.sep).join('/');
}

/** @param {string} value */
function isHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Tek bir kitap satırını doğrular.
 * @param {unknown} book
 * @param {string} where
 * @returns {string[]} hata mesajları
 */
function validateBook(book, where) {
  /** @type {string[]} */
  const errors = [];
  /** @param {string} message */
  const add = (message) => errors.push(`${where}: ${message}`);

  if (book === null || typeof book !== 'object' || Array.isArray(book)) {
    add('kitap bir nesne olmalı');
    return errors;
  }

  /** @type {Record<string, unknown>} */
  const row = book;

  if (typeof row.title !== 'string' || row.title.trim() === '') {
    add('`title` boş olmayan bir metin olmalı');
  }
  if (typeof row.publisher !== 'string' || row.publisher.trim() === '') {
    add('`publisher` boş olmayan bir metin olmalı');
  }
  if (typeof row.exam !== 'string' || !EXAMS.has(row.exam)) {
    add('`exam` yalnızca TYT veya AYT olabilir');
  }
  if (typeof row.subjectSlug !== 'string' || !SUBJECT_SLUGS.has(row.subjectSlug)) {
    add('`subjectSlug` izinli ders listesinde olmalı');
  }
  if (
    typeof row.exam === 'string' &&
    EXAMS.has(row.exam) &&
    typeof row.subjectSlug === 'string' &&
    SUBJECT_SLUGS.has(row.subjectSlug) &&
    !MODULE_BY_KEY.has(`${row.exam}|${row.subjectSlug}`)
  ) {
    add(`\`${row.exam} ${row.subjectSlug}\` için ders modülü yok`);
  }
  if (!Number.isInteger(row.totalPages) || /** @type {number} */ (row.totalPages) <= 0) {
    add('`totalPages` pozitif tam sayı olmalı');
  }
  if (typeof row.edition !== 'string' || !EDITION_RE.test(row.edition)) {
    add('`edition` 4 haneli yıl olmalı');
  }
  if (!isHttpUrl(row.sourceUrl)) {
    add('`sourceUrl` http(s) adresi olmalı');
  }
  if (
    !Array.isArray(row.sourceUrls) ||
    row.sourceUrls.length === 0 ||
    !row.sourceUrls.every((url) => isHttpUrl(url))
  ) {
    add('`sourceUrls` en az bir http(s) adresi içermeli');
  }
  if (!CONFIDENCES.has(row.confidence)) {
    add('`confidence` "high" veya "medium" olmalı ("low" kabul edilmez)');
  }
  if (row.notes !== undefined && row.notes !== null && typeof row.notes !== 'string') {
    add('`notes` metin olmalı');
  }

  return errors;
}

/**
 * `mevcut.ts` içindeki title + publisher çiftlerini okur. Dosya değişmez.
 * @returns {Promise<Set<string>>}
 */
async function readMevcutKeys() {
  const source = (await readFile(MEVCUT_FILE, 'utf8')).replace(/^\uFEFF/, '');
  const titles = [...source.matchAll(/title:\s*'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1]);
  const publishers = [...source.matchAll(/publisher:\s*'((?:[^'\\]|\\.)*)'/g)].map(
    (match) => match[1],
  );

  if (titles.length === 0 || titles.length !== publishers.length) {
    console.warn(
      'UYARI: src/data/catalog/mevcut.ts okunamadı; mevcut çakışma kontrolü atlandı.',
    );
    return new Set();
  }

  const keys = new Set();
  for (let index = 0; index < titles.length; index += 1) {
    keys.add(`${titles[index].trim()}|${publishers[index].trim()}`);
  }
  return keys;
}

/**
 * `docs/superpowers/research/catalog-2026-11-23/*.json` raporlarını okur.
 * @returns {Promise<Array<{ file: string, books: unknown[] }>>}
 */
async function readReports() {
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await readdir(REPORTS_DIR, { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  const reports = [];
  for (const file of files) {
    const filePath = path.join(REPORTS_DIR, file);
    let parsed;
    try {
      const text = (await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `${display(path.join('docs', 'superpowers', 'research', 'catalog-2026-11-23', file))} okunamadı: ${/** @type {Error} */ (error).message}`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !Array.isArray(/** @type {{ books?: unknown }} */ (parsed).books)
    ) {
      throw new Error(`${file}: kök nesnede "books" dizisi olmalı`);
    }
    reports.push({ file, books: /** @type {{ books: unknown[] }} */ (parsed).books });
  }
  return reports;
}

/** @returns {Promise<string>} */
async function detectEol() {
  try {
    const source = await readFile(INDEX_FILE, 'utf8');
    return source.includes('\r\n') ? '\r\n' : '\n';
  } catch {
    return '\n';
  }
}

/**
 * @param {string} value
 * @returns {string} tek tırnaklı TS metin sabiti
 */
function quote(value) {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}'`;
}

/**
 * @param {string} constName
 * @param {BookRow[]} books
 * @param {string} eol
 */
function moduleSource(constName, books, eol) {
  const header = `import type { CatalogBookSeed } from './types';${eol}${eol}`;
  if (books.length === 0) {
    return `${header}export const ${constName}: readonly CatalogBookSeed[] = [];${eol}`;
  }

  const rows = books
    .map((book) =>
      [
        '  {',
        `    title: ${quote(book.title)},`,
        `    publisher: ${quote(book.publisher)},`,
        `    exam: ${quote(book.exam)},`,
        `    subjectSlug: ${quote(book.subjectSlug)},`,
        `    totalPages: ${book.totalPages},`,
        `    edition: ${quote(book.edition)},`,
        '  },',
      ].join(eol),
    )
    .join(eol);

  return `${header}export const ${constName}: readonly CatalogBookSeed[] = [${eol}${rows}${eol}];${eol}`;
}

/** @param {string} eol */
function indexSource(eol) {
  const lines = [
    `import type { CatalogBookSeed } from './types';`,
    ...MODULES.map(([, , file, constName]) => `import { ${constName} } from './${file}';`),
    '',
    '/** Research reports land here; `CATALOG_SEED` appends these after the starter rows. */',
    'export const YENI_KATALOG: readonly CatalogBookSeed[] = [',
    ...MODULES.map(([, , , constName]) => `  ...${constName},`),
    '];',
  ];
  return `${lines.join(eol)}${eol}`;
}

/**
 * @param {BookRow} a
 * @param {BookRow} b
 */
function compareBooks(a, b) {
  return (
    COLLATOR.compare(a.title, b.title) ||
    COLLATOR.compare(a.publisher, b.publisher) ||
    COLLATOR.compare(a.edition, b.edition)
  );
}

async function main() {
  const reports = await readReports();
  const mevcutKeys = await readMevcutKeys();

  /** @type {string[]} */
  const errors = [];
  /** @type {BookRow[]} */
  const accepted = [];
  /** @type {Map<string, { where: string }>} */
  const seen = new Map();
  let rowCount = 0;

  for (const report of reports) {
    report.books.forEach((book, index) => {
      rowCount += 1;
      const where = `${report.file} books[${index}]`;
      const bookErrors = validateBook(book, where);
      if (bookErrors.length > 0) {
        errors.push(...bookErrors);
        return;
      }

      const row = /** @type {BookRow} */ (book);
      const title = row.title.trim();
      const publisher = row.publisher.trim();
      const key = `${title}|${publisher}`;

      if (mevcutKeys.has(key)) {
        errors.push(
          `${where}: "${title}" — ${publisher} mevcut.ts içinde zaten var (edition farklı olsa bile eklenemez)`,
        );
        return;
      }

      const first = seen.get(key);
      if (first) {
        console.warn(
          `UYARI ${where}: "${title}" — ${publisher} tekrarı (ilk kayıt: ${first.where}); satır çıkarıldı.`,
        );
        return;
      }

      seen.set(key, { where });
      accepted.push({
        title,
        publisher,
        exam: row.exam,
        subjectSlug: row.subjectSlug,
        totalPages: row.totalPages,
        edition: row.edition,
      });
    });
  }

  if (errors.length > 0) {
    for (const message of errors) console.error(`HATA ${message}`);
    console.error(`\n${errors.length} hata bulundu; hiçbir dosya yazılmadı.`);
    process.exitCode = 1;
    return;
  }

  /** @type {Map<string, typeof accepted>} */
  const groups = new Map(MODULES.map(([exam, subjectSlug]) => [`${exam}|${subjectSlug}`, []]));
  for (const book of accepted) {
    groups.get(`${book.exam}|${book.subjectSlug}`)?.push(book);
  }

  const eol = await detectEol();

  for (const [exam, subjectSlug, file, constName] of MODULES) {
    const books = groups.get(`${exam}|${subjectSlug}`) ?? [];
    books.sort(compareBooks);
    const target = path.join(CATALOG_DIR, `${file}.ts`);
    await writeFile(target, moduleSource(constName, books, eol), 'utf8');
  }
  await writeFile(INDEX_FILE, indexSource(eol), 'utf8');

  console.log(
    `Raporlar: ${reports.length} JSON dosyası, ${rowCount} satır okundu, ${accepted.length} satır kabul edildi.`,
  );
  for (const [exam, subjectSlug, file] of MODULES) {
    const count = groups.get(`${exam}|${subjectSlug}`)?.length ?? 0;
    console.log(`  ${exam} ${subjectSlug} (${file}.ts): ${count}`);
  }
  console.log(
    `Toplam: ${accepted.length} yeni kitap, ${MODULES.length} ders modülü, ${reports.length} rapor.`,
  );
  console.log('src/data/catalog/index.ts yeniden üretildi; mevcut.ts değiştirilmedi.');
}

main().catch((error) => {
  console.error(`HATA: ${/** @type {Error} */ (error).message}`);
  process.exitCode = 1;
});
