import { deterministicId } from '@/lib/deterministicId';
import { CATALOG_NAMESPACE } from '@/lib/namespaces';
import type { CatalogBookSeed } from './catalog/types';
import { YENI_KATALOG } from './catalog';
import { MEVCUT } from './catalog/mevcut';

export type { CatalogBookSeed };

/**
 * Starter catalog: the 80 original books plus rows added from subject research
 * reports. Every other book is added through `Kendi kitabımı ekle`.
 */
export const CATALOG_SEED: readonly CatalogBookSeed[] = [
  ...MEVCUT,
  ...YENI_KATALOG,
];

/** Stable catalog identity: title + publisher + edition (see design doc). */
export function catalogBookId(title: string, publisher: string, edition: string): string {
  return deterministicId(CATALOG_NAMESPACE, `${title}|${publisher}|${edition}`);
}

/**
 * Seed catalog ids are the only rows that ship with the app and must never be
 * uploaded as a user's private books. Custom books — including rows pulled
 * from another device without the local `ownerId` marker — are not in this set.
 */
const SHARED_CATALOG_IDS: ReadonlySet<string> = new Set(
  CATALOG_SEED.map((seed) => catalogBookId(seed.title, seed.publisher, seed.edition)),
);

export function isSharedCatalogBook(id: string): boolean {
  return SHARED_CATALOG_IDS.has(id);
}
