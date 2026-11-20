import type { AytAlan, ExamType, Subject } from '@/domain/types';

/**
 * Her alanın AYT'de gördüğü dersler. `tumu` seçildiğinde hiçbir AYT dersi
 * gizlenmez; TYT dersleri hiçbir zaman gizlenmez.
 */
export const ALAN_SUBJECT_SEED_KEYS: Readonly<
  Record<Exclude<AytAlan, 'tumu'>, readonly string[]>
> = {
  sayisal: [
    'ayt-matematik',
    'ayt-geometri',
    'ayt-fizik',
    'ayt-kimya',
    'ayt-biyoloji',
  ],
  ea: [
    'ayt-matematik',
    'ayt-geometri',
    'ayt-edebiyat',
    'ayt-tarih-1',
    'ayt-cografya-1',
    'ayt-tarih-2',
    'ayt-cografya-2',
    'ayt-felsefe-grubu',
    'ayt-din-kulturu',
  ],
  sozel: [
    'ayt-edebiyat',
    'ayt-tarih-1',
    'ayt-cografya-1',
    'ayt-tarih-2',
    'ayt-cografya-2',
    'ayt-felsefe-grubu',
    'ayt-din-kulturu',
  ],
};

/** Seçilen alanın dışında kalan AYT derslerinin ID'lerini döndürür. */
export function computeHiddenSubjects(
  alan: AytAlan,
  subjects: ReadonlyArray<Pick<Subject, 'id' | 'exam' | 'seedKey'>>,
): string[] {
  if (alan === 'tumu') {
    return [];
  }

  const visibleSeedKeys = new Set(ALAN_SUBJECT_SEED_KEYS[alan]);
  return subjects
    .filter((subject) => subject.exam === 'AYT' && !visibleSeedKeys.has(subject.seedKey))
    .map((subject) => subject.id);
}

/**
 * `hiddenSubjects` stores both the user's manual hides and the AYT subjects
 * hidden automatically by the study alan (`computeHiddenSubjects`). Screens
 * that make their own AYT branch choice (exam form, exams chart) need only the
 * manual part: otherwise a subject the student does not study would stay
 * hidden even for an exam branch that includes it.
 */
export function manualHiddenSubjects(
  hiddenSubjects: readonly string[],
  aytAlan: AytAlan,
  examType: ExamType,
  subjects: ReadonlyArray<Pick<Subject, 'id' | 'exam' | 'seedKey'>>,
): Set<string> {
  const autoHidden = new Set(
    examType === 'AYT' ? computeHiddenSubjects(aytAlan, subjects) : [],
  );
  return new Set(hiddenSubjects.filter((subjectId) => !autoHidden.has(subjectId)));
}
