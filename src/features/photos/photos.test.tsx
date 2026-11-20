import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  addPhotos,
  deletePhotos,
  listPhotos,
  saveExam,
  updatePhoto,
} from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import type { ExamType, Subject, Topic } from '@/domain/types';
import { searchAll } from '@/features/search/searchAll';
import { compressImage } from '@/lib/image';
import { STORAGE_QUOTA_MESSAGE } from '@/lib/storageError';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

vi.mock('@/db/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/repositories')>();
  return {
    ...actual,
    addPhotos: vi.fn(actual.addPhotos),
  };
});

vi.mock('@/lib/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/image')>();
  return {
    ...actual,
    compressImage: vi.fn(),
  };
});

const FIXTURE: CurriculumSeed = {
  version: 1,
  subjects: [
    {
      seedKey: 'tyt-mat',
      exam: 'TYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [
        { seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 },
        { seedKey: 'tyt-mat-pol', name: 'Polinomlar', order: 2 },
      ],
    },
    {
      seedKey: 'tyt-fiz',
      exam: 'TYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 2,
      topics: [{ seedKey: 'tyt-fiz-hareket', name: 'Hareket', order: 1 }],
    },
  ],
};

beforeEach(async () => {
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
  vi.mocked(compressImage).mockReset();
  vi.mocked(compressImage).mockResolvedValue({
    blob: new Blob(['sıkıştırılmış fotoğraf'], { type: 'image/jpeg' }),
    thumbBlob: new Blob(['küçük resim'], { type: 'image/jpeg' }),
    width: 1600,
    height: 900,
  });
  vi.mocked(addPhotos).mockClear();
});

async function topicByKey(seedKey: string): Promise<{ subject: Subject; topic: Topic }> {
  const topic = await db.topics.where('seedKey').equals(seedKey).first();
  if (!topic) {
    throw new Error(`Test konusu bulunamadı: ${seedKey}`);
  }
  const subject = await db.subjects.get(topic.subjectId);
  if (!subject) {
    throw new Error(`Test dersi bulunamadı: ${topic.subjectId}`);
  }
  return { subject, topic };
}

interface CreatePhotoOptions {
  note?: string;
  subjectKey?: string;
  examId?: string;
  examType?: ExamType;
}

async function createPhoto(options: CreatePhotoOptions = {}) {
  const { subject, topic } = await topicByKey(options.subjectKey ?? 'tyt-mat-turev');
  const [photo] = await addPhotos([
    {
      file: new File(['fotoğraf'], 'soru.jpg', { type: 'image/jpeg' }),
      examType: options.examType ?? 'TYT',
      subjectId: subject.id,
      topicId: topic.id,
      examId: options.examId,
      note: options.note ?? 'Yanlış soru',
    },
  ]);
  return photo;
}

async function openUploadDialog(): Promise<HTMLElement> {
  renderApp('/yanlislar');
  await userEvent.click(await screen.findByRole('button', { name: 'Fotoğraf ekle' }));
  return screen.findByRole('dialog', { name: 'Fotoğraf yükle' });
}

test('fotoğraf ekler, blobsuz arama projeksiyonu yazar ve arama notu bulur', async () => {
  const photo = await createPhoto({ note: 'Türev fotoğrafı' });

  expect(photo).toMatchObject({
    note: 'Türev fotoğrafı',
    examType: 'TYT',
    mastered: false,
    practiceCount: 0,
  });
  expect(photo.blob.type).toBe('image/jpeg');
  expect(photo.thumbBlob.type).toBe('image/jpeg');
  expect(photo.width).toBe(1600);
  expect(photo.createdAt).toBeTruthy();
  expect(compressImage).toHaveBeenCalledWith(expect.any(File));

  const projection = await db.photoSearch.get(photo.id);
  expect(projection).toEqual({
    id: photo.id,
    examType: 'TYT',
    subjectId: photo.subjectId,
    topicId: photo.topicId,
    note: 'Türev fotoğrafı',
    createdAt: photo.createdAt,
  });
  expect(projection).not.toHaveProperty('blob');
  expect(projection).not.toHaveProperty('thumbBlob');

  // Arama yalnızca projeksiyonu okur; fotoğraf bloblarını taşıyan tabloya dokunmaz.
  const blobTableSpy = vi.spyOn(db.photos, 'toArray');
  const results = await searchAll('TÜREV FOTOĞRAFI');
  expect(blobTableSpy).not.toHaveBeenCalled();
  blobTableSpy.mockRestore();

  expect(results).toContainEqual(
    expect.objectContaining({
      kind: 'photo',
      id: photo.id,
      title: 'Türev fotoğrafı',
      href: '/yanlislar',
    }),
  );
});

