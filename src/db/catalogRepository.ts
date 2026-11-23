import { CATALOG_SEED, catalogBookId } from '@/data/catalogBooks';
import type { CatalogBook } from '@/domain/types';
import { matchesTokens, tokenizeTr } from '@/lib/normalize';
import { db } from './db';

/** Non-deleted catalog rows, ordered by title for stable pickers and lists. */
function listActiveCatalogBooks(): Promise<CatalogBook[]> {
  return db.catalogBooks
    .orderBy('title')
    .filter((book) => !book.deletedAt)
    .toArray();
}

/** The haystack the catalog search matches against: title, publisher, subject, exam. */
function catalogHaystack(book: CatalogBook): string {
  return [book.title, book.publisher ?? '', book.subjectSlug ?? '', book.exam ?? ''].join(' ');
}

/**
 * Inserts starter catalog rows that are missing. Existing rows (including ones
 * the user edited or soft-deleted) are never overwritten, so seeding is safe to
 * run on every app start.
 */
export async function seedCatalog(): Promise<void> {
  const now = new Date().toISOString();
  const rows: CatalogBook[] = CATALOG_SEED.map((seed) => ({
    id: catalogBookId(seed.title, seed.publisher, seed.edition),
    title: seed.title,
    publisher: seed.publisher,
    exam: seed.exam,
    subjectSlug: seed.subjectSlug,
    totalPages: seed.totalPages,
    edition: seed.edition,
    createdAt: now,
    updatedAt: now,
  }));

  await db.transaction('rw', db.catalogBooks, async () => {
    const existing = await db.catalogBooks.bulkGet(rows.map((row) => row.id));
    const existingIds = new Set(
      existing.filter((row): row is CatalogBook => row !== undefined).map((row) => row.id),
    );
    const missing = rows.filter((row) => !existingIds.has(row.id));
    if (missing.length > 0) {
      await db.catalogBooks.bulkAdd(missing);
    }
  });
}

export function listCatalogBooks(): Promise<CatalogBook[]> {
  return listActiveCatalogBooks();
}

export async function getCatalogBook(id: string): Promise<CatalogBook | undefined> {
  const book = await db.catalogBooks.get(id);
  return book && !book.deletedAt ? book : undefined;
}

export async function searchCatalog(query: string): Promise<CatalogBook[]> {
  const tokens = tokenizeTr(query);
  if (tokens.length === 0) {
    return [];
  }

  const books = await listActiveCatalogBooks();
  return books.filter((book) => matchesTokens(catalogHaystack(book), tokens));
}
