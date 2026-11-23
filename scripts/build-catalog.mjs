#!/usr/bin/env node
/**
 * Katalog araştırma raporlarını (`docs/superpowers/research/catalog-2026-11-23/*.json`)
 * okuyup ders başına seed modüllerini ve `src/data/catalog/index.ts` dosyasını üretir.
 *
 * Kullanım: `node scripts/build-catalog.mjs`
 *
 * Kurallar:
 * - Zorunlu alanlar ve `confidence` high/medium doğrulanır; hata varsa hiçbir dosya yazılmaz.
 * - `mevcut.ts` içindeki `title|publisher` çifti reddedilir; dosya çözümlenemezse build durur.
 * - Raporlar arası `title|publisher` tekrarı listelenir, ilk satır korunur, sonrakiler çıkarılır.
 * - `src/data/catalog/mevcut.ts` dosyasına hiçbir koşulda yazılmaz.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const MEVCUT_ROW_COUNT = 80;
const MEVCUT_FIELDS = ['title', 'publisher', 'exam', 'subjectSlug', 'totalPages', 'edition'];
const MEVCUT_FIELD_SET = new Set(MEVCUT_FIELDS);

/**
 * Metin sabitini (tek/çift tırnak) atlayıp bir sonraki konumu döndürür.
 * @param {string} text
 * @param {number} start
 * @param {string} quote
 * @returns {number}
 */
function skipStringLiteral(text, start, quote) {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  throw new Error('metin sabiti kapanmadan dosya bitti');
}

/**
 * Yorumları boşlukla değiştirir; metin sabitlerine dokunmaz.
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index);
      const end = newline === -1 ? text.length : newline;
      out += ' '.repeat(end - index);
      index = end;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2);
      if (close === -1) throw new Error('yorum kapanmadan dosya bitti');
      out += ' '.repeat(close + 2 - index);
      index = close + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const end = skipStringLiteral(text, index, char);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Tek tırnaklı/çift tırnaklı TS metin gövdesindeki kaçış dizilerini çözer.
 * @param {string} raw
 * @param {string} where
 * @returns {string}
 */
function unescapeTsString(raw, where) {
  let value = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== '\\') {
      value += char;
      continue;
    }
    index += 1;
    if (index >= raw.length) throw new Error(`${where}: metin kaçışı eksik`);
    const escape = raw[index];
    if (escape === 'n') value += '\n';
    else if (escape === 'r') value += '\r';
    else if (escape === 't') value += '\t';
    else if (escape === 'b') value += '\b';
    else if (escape === 'f') value += '\f';
    else if (escape === 'v') value += '\v';
    else if (escape === '0') value += '\0';
    else if (escape === 'x') {
      const hex = raw.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error(`${where}: geçersiz \\x kaçışı`);
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 2;
    } else if (escape === 'u') {
      if (raw[index + 1] === '{') {
        const close = raw.indexOf('}', index + 2);
        if (close === -1) throw new Error(`${where}: geçersiz \\u kaçışı`);
        const hex = raw.slice(index + 2, close);
        if (!/^[0-9a-fA-F]{1,6}$/.test(hex) || Number.parseInt(hex, 16) > 0x10ffff) {
          throw new Error(`${where}: geçersiz \\u kaçışı`);
        }
        value += String.fromCodePoint(Number.parseInt(hex, 16));
        index = close;
      } else {
        const hex = raw.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`${where}: geçersiz \\u kaçışı`);
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
      }
    } else if (escape === '\n') {
      // satır devamı: değere bir şey eklenmez
    } else if (escape === '\r') {
      if (raw[index + 1] === '\n') index += 1;
    } else {
      // \\, \', \" ve bilinmeyen kaçışlar: kaçış karakteri düşer
      value += escape;
    }
  }
  return value;
}

/**
 * Tek bir `{ ... }` satırını çözümler.
 * @param {string} block
 * @param {number} rowIndex
 * @returns {{ title: string, publisher: string }}
 */
