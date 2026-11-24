import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { computeHiddenSubjects } from '@/data/alanSubjects';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  deleteExamUnlinkPhotos,
  getExam,
  listExamResults,
  listExams,
  listSubjects,
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
      seedKey: 'tyt-geometri',
      exam: 'TYT',
      name: 'Geometri',
      slug: 'geometri',
      icon: 'triangle',
      order: 3,
      topics: [],
    },
    {
      seedKey: 'tyt-fizik',
      exam: 'TYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 4,
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
    {
      seedKey: 'ayt-edebiyat',
      exam: 'AYT',
      name: 'Edebiyat',
      slug: 'edebiyat',
      icon: 'book-open',
      order: 3,
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

  expect((await db.exams.get(target.id))?.deletedAt).toEqual(expect.any(String));
  const storedResults = await db.examResults.where('examId').equals(target.id).toArray();
  expect(storedResults).toHaveLength(1);
  expect(storedResults[0].deletedAt).toEqual(expect.any(String));
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
    expect(results[0]).toMatchObject({ correct: 10, wrong: 0, blank: 30, net: 10 });
  });
});

test('form boş sayısını otomatik hesaplar, boş inputu göstermez ve kaydeder', async () => {
  renderApp('/denemeler/yeni');

  await screen.findByLabelText('Türkçe doğru');
  const turkceRow = screen.getByRole('group', { name: 'Türkçe' });
  expect(turkceRow).toHaveTextContent('Boş: —');
  expect(within(turkceRow).queryByRole('spinbutton', { name: 'Türkçe boş' })).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Deneme adı'), 'Oto Boş');
  fireEvent.change(screen.getByLabelText('Tarih'), { target: { value: '2026-11-17' } });
  await userEvent.type(screen.getByLabelText('Türkçe doğru'), '30');
  await userEvent.type(screen.getByLabelText('Türkçe yanlış'), '8');

  expect(turkceRow).toHaveTextContent('Boş: 2');

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Denemeler' })).toBeInTheDocument();

  await waitFor(async () => {
    const exams = await listExams('TYT');
    expect(exams).toHaveLength(1);
    const results = await listExamResults(exams[0].id);
    expect(results[0]).toMatchObject({ correct: 30, wrong: 8, blank: 2, net: 28 });
  });
});

test('doğru + yanlış soru sayısını aşınca satır hatası verir ve kaydı kapatır', async () => {
  renderApp('/denemeler/yeni');

  await screen.findByLabelText('Türkçe doğru');
  await userEvent.type(screen.getByLabelText('Deneme adı'), 'Hatalı Deneme');
  await userEvent.type(screen.getByLabelText('Türkçe doğru'), '41');

  expect(
    await screen.findByText('Doğru ve yanlış toplamı 40 soruyu aşıyor.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Türkçe doğru')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled();

  await userEvent.clear(screen.getByLabelText('Türkçe doğru'));
  await userEvent.type(screen.getByLabelText('Türkçe doğru'), '30');
  await userEvent.type(screen.getByLabelText('Türkçe yanlış'), '8');
  expect(screen.queryByText('Doğru ve yanlış toplamı 40 soruyu aşıyor.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled();
});

test('negatif veya ondalıklı doğru/yanlış değeri kabul edilmez', async () => {
  renderApp('/denemeler/yeni');

  await screen.findByLabelText('Türkçe doğru');
  await userEvent.type(screen.getByLabelText('Deneme adı'), 'Geçersiz Sayı');
  fireEvent.change(screen.getByLabelText('Türkçe doğru'), { target: { value: '-2' } });

  expect(
    await screen.findByText('D ve Y 0 veya daha büyük tam sayı olmalı.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Türkçe doğru'), { target: { value: '1.5' } });
  expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled();
});

test('ayrı geometri varsayılanında matematik 30, geometri 10 soru', async () => {
  renderApp('/denemeler/yeni');

  const matematik = await screen.findByLabelText('Matematik doğru');
  const geometri = screen.getByLabelText('Geometri doğru');
  expect(matematik).toHaveAttribute('max', '30');
  expect(geometri).toHaveAttribute('max', '10');
});

test('birleşik geometride matematik 40 soru olur ve geometri satırı gizlenir', async () => {
  await patchSettings({ geometryMode: 'combined' });
  renderApp('/denemeler/yeni');

  const matematik = await screen.findByLabelText('Matematik doğru');
  expect(matematik).toHaveAttribute('max', '40');
  expect(screen.queryByLabelText('Geometri doğru')).not.toBeInTheDocument();
  expect(screen.queryByText('Geometri')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', {
      name: 'Geometri sonucunu matematiğe katmayı onaylıyorum',
    }),
  ).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Deneme adı'), 'Birleşik');
  fireEvent.change(screen.getByLabelText('Tarih'), { target: { value: '2026-11-17' } });
  await userEvent.type(screen.getByLabelText('Matematik doğru'), '30');
  await userEvent.type(screen.getByLabelText('Matematik yanlış'), '5');
  expect(screen.getByRole('group', { name: 'Matematik' })).toHaveTextContent('Boş: 5');

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Denemeler' })).toBeInTheDocument();

  await waitFor(async () => {
    const exams = await listExams('TYT');
    const results = await listExamResults(exams[0].id);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ correct: 30, wrong: 5, blank: 5, net: 28.75 });
  });
});

