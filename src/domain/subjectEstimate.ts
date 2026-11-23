import type { ExamType, Progress } from './types';

/** Bir kitabın tek bir konuya verebileceği en yüksek katkı. */
const MAX_TOPIC_CONTRIBUTION = 50;

/** `TYT-AYT` / `TYT AYT` gibi ortak tek cilt kitapların başlık deseni. */
const COMMON_EXAM_TITLE = /TYT\s*[-–]?\s*AYT/i;

type AytSubjectGroup = 'tarih' | 'cografya';

/** Tek cilt AYT Tarih/Coğrafya kitaplarının kapsadığı alt ders slug'ları. */
const AYT_GROUP_BY_SLUG: Record<string, AytSubjectGroup> = {
  'tarih-1': 'tarih',
  'tarih-2': 'tarih',
  'cografya-1': 'cografya',
  'cografya-2': 'cografya',
};

/**
 * Ortak TYT-AYT kitabının TYT slug'ından AYT'deki karşılıklarına eşleme.
 * `turkce` bilinçli olarak yok: TYT Türkçe ile AYT Edebiyatı ayrı derslerdir.
 */
const COMMON_TITLE_AYT_SLUGS: Record<string, readonly string[]> = {
  tarih: ['tarih-1', 'tarih-2'],
  cografya: ['cografya-1', 'cografya-2'],
  felsefe: ['felsefe-grubu'],
};

/** Türkçe büyük harfleri doğru küçültür; `TARIH` yazımını da `tarih`e indirger. */
function normalizeTitle(title: string): string {
  return title.toLocaleLowerCase('tr').replaceAll('ı', 'i');
}

/**
 * "AYT Tarih" / "AYT 3D Tarih" / "AYT Iceberg Coğrafya" gibi, alt ders ayrımı
 * olmayan birleşik başlıklar. Marka adı `AYT` ile ders adı arasında en fazla
 * üç kelime olabilir.
 */
const COMBINED_AYT_TITLE: Record<AytSubjectGroup, RegExp> = {
  tarih: /(^|[^a-zçğıöşü])ayt(?:\s+[a-z0-9çğıöşü.&]+){0,3}\s+tarih(?!\w)/u,
  cografya: /(^|[^a-zçğıöşü])ayt(?:\s+[a-z0-9çğıöşü.&]+){0,3}\s+co[ğg]rafya(?!\w)/u,
};

/** "Tarih-1", "Tarih 2", "Coğrafya-1" gibi alt ders ayrımını belirten başlıklar. */
const EXPLICIT_AYT_SUB_SUBJECT = /(?:tarih|co[ğg]rafya)\s*(?:[-–—]\s*)?[12](?!\d)/u;

function combinedAytGroup(slug: string | undefined): AytSubjectGroup | undefined {
  if (!slug) {
    return undefined;
  }
  const key = slug.trim().toLowerCase();
  return Object.hasOwn(AYT_GROUP_BY_SLUG, key) ? AYT_GROUP_BY_SLUG[key] : undefined;
}

export interface SubjectBookMatch {
  title: string;
  exam?: ExamType;
  subjectSlug?: string;
}

export interface SubjectRef {
  exam: ExamType;
  slug: string;
}

function sameSlug(left: string | undefined, right: string): boolean {
  return (left ?? '').trim().toLowerCase() === right.trim().toLowerCase();
}

/** Ortak TYT-AYT başlığı, TYT slug'ının AYT karşılığına mı denk geliyor? */
function commonTitleTargetsAytSlug(
  bookSlug: string | undefined,
  title: string,
  subjectSlug: string,
): boolean {
  if (!COMMON_EXAM_TITLE.test(title)) {
    return false;
  }
  const key = (bookSlug ?? '').trim().toLowerCase();
  if (!Object.hasOwn(COMMON_TITLE_AYT_SLUGS, key)) {
    return false;
  }
  return COMMON_TITLE_AYT_SLUGS[key]?.includes(subjectSlug.trim().toLowerCase()) === true;
}

/**
 * Kitap, dersin sınavına ve slug'ına uyuyorsa sayılır. `TYT-AYT` ortak
 * kitapları katalogda tek sınavla işaretli olsa da iki sınava da katkı verir;
 * ortak Tarih/Coğrafya/Felsefe kitabı AYT'de alt derslerine eşlenir. Ayrıca alt
 * ders ayrımı olmayan tek cilt AYT Tarih/Coğrafya kitapları, aynı grubun kardeş
 * alt dersine (Tarih-1 ↔ Tarih-2, Coğrafya-1 ↔ Coğrafya-2) de sayılır;
 * başlıkta açık `-1`/`-2` ayrımı varsa sayılmaz.
 */
export function countsForSubject(book: SubjectBookMatch, subject: SubjectRef): boolean {
  if (sameSlug(book.subjectSlug, subject.slug)) {
    return book.exam === subject.exam || COMMON_EXAM_TITLE.test(book.title);
  }

  if (
    subject.exam === 'AYT' &&
    commonTitleTargetsAytSlug(book.subjectSlug, book.title, subject.slug)
  ) {
    return true;
  }

  const bookGroup = combinedAytGroup(book.subjectSlug);
  if (!bookGroup || bookGroup !== combinedAytGroup(subject.slug)) {
    return false;
  }
  if (book.exam !== 'AYT' || subject.exam !== 'AYT') {
    return false;
  }

  const title = normalizeTitle(book.title);
  if (EXPLICIT_AYT_SUB_SUBJECT.test(title)) {
    return false;
  }
  return COMBINED_AYT_TITLE[bookGroup].test(title);
}

