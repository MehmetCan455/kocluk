import type { PracticeFilters, PracticeSession } from '@/domain/types';

export interface PracticeScore {
  correct: number;
  wrong: number;
  blank: number;
  answered: number;
  total: number;
}

/**
 * Counts the recorded outcomes for the session's original photo ids. Deleted
 * photos keep their ids in `photoIds`/`results`, so a finished session keeps the
 * score it had even after the archive entry is removed.
 */
export function scorePracticeSession(
  session: Pick<PracticeSession, 'photoIds' | 'results'>,
): PracticeScore {
  let correct = 0;
  let wrong = 0;
  let blank = 0;

  for (const photoId of session.photoIds) {
    const outcome = session.results[photoId];
    if (outcome === 'correct') {
      correct += 1;
    } else if (outcome === 'wrong') {
      wrong += 1;
    } else if (outcome === 'blank') {
      blank += 1;
    }
  }

  return {
    correct,
    wrong,
    blank,
    answered: correct + wrong + blank,
    total: session.photoIds.length,
  };
}

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatPracticeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

/** Compact Turkish duration: "42 sn", "3 dk 5 sn", "1 sa 10 dk". */
export function formatPracticeDuration(startIso: string, endIso: string): string {
  const elapsed = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(elapsed)) {
    return '—';
  }
  const totalSeconds = Math.max(0, Math.round(elapsed / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds} sn`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes} dk ${seconds} sn` : `${minutes} dk`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} sa ${remainingMinutes} dk` : `${hours} sa`;
}

/** Short label for the wizard summary and the session history rows. */
export function describePracticeFilters(filters: PracticeFilters): string {
  const parts = [filters.examType ?? 'Karışık'];

  parts.push(
    filters.subjectIds && filters.subjectIds.length > 0
      ? `${filters.subjectIds.length} ders`
      : 'Tüm dersler',
  );

  if (filters.topicIds && filters.topicIds.length > 0) {
    parts.push(`${filters.topicIds.length} konu`);
  }
  if (filters.examId) {
    parts.push('Deneme seçili');
  }
  if (filters.onlyUnmastered !== false) {
    parts.push('Çözülmemişler');
  }

  return parts.join(' · ');
}
