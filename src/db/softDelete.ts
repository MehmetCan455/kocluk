/**
 * `deletedAt` may come from Dexie rows (missing when active) or from the sync
 * API (`null` when active). An empty string is a present marker, so it must
 * stay deleted instead of resurrecting the row.
 */
export function isActiveRow(row: unknown): boolean {
  if (typeof row !== 'object' || row === null || !('deletedAt' in row)) {
    return true;
  }
  const { deletedAt } = row as { deletedAt?: unknown };
  return deletedAt === undefined || deletedAt === null;
}