function parseMevcutBlock(block, rowIndex) {
  const where = `mevcut.ts satır ${rowIndex + 1}`;
  const fieldPattern =
    /([A-Za-z_$][\w$]*)\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?))/g;
  /** @type {Record<string, string | number>} */
  const values = {};
  let match;
  while ((match = fieldPattern.exec(block)) !== null) {
    const key = match[1];
    if (Object.hasOwn(values, key)) throw new Error(`${where}: "${key}" alanı iki kez tanımlı`);
    if (match[2] !== undefined) values[key] = unescapeTsString(match[2], where);
    else if (match[3] !== undefined) values[key] = unescapeTsString(match[3], where);
    else values[key] = Number(match[4]);
  }

  const rest = block.replace(fieldPattern, '');
  if (!/^[\s{},]*$/.test(rest)) throw new Error(`${where}: çözümlenemeyen alan var`);

  const keys = Object.keys(values);
  const missing = MEVCUT_FIELDS.filter((field) => !Object.hasOwn(values, field));
  const extra = keys.filter((field) => !MEVCUT_FIELD_SET.has(field));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${where}: beklenen alanlar eksik/fazla${missing.length > 0 ? ` (eksik: ${missing.join(', ')})` : ''}${extra.length > 0 ? ` (fazla: ${extra.join(', ')})` : ''}`,
    );
  }

  const title = values.title;
  const publisher = values.publisher;
  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error(`${where}: "title" boş olamaz`);
  }
  if (typeof publisher !== 'string' || publisher.trim() === '') {
    throw new Error(`${where}: "publisher" boş olamaz`);
  }
  return { title: title.trim(), publisher: publisher.trim() };
}

/**
 * `mevcut.ts` kaynağını nesne blokları hâlinde çözümler. Yorumları atlar,
 * kaçış dizilerini çözer ve tanınmayan biçimde hata verir (fail-closed).
 * @param {string} source
 * @returns {Array<{ title: string, publisher: string }>}
 */
export function parseMevcutSource(source) {
  const text = stripComments(source.replace(/^\uFEFF/, ''));
  const match = /export\s+const\s+MEVCUT\b[^=]*=\s*\[/.exec(text);
  if (!match) throw new Error('MEVCUT dizisi bulunamadı');

  let index = match.index + match[0].length;
  let arrayDepth = 1;
  let inObject = false;
  let objectDepth = 0;
  let objectStart = -1;
  /** @type {string[]} */
  const blocks = [];

  while (index < text.length) {
    const char = text[index];
    if (char === "'" || char === '"' || char === '`') {
      index = skipStringLiteral(text, index, char);
      continue;
    }
    if (char === '{') {
      if (inObject) {
        objectDepth += 1;
      } else {
        inObject = true;
        objectDepth = 1;
        objectStart = index;
      }
      index += 1;
      continue;
    }
    if (char === '}') {
      if (!inObject) throw new Error('MEVCUT dizisinde beklenmeyen "}"');
      objectDepth -= 1;
      if (objectDepth === 0) {
        blocks.push(text.slice(objectStart, index + 1));
        inObject = false;
        objectStart = -1;
      }
      index += 1;
      continue;
    }
    if (!inObject && char === '[') {
      arrayDepth += 1;
      index += 1;
      continue;
    }
    if (!inObject && char === ']') {
      arrayDepth -= 1;
      if (arrayDepth === 0) {
        if (blocks.length === 0) throw new Error('MEVCUT dizisinde satır yok');
        return blocks.map((block, blockIndex) => parseMevcutBlock(block, blockIndex));
      }
      index += 1;
      continue;
    }
    index += 1;
  }

  throw new Error('MEVCUT dizisi kapanmadan dosya bitti');
}

/**
 * Satırlardan `title|publisher` kümesi üretir; tam 80 benzersiz çift ister.
 * @param {Array<{ title: string, publisher: string }>} rows
 * @returns {Set<string>}
 */
export function mevcutKeySet(rows) {
  if (rows.length !== MEVCUT_ROW_COUNT) {
    throw new Error(`${MEVCUT_ROW_COUNT} satır bekleniyordu, ${rows.length} bulundu`);
  }
  const keys = new Set(rows.map((row) => `${row.title}|${row.publisher}`));
  if (keys.size !== rows.length) {
    throw new Error(`${rows.length - keys.size} tekrar eden title|publisher çifti var`);
  }
  return keys;
}

/**
 * `mevcut.ts` içindeki title + publisher çiftlerini okur. Dosya değişmez.
 * Çözümleme başarısızsa veya 80 benzersiz çift yoksa build durur.
 * @returns {Promise<Set<string>>}
 */
async function readMevcutKeys() {
  const source = await readFile(MEVCUT_FILE, 'utf8');
  try {
    return mevcutKeySet(parseMevcutSource(source));
  } catch (error) {
    throw new Error(
      `src/data/catalog/mevcut.ts okunamadı: ${/** @type {Error} */ (error).message}`,
    );
  }
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

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`HATA: ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  });
}
