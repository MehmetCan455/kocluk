import type { AytAlan, ExamType, GeometryMode, Subject } from '@/domain/types';

/**
 * Exam question counts for the deneme form. These are the ÖSYM totals; topic
 * and book tracking are untouched by this file.
 */
export interface ExamSubjectConfig {
  seedKey: string;
  questionCount: number;
}

export type AytBranch = Exclude<AytAlan, 'tumu'>;

export const TYT_TOTAL_QUESTIONS = 120;
export const AYT_TOTAL_QUESTIONS = 80;

/** Geometry is 10 questions, folded into maths when `geometryMode` is combined. */
export const GEOMETRY_QUESTIONS = 10;
/** Standalone maths question count before geometry is folded in. */
const MATH_QUESTIONS = 30;

const TYT_BASE: readonly ExamSubjectConfig[] = [
  { seedKey: 'tyt-turkce', questionCount: 40 },
  { seedKey: 'tyt-tarih', questionCount: 5 },
  { seedKey: 'tyt-cografya', questionCount: 5 },
  { seedKey: 'tyt-felsefe', questionCount: 5 },
  { seedKey: 'tyt-din-kulturu', questionCount: 5 },
  { seedKey: 'tyt-matematik', questionCount: MATH_QUESTIONS },
  { seedKey: 'tyt-geometri', questionCount: GEOMETRY_QUESTIONS },
  { seedKey: 'tyt-fizik', questionCount: 7 },
  { seedKey: 'tyt-kimya', questionCount: 7 },
  { seedKey: 'tyt-biyoloji', questionCount: 6 },
];

const AYT_BASE: Readonly<Record<AytBranch, readonly ExamSubjectConfig[]>> = {
  sayisal: [
    { seedKey: 'ayt-matematik', questionCount: MATH_QUESTIONS },
    { seedKey: 'ayt-geometri', questionCount: GEOMETRY_QUESTIONS },
    { seedKey: 'ayt-fizik', questionCount: 14 },
    { seedKey: 'ayt-kimya', questionCount: 13 },
    { seedKey: 'ayt-biyoloji', questionCount: 13 },
  ],
  ea: [
    { seedKey: 'ayt-edebiyat', questionCount: 24 },
    { seedKey: 'ayt-tarih-1', questionCount: 10 },
    { seedKey: 'ayt-cografya-1', questionCount: 6 },
    { seedKey: 'ayt-matematik', questionCount: MATH_QUESTIONS },
    { seedKey: 'ayt-geometri', questionCount: GEOMETRY_QUESTIONS },
  ],
  sozel: [
    { seedKey: 'ayt-edebiyat', questionCount: 24 },
    { seedKey: 'ayt-tarih-1', questionCount: 10 },
    { seedKey: 'ayt-cografya-1', questionCount: 6 },
    { seedKey: 'ayt-tarih-2', questionCount: 11 },
    { seedKey: 'ayt-cografya-2', questionCount: 11 },
    { seedKey: 'ayt-felsefe-grubu', questionCount: 12 },
    { seedKey: 'ayt-din-kulturu', questionCount: 6 },
  ],
};

/**
 * The global AYT order requested by the brief. Every branch config above must
 * stay a subsequence of this list; `examConfig.test.ts` enforces that coupling
 * instead of deriving a union (the branch lists have different starts).
 */
export const AYT_SUBJECT_ORDER: readonly string[] = [
  'ayt-edebiyat',
  'ayt-tarih-1',
  'ayt-cografya-1',
  'ayt-tarih-2',
  'ayt-cografya-2',
  'ayt-felsefe-grubu',
  'ayt-din-kulturu',
  'ayt-matematik',
  'ayt-geometri',
  'ayt-fizik',
  'ayt-kimya',
  'ayt-biyoloji',
];

/** TYT order is exactly the config order, so it is derived rather than repeated. */
export const TYT_SUBJECT_ORDER: readonly string[] = TYT_BASE.map((row) => row.seedKey);

