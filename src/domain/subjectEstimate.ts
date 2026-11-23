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

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent));
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
 * Her kitabın yüzdesini konu sırasına göre dağıtır. Kısmi kitap konu başına en
 * fazla %50 verir ve dolu konuları atlar. Bitmiş (%100) kitap dersin tamamını
 * kapsadığı için her konuya %50 verir; böylece iki kitap bir dersi tamamlar.
 */
export function distributeBookPercent(
  topicIds: readonly string[],
  books: ReadonlyArray<{ percent: number }>,
): Map<string, number> {
  const byTopic = new Map<string, number>();
  for (const topicId of topicIds) {
    if (!byTopic.has(topicId)) {
      byTopic.set(topicId, 0);
    }
  }
  const uniqueTopicIds = [...byTopic.keys()];

  for (const book of books) {
    const percent = clampPercent(book.percent);
    if (percent <= 0) {
      continue;
    }

    if (percent >= 100) {
      for (const topicId of uniqueTopicIds) {
        const current = byTopic.get(topicId) ?? 0;
        const room = Math.min(MAX_TOPIC_CONTRIBUTION, 100 - current);
        if (room > 0) {
          byTopic.set(topicId, current + room);
        }
      }
      continue;
    }

    let remaining = percent;
    for (const topicId of uniqueTopicIds) {
      const current = byTopic.get(topicId) ?? 0;
      const room = Math.min(MAX_TOPIC_CONTRIBUTION, 100 - current);
      const pay = Math.min(remaining, room);
      if (pay <= 0) {
        continue;
      }
      byTopic.set(topicId, current + pay);
      remaining -= pay;
      if (remaining === 0) {
        break;
      }
    }
  }

  return byTopic;
}

/** Konu bazlı tahmin haritası ve bunun ders tahminine yuvarlanmış ortalaması. */
export function subjectBookEstimate(
  topicIds: readonly string[],
  books: ReadonlyArray<{ percent: number }>,
): { byTopic: Map<string, number>; estimate: number } {
  const byTopic = distributeBookPercent(topicIds, books);
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
