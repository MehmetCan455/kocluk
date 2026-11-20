import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  deleteExamUnlinkPhotos,
  getExam,
  listExamResults,
  listExams,
  patchSettings,
  saveExam,
} from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import type { ExamType, Photo } from '@/domain/types';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

const FIXTURE: CurriculumSeed = {
  version: 1,
  subjects: [
    {
      seedKey: 'tyt-turkce',
      exam: 'TYT',
      name: 'Türkçe',
      slug: 'turkce',
      icon: 'book-open',
      order: 1,
      topics: [],
    },
    {
      seedKey: 'tyt-matematik',
      exam: 'TYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 2,
      topics: [],
    },
    {
      seedKey: 'tyt-fizik',
      exam: 'TYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 3,
      topics: [],
    },
    {
      seedKey: 'ayt-matematik',
      exam: 'AYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [],
    },
    {
      seedKey: 'ayt-fizik',
      exam: 'AYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 2,
      topics: [],
    },
  ],
};

const NOW = '2026-11-17T10:00:00.000Z';

beforeEach(async () => {
  // Keep seedVersion current so SettingsProvider does not replace the fixture
  // with the full curriculum.
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
});

async function subjectIdByKey(seedKey: string): Promise<string> {
  const subject = await db.subjects.where('seedKey').equals(seedKey).first();
  if (!subject) {
    throw new Error(`Test dersi bulunamadı: ${seedKey}`);
  }
  return subject.id;
}

function photo(id: string, examId: string | undefined, subjectId: string): Photo {
  return {
    id,
    examId,
    examType: 'TYT',
    subjectId,
    note: `${id} notu`,
    blob: new Blob(['buyuk']),
    thumbBlob: new Blob(['kucuk']),
    width: 10,
    height: 10,
    mastered: false,
    practiceCount: 0,
    createdAt: NOW,
  };
}

interface ExamSeed {
  type?: ExamType;
  name: string;
  date: string;
  note?: string;
  results?: Array<{ subjectId: string; correct: number; wrong: number; blank: number }>;
}

function insertExam(input: ExamSeed) {
  return saveExam({
    type: input.type ?? 'TYT',
    name: input.name,
    date: input.date,
    note: input.note,
    results: input.results ?? [],
  });
}

test('deneme kaydı boş satırları atlar, netleri hesaplar ve notu varsayılan boş tutar', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  const matematik = await subjectIdByKey('tyt-matematik');
  const fizik = await subjectIdByKey('tyt-fizik');

  const exam = await saveExam({
    type: 'TYT',
    name: '  3D TYT 5  ',
    date: '2026-11-17',
    results: [
      { subjectId: turkce, correct: 30, wrong: 8, blank: 2 },
      { subjectId: matematik, correct: 20, wrong: 10, blank: 0 },
      { subjectId: fizik, correct: 0, wrong: 0, blank: 0 },
    ],
  });

  expect(exam).toMatchObject({
    type: 'TYT',
    name: '3D TYT 5',
    date: '2026-11-17',
    note: '',
  });
  expect(exam.alan).toBeUndefined();
  expect(await getExam(exam.id)).toEqual(exam);

  const results = await listExamResults(exam.id);
  expect(results).toHaveLength(2);
  expect(results.find((row) => row.subjectId === turkce)).toMatchObject({
    correct: 30,
    wrong: 8,
    blank: 2,
    net: 28,
  });
  expect(results.find((row) => row.subjectId === matematik)).toMatchObject({
    correct: 20,
    wrong: 10,
    blank: 0,
    net: 17.5,
  });
});

