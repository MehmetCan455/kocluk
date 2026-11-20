import { expect, test } from 'vitest';
import type { AytAlan, Exam, ExamResult, ExamType } from '@/domain/types';
import {
  buildExamComparison,
  buildNetSeries,
  buildSubjectNetSeries,
  tailSeries,
  type NetSeries,
} from './chartData';

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

test('denemeleri tarihe göre sıralar; ad, tarih, net ve rekor bilgisini taşır', () => {
  expect(buildNetSeries(TYT_EXAMS, TYT_RESULTS, 'TYT').points).toEqual([
    {
      examId: 'tyt-eylul',
      examName: 'tyt-eylul',
      date: '2026-09-01',
      label: '1 Eyl',
      net: 45.5,
      record: false,
    },
    {
      examId: 'tyt-ekim',
      examName: 'tyt-ekim',
      date: '2026-10-10',
      label: '10 Eki',
      net: 10,
      record: false,
    },
    {
      examId: 'tyt-kasim',
      examName: 'tyt-kasim',
      date: '2026-11-17',
      label: '17 Kas',
      net: 39,
      record: false,
    },
  ]);
});

test('ilk nokta rekor değildir, eşit net rekor sayılmaz, yeni zirve rekor sayılır', () => {
  const exams = [
    exam('tyt-1', 'TYT', '2026-09-01'),
    exam('tyt-2', 'TYT', '2026-09-02'),
    exam('tyt-3', 'TYT', '2026-09-03'),
    exam('tyt-4', 'TYT', '2026-09-04'),
  ];
  const results = [
    result('r1', 'tyt-1', 10),
    result('r2', 'tyt-2', 10),
    result('r3', 'tyt-3', 15),
    result('r4', 'tyt-4', 12),
  ];

  expect(
    buildNetSeries(exams, results, 'TYT').points.map((point) => point.record),
  ).toEqual([false, false, true, false]);
});

test('aynı gün denemeleri ada göre ayrılır', () => {
  const exams = [
    {
      ...exam('tyt-sabah', 'TYT', '2026-09-01', undefined, 'Sabah Denemesi'),
      createdAt: '2026-09-01T08:00:00.000Z',
    },
    {
      ...exam('tyt-aksam', 'TYT', '2026-09-01', undefined, 'Akşam Denemesi'),
      createdAt: '2026-09-01T18:00:00.000Z',
    },
  ];
  const results = [
    result('r1', 'tyt-sabah', 20),
    result('r2', 'tyt-aksam', 25),
  ];

  const points = buildNetSeries(exams, results, 'TYT').points;
  expect(points.map((point) => point.label)).toEqual(['1 Eyl', '1 Eyl']);
  expect(points.map((point) => point.examName)).toEqual([
    'Sabah Denemesi',
    'Akşam Denemesi',
  ]);
  expect(points.map((point) => point.net)).toEqual([20, 25]);
});

test('son 10 denemeyle sınırlanmadan tüm denemeleri tarih sırasıyla alır', () => {
  const exams: Exam[] = [];
  const results: ExamResult[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const day = String(index).padStart(2, '0');
    const id = `tyt-${index}`;
    exams.push(exam(id, 'TYT', `2026-09-${day}`));
    results.push(result(`r-${index}`, id, index));
  }

  const series = buildNetSeries(exams, results, 'TYT');

  expect(series.points).toHaveLength(12);
  expect(series.points[0]).toMatchObject({
    examId: 'tyt-1',
    label: '1 Eyl',
    net: 1,
    record: false,
  });
  expect(series.points[11]).toMatchObject({
    examId: 'tyt-12',
    label: '12 Eyl',
    net: 12,
    record: true,
  });
  expect(series.points.map((point) => point.net)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]);
  // Her yeni zirve rekor; ilk nokta değil.
  expect(series.points.map((point) => point.record)).toEqual([
    false, true, true, true, true, true, true, true, true, true, true, true,
  ]);
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

  expect(buildNetSeries(exams, results, 'AYT', 'sayisal').points).toEqual([
    {
      examId: 'ayt-1',
      examName: 'ayt-1',
      date: '2026-11-18',
      label: '18 Kas',
      net: 30,
      record: false,
    },
  ]);
  expect(buildNetSeries(exams, results, 'TYT').points.map((point) => point.label)).toEqual([
    '1 Eyl',
    '10 Eki',
    '17 Kas',
  ]);
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

  expect(buildNetSeries(exams, results, 'AYT', 'sayisal').points.map((point) => point.net)).toEqual([
    10,
  ]);
  expect(buildNetSeries(exams, results, 'AYT', 'ea').points.map((point) => point.net)).toEqual([
    20,
  ]);
  expect(buildNetSeries(exams, results, 'AYT', 'sozel').points).toEqual([]);

  const genelPoints = buildNetSeries(exams, results, 'AYT', 'tumu').points;
  expect(genelPoints.map((point) => point.label)).toEqual(['3 Eyl', '4 Eyl']);
  expect(genelPoints.map((point) => point.net)).toEqual([30, 40]);

  const allPoints = buildNetSeries(exams, results, 'AYT').points;
  expect(allPoints.map((point) => point.label)).toEqual([
    '1 Eyl',
    '2 Eyl',
    '3 Eyl',
    '4 Eyl',
  ]);
  expect(allPoints.map((point) => point.net)).toEqual([10, 20, 30, 40]);
});