test('birleşik geometride eski ayrı geometri sonucu bilgilendirmeyle matematiğe katılır', async () => {
  const matematik = await subjectIdByKey('tyt-matematik');
  const geometri = await subjectIdByKey('tyt-geometri');
  const exam = await saveExam({
    type: 'TYT',
    name: 'Eski Ayrı Deneme',
    date: '2026-11-17',
    results: [
      { subjectId: matematik, correct: 20, wrong: 10, blank: 0 },
      { subjectId: geometri, correct: 8, wrong: 2, blank: 0 },
    ],
  });
  await patchSettings({ geometryMode: 'combined' });

  renderApp(`/denemeler/${exam.id}/duzenle`);

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Denemeyi düzenle' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Matematik doğru')).toHaveValue(28);
  expect(screen.getByLabelText('Matematik yanlış')).toHaveValue(12);
  expect(screen.queryByLabelText('Geometri doğru')).not.toBeInTheDocument();
  expect(
    screen.getByText(
      'Bu deneme eski ayrı Geometri kaydı içeriyor. Kaydedince Matematik 40 olarak birleştirilecek; net korunur, ayrı Geometri kaydı kaldırılır.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled();

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Eski Ayrı Deneme' }),
  ).toBeInTheDocument();
  await waitFor(async () => {
    const results = await listExamResults(exam.id);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      subjectId: matematik,
      correct: 28,
      wrong: 12,
      blank: 0,
      net: 25,
    });
  });
});

test('ayrı geometride eski ayrı geometri sonucu onay istemeden korunur', async () => {
  const matematik = await subjectIdByKey('tyt-matematik');
  const geometri = await subjectIdByKey('tyt-geometri');
  const exam = await saveExam({
    type: 'TYT',
    name: 'Ayrı Korunan Deneme',
    date: '2026-11-17',
    results: [
      { subjectId: matematik, correct: 20, wrong: 10, blank: 0 },
      { subjectId: geometri, correct: 8, wrong: 2, blank: 0 },
    ],
  });

  renderApp(`/denemeler/${exam.id}/duzenle`);

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Denemeyi düzenle' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Matematik doğru')).toHaveValue(20);
  expect(screen.getByLabelText('Geometri doğru')).toHaveValue(8);
  expect(
    screen.queryByRole('checkbox', {
      name: 'Geometri sonucunu matematiğe katmayı onaylıyorum',
    }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled();

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Ayrı Korunan Deneme' }),
  ).toBeInTheDocument();
  await waitFor(async () => {
    const results = await listExamResults(exam.id);
    expect(results).toHaveLength(2);
    expect(results.find((row) => row.subjectId === geometri)?.net).toBe(7.5);
  });
});