test('deneme güncellenince ders sonuçları yenilenir ve diğer denemeler korunur', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  const matematik = await subjectIdByKey('tyt-matematik');

  const created = await saveExam({
    type: 'TYT',
    name: '3D TYT 5',
    date: '2026-11-17',
    results: [
      { subjectId: turkce, correct: 30, wrong: 8, blank: 2 },
      { subjectId: matematik, correct: 20, wrong: 10, blank: 0 },
    ],
  });
  const other = await insertExam({
    name: 'Başka Deneme',
    date: '2026-11-18',
    results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
  });

  const updated = await saveExam({
    id: created.id,
    type: 'TYT',
    name: '3D TYT 5B',
    date: '2026-11-19',
    note: 'Tekrar çözüldü',
    results: [{ subjectId: matematik, correct: 24, wrong: 4, blank: 0 }],
  });

  expect(updated.id).toBe(created.id);
  expect(updated.createdAt).toBe(created.createdAt);
  expect(updated).toMatchObject({ name: '3D TYT 5B', date: '2026-11-19', note: 'Tekrar çözüldü' });

  const results = await listExamResults(created.id);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ subjectId: matematik, correct: 24, wrong: 4, net: 23 });
  expect(await listExamResults(other.id)).toHaveLength(1);
});

test('deneme girişini doğrular', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');

  await expect(insertExam({ name: '   ', date: '2026-11-17' })).rejects.toThrow(
    'Deneme adı boş olamaz',
  );
  await expect(insertExam({ name: 'Deneme', date: '' })).rejects.toThrow('Tarih boş olamaz');
  await expect(insertExam({ name: 'Deneme', date: '17-11-2026' })).rejects.toThrow(
    'Tarih YYYY-MM-DD biçiminde olmalı',
  );
  await expect(insertExam({ name: 'Deneme', date: '2026-02-31' })).rejects.toThrow(
    'Geçerli bir tarih gir',
  );
  await expect(
    insertExam({
      name: 'Deneme',
      date: '2026-11-17',
      results: [{ subjectId: turkce, correct: -1, wrong: 0, blank: 0 }],
    }),
  ).rejects.toThrow('0 veya daha büyük tam sayı');
  await expect(
    insertExam({
      name: 'Deneme',
      date: '2026-11-17',
      results: [{ subjectId: turkce, correct: 1.5, wrong: 0, blank: 0 }],
    }),
  ).rejects.toThrow('0 veya daha büyük tam sayı');

  expect(await db.exams.count()).toBe(0);
  expect(await db.examResults.count()).toBe(0);
});

test('olmayan deneme güncellenemez ve mevcut sonuçlar bozulmaz', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  const created = await insertExam({
    name: 'Mevcut Deneme',
    date: '2026-11-17',
    results: [{ subjectId: turkce, correct: 30, wrong: 8, blank: 2 }],
  });

  await expect(
    saveExam({
      id: 'olmayan-deneme',
      type: 'TYT',
      name: 'Yeni',
      date: '2026-11-18',
      results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
    }),
  ).rejects.toThrow('Deneme bulunamadı');

  expect((await getExam(created.id))?.name).toBe('Mevcut Deneme');
  expect(await listExamResults(created.id)).toHaveLength(1);
  expect((await listExamResults('olmayan-deneme'))).toHaveLength(0);
});

test('deneme listesi türe göre süzülür ve tarihe göre yeniden eskiye sıralanır', async () => {
  await insertExam({ name: 'Eylül TYT', date: '2026-09-01' });
  await insertExam({ name: 'Kasım TYT', date: '2026-11-10' });
  await insertExam({ name: 'Ekim AYT', type: 'AYT', date: '2026-10-05' });

  expect((await listExams()).map((exam) => exam.name)).toEqual([
    'Kasım TYT',
    'Ekim AYT',
    'Eylül TYT',
  ]);
  expect((await listExams('TYT')).map((exam) => exam.name)).toEqual(['Kasım TYT', 'Eylül TYT']);
  expect((await listExams('AYT')).map((exam) => exam.name)).toEqual(['Ekim AYT']);
});

