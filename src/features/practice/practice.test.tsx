import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  addPhotos,
  completePracticeSession,
  createPracticeSession,
  deletePhotos,
  getPracticeSession,
  listOpenPracticeSessions,
  listPracticeSessions,
  recordPracticeAnswer,
  updatePhoto,
} from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import type { ExamType, Photo, Subject, Topic } from '@/domain/types';
import { compressImage } from '@/lib/image';
import { scorePracticeSession } from '@/features/practice/practiceSummary';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

const repositoryMocks = vi.hoisted(() => ({
  realCompletePracticeSession: undefined as unknown as typeof import('@/db/repositories')['completePracticeSession'],
}));

vi.mock('@/db/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/repositories')>();
  repositoryMocks.realCompletePracticeSession = actual.completePracticeSession;
  return {
    ...actual,
    completePracticeSession: vi.fn(actual.completePracticeSession),
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
  vi.mocked(completePracticeSession).mockReset();
  vi.mocked(completePracticeSession).mockImplementation(
    repositoryMocks.realCompletePracticeSession,
  );
  vi.mocked(compressImage).mockReset();
  vi.mocked(compressImage).mockResolvedValue({
    blob: new Blob(['sıkıştırılmış fotoğraf'], { type: 'image/jpeg' }),
    thumbBlob: new Blob(['küçük resim'], { type: 'image/jpeg' }),
    width: 1600,
    height: 900,
  });
});

async function subjectByKey(seedKey: string): Promise<Subject> {
  const subject = await db.subjects.where('seedKey').equals(seedKey).first();
  if (!subject) {
    throw new Error(`Test dersi bulunamadı: ${seedKey}`);
  }
  return subject;
}

async function topicByKey(seedKey: string): Promise<Topic> {
  const topic = await db.topics.where('seedKey').equals(seedKey).first();
  if (!topic) {
    throw new Error(`Test konusu bulunamadı: ${seedKey}`);
  }
  return topic;
}

interface CreatePhotoOptions {
  note: string;
  subjectKey?: string;
  topicKey?: string;
  examType?: ExamType;
  mastered?: boolean;
  correctOption?: 'A' | 'B' | 'C' | 'D' | 'E';
}

async function createPhoto(options: CreatePhotoOptions): Promise<Photo> {
  const subject = await subjectByKey(options.subjectKey ?? 'tyt-mat');
  const topic = options.topicKey ? await topicByKey(options.topicKey) : undefined;
  const [photo] = await addPhotos([
    {
      file: new File(['fotoğraf'], 'soru.jpg', { type: 'image/jpeg' }),
      examType: options.examType ?? 'TYT',
      subjectId: subject.id,
      topicId: topic?.id,
      note: options.note,
      correctOption: options.correctOption ?? 'A',
    },
  ]);
  if (options.mastered) {
    await updatePhoto(photo.id, { mastered: true });
  }
  const stored = await db.photos.get(photo.id);
  if (!stored) {
    throw new Error('Fotoğraf kaydedilemedi');
  }
  return stored;
}

async function storedPhotoByNote(note: string): Promise<Photo | undefined> {
  const photos = await db.photos.toArray();
  return photos.find((photo) => photo.note === note);
}

test('createPracticeSession filtreleri saklar ve fotoğraf kimliklerini tekilleştirir', async () => {
  const session = await createPracticeSession({
    filters: {
      examType: 'TYT',
      subjectIds: ['ders-1', 'ders-1'],
      topicIds: [],
      count: 5,
    },
    photoIds: ['foto-a', 'foto-b', 'foto-a'],
  });

  expect(session.photoIds).toEqual(['foto-a', 'foto-b']);
  expect(session.results).toEqual({});
  expect(session.completedAt).toBeUndefined();
  expect(session.filters).toMatchObject({
    examType: 'TYT',
    subjectIds: ['ders-1'],
    count: 5,
  });
  // Yönerge gereği eksik onlyUnmastered "true" demektir; saklanan anlık görüntü
  // alanı uydurmaz.
  expect(session.filters.onlyUnmastered).toBeUndefined();
  expect(session.createdAt).toBeTruthy();
  expect(await getPracticeSession(session.id)).toEqual(session);

  await expect(
    createPracticeSession({ filters: {}, photoIds: [] }),
  ).rejects.toThrow('Test için fotoğraf bulunamadı');
});