test('deneme listesi varsayılan TYT, Tümü filtresi yok ve AYT sekmesine geçilebilir', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  await insertExam({
    name: 'TYT Denemesi',
    date: '2026-11-01',
    results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
  });
  await insertExam({ name: 'AYT Denemesi', type: 'AYT', date: '2026-11-02' });

  renderApp('/denemeler');

  expect(await screen.findByText('TYT Denemesi')).toBeInTheDocument();
  expect(screen.queryByText('AYT Denemesi')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tümü' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'TYT' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await userEvent.click(screen.getByRole('button', { name: 'AYT' }));
  expect(await screen.findByText('AYT Denemesi')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('TYT Denemesi')).not.toBeInTheDocument());
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
  expect(screen.getByText('Dersleri görmek için önce AYT alanını seç.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Matematik doğru')).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Genel' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Sayısal' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Eşit Ağırlık' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Sözel' })).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('AYT alanı'), 'sayisal');
  expect(await screen.findByLabelText('Matematik doğru')).toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: 'AYT' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const aytCard = await screen.findByRole('link', { name: /3D AYT 2.*ilk deneme/i });
  expect(within(aytCard).getAllByText('11,00').length).toBeGreaterThan(0);

  await waitFor(async () => {
    const exams = await listExams('AYT');
    expect(exams).toHaveLength(1);
    expect(exams[0]).toMatchObject({ name: '3D AYT 2', type: 'AYT', alan: 'sayisal' });
    const results = await listExamResults(exams[0].id);
    expect(results).toHaveLength(1);
    expect(results[0].net).toBe(11);
  });
});

test('eski alansız AYT denemesi sonuçlarından çıkarılır ve düzenlemede korunur', async () => {
  const fizik = await subjectIdByKey('ayt-fizik');
  const exam = await saveExam({
    type: 'AYT',
    name: 'Eski AYT',
    date: '2026-11-17',
    results: [{ subjectId: fizik, correct: 5, wrong: 0, blank: 9 }],
  });
  expect(exam.alan).toBeUndefined();

  renderApp(`/denemeler/${exam.id}/duzenle`);

  expect(await screen.findByLabelText('AYT alanı')).toHaveValue('sayisal');
  expect(await screen.findByLabelText('Fizik doğru')).toHaveValue(5);

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Eski AYT' }),
  ).toBeInTheDocument();
  await waitFor(async () => {
    expect((await getExam(exam.id))?.alan).toBe('sayisal');
    const results = await listExamResults(exam.id);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ subjectId: fizik, correct: 5, blank: 9, net: 5 });
  });
});

test('AYT branşı değiştirilince yabancı branş sonuçları korunur', async () => {
  const matematik = await subjectIdByKey('ayt-matematik');
  const fizik = await subjectIdByKey('ayt-fizik');
  const edebiyat = await subjectIdByKey('ayt-edebiyat');
  const exam = await saveExam({
    type: 'AYT',
    name: 'Branş Denemesi',
    date: '2026-11-17',
    alan: 'sayisal',
    results: [
      { subjectId: matematik, correct: 10, wrong: 0, blank: 20 },
      { subjectId: fizik, correct: 5, wrong: 0, blank: 9 },
      { subjectId: edebiyat, correct: 8, wrong: 0, blank: 16 },
    ],
  });

  renderApp(`/denemeler/${exam.id}/duzenle`);

  const alanSelect = await screen.findByLabelText('AYT alanı');
  expect(alanSelect).toHaveValue('sayisal');
  expect(await screen.findByLabelText('Fizik doğru')).toHaveValue(5);

  await userEvent.selectOptions(alanSelect, 'ea');

  expect(await screen.findByLabelText('Edebiyat doğru')).toHaveValue(8);
  expect(screen.queryByLabelText('Fizik doğru')).not.toBeInTheDocument();
  expect(
    screen.getByText('Bu alanda girilmiyor · eski sonuç korunuyor'),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Branş Denemesi' }),
  ).toBeInTheDocument();
  await waitFor(async () => {
    const results = await listExamResults(exam.id);
    expect(results).toHaveLength(3);
    expect(results.find((row) => row.subjectId === fizik)).toMatchObject({
      correct: 5,
      wrong: 0,
      net: 5,
    });
    expect(results.find((row) => row.subjectId === edebiyat)?.net).toBe(8);
  });
});