const SAYISAL_MARKERS: ReadonlySet<string> = new Set([
  'ayt-fizik',
  'ayt-kimya',
  'ayt-biyoloji',
]);

const SOZEL_MARKERS: ReadonlySet<string> = new Set([
  'ayt-tarih-2',
  'ayt-cografya-2',
  'ayt-felsefe-grubu',
]);

export function isAytBranch(value: AytAlan | '' | undefined | null): value is AytBranch {
  return value === 'sayisal' || value === 'ea' || value === 'sozel';
}

export const AYT_BRANCHES: readonly AytBranch[] = ['sayisal', 'ea', 'sozel'];

export function mathSeedKey(examType: ExamType): string {
  return examType === 'TYT' ? 'tyt-matematik' : 'ayt-matematik';
}

export function geometrySeedKey(examType: ExamType): string {
  return examType === 'TYT' ? 'tyt-geometri' : 'ayt-geometri';
}

function applyGeometryMode(
  rows: readonly ExamSubjectConfig[],
  geometryMode: GeometryMode,
): ExamSubjectConfig[] {
  if (geometryMode !== 'combined') {
    return [...rows];
  }

  return rows.flatMap((row) => {
    if (row.seedKey.endsWith('-geometri')) {
      return [];
    }
    if (row.seedKey.endsWith('-matematik')) {
      return [{ ...row, questionCount: row.questionCount + GEOMETRY_QUESTIONS }];
    }
    return [row];
  });
}

/**
 * The ordered subject rows for one exam. AYT without a concrete branch has no
 * rows: the form must ask for Sayısal / Eşit Ağırlık / Sözel first. Legacy
 * `tumu` values are resolved to a branch before the form calls this.
 */
export function getExamSubjectConfig(
  examType: ExamType,
  alan: AytAlan | '' | undefined,
  geometryMode: GeometryMode,
): ExamSubjectConfig[] {
  if (examType === 'TYT') {
    return applyGeometryMode(TYT_BASE, geometryMode);
  }
  if (!isAytBranch(alan)) {
    return [];
  }
  return applyGeometryMode(AYT_BASE[alan], geometryMode);
}

/** Question count for one subject, or `undefined` when it is not in the exam. */
export function getQuestionCount(
  examType: ExamType,
  alan: AytAlan | '' | undefined,
  geometryMode: GeometryMode,
  seedKey: string,
): number | undefined {
  return getExamSubjectConfig(examType, alan, geometryMode).find(
    (row) => row.seedKey === seedKey,
  )?.questionCount;
}

/**
 * Infers the AYT branch of an old exam that has no branch (or was saved as the
 * old Genel/`tumu` bucket). Physics/chemistry/biology imply Sayısal;
 * Tarih-2/Coğrafya-2/Felsefe Grubu imply Sözel; anything else is Eşit Ağırlık.
 * Results are never modified here.
 */
export function inferAytAlan(
  results: ReadonlyArray<{ subjectId: string }>,
  subjects: ReadonlyArray<Pick<Subject, 'id' | 'seedKey'>>,
): AytBranch {
  const seedKeyById = new Map(subjects.map((subject) => [subject.id, subject.seedKey]));
  const present = new Set<string>();
  for (const result of results) {
    const seedKey = seedKeyById.get(result.subjectId);
    if (seedKey) {
      present.add(seedKey);
    }
  }

  for (const marker of SAYISAL_MARKERS) {
    if (present.has(marker)) {
      return 'sayisal';
    }
  }
  for (const marker of SOZEL_MARKERS) {
    if (present.has(marker)) {
      return 'sozel';
    }
  }
  return 'ea';
}

/** Stored branch when it is concrete, otherwise the branch inferred from results. */
export function resolveAytAlan(
  exam: { alan?: AytAlan },
  results: ReadonlyArray<{ subjectId: string }>,
  subjects: ReadonlyArray<Pick<Subject, 'id' | 'seedKey'>>,
): AytBranch {
  if (isAytBranch(exam.alan)) {
    return exam.alan;
  }
  return inferAytAlan(results, subjects);
}