test('recordPracticeAnswer doğru, yanlış ve boş geçişlerini fotoğrafa yazar', async () => {
  const correct = await createPhoto({ note: 'Doğru soru' });
  const wrong = await createPhoto({ note: 'Yanlış soru', mastered: true });
  const blank = await createPhoto({ note: 'Boş soru', mastered: true });
  const session = await createPracticeSession({
    filters: {},
    photoIds: [correct.id, wrong.id, blank.id],
  });

  await recordPracticeAnswer(session.id, correct.id, 'correct');
  await recordPracticeAnswer(session.id, wrong.id, 'wrong');
  await recordPracticeAnswer(session.id, blank.id, 'blank');

  const savedSession = await getPracticeSession(session.id);
  expect(savedSession?.results).toEqual({
    [correct.id]: 'correct',
    [wrong.id]: 'wrong',
    [blank.id]: 'blank',
  });
  expect(savedSession?.updatedAt).toBeTruthy();

  const savedCorrect = await db.photos.get(correct.id);
  expect(savedCorrect).toMatchObject({ mastered: true, practiceCount: 1 });
  expect(savedCorrect?.lastPracticedAt).toBeTruthy();

  const savedWrong = await db.photos.get(wrong.id);
  expect(savedWrong).toMatchObject({ mastered: false, practiceCount: 1 });
  expect(savedWrong?.lastPracticedAt).toBeTruthy();

  const savedBlank = await db.photos.get(blank.id);
  expect(savedBlank).toMatchObject({ mastered: true, practiceCount: 1 });
  expect(savedBlank?.lastPracticedAt).toBeTruthy();

  await expect(recordPracticeAnswer('olmayan-oturum', correct.id, 'correct')).rejects.toThrow(
    'Test oturumu bulunamadı',
  );
});

test('recordPracticeAnswer silinmiş fotoğrafı atlar ama oturum sonucunu korur', async () => {
  const existing = await createPhoto({ note: 'Kalan soru' });
  const session = await createPracticeSession({
    filters: {},
    photoIds: ['silinmis-foto', existing.id],
  });

  await expect(
    recordPracticeAnswer(session.id, 'silinmis-foto', 'correct'),
  ).resolves.toBeUndefined();

  expect((await getPracticeSession(session.id))?.results).toEqual({
    'silinmis-foto': 'correct',
  });
  expect((await db.photos.get(existing.id))?.practiceCount).toBe(0);

  // Silinen fotoğrafın cevabı oturumda kalır; geçmiş skoru korunur.
  const saved = await getPracticeSession(session.id);
  expect(scorePracticeSession(saved!)).toMatchObject({
    correct: 1,
    answered: 1,
    total: 2,
  });
});

test('recordPracticeAnswer oturum ve fotoğrafı tek işlemde yazar', async () => {
  const photo = await createPhoto({ note: 'Atomik soru' });
  const session = await createPracticeSession({ filters: {}, photoIds: [photo.id] });

  const updateSpy = vi
    .spyOn(db.photos, 'update')
    .mockRejectedValueOnce(new Error('yazma hatası'));

  await expect(recordPracticeAnswer(session.id, photo.id, 'correct')).rejects.toThrow(
    'yazma hatası',
  );
  updateSpy.mockRestore();

  expect((await getPracticeSession(session.id))?.results).toEqual({});
  expect((await db.photos.get(photo.id))?.practiceCount).toBe(0);
});

test('completePracticeSession bitiş zamanını yazar ve tamamlananları son 10 olarak listeler', async () => {
  const photo = await createPhoto({ note: 'Geçmiş sorusu' });
  const open = await createPracticeSession({ filters: {}, photoIds: [photo.id] });

  expect(await listOpenPracticeSessions()).toContainEqual(open);

  await completePracticeSession(open.id);
  const completed = await getPracticeSession(open.id);
  expect(completed?.completedAt).toBeTruthy();
  expect(completed?.updatedAt).toBe(completed?.completedAt);
  // Push the first completion before the generated history so it does not
  // compete with the 12 deterministic entries below.
  await db.practiceSessions.update(open.id, {
    completedAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  });
  expect(await listOpenPracticeSessions()).not.toContainEqual(
    expect.objectContaining({ id: open.id }),
  );

  // 12 tamamlanmış oturum: liste varsayılan olarak en yeni 10'u döndürür.
  for (let index = 1; index <= 12; index += 1) {
    const session = await createPracticeSession({
      filters: { count: index },
      photoIds: [photo.id],
    });
    const completedAt = `2026-11-${String(index).padStart(2, '0')}T10:00:00.000Z`;
    await db.practiceSessions.update(session.id, { completedAt, updatedAt: completedAt });
  }

  const latest = await listPracticeSessions();
  expect(latest).toHaveLength(10);
  expect(latest[0]?.completedAt).toBe('2026-11-12T10:00:00.000Z');
  expect(latest.at(-1)?.completedAt).toBe('2026-11-03T10:00:00.000Z');

  const five = await listPracticeSessions(5);
  expect(five).toHaveLength(5);
  expect(five[0]?.completedAt).toBe('2026-11-12T10:00:00.000Z');

  const openSessions = await listOpenPracticeSessions();
  expect(openSessions).toHaveLength(0);
});