test('veri yoksa boş seri döndürür', () => {
  expect(buildNetSeries([], [], 'TYT')).toEqual({ points: [] });
});

test('ders bazında net serisi yalnızca o dersin sonuçlarını kullanır', () => {
  const exams = [
    exam('tyt-1', 'TYT', '2026-09-01'),
    exam('tyt-2', 'TYT', '2026-09-02'),
    exam('tyt-3', 'TYT', '2026-09-03'),
    exam('ayt-1', 'AYT', '2026-09-04', 'sayisal'),
  ];
  const results = [
    result('r1', 'tyt-1', 10),
    result('r2', 'tyt-1', 6),
    result('r3', 'tyt-2', 20),
    result('r4', 'ayt-1', 30),
  ];
  // r1/r2 share the same derived subject id; simulate two rows for the
  // requested subject on one exam and a missing subject on another.
  results[0] = { ...results[0], subjectId: 'matematik' };
  results[1] = { ...results[1], subjectId: 'matematik' };
  results[2] = { ...results[2], subjectId: 'fizik' };
  results[3] = { ...results[3], subjectId: 'matematik' };

  const tytPoints = buildSubjectNetSeries(exams, results, 'TYT', 'matematik').points;
  expect(tytPoints.map((point) => point.label)).toEqual(['1 Eyl', '2 Eyl', '3 Eyl']);
  expect(tytPoints.map((point) => point.net)).toEqual([16, 0, 0]);
  expect(tytPoints.map((point) => point.record)).toEqual([false, false, false]);
  expect(tytPoints[0]).toMatchObject({
    examId: 'tyt-1',
    examName: 'tyt-1',
    date: '2026-09-01',
  });

  expect(
    buildSubjectNetSeries(exams, results, 'AYT', 'matematik', 'sayisal').points.map(
      (point) => point.net,
    ),
  ).toEqual([30]);
  expect(
    buildSubjectNetSeries(exams, results, 'AYT', 'matematik', 'ea').points,
  ).toEqual([]);
});

test('ders bazında pozitif netlerde yeni zirve rekor olur', () => {
  const exams = [
    exam('tyt-1', 'TYT', '2026-09-01'),
    exam('tyt-2', 'TYT', '2026-09-02'),
    exam('tyt-3', 'TYT', '2026-09-03'),
  ];
  const results = [
    { ...result('r1', 'tyt-1', 10), subjectId: 'matematik' },
    { ...result('r2', 'tyt-2', 20), subjectId: 'matematik' },
    { ...result('r3', 'tyt-3', 15), subjectId: 'matematik' },
  ];
  const points = buildSubjectNetSeries(exams, results, 'TYT', 'matematik').points;

  expect(points.map((point) => point.net)).toEqual([10, 20, 15]);
  expect(points.map((point) => point.record)).toEqual([false, true, false]);
});

test('sonuçsuz deneme 0 olarak çizilir ama rekor kazanamaz', () => {
  const exams = [
    exam('tyt-1', 'TYT', '2026-09-01'),
    exam('tyt-bos', 'TYT', '2026-09-02'),
    exam('tyt-3', 'TYT', '2026-09-03'),
  ];
  // Önceki netler negatif: sonuçsuz deneme 0'a düşse de rekor olmamalı.
  const results = [
    result('r1', 'tyt-1', -5),
    result('r2', 'tyt-3', -6),
  ];

  const points = buildNetSeries(exams, results, 'TYT').points;
  expect(points.map((point) => point.net)).toEqual([-5, 0, -6]);
  expect(points.map((point) => point.record)).toEqual([false, false, false]);
});

test('seçilen derste sonucu olmayan deneme 0 olarak çizilir ama rekor kazanamaz', () => {
  const exams = [
    exam('tyt-1', 'TYT', '2026-09-01'),
    exam('tyt-2', 'TYT', '2026-09-02'),
    exam('tyt-3', 'TYT', '2026-09-03'),
  ];
  const results = [
    { ...result('r1', 'tyt-1', -5), subjectId: 'matematik' },
    { ...result('r2', 'tyt-2', -8), subjectId: 'fizik' },
    { ...result('r3', 'tyt-3', -6), subjectId: 'matematik' },
  ];

  const points = buildSubjectNetSeries(exams, results, 'TYT', 'matematik').points;
  expect(points.map((point) => point.net)).toEqual([-5, 0, -6]);
  expect(points.map((point) => point.record)).toEqual([false, false, false]);
});