test('deneme silme yalnızca bağlı fotoğrafların bağlantısını koparır', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  const target = await insertExam({
    name: 'Silinecek Deneme',
    date: '2026-11-17',
    results: [{ subjectId: turkce, correct: 30, wrong: 8, blank: 2 }],
  });
  const other = await insertExam({
    name: 'Kalacak Deneme',
    date: '2026-11-18',
    results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
  });
  await db.photos.bulkAdd([
    photo('photo-target', target.id, turkce),
    photo('photo-other', other.id, turkce),
    photo('photo-free', undefined, turkce),
  ]);

  await deleteExamUnlinkPhotos(target.id);

  expect(await getExam(target.id)).toBeUndefined();
  expect(await listExamResults(target.id)).toHaveLength(0);
  expect(await getExam(other.id)).toBeDefined();
  expect(await listExamResults(other.id)).toHaveLength(1);

  const unlinked = await db.photos.get('photo-target');
  expect(unlinked).toBeDefined();
  expect(unlinked?.examId).toBeUndefined();
  expect(unlinked?.note).toBe('photo-target notu');
  expect(await db.photos.where('examId').equals(target.id).count()).toBe(0);
  expect((await db.photos.get('photo-other'))?.examId).toBe(other.id);
  expect((await db.photos.get('photo-free'))?.examId).toBeUndefined();
});

test('deneme formundan kaydedilen sonuç listelenir ve detayda görünür', async () => {
  renderApp('/denemeler/yeni');

  expect(await screen.findByRole('heading', { level: 1, name: 'Yeni deneme' })).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('Deneme türü'), 'TYT');
  await userEvent.type(screen.getByLabelText('Deneme adı'), '3D TYT 5');
  fireEvent.change(screen.getByLabelText('Tarih'), { target: { value: '2026-11-17' } });
  await userEvent.type(screen.getByLabelText('Türkçe doğru'), '30');
  await userEvent.type(screen.getByLabelText('Türkçe yanlış'), '8');
  await userEvent.type(screen.getByLabelText('Türkçe boş'), '2');
  await userEvent.type(screen.getByLabelText('Matematik doğru'), '20');
  await userEvent.type(screen.getByLabelText('Matematik yanlış'), '10');
  await userEvent.type(screen.getByLabelText('Not'), 'İlk deneme notu');

  expect(await screen.findByText(/28,00/)).toBeInTheDocument();
  expect(screen.getByText(/17,50/)).toBeInTheDocument();
  expect(screen.getByText('45,50')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Denemeler' })).toBeInTheDocument();
  expect(await screen.findByText('45,50')).toBeInTheDocument();

  await waitFor(async () => {
    const exams = await listExams('TYT');
    expect(exams).toHaveLength(1);
    expect(exams[0]).toMatchObject({ name: '3D TYT 5', date: '2026-11-17' });
  });

  await userEvent.click(screen.getByRole('link', { name: /3D TYT 5/ }));

  expect(await screen.findByRole('heading', { level: 1, name: '3D TYT 5' })).toBeInTheDocument();
  expect(screen.getByText('İlk deneme notu')).toBeInTheDocument();

  const table = screen.getByRole('table', { name: 'Ders sonuçları' });
  const turkceRow = within(table).getByRole('row', { name: /Türkçe/ });
  expect(within(turkceRow).getByText('30')).toBeInTheDocument();
  expect(within(turkceRow).getByText('8')).toBeInTheDocument();
  expect(within(turkceRow).getByText('2')).toBeInTheDocument();
  expect(within(turkceRow).getByText('28,00')).toBeInTheDocument();

  const matematikRow = within(table).getByRole('row', { name: /Matematik/ });
  expect(within(matematikRow).getByText('20')).toBeInTheDocument();
  expect(within(matematikRow).getByText('10')).toBeInTheDocument();
  expect(within(matematikRow).getByText('17,50')).toBeInTheDocument();

  expect(screen.getByText('Toplam net')).toBeInTheDocument();
  expect(screen.getByText('45,50')).toBeInTheDocument();
  expect(screen.getByText('Yanlış fotoğrafları')).toBeInTheDocument();
  expect(screen.getByText('Karşılaştırılacak önceki TYT denemesi yok.')).toBeInTheDocument();
});

test('boş bırakılan ders satırı kayda katılmaz', async () => {
  renderApp('/denemeler/yeni');

  await screen.findByLabelText('Türkçe doğru');
  await userEvent.type(screen.getByLabelText('Deneme adı'), 'Tek Ders');
  fireEvent.change(screen.getByLabelText('Tarih'), { target: { value: '2026-11-17' } });
  await userEvent.type(screen.getByLabelText('Türkçe doğru'), '10');

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Denemeler' })).toBeInTheDocument();

  await waitFor(async () => {
    const exams = await listExams();
    expect(exams).toHaveLength(1);
    const results = await listExamResults(exams[0].id);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ correct: 10, wrong: 0, blank: 0, net: 10 });
  });
});

