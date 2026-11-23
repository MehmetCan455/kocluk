import type { ExamType } from '@/domain/types';

/** A starter catalog row; identity is title + publisher + edition. */
export interface CatalogBookSeed {
  title: string;
  publisher: string;
  exam: ExamType;
  subjectSlug: string;
  totalPages: number;
  edition: string;
}
