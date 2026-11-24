import { beforeEach, expect, test } from 'vitest';
import { db } from '@/db/db';
import {
  getExam,
  listAllExamResults,
  listExamResults,
  listFullExams,
  saveExam,
} from '@/db/repositories';
import { deterministicId } from '@/lib/deterministicId';
import { EXAM_RESULT_NAMESPACE } from '@/lib/namespaces';
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

const fullExamInput = {
  type: 'TYT' as const,
  name: 'TYT Deneme 1',
  date: '2026-11-20',
  results: [
    { subjectId: 'tyt-mat', correct: 30, wrong: 4, blank: 6 },
    { subjectId: 'tyt-fen', correct: 12, wrong: 3, blank: 5 },
  ],
};

async function resultIdsBySubject(examId: string): Promise<Map<string, string>> {
  return new Map(
    (await listExamResults(examId)).map((result) => [result.subjectId, result.id]),
  );
}

test('saveExam mevcut sonuç kimliklerini korur', async () => {
  const saved = await saveExam(fullExamInput);
  const before = await resultIdsBySubject(saved.id);

  await saveExam({
    ...fullExamInput,
    id: saved.id,
    results: [
      { subjectId: 'tyt-mat', correct: 31, wrong: 2, blank: 7 },
      { subjectId: 'tyt-fen', correct: 14, wrong: 1, blank: 5 },
    ],
  });

  const after = await resultIdsBySubject(saved.id);
  expect(after.get('tyt-mat')).toBe(before.get('tyt-mat'));
  expect(after.get('tyt-fen')).toBe(before.get('tyt-fen'));
  expect(after.size).toBe(2);
  expect((await listExamResults(saved.id)).find((row) => row.subjectId === 'tyt-mat')).toMatchObject({
    correct: 31,
    wrong: 2,
    blank: 7,
    net: 30.5,
  });
});

test('yeni sonuç deterministik kimlik üretir', async () => {
  const saved = await saveExam({
    ...fullExamInput,
    results: [{ subjectId: 'tyt-mat', correct: 30, wrong: 4, blank: 6 }],
  });

  await saveExam({
    ...fullExamInput,
    id: saved.id,
    results: [
      { subjectId: 'tyt-mat', correct: 30, wrong: 4, blank: 6 },
      { subjectId: 'tyt-fiz', correct: 5, wrong: 1, blank: 2 },
    ],
  });

  const result = (await listExamResults(saved.id)).find(
    (row) => row.subjectId === 'tyt-fiz',
  );
  expect(result?.id).toBe(
    deterministicId(EXAM_RESULT_NAMESPACE, `${saved.id}:tyt-fiz`),
  );
});

test('aktarılmış sonuç satırının kimliğini korur', async () => {
  await db.exams.put({
    id: 'legacy-exam',
    type: 'TYT',
    name: 'Aktarılmış Deneme',
    date: '2026-01-01',
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await db.examResults.put({
    id: 'legacy-result',
    examId: 'legacy-exam',
    subjectId: 'tyt-mat',
    correct: 10,
    wrong: 1,
    blank: 0,
    net: 9.75,
  });

  await saveExam({
    id: 'legacy-exam',
    type: 'TYT',
    name: 'Aktarılmış Deneme',
    date: '2026-01-01',
    results: [{ subjectId: 'tyt-mat', correct: 12, wrong: 2, blank: 0 }],
  });

  const [result] = await listExamResults('legacy-exam');
  expect(result).toMatchObject({ id: 'legacy-result', correct: 12, wrong: 2, net: 11.5 });
});

test('kaldırılan sonuç deletedAt alır ve listelerde görünmez', async () => {
  const saved = await saveExam(fullExamInput);
  const before = await resultIdsBySubject(saved.id);
  const removedId = before.get('tyt-fen');

  await saveExam({
    ...fullExamInput,
    id: saved.id,
    results: [{ subjectId: 'tyt-mat', correct: 30, wrong: 4, blank: 6 }],
  });

  expect((await listExamResults(saved.id)).map((row) => row.subjectId)).toEqual([
    'tyt-mat',
  ]);
  expect((await listAllExamResults()).map((row) => row.subjectId)).toEqual(['tyt-mat']);
  expect((await db.examResults.get(removedId!))?.deletedAt).toEqual(expect.any(String));
});

test('aynı examId+subjectId için ikinci aktif sonuç oluşmaz', async () => {
  const saved = await saveExam({
    ...fullExamInput,
    results: [{ subjectId: 'tyt-mat', correct: 30, wrong: 4, blank: 6 }],
  });
  const originalId = (await listExamResults(saved.id))[0].id;

  await saveExam({ ...fullExamInput, id: saved.id, results: [] });
  expect(await listExamResults(saved.id)).toEqual([]);

  await saveExam({
    ...fullExamInput,
    id: saved.id,
    results: [{ subjectId: 'tyt-mat', correct: 28, wrong: 6, blank: 6 }],
  });

  const rows = await db.examResults.where('examId').equals(saved.id).toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: originalId, correct: 28, net: 26.5 });
  expect(rows[0].deletedAt).toBeUndefined();
});