test('tailSeries rekor bayrağını görünen pencereye göre yeniden hesaplamaz', () => {
  const series: NetSeries = {
    points: [
      { examId: 'a', examName: 'A', date: '2026-09-01', label: '1 Eyl', net: 5, record: false },
      { examId: 'b', examName: 'B', date: '2026-09-02', label: '2 Eyl', net: 10, record: true },
      { examId: 'c', examName: 'C', date: '2026-09-03', label: '3 Eyl', net: 7, record: false },
      { examId: 'd', examName: 'D', date: '2026-09-04', label: '4 Eyl', net: 8, record: false },
    ],
  };

  const trimmed = tailSeries(series, 2);
  expect(trimmed.points.map((point) => point.examId)).toEqual(['c', 'd']);
  // 8 > 7 olsa da 8, tüm geçmişteki 10 rekorunu kırmadığı için rekor değil.
  expect(trimmed.points.map((point) => point.record)).toEqual([false, false]);
  expect(trimmed.points.map((point) => point.net)).toEqual([7, 8]);

  // Pencere erken bir rekoru da dışarıda bıraksa sonraki noktalar rekor olmaz.
  const wider = tailSeries(series, 3);
  expect(wider.points.map((point) => point.record)).toEqual([true, false, false]);
});

test('dashboard penceresi rekorları tüm geçmişe göre korur', () => {
  const exams: Exam[] = [];
  const results: ExamResult[] = [];
  // Rekor üçüncü denemede (50); son sekiz nokta hep onun altında.
  const nets = [10, 20, 50, 15, 12, 11, 9, 20, 18, 16, 14, 13];
  nets.forEach((net, index) => {
    const day = String(index + 1).padStart(2, '0');
    const id = `tyt-${index + 1}`;
    exams.push(exam(id, 'TYT', `2026-09-${day}`));
    results.push(result(`r-${index + 1}`, id, net));
  });

  const full = buildNetSeries(exams, results, 'TYT');
  expect(full.points.map((point) => point.record)).toEqual([
    false, true, true, false, false, false, false, false, false, false, false, false,
  ]);

  const windowed = tailSeries(full, 8);
  // Pencere içinde 20, hemen önceki 9'dan yüksek olsa da tüm geçmişteki 50
  // rekorunu kırmadığı için yıldız olmamalı.
  expect(windowed.points.map((point) => point.record)).toEqual(
    new Array(8).fill(false),
  );
});

test('deneme karşılaştırması aynı tür ve alandaki bir önceki denemeyi bulur', () => {
  const tyt = [
    exam('tyt-1', 'TYT', '2026-09-01'),
    exam('tyt-2', 'TYT', '2026-09-02'),
    exam('tyt-3', 'TYT', '2026-09-03'),
  ];
  const ayt = [
    exam('ayt-say-1', 'AYT', '2026-09-01', 'sayisal'),
    exam('ayt-say-2', 'AYT', '2026-09-02', 'sayisal'),
    exam('ayt-ea-1', 'AYT', '2026-09-03', 'ea'),
    exam('ayt-genel', 'AYT', '2026-09-04'),
  ];
  const results = [
    result('r1', 'tyt-1', 10),
    result('r2', 'tyt-2', 20),
    result('r3', 'tyt-3', 15),
    result('r4', 'ayt-say-1', 30),
    result('r5', 'ayt-say-2', 40),
    result('r6', 'ayt-ea-1', 50),
    result('r7', 'ayt-genel', 60),
  ];

  expect(buildExamComparison(tyt, results, tyt[1])).toMatchObject({
    previous: { id: 'tyt-1' },
    currentTotal: 20,
    previousTotal: 10,
    delta: 10,
  });
  expect(buildExamComparison(tyt, results, tyt[0]).delta).toBeUndefined();
  expect(buildExamComparison([...tyt, ...ayt], results, ayt[1])).toMatchObject({
    previous: { id: 'ayt-say-1' },
    delta: 10,
  });
  // Genel/alanı boş AYT denemesi Sayısal ile karşılaştırılmaz.
  expect(buildExamComparison([...tyt, ...ayt], results, ayt[3]).previous).toBeUndefined();
  const eaComparison = buildExamComparison([...tyt, ...ayt], results, ayt[2]);
  expect(eaComparison.currentTotal).toBe(50);
  expect(eaComparison.previous).toBeUndefined();
  expect(eaComparison.delta).toBeUndefined();
});
