import { CATALOG_SEED } from '@/data/catalogBooks';
import { buildNewModelFromLegacy } from '@/domain/legacyBookMigration';
import { db } from './db';

/** Written after the one-time legacy shelf conversion, successful or empty. */
export const LEGACY_SHELF_MIGRATED_KEY = 'legacyShelfMigrated';

/**
 * Moves the pre-v6 `books`/`topicBooks` archive onto the page-based shelf when
 * an existing local database is opened by the new build. The legacy tables are
 * never deleted; they stay as the read-only test archive.
 *
 * Runs at most once. A database that already has any `userBooks` row (including
 * tombstones) is left alone, so a user who deleted their shelf is not given it
 * back. Catalog rows that already exist, such as the seeded starter books, are
 * not overwritten.
 */
export async function migrateLegacyShelfFromLocalData(): Promise<void> {
  const marker = await db.settings.get(LEGACY_SHELF_MIGRATED_KEY);
  if (marker?.value === true) {
    return;
  }

  const [userBookCount, books] = await Promise.all([
    db.userBooks.count(),
    db.books.toArray(),
  ]);
  if (userBookCount > 0) {
    await db.settings.put({ key: LEGACY_SHELF_MIGRATED_KEY, value: true });
    return;
  }

  const [topicBooks, topics, subjects] = await Promise.all([
    db.topicBooks.toArray(),
    db.topics.toArray(),
    db.subjects.toArray(),
  ]);
  const derived = buildNewModelFromLegacy({
    books,
    topicBooks,
    topics,
    subjects,
    catalogSeed: CATALOG_SEED,
  });

  await db.transaction(
    'rw',
    db.catalogBooks,
    db.userBooks,
    db.topicProgress,
    db.settings,
    async () => {
      // Re-check inside the transaction so a concurrent catalog/shelf write
      // cannot be duplicated by a second app tab starting at the same time.
      if ((await db.userBooks.count()) > 0) {
        await db.settings.put({ key: LEGACY_SHELF_MIGRATED_KEY, value: true });
        return;
      }

      for (const row of derived.catalogBooks) {
        if (!(await db.catalogBooks.get(row.id))) {
          await db.catalogBooks.put(row);
        }
      }
      for (const row of derived.userBooks) {
        if (!(await db.userBooks.get(row.id))) {
          await db.userBooks.put(row);
        }
      }
      for (const row of derived.topicProgress) {
        if (!(await db.topicProgress.get(row.id))) {
          await db.topicProgress.put(row);
        }
      }

      await db.settings.put({ key: LEGACY_SHELF_MIGRATED_KEY, value: true });
    },
  );
}
