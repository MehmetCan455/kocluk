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

/**
 * Builds an ascending net trend for one exam type. An omitted `alan` keeps
 * every AYT exam; `tumu` means Genel and also matches exams whose alan was
 * left empty. Only the most recent `MAX_CHART_POINTS` exams are returned, in
 * the oldest-to-newest order the chart needs.
 */
export function buildNetSeries(
  exams: Exam[],
  results: ExamResult[],
  type: ExamType,
  alan?: AytAlan,
): NetSeries {
  const netByExam = new Map<string, number>();
  for (const result of results) {
    netByExam.set(result.examId, (netByExam.get(result.examId) ?? 0) + result.net);
  }

  const points = exams
    .filter((exam) => exam.type === type)
    .filter((exam) => type !== 'AYT' || alan === undefined || alanOf(exam) === alan)
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(-MAX_CHART_POINTS);

  return {
    labels: points.map((exam) => formatLabel(exam.date)),
    values: points.map((exam) => netByExam.get(exam.id) ?? 0),
  };
}

/** Trims a series to its newest `count` points for compact charts. */
export function tailSeries(series: NetSeries, count: number): NetSeries {
  return {
    labels: series.labels.slice(-count),
    values: series.values.slice(-count),
  };
}