test('seçilen AYT branşı otomatik gizlenen dersleri açar, elle gizlenenleri gizli tutar', async () => {
  const allSubjects = await listSubjects();
  const edebiyat = await subjectIdByKey('ayt-edebiyat');
  await patchSettings({
    aytAlan: 'sozel',
    hiddenSubjects: [...computeHiddenSubjects('sozel', allSubjects), edebiyat],
  });

  renderApp('/denemeler/yeni');
  await userEvent.selectOptions(
    await screen.findByLabelText('Deneme türü'),
    'AYT',
  );
  await userEvent.selectOptions(await screen.findByLabelText('AYT alanı'), 'ea');

  // Sözel çalışma alanının otomatik gizlediği matematik, seçilen EA
  // denemesinde görünür; elle gizlenen edebiyat gizli kalır.
  expect(await screen.findByLabelText('Matematik doğru')).toBeInTheDocument();
  expect(screen.queryByLabelText('Edebiyat doğru')).not.toBeInTheDocument();
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
    const storedExam = await db.exams.get(exam.id);
    expect(storedExam?.deletedAt).toEqual(expect.any(String));
    expect(await getExam(exam.id)).toBeUndefined();
    expect(await listExamResults(exam.id)).toHaveLength(0);
    const storedResults = await db.examResults.where('examId').equals(exam.id).toArray();
    expect(storedResults).toHaveLength(1);
    expect(storedResults[0].deletedAt).toEqual(expect.any(String));
    const stored = await db.photos.get('photo-1');
    expect(stored).toBeDefined();
    expect(stored?.examId).toBeUndefined();
  });
});