test('deneme listesi TYT, AYT ve tümü olarak süzülür', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  await insertExam({
    name: 'TYT Denemesi',
    date: '2026-11-01',
    results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
  });
  await insertExam({ name: 'AYT Denemesi', type: 'AYT', date: '2026-11-02' });

  renderApp('/denemeler');

  expect(await screen.findByText('TYT Denemesi')).toBeInTheDocument();
  expect(screen.getByText('AYT Denemesi')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'TYT' }));
  expect(await screen.findByText('TYT Denemesi')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('AYT Denemesi')).not.toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: 'AYT' }));
  expect(await screen.findByText('AYT Denemesi')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('TYT Denemesi')).not.toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: 'Tümü' }));
  expect(await screen.findByText('TYT Denemesi')).toBeInTheDocument();
  expect(screen.getByText('AYT Denemesi')).toBeInTheDocument();
});

test('AYT formu alan seçtirir ve gizlenen dersleri göstermez', async () => {
  const tytMatematik = await subjectIdByKey('tyt-matematik');
  await patchSettings({ hiddenSubjects: [tytMatematik] });

  renderApp('/denemeler/yeni');

  expect(await screen.findByLabelText('Türkçe doğru')).toBeInTheDocument();
  expect(screen.queryByLabelText('Matematik doğru')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('AYT alanı')).not.toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('Deneme türü'), 'AYT');
  expect(await screen.findByLabelText('AYT alanı')).toBeInTheDocument();
  expect(await screen.findByLabelText('Matematik doğru')).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Genel' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Sayısal' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Eşit Ağırlık' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Sözel' })).toBeInTheDocument();
});

test('gizlenen dersin mevcut sonucu düzenlemede korunur', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  const matematik = await subjectIdByKey('tyt-matematik');
  const exam = await saveExam({
    type: 'TYT',
    name: 'Korunan Deneme',
    date: '2026-11-17',
    results: [
      { subjectId: turkce, correct: 30, wrong: 8, blank: 2 },
      { subjectId: matematik, correct: 20, wrong: 10, blank: 0 },
    ],
  });
  await patchSettings({ hiddenSubjects: [matematik] });

  renderApp(`/denemeler/${exam.id}/duzenle`);

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Denemeyi düzenle' }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('Matematik doğru')).not.toBeInTheDocument();
  expect(screen.getByText('Gizlenen 1 dersin mevcut sonucu korunacak.')).toBeInTheDocument();

  await userEvent.clear(screen.getByLabelText('Türkçe doğru'));
  await userEvent.type(screen.getByLabelText('Türkçe doğru'), '32');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Korunan Deneme' }),
  ).toBeInTheDocument();
  expect(screen.getByText('47,50')).toBeInTheDocument();

  await waitFor(async () => {
    const results = await listExamResults(exam.id);
    expect(results).toHaveLength(2);
    expect(results.find((row) => row.subjectId === matematik)?.net).toBe(17.5);
    expect(results.find((row) => row.subjectId === turkce)?.net).toBe(30);
  });
});

test('AYT denemesi alan bilgisiyle kaydedilir', async () => {
  renderApp('/denemeler/yeni');

  await screen.findByLabelText('Türkçe doğru');
  expect(screen.getByLabelText('Deneme türü')).toBeEnabled();
  await userEvent.selectOptions(screen.getByLabelText('Deneme türü'), 'AYT');
  await userEvent.selectOptions(await screen.findByLabelText('AYT alanı'), 'sayisal');
  await userEvent.type(screen.getByLabelText('Deneme adı'), '3D AYT 2');
  fireEvent.change(screen.getByLabelText('Tarih'), { target: { value: '2026-11-18' } });
  await userEvent.type(screen.getByLabelText('Matematik doğru'), '12');
  await userEvent.type(screen.getByLabelText('Matematik yanlış'), '4');

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Denemeler' })).toBeInTheDocument();

  await waitFor(async () => {
    const exams = await listExams('AYT');
    expect(exams).toHaveLength(1);
    expect(exams[0]).toMatchObject({ name: '3D AYT 2', type: 'AYT', alan: 'sayisal' });
    const results = await listExamResults(exams[0].id);
    expect(results).toHaveLength(1);
    expect(results[0].net).toBe(11);
  });
});

