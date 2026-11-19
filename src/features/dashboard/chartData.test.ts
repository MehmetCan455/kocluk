import { expect, test } from 'vitest';
import type { AytAlan, Exam, ExamResult, ExamType } from '@/domain/types';
import { buildNetSeries } from './chartData';

function exam(
  id: string,
  type: ExamType,
  date: string,
  alan?: AytAlan,
  name = id,
): Exam {
  return {
    id,
    type,
    name,
    date,
    alan,
    note: '',
    createdAt: `${date}T10:00:00.000Z`,
  };
}

function result(id: string, examId: string, net: number): ExamResult {
  return {
    id,
    examId,
    subjectId: `subject-${id}`,
    correct: net,
    wrong: 0,
    blank: 0,
    net,
  };
}

const TYT_EXAMS: Exam[] = [
  exam('tyt-kasim', 'TYT', '2026-11-17'),
  exam('tyt-eylul', 'TYT', '2026-09-01'),
  exam('tyt-ekim', 'TYT', '2026-10-10'),
];

const TYT_RESULTS: ExamResult[] = [
  result('r1', 'tyt-eylul', 28),
  result('r2', 'tyt-eylul', 17.5),
  result('r3', 'tyt-ekim', 10),
  result('r4', 'tyt-kasim', 39),
];

test('denemeleri tarihe göre sıralar ve toplam netleri tr-TR etiketleriyle döndürür', () => {
  expect(buildNetSeries(TYT_EXAMS, TYT_RESULTS, 'TYT')).toEqual({
    labels: ['1 Eyl', '10 Eki', '17 Kas'],
    values: [45.5, 10, 39],
  });
});

test('son 10 denemeyi tarih sırasıyla alır', () => {
  const exams: Exam[] = [];
  const results: ExamResult[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const day = String(index).padStart(2, '0');
    const id = `tyt-${index}`;
    exams.push(exam(id, 'TYT', `2026-09-${day}`));
    results.push(result(`r-${index}`, id, index));
  }

  const series = buildNetSeries(exams, results, 'TYT');

  expect(series.labels).toHaveLength(10);
  expect(series.labels[0]).toBe('3 Eyl');
  expect(series.labels[9]).toBe('12 Eyl');
  expect(series.values).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('yalnızca istenen türdeki denemeleri ve sonuçlarını kullanır', () => {
  const exams = [
    ...TYT_EXAMS,
    exam('ayt-1', 'AYT', '2026-11-18', 'sayisal'),
    exam('ayt-2', 'AYT', '2026-11-19', 'ea'),
  ];
  const results = [
    ...TYT_RESULTS,
    result('ayt-r1', 'ayt-1', 30),
    result('ayt-r2', 'ayt-2', 20),
  ];

  expect(buildNetSeries(exams, results, 'AYT', 'sayisal')).toEqual({
    labels: ['18 Kas'],
    values: [30],
  });
  expect(buildNetSeries(exams, results, 'TYT').labels).toEqual(['1 Eyl', '10 Eki', '17 Kas']);
});

test('AYT alan filtresi yalnızca eşleşenleri alır, alanı boş denemeler Genel sayılır', () => {
  const exams = [
    exam('ayt-sayisal', 'AYT', '2026-09-01', 'sayisal'),
    exam('ayt-ea', 'AYT', '2026-09-02', 'ea'),
    exam('ayt-bos', 'AYT', '2026-09-03'),
    exam('ayt-genel', 'AYT', '2026-09-04', 'tumu'),
  ];
  const results = [
    result('r1', 'ayt-sayisal', 10),
    result('r2', 'ayt-ea', 20),
    result('r3', 'ayt-bos', 30),
    result('r4', 'ayt-genel', 40),
  ];

  expect(buildNetSeries(exams, results, 'AYT', 'sayisal').values).toEqual([10]);
  expect(buildNetSeries(exams, results, 'AYT', 'ea').values).toEqual([20]);
  expect(buildNetSeries(exams, results, 'AYT', 'sozel').values).toEqual([]);
  expect(buildNetSeries(exams, results, 'AYT', 'tumu')).toEqual({
    labels: ['3 Eyl', '4 Eyl'],
    values: [30, 40],
  });
  expect(buildNetSeries(exams, results, 'AYT')).toEqual({
    labels: ['1 Eyl', '2 Eyl', '3 Eyl', '4 Eyl'],
    values: [10, 20, 30, 40],
  });
});

test('veri yoksa boş seri döndürür', () => {
  expect(buildNetSeries([], [], 'TYT')).toEqual({ labels: [], values: [] });
});