test('silinen deneme listede ve detayda görünmez', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  const exam = await insertExam({
    name: 'Soft Silinen',
    date: '2026-11-17',
    results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
  });
  await deleteExamUnlinkPhotos(exam.id);

  const listView = renderApp('/denemeler');
  expect(await screen.findByText('Henüz deneme yok')).toBeInTheDocument();
  expect(screen.queryByText('Soft Silinen')).not.toBeInTheDocument();
  listView.unmount();

  const detailView = renderApp(`/denemeler/${exam.id}`);
  expect(await screen.findByText('Deneme bulunamadı')).toBeInTheDocument();
  detailView.unmount();
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
  expect(await screen.findByRole('img', { name: 'TYT net trend grafiği' })).toBeInTheDocument();
  expect(screen.getByText('Deneme başarı grafiği')).toBeInTheDocument();
  expect(await screen.findByText(/TYT Denemesi · 1 Kas: 10,00 net/)).toBeInTheDocument();
  expect(screen.queryByText(/Genel AYT · 3 Kas: 7,00 net/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'AYT' }));
  expect(await screen.findByRole('img', { name: 'AYT net trend grafiği' })).toBeInTheDocument();
  expect(await screen.findByText(/Sayısal AYT · 2 Kas: 11,00 net/)).toBeInTheDocument();
  expect(screen.getByText(/Genel AYT · 3 Kas: 7,00 net/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Genel' })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Sayısal' }));
  await waitFor(() =>
    expect(screen.queryByText(/Genel AYT · 3 Kas: 7,00 net/)).not.toBeInTheDocument(),
  );
  expect(screen.getByText(/Sayısal AYT · 2 Kas: 11,00 net/)).toBeInTheDocument();

  // The old exam has no stored branch; its results imply Eşit Ağırlık.
  await userEvent.click(screen.getByRole('button', { name: 'Eşit Ağırlık' }));
  expect(await screen.findByText(/Genel AYT · 3 Kas: 7,00 net/)).toBeInTheDocument();
  expect(screen.queryByText(/Sayısal AYT · 2 Kas: 11,00 net/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Tüm alanlar' }));
  expect(await screen.findByText(/Sayısal AYT · 2 Kas: 11,00 net/)).toBeInTheDocument();
  expect(screen.getByText(/Genel AYT · 3 Kas: 7,00 net/)).toBeInTheDocument();

  const chartSelect = screen.getByLabelText('Grafik dersi');
  await userEvent.selectOptions(chartSelect, aytMatematik);

  expect(
    await screen.findByRole('img', { name: 'AYT Matematik net trend grafiği' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Matematik başarı grafiği')).toBeInTheDocument();
  expect(screen.getByText(/Sayısal AYT · 2 Kas: 11,00 net/)).toBeInTheDocument();
  expect(screen.getByText(/Genel AYT · 3 Kas: 7,00 net/)).toBeInTheDocument();

  await userEvent.selectOptions(chartSelect, '');
  expect(await screen.findByRole('img', { name: 'AYT net trend grafiği' })).toBeInTheDocument();
});

test('grafik son 10 sınırı olmadan seçili türdeki tüm denemeleri gösterir', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');

  for (let index = 1; index <= 12; index += 1) {
    const day = String(index).padStart(2, '0');
    await insertExam({
      name: `Eylül Denemesi ${index}`,
      date: `2026-09-${day}`,
      results: [{ subjectId: turkce, correct: index, wrong: 0, blank: 0 }],
    });
  }

  renderApp('/denemeler');

  expect(await screen.findByText('Deneme başarı grafiği')).toBeInTheDocument();
  // Son 10 ile sınırlı olsaydı ilk iki deneme grafik özetinde olmayacaktı.
  expect(
    await screen.findByText(/Eylül Denemesi 1 · 1 Eyl: 1,00 net/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Eylül Denemesi 12 · 12 Eyl: 12,00 net/),
  ).toBeInTheDocument();
  expect(screen.getByText('12 TYT denemesi')).toBeInTheDocument();
});

test('grafik dersi elle gizlenenleri saklar, çalışma alanının otomatik gizlemelerini gösterir', async () => {
  const allSubjects = await listSubjects();
  const aytMatematik = await subjectIdByKey('ayt-matematik');
  const aytEdebiyat = await subjectIdByKey('ayt-edebiyat');
  await saveExam({
    type: 'AYT',
    name: 'Sayısal AYT',
    date: '2026-11-02',
    alan: 'sayisal',
    results: [{ subjectId: aytMatematik, correct: 10, wrong: 0, blank: 0 }],
  });
  await patchSettings({
    aytAlan: 'sozel',
    hiddenSubjects: [...computeHiddenSubjects('sozel', allSubjects), aytEdebiyat],
  });

  renderApp('/denemeler?tur=AYT');

  expect(await screen.findByRole('img', { name: 'AYT net trend grafiği' })).toBeInTheDocument();
  const chartSelect = screen.getByLabelText('Grafik dersi');
  // Sözel çalışma alanı matematiği otomatik gizler; Sayısal denemesi için
  // grafikte seçilebilir kalır. Elle gizlenen edebiyat ise görünmez.
  expect(within(chartSelect).getByRole('option', { name: 'Matematik' })).toBeInTheDocument();
  expect(within(chartSelect).getByRole('option', { name: 'Fizik' })).toBeInTheDocument();
  expect(
    within(chartSelect).queryByRole('option', { name: 'Edebiyat' }),
  ).not.toBeInTheDocument();
});

test('AYT alan filtresi grafik dersi seçeneklerini daraltır ve seçimi sıfırlar', async () => {
  const aytMatematik = await subjectIdByKey('ayt-matematik');
  const aytEdebiyat = await subjectIdByKey('ayt-edebiyat');
  await saveExam({
    type: 'AYT',
    name: 'Sayısal AYT',
    date: '2026-11-02',
    alan: 'sayisal',
    results: [{ subjectId: aytMatematik, correct: 12, wrong: 4, blank: 0 }],
  });
  await saveExam({
    type: 'AYT',
    name: 'EA AYT',
    date: '2026-11-03',
    alan: 'ea',
    results: [{ subjectId: aytEdebiyat, correct: 8, wrong: 0, blank: 16 }],
  });

  renderApp('/denemeler?tur=AYT');

  const chartSelect = await screen.findByLabelText('Grafik dersi');
  expect(within(chartSelect).getByRole('option', { name: 'Edebiyat' })).toBeInTheDocument();
  await userEvent.selectOptions(chartSelect, aytEdebiyat);
  expect(
    await screen.findByRole('img', { name: 'AYT Edebiyat net trend grafiği' }),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Sayısal' }));
  await waitFor(() =>
    expect(
      within(chartSelect).queryByRole('option', { name: 'Edebiyat' }),
    ).not.toBeInTheDocument(),
  );
  expect(within(chartSelect).getByRole('option', { name: 'Matematik' })).toBeInTheDocument();
  expect(chartSelect).toHaveValue('');

  await userEvent.click(screen.getByRole('button', { name: 'Tüm alanlar' }));
  expect(
    await within(chartSelect).findByRole('option', { name: 'Edebiyat' }),
  ).toBeInTheDocument();
  // Branş değişimi seçili dersi sıfırlar; geri dönünce eski seçim geri gelmez.
  expect(chartSelect).toHaveValue('');
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

test('deneme kartları önceki aynı tür denemeye göre net farkını gösterir', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  await insertExam({
    name: 'Eylül TYT',
    date: '2026-09-01',
    results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
  });
  await insertExam({
    name: 'Ekim TYT',
    date: '2026-10-01',
    results: [{ subjectId: turkce, correct: 20, wrong: 2, blank: 0 }],
  });
  await insertExam({
    name: 'Kasım TYT',
    date: '2026-11-01',
    results: [{ subjectId: turkce, correct: 10, wrong: 10, blank: 0 }],
  });

  renderApp('/denemeler');

  expect(await screen.findByText('Kasım TYT')).toBeInTheDocument();
  expect(await screen.findByText('+9,50')).toBeInTheDocument();
  expect(screen.getByText('-12,00')).toBeInTheDocument();
  expect(screen.getByText('İlk deneme')).toBeInTheDocument();
});

test('eski alansız AYT denemesi çıkarılan alanla karşılaştırılır', async () => {
  const aytMatematik = await subjectIdByKey('ayt-matematik');
  await saveExam({
    type: 'AYT',
    name: 'Eski AYT',
    date: '2026-09-01',
    results: [{ subjectId: aytMatematik, correct: 10, wrong: 0, blank: 0 }],
  });
  await saveExam({
    type: 'AYT',
    name: 'Yeni EA AYT',
    date: '2026-10-01',
    alan: 'ea',
    results: [{ subjectId: aytMatematik, correct: 20, wrong: 0, blank: 0 }],
  });

  renderApp('/denemeler');
  await userEvent.click(await screen.findByRole('button', { name: 'AYT' }));

  expect(await screen.findByText('Yeni EA AYT')).toBeInTheDocument();
  expect(await screen.findByText('+10,00')).toBeInTheDocument();
  expect(screen.getByText('İlk deneme')).toBeInTheDocument();
  expect(screen.getByText('Eski AYT')).toBeInTheDocument();
});

test('TYT branş denemesi tek satırla kaydedilir', async () => {
  renderApp('/denemeler/yeni?brans=1&tur=TYT&branch=tyt-sosyal');
  await userEvent.type(await screen.findByLabelText('Deneme adı'), 'TYT Sosyal 1');
  await userEvent.type(screen.getByLabelText('Sosyal doğru'), '15');
  await userEvent.type(screen.getByLabelText('Sosyal yanlış'), '3');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'TYT Sosyal 1' }),
  ).toBeInTheDocument();
  const exams = await listExams('TYT');
  expect(exams).toHaveLength(1);
  expect(exams[0]).toMatchObject({ kind: 'branch', branch: 'tyt-sosyal' });
  const results = await listExamResults(exams[0].id);
  expect(results).toMatchObject([{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3 }]);
});

test('AYT branş denemesi alanına göre branş seçenekleri sunar', async () => {
  renderApp('/denemeler/yeni?brans=1&tur=AYT&alan=sayisal');
  await userEvent.type(await screen.findByLabelText('Deneme adı'), 'AYT Fen 1');
  const branch = screen.getByLabelText('Branş');
  expect(branch).toHaveDisplayValue('Branş seç');
  await userEvent.selectOptions(branch, 'ayt-sayisal-fen');
  await userEvent.type(screen.getByLabelText('Fen doğru'), '30');
  await userEvent.type(screen.getByLabelText('Fen yanlış'), '6');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  const exams = await listExams('AYT');
  expect(exams[0]).toMatchObject({
    kind: 'branch',
    branch: 'ayt-sayisal-fen',
    alan: 'sayisal',
  });
});

test('branş denemesi düzenlemede tür/alan/branş kilitlidir', async () => {
  const saved = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'Düzenlenecek',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 10, wrong: 2, blank: 8 }],
  });
  renderApp(`/denemeler/${saved.id}/duzenle`);

  expect(await screen.findByRole('button', { name: 'Branş denemesi' })).toBeDisabled();
  expect(screen.getByLabelText('Deneme türü')).toBeDisabled();
  expect(screen.getByLabelText('Branş')).toBeDisabled();
  expect(screen.getByLabelText('Sosyal doğru')).toHaveValue(10);
});