test('deneme düzenlenince form mevcut değerleri yükler ve sonuçları günceller', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  const matematik = await subjectIdByKey('tyt-matematik');
  const exam = await saveExam({
    type: 'TYT',
    name: '3D TYT 5',
    date: '2026-11-17',
    results: [
      { subjectId: turkce, correct: 30, wrong: 8, blank: 2 },
      { subjectId: matematik, correct: 20, wrong: 10, blank: 0 },
    ],
  });

  renderApp(`/denemeler/${exam.id}/duzenle`);

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Denemeyi düzenle' }),
  ).toBeInTheDocument();
  const typeSelect = screen.getByLabelText('Deneme türü');
  expect(typeSelect).toBeDisabled();
  expect(
    screen.getByText(
      'Deneme türü sonradan değiştirilemez; farklı tür için yeni deneme oluşturun.',
    ),
  ).toBeInTheDocument();
  const nameInput = screen.getByLabelText('Deneme adı');
  expect(nameInput).toHaveValue('3D TYT 5');
  expect(screen.getByLabelText('Tarih')).toHaveValue('2026-11-17');
  expect(screen.getByLabelText('Türkçe doğru')).toHaveValue(30);
  expect(screen.getByLabelText('Türkçe yanlış')).toHaveValue(8);
  expect(screen.getByLabelText('Matematik doğru')).toHaveValue(20);

  await userEvent.clear(nameInput);
  await userEvent.type(nameInput, '3D TYT 5B');
  await userEvent.clear(screen.getByLabelText('Türkçe yanlış'));
  await userEvent.type(screen.getByLabelText('Türkçe yanlış'), '4');

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: '3D TYT 5B' }),
  ).toBeInTheDocument();
  const table = screen.getByRole('table', { name: 'Ders sonuçları' });
  const turkceRow = within(table).getByRole('row', { name: /Türkçe/ });
  expect(within(turkceRow).getByText('29,00')).toBeInTheDocument();
  expect(screen.getByText('46,50')).toBeInTheDocument();

  await waitFor(async () => {
    const stored = await getExam(exam.id);
    expect(stored?.name).toBe('3D TYT 5B');
    const results = await listExamResults(exam.id);
    expect(results).toHaveLength(2);
    expect(results.find((row) => row.subjectId === turkce)?.net).toBe(29);
  });
});

test('deneme silme onayı fotoğrafların korunacağını söyler ve fotoğrafı bağlantısından koparır', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  const exam = await saveExam({
    type: 'TYT',
    name: 'Silinecek Deneme',
    date: '2026-11-17',
    results: [{ subjectId: turkce, correct: 30, wrong: 8, blank: 2 }],
  });
  await db.photos.add(photo('photo-1', exam.id, turkce));

  renderApp(`/denemeler/${exam.id}`);

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Silinecek Deneme' }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sil' }));

  const dialog = await screen.findByRole('dialog', { name: 'Denemeyi sil' });
  expect(
    within(dialog).getByText(
      'Denemeye bağlı fotoğraflar silinmez; yalnızca deneme bağlantıları kaldırılır.',
    ),
  ).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Denemeler' })).toBeInTheDocument();
  expect(await screen.findByText('Henüz deneme yok')).toBeInTheDocument();

  await waitFor(async () => {
    expect(await getExam(exam.id)).toBeUndefined();
    expect(await listExamResults(exam.id)).toHaveLength(0);
    const stored = await db.photos.get('photo-1');
    expect(stored).toBeDefined();
    expect(stored?.examId).toBeUndefined();
  });
});

