import { expect, test } from 'vitest';
import {
  AYT_SUBJECT_ORDER,
  AYT_TOTAL_QUESTIONS,
  getExamSubjectConfig,
  getQuestionCount,
  inferAytAlan,
  resolveAytAlan,
  TYT_SUBJECT_ORDER,
  TYT_TOTAL_QUESTIONS,
} from './examConfig';

function rows(
  examType: 'TYT' | 'AYT',
  alan: 'sayisal' | 'ea' | 'sozel' | 'tumu' | '',
  geometryMode: 'separate' | 'combined',
) {
  return getExamSubjectConfig(examType, alan, geometryMode);
}

function mapping(examType: 'TYT' | 'AYT', alan: 'sayisal' | 'ea' | 'sozel', mode: 'separate' | 'combined') {
  return rows(examType, alan, mode).map((row) => `${row.seedKey}:${row.questionCount}`);
}

test('TYT ayrı geometri sayıları ve sırası brief ile aynı', () => {
  expect(mapping('TYT', 'ea', 'separate')).toEqual([
    'tyt-turkce:40',
    'tyt-tarih:5',
    'tyt-cografya:5',
    'tyt-felsefe:5',
    'tyt-din-kulturu:5',
    'tyt-matematik:30',
    'tyt-geometri:10',
    'tyt-fizik:7',
    'tyt-kimya:7',
    'tyt-biyoloji:6',
  ]);
  expect(rows('TYT', '', 'separate').map((row) => row.seedKey)).toEqual([
    ...TYT_SUBJECT_ORDER,
  ]);
  const total = rows('TYT', '', 'separate').reduce(
    (sum, row) => sum + row.questionCount,
    0,
  );
  expect(total).toBe(TYT_TOTAL_QUESTIONS);
});

test('birleşik geometride TYT matematiği 40 olur ve geometri satırı kalkar', () => {
  expect(mapping('TYT', 'ea', 'combined')).toEqual([
    'tyt-turkce:40',
    'tyt-tarih:5',
    'tyt-cografya:5',
    'tyt-felsefe:5',
    'tyt-din-kulturu:5',
    'tyt-matematik:40',
    'tyt-fizik:7',
    'tyt-kimya:7',
    'tyt-biyoloji:6',
  ]);
  expect(rows('TYT', '', 'combined').some((row) => row.seedKey === 'tyt-geometri')).toBe(false);
  const total = rows('TYT', '', 'combined').reduce((sum, row) => sum + row.questionCount, 0);
  expect(total).toBe(TYT_TOTAL_QUESTIONS);
});

test('AYT sayısal sayıları ve sırası doğru', () => {
  expect(mapping('AYT', 'sayisal', 'separate')).toEqual([
    'ayt-matematik:30',
    'ayt-geometri:10',
    'ayt-fizik:14',
    'ayt-kimya:13',
    'ayt-biyoloji:13',
  ]);
  expect(mapping('AYT', 'sayisal', 'combined')).toEqual([
    'ayt-matematik:40',
    'ayt-fizik:14',
    'ayt-kimya:13',
    'ayt-biyoloji:13',
  ]);
});

test('AYT eşit ağırlık sayıları ve sırası doğru', () => {
  expect(mapping('AYT', 'ea', 'separate')).toEqual([
    'ayt-edebiyat:24',
    'ayt-tarih-1:10',
    'ayt-cografya-1:6',
    'ayt-matematik:30',
    'ayt-geometri:10',
  ]);
  expect(mapping('AYT', 'ea', 'combined')).toEqual([
    'ayt-edebiyat:24',
    'ayt-tarih-1:10',
    'ayt-cografya-1:6',
    'ayt-matematik:40',
  ]);
});

