import { expect, test } from 'vitest';
import {
  BRANCH_EXAMS,
  branchDisplayLabel,
  branchesFor,
  getBranchExam,
  isBranchExam,
} from './branchConfig';

test('branş kataloğu TYT ve AYT soru sayılarını doğru verir', () => {
  expect(branchesFor('TYT').map((b) => [b.key, b.questionCount])).toEqual([
    ['tyt-turkce', 40],
    ['tyt-sosyal', 20],
    ['tyt-matematik', 40],
    ['tyt-fen', 20],
  ]);
  expect(branchesFor('AYT', 'sayisal').map((b) => [b.key, b.questionCount])).toEqual([
    ['ayt-sayisal-matematik', 40],
    ['ayt-sayisal-fen', 40],
  ]);
  expect(branchesFor('AYT', 'ea').map((b) => b.key)).toEqual([
    'ayt-ea-matematik',
    'ayt-ea-edebiyat-sosyal-1',
  ]);
  expect(branchesFor('AYT', 'sozel').map((b) => b.key)).toEqual([
    'ayt-sozel-edebiyat-sosyal-1',
    'ayt-sozel-sosyal-2',
  ]);
  expect(BRANCH_EXAMS).toHaveLength(10);
});

test('branş etiketi ve bilinmeyen anahtar davranışı', () => {
  expect(getBranchExam('tyt-sosyal')).toMatchObject({
    label: 'Sosyal',
    questionCount: 20,
    type: 'TYT',
  });
  expect(getBranchExam('bilinmeyen')).toBeUndefined();
  expect(branchDisplayLabel(getBranchExam('ayt-sayisal-fen')!)).toBe(
    'AYT Sayısal · Fen',
  );
});

test('isBranchExam eski kaydı tam deneme sayar', () => {
  expect(isBranchExam({})).toBe(false);
  expect(isBranchExam({ kind: 'full' })).toBe(false);
  expect(isBranchExam({ kind: 'branch' })).toBe(true);
});