test('deneme yokken boş durum ve yeni deneme bağlantısı gösterilir', async () => {
  renderApp('/denemeler');

  expect(await screen.findByRole('heading', { level: 1, name: 'Denemeler' })).toBeInTheDocument();
  expect(await screen.findByText('Henüz deneme yok')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Yeni deneme' })[0]).toHaveAttribute(
    'href',
    '/denemeler/yeni',
  );
});

test('silinmiş deneme için geri dönüş bağlantısı gösterilir', async () => {
  renderApp('/denemeler/olmayan-deneme');

  expect(await screen.findByText('Deneme bulunamadı')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Denemelere dön' })).toHaveAttribute(
    'href',
    '/denemeler',
  );
});

test('net trend grafiği tür ve AYT alan filtresine göre güncellenir', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  const aytMatematik = await subjectIdByKey('ayt-matematik');

  await insertExam({
    name: 'TYT Denemesi',
    date: '2026-11-01',
    results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
  });
  await saveExam({
    type: 'AYT',
    name: 'Sayısal AYT',
    date: '2026-11-02',
    alan: 'sayisal',
    results: [{ subjectId: aytMatematik, correct: 12, wrong: 4, blank: 0 }],
  });
  await saveExam({
    type: 'AYT',
    name: 'Genel AYT',
    date: '2026-11-03',
    results: [{ subjectId: aytMatematik, correct: 8, wrong: 4, blank: 0 }],
  });

  renderApp('/denemeler');

  expect(await screen.findByRole('heading', { level: 1, name: 'Denemeler' })).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: 'AYT net trend grafiği' })).toBeInTheDocument();
  expect(screen.getByText('Net trendi')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'TYT' }));
  expect(await screen.findByRole('img', { name: 'TYT net trend grafiği' })).toBeInTheDocument();
  expect(await screen.findByText(/1 Kas: 10,00 net/)).toBeInTheDocument();
  expect(screen.queryByText(/3 Kas: 7,00 net/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'AYT' }));
  expect(await screen.findByRole('img', { name: 'AYT net trend grafiği' })).toBeInTheDocument();
  expect(await screen.findByText(/2 Kas: 11,00 net/)).toBeInTheDocument();
  expect(screen.getByText(/3 Kas: 7,00 net/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Sayısal' }));
  await waitFor(() => expect(screen.queryByText(/3 Kas: 7,00 net/)).not.toBeInTheDocument());
  expect(screen.getByText(/2 Kas: 11,00 net/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Genel' }));
  expect(await screen.findByText(/3 Kas: 7,00 net/)).toBeInTheDocument();
  expect(screen.queryByText(/2 Kas: 11,00 net/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Tüm alanlar' }));
  expect(await screen.findByText(/2 Kas: 11,00 net/)).toBeInTheDocument();
  expect(screen.getByText(/3 Kas: 7,00 net/)).toBeInTheDocument();

  const chartSelect = screen.getByLabelText('Grafik dersi');
  await userEvent.selectOptions(chartSelect, aytMatematik);

  expect(
    await screen.findByRole('img', { name: 'AYT Matematik net trend grafiği' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Matematik net trendi')).toBeInTheDocument();
  expect(screen.getByText(/2 Kas: 11,00 net/)).toBeInTheDocument();

  await userEvent.selectOptions(chartSelect, '');
  expect(await screen.findByRole('img', { name: 'AYT net trend grafiği' })).toBeInTheDocument();
});

test('deneme detayı önceki denemeye göre net farkını gösterir', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  await insertExam({
    name: 'Eylül TYT',
    date: '2026-09-01',
    results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
  });
  const current = await insertExam({
    name: 'Ekim TYT',
    date: '2026-10-01',
    results: [{ subjectId: turkce, correct: 20, wrong: 2, blank: 0 }],
  });

  renderApp(`/denemeler/${current.id}`);

  expect(await screen.findByRole('heading', { level: 1, name: 'Ekim TYT' })).toBeInTheDocument();
  expect(screen.getByText('Önceki denemeye göre +9,50 net')).toBeInTheDocument();
  expect(screen.getByText(/Eylül TYT · 1 Eylül 2026/)).toBeInTheDocument();
});
