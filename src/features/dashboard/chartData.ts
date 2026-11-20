import type { AytAlan, Exam, ExamResult, ExamType } from '@/domain/types';

/** Number of points kept in the exams page trend chart. */
export const MAX_CHART_POINTS = 10;

/** Dashboard chart shows a shorter window so it fits above the fold. */
export const DASHBOARD_CHART_POINTS = 8;

const labelFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
});

export interface NetSeries {
  labels: string[];
  values: number[];
}

export interface ExamComparison {
  /** Previous exam of the same type/alan bucket, if any. */
  previous?: Exam;
  currentTotal: number;
  previousTotal?: number;
  /** `currentTotal - previousTotal`; absent when there is no previous exam. */
  delta?: number;
}

function formatLabel(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) {
    return date;
  }
  return labelFormatter.format(new Date(year, month - 1, day));
}

/**
 * An AYT exam without an alan is a general AYT exam, so it belongs to the
 * Genel (`tumu`) bucket. TYT exams never store an alan.
 */
function alanOf(exam: Exam): AytAlan {
  return exam.alan ?? 'tumu';
}

function compareExams(left: Exam, right: Exam): number {
  return (
    left.date.localeCompare(right.date) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Filters exams by type/alan and returns the most recent `limit` points in
 * ascending order, which is what every chart needs.
 */
function selectExams(
  exams: Exam[],
  type: ExamType,
  alan?: AytAlan,
  limit = MAX_CHART_POINTS,
): Exam[] {
  return exams
    .filter((exam) => exam.type === type)
    .filter((exam) => type !== 'AYT' || alan === undefined || alanOf(exam) === alan)
    .sort(compareExams)
    .slice(-limit);
}

function sumNetByExam(results: ExamResult[]): Map<string, number> {
  const netByExam = new Map<string, number>();
  for (const result of results) {
    netByExam.set(result.examId, (netByExam.get(result.examId) ?? 0) + result.net);
  }
  return netByExam;
}

/**
 * Builds an ascending total-net trend for one exam type. An omitted `alan`
 * keeps every AYT exam; `tumu` means Genel and also matches exams whose alan
 * was left empty. Only the most recent `MAX_CHART_POINTS` exams are returned.
 */
export function buildNetSeries(
  exams: Exam[],
  results: ExamResult[],
  type: ExamType,
  alan?: AytAlan,
): NetSeries {
  const netByExam = sumNetByExam(results);
  const points = selectExams(exams, type, alan);

  return {
    labels: points.map((exam) => formatLabel(exam.date)),
    values: points.map((exam) => netByExam.get(exam.id) ?? 0),
  };
}

/**
 * Per-subject net trend. An exam without a result for the subject contributes
 * `0`, matching the total series' "not entered" convention and keeping the two
 * charts aligned on the same date labels.
 */
export function buildSubjectNetSeries(
  exams: Exam[],
  results: ExamResult[],
  type: ExamType,
  subjectId: string,
  alan?: AytAlan,
): NetSeries {
  const netByExam = new Map<string, number>();
  for (const result of results) {
    if (result.subjectId === subjectId) {
      netByExam.set(result.examId, (netByExam.get(result.examId) ?? 0) + result.net);
    }
  }
  const points = selectExams(exams, type, alan);

  return {
    labels: points.map((exam) => formatLabel(exam.date)),
    values: points.map((exam) => netByExam.get(exam.id) ?? 0),
  };
}

/**
 * Compares an exam with the immediately preceding exam of the same type and
 * AYT alan bucket (the "same subject set" for chart purposes). The previous
 * exam is the one that appears directly before `current` in the canonical
 * date/createdAt/id order used by the exams list.
 */
export function buildExamComparison(
  exams: Exam[],
  results: ExamResult[],
  current: Exam,
): ExamComparison {
  const netByExam = sumNetByExam(results);
  const currentTotal = netByExam.get(current.id) ?? 0;
  const pool = exams
    .filter((exam) => exam.type === current.type)
    .filter((exam) => current.type !== 'AYT' || alanOf(exam) === alanOf(current))
    .sort(compareExams);

  const currentIndex = pool.findIndex((exam) => exam.id === current.id);
  let previous: Exam | undefined;
  if (currentIndex > 0) {
    previous = pool[currentIndex - 1];
  } else if (currentIndex === -1) {
    previous = pool.filter((exam) => compareExams(exam, current) < 0).at(-1);
  }

  if (!previous) {
    return { currentTotal };
  }
  const previousTotal = netByExam.get(previous.id) ?? 0;
  return {
    previous,
    currentTotal,
    previousTotal,
    delta: currentTotal - previousTotal,
  };
}

/** Trims a series to its newest `count` points for compact charts. */
export function tailSeries(series: NetSeries, count: number): NetSeries {
  return {
    labels: series.labels.slice(-count),
    values: series.values.slice(-count),
  };
}