test('Sayısal kartı önceki deneme olarak EA denemesini saymaz ve farkı adında taşır', async () => {
  const aytMatematik = await subjectIdByKey('ayt-matematik');
  await saveExam({
    type: 'AYT',
    name: 'Sayısal Bir',
    date: '2026-09-01',
    alan: 'sayisal',
    results: [{ subjectId: aytMatematik, correct: 10, wrong: 0, blank: 0 }],
  });
  await saveExam({
    type: 'AYT',
    name: 'EA Yüksek',
    date: '2026-10-01',
    alan: 'ea',
    results: [{ subjectId: aytMatematik, correct: 100, wrong: 0, blank: 0 }],
  });
  await saveExam({
    type: 'AYT',
    name: 'Sayısal İki',
    date: '2026-11-01',
    alan: 'sayisal',
    results: [{ subjectId: aytMatematik, correct: 20, wrong: 0, blank: 0 }],
  });

  renderApp('/denemeler?tur=AYT');

  const card = await screen.findByRole('link', { name: /Sayısal İki/ });
  expect(card).toHaveAccessibleName(
    /toplam 20,00 net, önceki denemeye göre \+10,00 net/,
  );
  expect(within(card).getByText('+10,00')).toBeInTheDocument();
  expect(within(card).queryByText('-80,00')).not.toBeInTheDocument();
});