test('AYT sözel sayıları ve sırası doğru, matematik içermez', () => {
  expect(mapping('AYT', 'sozel', 'separate')).toEqual([
    'ayt-edebiyat:24',
    'ayt-tarih-1:10',
    'ayt-cografya-1:6',
    'ayt-tarih-2:11',
    'ayt-cografya-2:11',
    'ayt-felsefe-grubu:12',
    'ayt-din-kulturu:6',
  ]);
  expect(mapping('AYT', 'sozel', 'combined')).toEqual(mapping('AYT', 'sozel', 'separate'));
  expect(rows('AYT', 'sozel', 'combined').some((row) => row.seedKey.includes('matematik'))).toBe(
    false,
  );
});

test('AYT toplamları 80 soru', () => {
  for (const alan of ['sayisal', 'ea', 'sozel'] as const) {
    const total = rows('AYT', alan, 'separate').reduce(
      (sum, row) => sum + row.questionCount,
      0,
    );
    expect(total, alan).toBe(AYT_TOTAL_QUESTIONS);
  }
});

test('AYT sırası brief ile aynı ve branşa göre filtrelenir', () => {
  const sayisalOrder = rows('AYT', 'sayisal', 'separate').map((row) => row.seedKey);
  const eaOrder = rows('AYT', 'ea', 'separate').map((row) => row.seedKey);
  const sozelOrder = rows('AYT', 'sozel', 'separate').map((row) => row.seedKey);

  for (const order of [sayisalOrder, eaOrder, sozelOrder]) {
    const expected = AYT_SUBJECT_ORDER.filter((seedKey) => order.includes(seedKey));
    expect(order).toEqual(expected);
  }
});

test('AYT alanı seçilmeden veya eski tumu değeriyle satır üretilmez', () => {
  expect(rows('AYT', '', 'separate')).toEqual([]);
  expect(rows('AYT', 'tumu', 'separate')).toEqual([]);
});

test('soru sayısı ders anahtarına göre bulunur', () => {
  expect(getQuestionCount('TYT', '', 'separate', 'tyt-matematik')).toBe(30);
  expect(getQuestionCount('TYT', '', 'combined', 'tyt-matematik')).toBe(40);
  expect(getQuestionCount('TYT', '', 'separate', 'tyt-geometri')).toBe(10);
  expect(getQuestionCount('TYT', '', 'combined', 'tyt-geometri')).toBeUndefined();
  expect(getQuestionCount('TYT', '', 'separate', 'tyt-bilinmeyen')).toBeUndefined();
});

const SUBJECTS = [
  { id: 'fizik', seedKey: 'ayt-fizik' },
  { id: 'kimya', seedKey: 'ayt-kimya' },
  { id: 'tarih2', seedKey: 'ayt-tarih-2' },
  { id: 'felsefe', seedKey: 'ayt-felsefe-grubu' },
  { id: 'matematik', seedKey: 'ayt-matematik' },
];

test('eski deneme alanı sonuçlardan çıkarılır', () => {
  expect(inferAytAlan([{ subjectId: 'fizik' }], SUBJECTS)).toBe('sayisal');
  expect(inferAytAlan([{ subjectId: 'tarih2' }], SUBJECTS)).toBe('sozel');
  expect(inferAytAlan([{ subjectId: 'felsefe' }], SUBJECTS)).toBe('sozel');
  expect(inferAytAlan([{ subjectId: 'matematik' }], SUBJECTS)).toBe('ea');
  expect(inferAytAlan([], SUBJECTS)).toBe('ea');
  // Sayısal, sözel işaretlerinden önce gelir.
  expect(
    inferAytAlan([{ subjectId: 'tarih2' }, { subjectId: 'kimya' }], SUBJECTS),
  ).toBe('sayisal');
});

test('kayıtlı alan korunur, eksik/tumu alan çıkarılır', () => {
  expect(resolveAytAlan({ alan: 'ea' }, [{ subjectId: 'fizik' }], SUBJECTS)).toBe('ea');
  expect(resolveAytAlan({ alan: 'tumu' }, [{ subjectId: 'fizik' }], SUBJECTS)).toBe('sayisal');
  expect(resolveAytAlan({}, [{ subjectId: 'tarih2' }], SUBJECTS)).toBe('sozel');
});