test('addPhotos notu varsayılan boş bırakır ve deneme türünü doğrular', async () => {
  const { subject } = await topicByKey('tyt-mat-turev');
  const exam = await saveExam({
    type: 'TYT',
    name: 'Tür Doğrulama',
    date: '2026-11-10',
    results: [],
  });

  const [emptyNote] = await addPhotos([
    {
      file: new File(['x'], 'notsuz.jpg', { type: 'image/jpeg' }),
      examType: 'TYT',
      subjectId: subject.id,
    },
  ]);
  expect(emptyNote.note).toBe('');

  await expect(
    addPhotos([
      {
        file: new File(['x'], 'yanlis.jpg', { type: 'image/jpeg' }),
        examId: exam.id,
        examType: 'AYT',
        subjectId: subject.id,
      },
    ]),
  ).rejects.toThrow('Deneme türü fotoğraf türüyle uyuşmuyor');

  await expect(
    addPhotos([
      {
        file: new File(['x'], 'yok.jpg', { type: 'image/jpeg' }),
        examId: 'olmayan-deneme',
        examType: 'TYT',
        subjectId: subject.id,
      },
    ]),
  ).rejects.toThrow('Deneme bulunamadı');

  await expect(
    addPhotos([
      {
        file: new File(['x'], 'derssiz.jpg', { type: 'image/jpeg' }),
        examType: 'TYT',
        subjectId: '   ',
      },
    ]),
  ).rejects.toThrow('Ders seçilmedi');

  expect(await db.photos.count()).toBe(1);
  expect(await db.photoSearch.count()).toBe(1);
});

test('depolama kotası dolduğunda Türkçe hata verir ve yarım kayıt bırakmaz', async () => {
  const bulkAddSpy = vi
    .spyOn(db.photoSearch, 'bulkAdd')
    .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

  await expect(createPhoto({ note: 'Kota testi' })).rejects.toThrow(STORAGE_QUOTA_MESSAGE);
  bulkAddSpy.mockRestore();

  expect(await db.photos.count()).toBe(0);
  expect(await db.photoSearch.count()).toBe(0);
});

test('listPhotos indeksli filtreleri, durumu ve metin aramasını uygular', async () => {
  const mat = await topicByKey('tyt-mat-turev');
  const fiz = await topicByKey('tyt-fiz-hareket');
  const exam = await saveExam({
    type: 'TYT',
    name: 'Filtre Denemesi',
    date: '2026-11-10',
    results: [],
  });

  const older = await createPhoto({ note: 'Türev sorusu', subjectKey: 'tyt-mat-turev' });
  const newer = await createPhoto({
    note: 'Fizik sorusu',
    subjectKey: 'tyt-fiz-hareket',
    examId: exam.id,
  });
  await updatePhoto(older.id, { createdAt: '2026-11-01T09:00:00.000Z' });
  await updatePhoto(newer.id, { createdAt: '2026-11-05T09:00:00.000Z' });

  const ids = (photos: Awaited<ReturnType<typeof listPhotos>>) => photos.map((photo) => photo.id);

  expect(ids(await listPhotos({}))).toEqual([newer.id, older.id]);
  expect(ids(await listPhotos({ subjectId: mat.subject.id }))).toEqual([older.id]);
  expect(ids(await listPhotos({ topicId: mat.topic.id }))).toEqual([older.id]);
  expect(ids(await listPhotos({ examId: exam.id }))).toEqual([newer.id]);
  expect(ids(await listPhotos({ examType: 'TYT' }))).toEqual([newer.id, older.id]);
  expect(ids(await listPhotos({ query: 'FİZİK' }))).toEqual([newer.id]);
  expect(ids(await listPhotos({ from: '2026-11-03' }))).toEqual([newer.id]);
  expect(ids(await listPhotos({ to: '2026-11-03' }))).toEqual([older.id]);
  expect(ids(await listPhotos({ subjectId: fiz.subject.id, query: 'türev' }))).toEqual([]);

  await updatePhoto(older.id, { mastered: true });
  expect(ids(await listPhotos({ mastered: true }))).toEqual([older.id]);
  expect(ids(await listPhotos({ mastered: false }))).toEqual([newer.id]);
});

