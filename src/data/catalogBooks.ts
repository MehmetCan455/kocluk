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
 * Starter catalog: a starter set across publishers, so the shelf picker has a
 * realistic starting list. Page counts are current-listing values; editions
 * vary, and the per-user total-page override stays available when a copy
 * differs. Every other book is added through `Kendi kitabımı ekle`.
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
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Apotemi',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2026',
  },
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Aydın Yayınları',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 368,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Bankası',
    publisher: 'Aydın Yayınları',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 344,
    edition: '2026',
  },
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: '345 Yayınları',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 432,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Bankası',
    publisher: '345 Yayınları',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 384,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 416,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Bankası',
    publisher: '3D Yayınları',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 304,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Kitabı',
    publisher: 'Palme',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 384,
    edition: '2026',
  },
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Orijinal Yayınları',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Bankası',
    publisher: 'Orijinal Yayınları',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 431,
    edition: '2026',
  },
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Barış Yayınları',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 304,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Bankası',
    publisher: 'Barış Yayınları',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 328,
    edition: '2026',
  },
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Hız ve Renk Yayınları',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Bankası',
    publisher: 'Hız ve Renk Yayınları',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 368,
    edition: '2026',
  },
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Toprak Yayınları',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Bankası',
    publisher: 'Toprak Yayınları',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2026',
  },
  {
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Mikroorijinal',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2026',
  },
  {
    title: 'AYT Matematik Soru Bankası',
    publisher: 'Mikroorijinal',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2026',
  },
  {
    title: 'TYT Biyoloji Soru Bankası',
    publisher: 'Biyotik',
    exam: 'TYT',
    subjectSlug: 'biyoloji',
    totalPages: 224,
    edition: '2026',
  },
  {
    title: 'AYT Biyoloji Soru Bankası',
    publisher: 'Biyotik',
    exam: 'AYT',
    subjectSlug: 'biyoloji',
    totalPages: 272,
    edition: '2026',
  },
  {
    title: 'TYT Kimya Soru Bankası',
    publisher: 'Orbital Yayınları',
    exam: 'TYT',
    subjectSlug: 'kimya',
    totalPages: 313,
    edition: '2026',
  },
  {
    title: 'AYT Kimya Soru Bankası',
    publisher: 'Orbital Yayınları',
    exam: 'AYT',
    subjectSlug: 'kimya',
    totalPages: 368,
    edition: '2026',
  },
  {
    title: 'TYT Fizik Soru Kitabı',
    publisher: 'Profizik Yayınları',
    exam: 'TYT',
    subjectSlug: 'fizik',
    totalPages: 334,
    edition: '2026',
  },
  {
    title: 'AYT Fizik Soru Kitabı',
    publisher: 'Profizik Yayınları',
    exam: 'AYT',
    subjectSlug: 'fizik',
    totalPages: 368,
    edition: '2026',
  },
  {
    title: 'TYT Biyoloji Soru Bankası',
    publisher: 'Biyoanaliz',
    exam: 'TYT',
    subjectSlug: 'biyoloji',
    totalPages: 256,
    edition: '2026',
  },
  {
    title: 'AYT Biyoloji Soru Bankası',
    publisher: 'Biyoanaliz',
    exam: 'AYT',
    subjectSlug: 'biyoloji',
    totalPages: 272,
    edition: '2026',
  },
];

/** Stable catalog identity: title + publisher + edition (see design doc). */
export function catalogBookId(title: string, publisher: string, edition: string): string {
  return deterministicId(CATALOG_NAMESPACE, `${title}|${publisher}|${edition}`);
}