test('sihirbaz fotoğrafları seçer ve oturum başlatır', async () => {
  const first = await createPhoto({ note: 'Birinci soru' });
  const second = await createPhoto({ note: 'İkinci soru' });

  renderApp('/yanlislar/test');

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Rastgele Test' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('Test 2 fotoğraftan oluşacak.')).toBeInTheDocument();

  // 5 istenir ama arşivde yalnızca 2 fotoğraf var: uyarı verip mevcutları kullanır.
  await userEvent.click(screen.getByRole('button', { name: '5 soru' }));
  expect(
    await screen.findByText('Yalnızca 2 fotoğraf var; test 2 sorudan oluşacak.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Test 2 fotoğraftan oluşacak.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Testi başlat' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Test oturumu' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Soru 1 / 2')).toBeInTheDocument();

  const sessions = await db.practiceSessions.toArray();
  expect(sessions).toHaveLength(1);
  expect(new Set(sessions[0]?.photoIds)).toEqual(new Set([first.id, second.id]));
});

test('sihirbaz varsayılan olarak 10 soru seçer ve Tümü açık uyarı verir', async () => {
  for (let index = 1; index <= 12; index += 1) {
    await createPhoto({ note: `Soru ${index}` });
  }

  renderApp('/yanlislar/test');

  expect(await screen.findByText('Test 10 fotoğraftan oluşacak.')).toBeInTheDocument();
  expect(screen.queryByText(/Tümü seçildi/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Tümü sorular' }));

  expect(await screen.findByText('Test 12 fotoğraftan oluşacak.')).toBeInTheDocument();
  expect(screen.getByText(/Tümü seçildi/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '10 soru' }));
  await userEvent.click(screen.getByRole('button', { name: 'Testi başlat' }));

  await screen.findByRole('heading', { level: 1, name: 'Test oturumu' });
  const sessions = await db.practiceSessions.toArray();
  expect(sessions).toHaveLength(1);
  expect(sessions[0].photoIds).toHaveLength(10);
});

test('test oturumu iptal edilir, cevaplar ve fotoğraf durumu korunur', async () => {
  const photo = await createPhoto({ note: 'İptal sorusu' });
  const history = await createPracticeSession({ filters: {}, photoIds: [photo.id] });
  await completePracticeSession(history.id);
  const session = await createPracticeSession({ filters: {}, photoIds: [photo.id] });
  await recordPracticeAnswer(session.id, photo.id, 'wrong');

  renderApp(`/yanlislar/test/${session.id}`);

  expect(await screen.findByRole('img', { name: 'İptal sorusu' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Testi iptal et' }));
  const dialog = await screen.findByRole('dialog', { name: 'Testi iptal et' });
  expect(within(dialog).getByText(/Cevapladığın soruların sonuçları/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'İptal et' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Rastgele Test' }),
  ).toBeInTheDocument();
  expect(await getPracticeSession(session.id)).toBeUndefined();
  expect(await listOpenPracticeSessions()).toHaveLength(0);
  // Tamamlanmış geçmiş test iptalden etkilenmez.
  expect((await listPracticeSessions()).map((item) => item.id)).toEqual([history.id]);
  const stored = await db.photos.get(photo.id);
  expect(stored).toMatchObject({ practiceCount: 1, mastered: false });
});

test('oturum yalnızca mevcut fotoğrafın tam blobunu okur', async () => {
  const first = await createPhoto({ note: 'Birinci soru' });
  const second = await createPhoto({ note: 'İkinci soru' });
  const session = await createPracticeSession({
    filters: {},
    photoIds: [first.id, second.id],
  });
  const getSpy = vi.spyOn(db.photos, 'get');
  const bulkGetSpy = vi.spyOn(db.photos, 'bulkGet');

  renderApp(`/yanlislar/test/${session.id}`);

  expect(await screen.findByRole('img', { name: 'Birinci soru' })).toBeInTheDocument();
  expect(bulkGetSpy).not.toHaveBeenCalled();
  const requestedIds = getSpy.mock.calls.map((call) => call[0]);
  expect(requestedIds).toContain(first.id);
  expect(requestedIds).not.toContain(second.id);

  await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
  expect(await screen.findByRole('img', { name: 'İkinci soru' })).toBeInTheDocument();
  expect(getSpy.mock.calls.map((call) => call[0])).toContain(second.id);

  getSpy.mockRestore();
  bulkGetSpy.mockRestore();
});

test('cevaplar anında kaydedilir, bitince özet ve geçmiş görünür', async () => {
  const correctPhoto = await createPhoto({ note: 'Doğru soru' });
  const wrongPhoto = await createPhoto({ note: 'Yanlış soru', mastered: true });
  const blankPhoto = await createPhoto({ note: 'Boş soru', mastered: true });

  renderApp('/yanlislar/test');

  // İki fotoğraf çözüldü, varsayılan filtre yalnızca birini bırakır.
  expect(await screen.findByText('Test 1 fotoğraftan oluşacak.')).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Sadece çözülmemişler'));
  expect(await screen.findByText('Test 3 fotoğraftan oluşacak.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Testi başlat' }));
  await screen.findByRole('heading', { level: 1, name: 'Test oturumu' });

  const outcomes = new Map([
    ['Doğru soru', 'A seçeneği'],
    ['Yanlış soru', 'B seçeneği'],
    ['Boş soru', 'Boş bırak'],
  ]);

  for (let step = 0; step < 3; step += 1) {
    const image = await screen.findByRole('img');
    const label = image.getAttribute('alt') ?? '';
    const outcome = outcomes.get(label);
    expect(outcome).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: outcome }));

    await waitFor(async () => {
      const stored = await storedPhotoByNote(label);
      expect(stored?.practiceCount).toBe(1);
      expect(stored?.lastPracticedAt).toBeTruthy();
    });

    if (outcome === 'A seçeneği') {
      expect(
        await screen.findByText('Doğru! Doğru cevap: A'),
      ).toBeInTheDocument();
    } else if (outcome === 'B seçeneği') {
      expect(
        await screen.findByText('Yanlış. Senin cevabın: B. Doğru cevap: A'),
      ).toBeInTheDocument();
    } else {
      expect(await screen.findByText('Boş bırakıldı. Doğru cevap: A')).toBeInTheDocument();
    }

    if (step < 2) {
      await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    }
  }

  expect((await db.photos.get(correctPhoto.id))?.mastered).toBe(true);
  expect((await db.photos.get(wrongPhoto.id))?.mastered).toBe(false);
  // Boş cevabı önceden çözülmüş olan fotoğrafın durumunu değiştirmez.
  expect((await db.photos.get(blankPhoto.id))?.mastered).toBe(true);

  await userEvent.click(await screen.findByRole('button', { name: 'Testi bitir' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Test tamamlandı' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Doğru sayısı: 1')).toBeInTheDocument();
  expect(screen.getByLabelText('Yanlış sayısı: 1')).toBeInTheDocument();
  expect(screen.getByLabelText('Boş sayısı: 1')).toBeInTheDocument();
  expect(screen.getByLabelText('Toplam soru: 3')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Süre:/)).toBeInTheDocument();

  const session = await db.practiceSessions.toCollection().first();
  expect(session?.completedAt).toBeTruthy();

  await userEvent.click(screen.getByRole('link', { name: 'Rastgele teste dön' }));

  expect(
    await screen.findByRole('heading', { level: 2, name: 'Geçmiş testler' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('1/3 doğru')).toBeInTheDocument();
});

test('yeniden açılan oturum ilk cevaplanmamış fotoğraftan devam eder ve silinmişleri atlar', async () => {
  const first = await createPhoto({ note: 'Birinci soru' });
  const second = await createPhoto({ note: 'İkinci soru' });
  const session = await createPracticeSession({
    filters: {},
    photoIds: ['silinmis-foto', first.id, second.id],
  });
  await recordPracticeAnswer(session.id, first.id, 'wrong');

  renderApp(`/yanlislar/test/${session.id}`);

  expect(await screen.findByRole('img', { name: 'İkinci soru' })).toBeInTheDocument();
  expect(screen.getByText('Soru 2 / 2')).toBeInTheDocument();
  expect(screen.getByText('1 / 2 cevaplandı')).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Birinci soru' })).not.toBeInTheDocument();
});

test('tüm fotoğraflar silinmiş testte bitirme hatası görünür kalır', async () => {
  const photo = await createPhoto({ note: 'Silinecek soru' });
  const session = await createPracticeSession({ filters: {}, photoIds: [photo.id] });
  await deletePhotos([photo.id]);
  vi.mocked(completePracticeSession).mockRejectedValueOnce(new Error('yazma hatası'));
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  renderApp(`/yanlislar/test/${session.id}`);

  expect(await screen.findByText('Bu testteki fotoğraflar silinmiş')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Testi bitir' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Test bitirilemedi. Lütfen tekrar dene.',
  );
  expect((await getPracticeSession(session.id))?.completedAt).toBeUndefined();
  // Hata sonrası buton yeniden denenebilir kalır.
  expect(screen.getByRole('button', { name: 'Testi bitir' })).toBeEnabled();

  consoleSpy.mockRestore();
});

test('yanlışlar sayfası devam eden testi ve seçilenlerden test bağlantısını gösterir', async () => {
  const first = await createPhoto({ note: 'Birinci soru' });
  const second = await createPhoto({ note: 'İkinci soru' });
  const open = await createPracticeSession({ filters: {}, photoIds: [first.id] });

  renderApp('/yanlislar');

  expect(
    await screen.findByRole('heading', { level: 2, name: 'Devam eden test' }),
  ).toBeInTheDocument();
  const continueLink = await screen.findByRole('link', { name: /Devam et/ });
  expect(continueLink).toHaveAttribute('href', `/yanlislar/test/${open.id}`);

  await userEvent.click(await screen.findByRole('button', { name: 'Seç' }));
  await userEvent.click(screen.getByRole('button', { name: 'Birinci soru' }));
  await userEvent.click(screen.getByRole('button', { name: 'İkinci soru' }));
  await userEvent.click(
    screen.getByRole('link', { name: 'Seçilenlerden test oluştur' }),
  );

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Rastgele Test' }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText('Seçilen 2 fotoğraftan test oluşturulacak.'),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Testi başlat' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Test oturumu' }),
  ).toBeInTheDocument();
  const sessions = await db.practiceSessions.toArray();
  expect(sessions).toHaveLength(2);
  const created = sessions.find((session) => session.id !== open.id);
  expect(new Set(created?.photoIds)).toEqual(new Set([first.id, second.id]));
});

test('geçmiş testler en yeni tamamlanan oturumları tarih ve skorla listeler', async () => {
  const photo = await createPhoto({ note: 'Geçmiş sorusu' });
  const oldSession = await createPracticeSession({
    filters: { examType: 'TYT' },
    photoIds: [photo.id],
  });
  await recordPracticeAnswer(oldSession.id, photo.id, 'correct');
  await completePracticeSession(oldSession.id);
  await db.practiceSessions.update(oldSession.id, {
    completedAt: '2026-11-01T09:00:00.000Z',
  });

  const newSession = await createPracticeSession({
    filters: { examType: 'AYT' },
    photoIds: [photo.id],
  });
  await recordPracticeAnswer(newSession.id, photo.id, 'wrong');
  await completePracticeSession(newSession.id);
  await db.practiceSessions.update(newSession.id, {
    completedAt: '2026-11-02T09:00:00.000Z',
  });

  renderApp('/yanlislar/test');

  expect(
    await screen.findByRole('heading', { level: 2, name: 'Geçmiş testler' }),
  ).toBeInTheDocument();
  const list = await screen.findByRole('list', { name: 'Geçmiş testler' });

  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  // En yeni (yanlış) test önce; skor tamamlanan oturumdan gelir.
  expect(items[0]).toHaveTextContent('0/1');
  expect(items[0]).toHaveTextContent('doğru');
  expect(items[1]).toHaveTextContent('1/1');
  expect(within(items[0] as HTMLElement).getByRole('link')).toHaveAttribute(
    'href',
    `/yanlislar/test/${newSession.id}`,
  );
  expect(within(items[1] as HTMLElement).getByRole('link')).toHaveAttribute(
    'href',
    `/yanlislar/test/${oldSession.id}`,
  );
});