test('updatePhoto projeksiyonu eşitler, deletePhotos iki tablodan siler', async () => {
  const photo = await createPhoto({ note: 'Eski not' });

  await updatePhoto(photo.id, { note: 'Yeni not', mastered: true });

  expect((await db.photos.get(photo.id))?.note).toBe('Yeni not');
  expect((await db.photos.get(photo.id))?.mastered).toBe(true);
  expect((await db.photoSearch.get(photo.id))?.note).toBe('Yeni not');
  expect(
    (await searchAll('yeni not')).some(
      (result) => result.kind === 'photo' && result.id === photo.id,
    ),
  ).toBe(true);
  expect((await searchAll('eski not')).some((result) => result.kind === 'photo')).toBe(false);

  await deletePhotos([photo.id]);

  expect(await db.photos.get(photo.id)).toBeUndefined();
  expect(await db.photoSearch.get(photo.id)).toBeUndefined();
});

test('galeride fotoğraf yükler ve küçük resmi tembel yükler', async () => {
  const { subject } = await topicByKey('tyt-mat-turev');
  const dialog = await openUploadDialog();

  await userEvent.selectOptions(within(dialog).getByLabelText(/Ders/), subject.id);
  await userEvent.type(within(dialog).getByLabelText('Not'), 'Türev sorusu 1');
  await userEvent.upload(
    within(dialog).getByLabelText('Galeriden seç'),
    new File(['fotoğraf'], 'soru.jpg', { type: 'image/jpeg' }),
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Yükle' }));

  const image = await screen.findByRole('img', { name: 'Türev sorusu 1' });
  expect(image).toHaveAttribute('src', expect.stringContaining('blob:'));
  expect(image).toHaveAttribute('loading', 'lazy');

  expect(await db.photos.count()).toBe(1);
  const stored = await db.photos.toCollection().first();
  expect(stored).toMatchObject({ note: 'Türev sorusu 1', subjectId: subject.id });
});

test('ders filtresi galerideki fotoğrafları daraltır', async () => {
  const fiz = await topicByKey('tyt-fiz-hareket');
  await createPhoto({ note: 'Matematik sorusu', subjectKey: 'tyt-mat-turev' });
  await createPhoto({ note: 'Fizik sorusu', subjectKey: 'tyt-fiz-hareket' });

  renderApp('/yanlislar');

  expect(await screen.findByRole('img', { name: 'Matematik sorusu' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Fizik sorusu' })).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('Ders filtresi'), fiz.subject.id);

  await waitFor(() => {
    expect(screen.queryByRole('img', { name: 'Matematik sorusu' })).not.toBeInTheDocument();
  });
  expect(screen.getByRole('img', { name: 'Fizik sorusu' })).toBeInTheDocument();
});

test('fotoğraf detayında çözüldü işaretlenir', async () => {
  const photo = await createPhoto({ note: 'İşaretlenecek soru' });

  renderApp(`/yanlislar/${photo.id}`);

  expect(await screen.findByRole('img', { name: 'İşaretlenecek soru' })).toBeInTheDocument();
  expect(screen.getByText('Durum: Çözülmedi')).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', { name: 'Çözüldü olarak işaretle' }),
  );

  await waitFor(async () => {
    expect((await db.photos.get(photo.id))?.mastered).toBe(true);
  });
  expect(await screen.findByText('Durum: Çözüldü')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Çözüldü işaretini kaldır' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('fotoğraf detayından onaylayarak siler ve galeriye döner', async () => {
  const photo = await createPhoto({ note: 'Silinecek soru' });

  renderApp(`/yanlislar/${photo.id}`);

  await userEvent.click(await screen.findByRole('button', { name: 'Sil' }));
  const dialog = await screen.findByRole('dialog', { name: 'Fotoğrafı sil' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));

  await waitFor(async () => {
    expect(await db.photos.get(photo.id)).toBeUndefined();
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Yanlışlar' })).toBeInTheDocument();
  expect(await db.photoSearch.get(photo.id)).toBeUndefined();
});

test('deneme detayında bağlı fotoğrafları ve yükleme kısayolunu gösterir', async () => {
  const { subject } = await topicByKey('tyt-mat-turev');
  const exam = await saveExam({
    type: 'TYT',
    name: 'Türev Denemesi',
    date: '2026-11-10',
    results: [],
  });
  await addPhotos([
    {
      file: new File(['fotoğraf'], 'deneme.jpg', { type: 'image/jpeg' }),
      examId: exam.id,
      examType: 'TYT',
      subjectId: subject.id,
      note: 'Deneme fotoğrafı',
    },
  ]);

  renderApp(`/denemeler/${exam.id}`);

  expect(await screen.findByRole('img', { name: 'Deneme fotoğrafı' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Fotoğraf ekle' })).toBeInTheDocument();
});

test('konu Yanlışlar sekmesinde fotoğrafı ve yükleme kısayolunu gösterir', async () => {
  const { subject, topic } = await topicByKey('tyt-mat-turev');
  await addPhotos([
    {
      file: new File(['fotoğraf'], 'konu.jpg', { type: 'image/jpeg' }),
      examType: 'TYT',
      subjectId: subject.id,
      topicId: topic.id,
      note: 'Konu fotoğrafı',
    },
  ]);

  renderApp(`/tyt/${subject.id}/${topic.id}`);

  await userEvent.click(await screen.findByRole('tab', { name: 'Yanlışlar' }));

  expect(await screen.findByRole('img', { name: 'Konu fotoğrafı' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Fotoğraf ekle' })).toBeInTheDocument();
});

test('toplu seçim ve silme fotoğrafları galeriden kaldırır', async () => {
  await createPhoto({ note: 'Birinci soru', subjectKey: 'tyt-mat-turev' });
  await createPhoto({ note: 'İkinci soru', subjectKey: 'tyt-fiz-hareket' });

  renderApp('/yanlislar');

  await userEvent.click(await screen.findByRole('button', { name: 'Seç' }));
  await userEvent.click(screen.getByRole('button', { name: 'Birinci soru' }));
  await userEvent.click(screen.getByRole('button', { name: 'İkinci soru' }));
  expect(screen.getByText('2 fotoğraf · 2 seçildi')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Seçilenleri sil' }));
  const dialog = await screen.findByRole('dialog', { name: 'Fotoğrafları sil' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));

  await waitFor(async () => {
    expect(await db.photos.count()).toBe(0);
  });
  expect(await screen.findByText('Henüz yanlış fotoğrafı yok')).toBeInTheDocument();
  expect(await db.photoSearch.count()).toBe(0);
});

test('Test oluştur bağlantısı rastgele test sayfasına gider', async () => {
  renderApp('/yanlislar');

  await userEvent.click(await screen.findByRole('link', { name: 'Test oluştur' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Rastgele Test' }),
  ).toBeInTheDocument();
});

test('depolama kotası hatasında Türkçe mesaj gösterir ve yükleme askıda kalmaz', async () => {
  const { subject } = await topicByKey('tyt-mat-turev');
  vi.mocked(addPhotos).mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

  const dialog = await openUploadDialog();
  await userEvent.selectOptions(within(dialog).getByLabelText(/Ders/), subject.id);
  await userEvent.upload(
    within(dialog).getByLabelText('Galeriden seç'),
    new File(['fotoğraf'], 'kota.jpg', { type: 'image/jpeg' }),
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Yükle' }));

  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Telefonda yeterli yer yok',
  );
  expect(within(dialog).getByRole('button', { name: 'Yükle' })).toBeEnabled();
  expect(await db.photos.count()).toBe(0);
  expect(await db.photoSearch.count()).toBe(0);
});
