import { beforeEach, expect, test } from 'vitest';
import { db } from '@/db/db';
import {
  getExam,
  listExamResults,
  listFullExams,
  saveExam,
} from '@/db/repositories';
import { resetDb } from '@/test/fixtures';

beforeEach(resetDb);

test('branş denemesini tek sonuç satırıyla kaydeder', async () => {
  const saved = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'TYT Sosyal 1',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });

  expect(saved).toMatchObject({ kind: 'branch', branch: 'tyt-sosyal' });
  const [result] = await listExamResults(saved.id);
  expect(result).toMatchObject({
    subjectId: 'tyt-sosyal',
    correct: 15,
    wrong: 3,
    blank: 2,
  });
  expect(result.net).toBeCloseTo(14.25);
  expect((await getExam(saved.id))?.kind).toBe('branch');
  expect(await listFullExams('TYT')).toEqual([]);
});

test('branş doğrulamaları Türkçe hata verir', async () => {
  const base = {
    kind: 'branch' as const,
    type: 'TYT' as const,
    branch: 'tyt-sosyal' as const,
    name: 'Hatalı',
    date: '2026-11-20',
  };

  await expect(
    saveExam({
      ...base,
      results: [{ subjectId: 'tyt-fen', correct: 1, wrong: 0, blank: 0 }],
    }),
  ).rejects.toThrow('Branş sonucu branşla eşleşmiyor');

  await expect(
    saveExam({
      ...base,
      type: 'AYT',
      alan: 'sayisal',
      branch: 'ayt-ea-matematik',
      results: [],
    }),
  ).rejects.toThrow('Branş AYT alanıyla eşleşmiyor');

  await expect(
    saveExam({
      ...base,
      results: [
        { subjectId: 'tyt-sosyal', correct: 1, wrong: 0, blank: 0 },
        { subjectId: 'tyt-fen', correct: 1, wrong: 0, blank: 0 },
      ],
    }),
  ).rejects.toThrow('Branş denemesinde tek sonuç satırı olabilir');

  await expect(
    saveExam({
      ...base,
      kind: 'full',
      results: [],
    }),
  ).rejects.toThrow('Tam denemede branş seçilemez');

  await expect(
    saveExam({
      ...base,
      results: [{ subjectId: 'tyt-sosyal', correct: 20, wrong: 1, blank: 0 }],
    }),
  ).rejects.toThrow('Doğru, yanlış ve boş toplamı 20 soruyu aşıyor');
});

test('kind alanı olmayan eski deneme tam deneme sayılır', async () => {
  await db.exams.put({
    id: 'eski',
    type: 'TYT',
    name: 'Eski TYT',
    date: '2026-01-01',
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  expect((await getExam('eski'))?.kind).toBeUndefined();
  expect((await listFullExams('TYT')).map((exam) => exam.id)).toEqual(['eski']);
});
