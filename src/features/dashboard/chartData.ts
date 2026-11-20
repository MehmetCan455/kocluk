import type { AytAlan, Exam, ExamResult, ExamType } from '@/domain/types';

/** Dashboard chart shows a shorter window so it fits above the fold. */
export const DASHBOARD_CHART_POINTS = 8;

const labelFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
});

/**
 * One plotted exam. `record` is an all-time fact: it is true only when the net
 * is strictly higher than every earlier point of the full matching history.
 * The first point is never a record, and equal nets are not records.
 */
export interface NetSeriesPoint {
  examId: string;
  /** Deneme adı; aynı gün yapılan denemeleri tooltip'te ayırır. */
  examName: string;
  /** Stored `YYYY-MM-DD` date. */
  date: string;
  /** Short tr-TR axis label, e.g. "17 Kas". */
  label: string;
  net: number;
  /** True when this net sets a new all-time high for the series. */
  record: boolean;
}

export interface NetSeries {
  points: NetSeriesPoint[];
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
 * Default alan for callers that do not pass a resolver. Legacy exams can be
 * stored without an alan (or as `tumu`); they fall into the old Genel bucket
 * here. Screens that can infer a concrete branch pass an `AlanResolver`
 * instead, so a legacy exam is compared and charted with its inferred branch.
 */
function alanOf(exam: Exam): AytAlan {
  return exam.alan ?? 'tumu';
}

export type AlanResolver = (exam: Exam) => AytAlan;

function compareExams(left: Exam, right: Exam): number {
  return (
    left.date.localeCompare(right.date) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Filters exams by type/alan and returns every matching exam in ascending
 * order, which is what every chart needs. `resolveAlan` lets legacy exams
 * participate in a concrete branch instead of the Genel bucket.
 */
function selectExams(
  exams: Exam[],
  type: ExamType,
  alan?: AytAlan,
  resolveAlan: AlanResolver = alanOf,
): Exam[] {
  return exams
    .filter((exam) => exam.type === type)
    .filter((exam) => type !== 'AYT' || alan === undefined || resolveAlan(exam) === alan)
    .sort(compareExams);
}

/** Builds points in ascending order and marks each all-time net record. */
function toSeries(
  exams: Exam[],
  netForExam: (examId: string) => number,
): NetSeries {
  let highestNet: number | undefined;
  const points = exams.map((exam): NetSeriesPoint => {
    const net = netForExam(exam.id);
    const record = highestNet !== undefined && net > highestNet;
    highestNet = highestNet === undefined ? net : Math.max(highestNet, net);
    return {
      examId: exam.id,
      examName: exam.name,
      date: exam.date,
      label: formatLabel(exam.date),
      net,
      record,
    };
  });
  return { points };
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
 * keeps every AYT exam. A concrete `alan` is matched through `resolveAlan`,
 * which defaults to the stored value (missing alan = legacy Genel); callers
 * that know the subjects can infer legacy branches from results. Every
 * matching exam is returned; the dashboard trims with `tailSeries`.
 */
export function buildNetSeries(
  exams: Exam[],
  results: ExamResult[],
  type: ExamType,
  alan?: AytAlan,
  resolveAlan: AlanResolver = alanOf,
): NetSeries {
  const netByExam = sumNetByExam(results);
  const points = selectExams(exams, type, alan, resolveAlan);
  return toSeries(points, (examId) => netByExam.get(examId) ?? 0);
}

/**
 * Per-subject net trend. An exam without a result for the subject contributes
 * `0`, matching the total series' "not entered" convention and keeping the two
 * charts aligned on the same date labels. Every matching exam is returned.
 */
export function buildSubjectNetSeries(
  exams: Exam[],
  results: ExamResult[],
  type: ExamType,
  subjectId: string,
  alan?: AytAlan,
  resolveAlan: AlanResolver = alanOf,
): NetSeries {
  const netByExam = new Map<string, number>();
  for (const result of results) {
    if (result.subjectId === subjectId) {
      netByExam.set(result.examId, (netByExam.get(result.examId) ?? 0) + result.net);
    }
  }
  const points = selectExams(exams, type, alan, resolveAlan);
  return toSeries(points, (examId) => netByExam.get(examId) ?? 0);
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
  resolveAlan: AlanResolver = alanOf,
): ExamComparison {
  const netByExam = sumNetByExam(results);
  const currentTotal = netByExam.get(current.id) ?? 0;
  const pool = exams
    .filter((exam) => exam.type === current.type)
    .filter(
      (exam) =>
        current.type !== 'AYT' || resolveAlan(exam) === resolveAlan(current),
    )
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

/**
 * Trims a series to its newest `count` points for compact charts. Record flags
 * are preserved as-is: an all-time record stays a record even when the earlier
 * points that it beat are no longer visible.
 */
export function tailSeries(series: NetSeries, count: number): NetSeries {
  return { points: series.points.slice(-count) };
}
