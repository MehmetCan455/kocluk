import { ALAN_SUBJECT_SEED_KEYS, computeHiddenSubjects } from './alanSubjects';
import { CURRICULUM } from './curriculum';
import type { AytAlan, Subject } from '@/domain/types';

const subjects: Subject[] = CURRICULUM.subjects.map((subject) => ({
  id: `id-${subject.seedKey}`,
  seedKey: subject.seedKey,
  exam: subject.exam,
  name: subject.name,
  slug: subject.slug,
  icon: subject.icon,
  order: subject.order,
}));

function hiddenSeedKeys(alan: AytAlan): string[] {
  return computeHiddenSubjects(alan, subjects)
    .map((id) => id.replace(/^id-/, ''))
    .sort();
}

test('alan ders anahtarları müfredatta vardır', () => {
  const curriculumKeys = new Set(CURRICULUM.subjects.map((subject) => subject.seedKey));
  for (const seedKeys of Object.values(ALAN_SUBJECT_SEED_KEYS)) {
    for (const seedKey of seedKeys) {
      expect(curriculumKeys.has(seedKey)).toBe(true);
    }
  }
});

test('sayısal alanı yalnızca sayısal AYT derslerini görünür bırakır', () => {
  expect(hiddenSeedKeys('sayisal')).toEqual([
    'ayt-cografya-1',
    'ayt-cografya-2',
    'ayt-din-kulturu',
    'ayt-edebiyat',
    'ayt-felsefe-grubu',
    'ayt-tarih-1',
    'ayt-tarih-2',
  ]);
});

test('eşit ağırlık yalnızca fen derslerini gizler', () => {
  expect(hiddenSeedKeys('ea')).toEqual(['ayt-biyoloji', 'ayt-fizik', 'ayt-kimya']);
});

test('sözel matematik ve fen derslerini gizler', () => {
  expect(hiddenSeedKeys('sozel')).toEqual([
    'ayt-biyoloji',
    'ayt-fizik',
    'ayt-geometri',
    'ayt-kimya',
    'ayt-matematik',
  ]);
});

test('tümü seçiminde hiçbir ders gizlenmez ve TYT dersleri hiç gizlenmez', () => {
  expect(computeHiddenSubjects('tumu', subjects)).toEqual([]);
  for (const alan of ['sayisal', 'ea', 'sozel'] as const) {
    expect(hiddenSeedKeys(alan).some((seedKey) => seedKey.startsWith('tyt-'))).toBe(false);
  }
});