test('branş denemesi ayrı sekmede grafiklenir, tam deneme sekmesine girmez', async () => {
  const turkceId = await subjectIdByKey('tyt-turkce');
  await saveExam({
    kind: 'full',
    type: 'TYT',
    name: 'Tam TYT',
    date: '2026-11-18',
    results: [{ subjectId: turkceId, correct: 30, wrong: 5, blank: 5 }],
  });
  await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'TYT Sosyal 1',
    date: '2026-11-19',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });

  const view = renderApp('/denemeler');
  expect(await screen.findByText('Tam TYT')).toBeInTheDocument();
  expect(screen.queryByText('TYT Sosyal 1')).not.toBeInTheDocument();
  expect(screen.getByText('1 TYT denemesi')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Branş' }));
  expect(await screen.findByText('TYT Sosyal 1')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Branş'), 'tyt-sosyal');
  expect(await screen.findByText('TYT Sosyal branş denemeleri')).toBeInTheDocument();
  expect(screen.getByText('1 branş denemesi')).toBeInTheDocument();
  expect(screen.queryByText('Tam TYT')).not.toBeInTheDocument();
  view.unmount();
});

test('branş sekmesi veri bulunan ilk branşta açılır, branş değişince liste ve grafik değişir', async () => {
  await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'Sosyal Branş 1',
    date: '2026-11-19',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });
  await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-turkce',
    name: 'Türkçe Branş 1',
    date: '2026-11-18',
    results: [{ subjectId: 'tyt-turkce', correct: 30, wrong: 5, blank: 5 }],
  });

  const view = renderApp('/denemeler');
  await userEvent.click(await screen.findByRole('button', { name: 'Branş' }));

  const branchSelect = await screen.findByLabelText('Branş');
  expect(branchSelect).toHaveValue('tyt-turkce');
  expect(await screen.findByText('TYT Türkçe branş denemeleri')).toBeInTheDocument();
  expect(screen.getByText('Türkçe Branş 1')).toBeInTheDocument();
  expect(screen.queryByText('Sosyal Branş 1')).not.toBeInTheDocument();

  await userEvent.selectOptions(branchSelect, 'tyt-sosyal');
  expect(await screen.findByText('TYT Sosyal branş denemeleri')).toBeInTheDocument();
  expect(screen.getByText('Sosyal Branş 1')).toBeInTheDocument();
  expect(screen.queryByText('Türkçe Branş 1')).not.toBeInTheDocument();

  await userEvent.selectOptions(branchSelect, 'tyt-fen');
  expect(
    await screen.findByText('Henüz TYT Fen branş denemesi yok'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Sosyal Branş 1')).not.toBeInTheDocument();
  view.unmount();
});

