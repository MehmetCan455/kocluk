import type { ExamType } from '@/domain/types';
import { deterministicId } from '@/lib/deterministicId';
import { CATALOG_NAMESPACE } from '@/lib/namespaces';

export interface CatalogBookSeed {
  title: string;
  publisher: string;
  exam: ExamType;
  subjectSlug: string;
  totalPages: number;
  edition: string;
}

/**
 * Starter catalog. These four books are the only shipped rows; page counts are
 * starter values, and every other book is added through `Kendi kitabımı ekle`.
 */
export const CATALOG_SEED: readonly CatalogBookSeed[] = [
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2025',
  },
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: '3D Yayınları',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 360,
    edition: '2026',
  },
  {
    title: 'TYT Matematik Soru Kitabı',
    publisher: 'Palme',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 384,
    edition: '2026',
  },
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Karekök',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 392,
    edition: '2026',
  },
];

/** Stable catalog identity: title + publisher + edition (see design doc). */
export function catalogBookId(title: string, publisher: string, edition: string): string {
  return deterministicId(CATALOG_NAMESPACE, `${title}|${publisher}|${edition}`);
}