/**
 * One book's page history. Pages are split evenly across the subject's topics,
 * so a partial read advances the topics whose page chunks it touches instead of
 * pouring everything into the first topics.
 */
export interface BookPageRead {
  totalPages: number;
  ranges: ReadonlyArray<{ fromPage: number; toPage: number }>;
}

/**
 * Splits `totalPages` (1..totalPages) across the topics as evenly as possible.
 * The first `totalPages % topicCount` topics get one extra page.
 */
export function topicPageChunks(
  topicIds: readonly string[],
  totalPages: number,
): number[] {
  const topicCount = new Set(topicIds).size;
  if (topicCount === 0) {
    return [];
  }
  const pages = Number.isFinite(totalPages) ? Math.max(0, Math.floor(totalPages)) : 0;
  const base = Math.floor(pages / topicCount);
  const extra = pages % topicCount;
  return Array.from(
    { length: topicCount },
    (_, index) => base + (index < extra ? 1 : 0),
  );
}

/** Unique page count of the read ranges clipped to `[fromPage, toPage]`, overlaps once. */
function coveredPagesIn(
  ranges: ReadonlyArray<{ fromPage: number; toPage: number }>,
  fromPage: number,
  toPage: number,
): number {
  const intervals: Array<[number, number]> = [];
  for (const range of ranges) {
    const start = Math.max(fromPage, Math.ceil(range.fromPage));
    const end = Math.min(toPage, Math.floor(range.toPage));
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
      intervals.push([start, end]);
    }
  }
  if (intervals.length === 0) {
    return 0;
  }

  intervals.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let covered = 0;
  let [currentStart, currentEnd] = intervals[0]!;
  for (let index = 1; index < intervals.length; index += 1) {
    const [start, end] = intervals[index]!;
    if (start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, end);
      continue;
    }
    covered += currentEnd - currentStart + 1;
    currentStart = start;
    currentEnd = end;
  }
  return covered + currentEnd - currentStart + 1;
}

/**
 * Assigns each book's read pages to the topic whose chunk contains them. A
 * topic gets at most 50 per book and at most 100 across books, so two finished
 * books complete it. Finished books touch every chunk and therefore give every
 * topic 50; partial reads only advance the chunks they reach.
 */
export function distributeBookPages(
  topicIds: readonly string[],
  books: readonly BookPageRead[],
): Map<string, number> {
  const uniqueTopicIds = [...new Set(topicIds)];
  const byTopic = new Map<string, number>(
    uniqueTopicIds.map((topicId) => [topicId, 0]),
  );
  if (uniqueTopicIds.length === 0) {
    return byTopic;
  }

  for (const book of books) {
    const totalPages = Number.isFinite(book.totalPages)
      ? Math.max(0, Math.floor(book.totalPages))
      : 0;
    if (totalPages === 0) {
      continue;
    }

    const chunks = topicPageChunks(uniqueTopicIds, totalPages);
    let cursor = 1;
    for (let index = 0; index < uniqueTopicIds.length; index += 1) {
      const chunkPages = chunks[index] ?? 0;
      const chunkEnd = cursor + chunkPages - 1;
      if (chunkPages > 0) {
        const topicId = uniqueTopicIds[index]!;
        const covered = coveredPagesIn(book.ranges, cursor, chunkEnd);
        const contribution = Math.min(
          MAX_TOPIC_CONTRIBUTION,
          Math.round((covered / chunkPages) * MAX_TOPIC_CONTRIBUTION),
        );
        if (contribution > 0) {
          byTopic.set(topicId, Math.min(100, (byTopic.get(topicId) ?? 0) + contribution));
        }
      }
      cursor = chunkEnd + 1;
    }
  }

  return byTopic;
}

/** Topic-by-topic estimate map and its rounded-down subject average. */
export function subjectBookEstimate(
  topicIds: readonly string[],
  books: readonly BookPageRead[],
): { byTopic: Map<string, number>; estimate: number } {
  const byTopic = distributeBookPages(topicIds, books);
  const values = [...byTopic.values()];
  if (values.length === 0) {
    return { byTopic, estimate: 0 };
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { byTopic, estimate: Math.min(100, Math.floor(average)) };
}

/** Manuel bitirme her zaman %100'dür; kitap katkısı onu düşürmez. */
export function effectiveTopicPercent(manualDone: boolean, bookPercent: number): number {
  return Math.max(manualDone ? 100 : 0, bookPercent);
}

/**
 * Ders yüzdesi konuların ortalamasıdır; tüm konular bitmeden %99'u geçmez.
 * `started` çağıranın "en az bir konu başladı" bilgisini taşır.
 */
export function calculateSubjectProgress(
  topicPercents: readonly number[],
  anyStarted: boolean,
): Progress {
  const total = topicPercents.length;
  const solved = topicPercents.filter((percent) => percent >= 100).length;
  const done = total > 0 && solved === total;
  const average =
    total === 0
      ? 0
      : topicPercents.reduce((sum, percent) => sum + percent, 0) / total;
  const percent = done ? 100 : Math.min(99, Math.floor(average));

  return {
    solved,
    total,
    percent,
    remaining: total - solved,
    started: anyStarted,
    done,
  };
}