test('branş denemesi kartı D/Y/B ve neti tek satırda gösterir', async () => {
  await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'Sosyal Kart',
    date: '2026-11-19',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });

  const view = renderApp('/denemeler?tur=BRANS');
  const card = await screen.findByRole('link', { name: /Sosyal Kart/ });

  expect(within(card).getByText('Sosyal')).toBeInTheDocument();
  expect(within(card).getByText('D')).toBeInTheDocument();
  expect(within(card).getByText('Y')).toBeInTheDocument();
  expect(within(card).getByText('B')).toBeInTheDocument();
  expect(within(card).getByText('Net')).toBeInTheDocument();
  expect(within(card).getByText('15')).toBeInTheDocument();
  expect(within(card).getByText('3')).toBeInTheDocument();
  expect(within(card).getByText('2')).toBeInTheDocument();
  // Toplam net ve tek satırın neti aynı değeri taşır.
  expect(within(card).getAllByText('14,25')).toHaveLength(2);
  view.unmount();
});

test('AYT branş sekmesi ayarlardaki alanla ve ilk branşla açılır', async () => {
  await patchSettings({ aytAlan: 'ea' });

  const view = renderApp('/denemeler');
  await userEvent.click(await screen.findByRole('button', { name: 'Branş' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Branş türü AYT' }));

  expect(screen.getByLabelText('Branş')).toHaveValue('ayt-ea-matematik');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Eşit Ağırlık' })).toHaveAttribute(
      'aria-pressed',
      'true',
    ),
  );
  expect(screen.getByRole('link', { name: 'Yeni deneme' })).toHaveAttribute(
    'href',
    '/denemeler/yeni?brans=1&tur=AYT&alan=ea&branch=ayt-ea-matematik',
  );
  view.unmount();
});

test('branş denemesi detayı tek satır ve branş etiketi gösterir', async () => {
  const saved = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'TYT Sosyal Detay',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });
  renderApp(`/denemeler/${saved.id}`);
  expect(await screen.findByText('Branş')).toBeInTheDocument();
  expect(screen.getByText('Sosyal')).toBeInTheDocument();
  expect(screen.queryByText('Bilinmeyen ders')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Yanlış fotoğrafları' })).not.toBeInTheDocument();

  const table = screen.getByRole('table', { name: 'Branş sonucu' });
  const row = within(table).getByRole('row', { name: /Sosyal/ });
  expect(within(row).getByText('15')).toBeInTheDocument();
  expect(within(row).getByText('3')).toBeInTheDocument();
  expect(within(row).getByText('2')).toBeInTheDocument();
  expect(within(row).getByText('14,25')).toBeInTheDocument();
  expect(within(table).getByText('D')).toBeInTheDocument();
  expect(within(table).getByText('Y')).toBeInTheDocument();
  expect(within(table).getByText('B')).toBeInTheDocument();
  expect(within(table).getByText('Net')).toBeInTheDocument();
  expect(screen.getByText('Toplam net')).toBeInTheDocument();
});

test('branş detayı yalnız aynı branştaki, tam detay yalnız tam denemelerle karşılaştırılır', async () => {
  const turkce = await subjectIdByKey('tyt-turkce');
  await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'Sosyal Eski',
    date: '2026-11-10',
    results: [{ subjectId: 'tyt-sosyal', correct: 10, wrong: 2, blank: 8 }],
  });
  const full = await saveExam({
    kind: 'full',
    type: 'TYT',
    name: 'Tam TYT',
    date: '2026-11-12',
    results: [{ subjectId: turkce, correct: 20, wrong: 0, blank: 0 }],
  });
  await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-turkce',
    name: 'Türkçe Branş',
    date: '2026-11-15',
    results: [{ subjectId: 'tyt-turkce', correct: 30, wrong: 0, blank: 10 }],
  });
  const current = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'Sosyal Yeni',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });

  const branchView = renderApp(`/denemeler/${current.id}`);
  expect(await screen.findByText('Önceki denemeye göre +4,75 net')).toBeInTheDocument();
  expect(screen.getByText(/Sosyal Eski · 10 Kasım 2026/)).toBeInTheDocument();
  expect(screen.queryByText(/Tam TYT/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Türkçe Branş/)).not.toBeInTheDocument();
  branchView.unmount();

  renderApp(`/denemeler/${full.id}`);
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Tam TYT' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Karşılaştırılacak önceki TYT denemesi yok.')).toBeInTheDocument();
  expect(screen.queryByText(/Sosyal Eski/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Sosyal Yeni/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Türkçe Branş/)).not.toBeInTheDocument();
});
