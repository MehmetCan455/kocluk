import type { ExamType, Progress } from './types';

/** Bir kitabın tek bir konuya verebileceği en yüksek katkı. */
const MAX_TOPIC_CONTRIBUTION = 50;

/** `TYT-AYT` / `TYT - AYT` gibi ortak tek cilt kitapların başlık deseni. */
const COMMON_EXAM_TITLE = /TYT\s*[-–]\s*AYT/i;

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

/**
 * Kitap, dersin sınavına ve slug'ına uyuyorsa sayılır. `TYT-AYT` ortak
 * kitapları katalogda tek sınavla işaretli olsa da iki sınava da katkı verir.
 */
export function countsForSubject(book: SubjectBookMatch, subject: SubjectRef): boolean {
  if (!sameSlug(book.subjectSlug, subject.slug)) {
    return false;
  }
  if (book.exam === subject.exam) {
    return true;
  }
  return COMMON_EXAM_TITLE.test(book.title);
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
