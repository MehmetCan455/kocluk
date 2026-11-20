import { expect, test, vi } from 'vitest';
import type { Photo, PracticeFilters } from '@/domain/types';
import { selectPracticePhotos } from './practiceSelection';

/** Returns 0.999 so Fisher–Yates never swaps and assertions keep input order. */
const identityShuffle = () => 0.999;

function photo(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    examType: 'TYT',
    subjectId: 'matematik',
    topicId: 'turev',
    note: `${id} sorusu`,
    blob: new Blob(['buyuk']),
    thumbBlob: new Blob(['kucuk']),
    width: 10,
    height: 10,
    mastered: false,
    practiceCount: 0,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function ids(photos: Photo[]): string[] {
  return photos.map((item) => item.id);
}

function select(photos: Photo[], filters: PracticeFilters): Photo[] {
  return selectPracticePhotos(photos, filters, identityShuffle);
}

test('varsayılan olarak yalnızca çözülmemişleri seçer', () => {
  const unmastered = photo('cozulmemis');
  const mastered = photo('cozulmus', { mastered: true });

  expect(ids(select([unmastered, mastered], {}))).toEqual(['cozulmemis']);
  expect(ids(select([unmastered, mastered], { onlyUnmastered: false }))).toEqual([
    'cozulmemis',
    'cozulmus',
  ]);
  expect(ids(select([unmastered, mastered], { onlyUnmastered: true }))).toEqual([
    'cozulmemis',
  ]);
});

test('tür, ders, konu ve deneme filtrelerini birlikte uygular', () => {
  const mat = photo('mat');
  const fiz = photo('fiz', { subjectId: 'fizik', topicId: 'hareket' });
  const ayt = photo('ayt', {
    examType: 'AYT',
    subjectId: 'ayt-mat',
    topicId: 'integral',
  });
  const exam = photo('exam', {
    examId: 'deneme-1',
    subjectId: 'deneme-ders',
    topicId: 'deneme-konu',
  });
  const all = [mat, fiz, ayt, exam];

  // examType yoksa karışık: TYT ve AYT birlikte.
  expect(ids(select(all, { onlyUnmastered: false }))).toEqual(['mat', 'fiz', 'ayt', 'exam']);
  expect(ids(select(all, { onlyUnmastered: false, examType: 'TYT' }))).toEqual([
    'mat',
    'fiz',
    'exam',
  ]);
  expect(ids(select(all, { onlyUnmastered: false, examType: 'AYT' }))).toEqual(['ayt']);
  expect(
    ids(select(all, { onlyUnmastered: false, subjectIds: ['matematik', 'fizik'] })),
  ).toEqual(['mat', 'fiz']);
  expect(
    ids(select(all, { onlyUnmastered: false, topicIds: ['turev', 'integral'] })),
  ).toEqual(['mat', 'ayt']);
  expect(ids(select(all, { onlyUnmastered: false, examId: 'deneme-1' }))).toEqual(['exam']);
});

test('boş ders ve konu listeleri filtre uygulamaz', () => {
  const all = [photo('a'), photo('b', { subjectId: 'fizik' })];

  expect(ids(select(all, { onlyUnmastered: false, subjectIds: [], topicIds: [] }))).toEqual([
    'a',
    'b',
  ]);
});

test('count sınırını uygular, yeterli fotoğraf yoksa mevcutları döndürür', () => {
  const all = [photo('a'), photo('b'), photo('c')];

  expect(ids(select(all, { onlyUnmastered: false, count: 2 }))).toHaveLength(2);
  expect(ids(select(all, { onlyUnmastered: false, count: 10 }))).toHaveLength(3);
  // count yok = tümü.
  expect(ids(select(all, { onlyUnmastered: false }))).toHaveLength(3);
  expect(select(all, { onlyUnmastered: false, count: 0 })).toEqual([]);
});

test('aynı fotoğrafı iki kez seçmez', () => {
  const first = photo('a');
  const second = photo('b');

  expect(ids(select([first, first, second], { onlyUnmastered: false, count: 3 }))).toEqual([
    'a',
    'b',
  ]);
});

test('eşleşme yoksa boş dizi döndürür', () => {
  expect(select([photo('a')], { subjectIds: ['fizik'] })).toEqual([]);
  expect(select([], {})).toEqual([]);
});

test('kaynak diziyi değiştirmez ve verilen karıştırıcıyı kullanır', () => {
  const all = [photo('a'), photo('b'), photo('c')];
  const random = vi.fn(() => 0);

  const selected = selectPracticePhotos(all, { onlyUnmastered: false }, random);

  expect(random).toHaveBeenCalled();
  expect(ids(all)).toEqual(['a', 'b', 'c']);
  expect(selected).toHaveLength(3);
  expect(new Set(ids(selected))).toEqual(new Set(['a', 'b', 'c']));
});
