import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  createBook,
  deleteBookCascade,
  getBook,
  listBookTopicBooks,
  listBooks,
  upsertTopicBook,
} from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import type { Subject, Topic } from '@/domain/types';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

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
    {
      seedKey: 'ayt-mat',
      exam: 'AYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [{ seedKey: 'ayt-mat-turev', name: 'Türev', order: 1 }],
    },
  ],
};

const NOW = '2026-05-01T10:00:00.000Z';

beforeEach(async () => {
  // The fixture keeps seedVersion current so SettingsProvider does not replace
  // this small curriculum with the full 339-topic seed.
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
});

async function subjectByKey(seedKey: string): Promise<Subject> {
  const subject = (await db.subjects.where('seedKey').equals(seedKey).first()) ?? undefined;
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

async function seedBookWithRecords(): Promise<{ bookId: string; turev: Topic; polinomlar: Topic }> {
  const book = await createBook({ name: 'Karekök TYT', publisher: 'Karekök' });
  const turev = await topicByKey('tyt-mat-turev');
  const polinomlar = await topicByKey('tyt-mat-pol');

  await upsertTopicBook({
    topicId: turev.id,
    bookId: book.id,
    totalTests: 10,
    solvedTests: 4,
  });
  await upsertTopicBook({
    topicId: polinomlar.id,
    bookId: book.id,
    totalTests: 6,
    solvedTests: 5,
  });

  return { bookId: book.id, turev, polinomlar };
}

async function addNoteAndPhoto(topic: Topic, subject: Subject): Promise<void> {
  await db.notes.add({
    topicId: topic.id,
    contentHtml: '<p>Konu notu</p>',
    plainText: 'Konu notu',
    updatedAt: NOW,
  });
  await db.photos.add({
    id: 'photo-1',
    examType: 'TYT',
    subjectId: subject.id,
    topicId: topic.id,
    note: 'Yanlış soru',
    blob: new Blob(['x']),
    thumbBlob: new Blob(['x']),
    width: 1,
    height: 1,
    mastered: false,
    practiceCount: 0,
    createdAt: NOW,
  });
}

test('kitap konu kayıtlarını gerçek tablolardan birleştirir ve sıraya koyar', async () => {
  const book = await createBook({ name: 'Sıralama Kitabı' });
  const insertedTopics = [
    await topicByKey('ayt-mat-turev'),
    await topicByKey('tyt-fiz-hareket'),
    await topicByKey('tyt-mat-pol'),
    await topicByKey('tyt-mat-turev'),
  ];

  for (const [index, topic] of insertedTopics.entries()) {
    await upsertTopicBook({
      topicId: topic.id,
      bookId: book.id,
      totalTests: index + 1,
      solvedTests: index + 1,
    });
  }

  const rows = await listBookTopicBooks(book.id);

  expect(rows.map((row) => row.topic.seedKey)).toEqual([
    'tyt-mat-turev',
    'tyt-mat-pol',
    'tyt-fiz-hareket',
    'ayt-mat-turev',
  ]);
  expect(rows[0]).toMatchObject({ bookId: book.id, totalTests: 4, solvedTests: 4 });
  expect(rows[0].subject).toMatchObject({ seedKey: 'tyt-mat', exam: 'TYT' });
  expect(rows[3].subject).toMatchObject({ seedKey: 'ayt-mat', exam: 'AYT' });
  expect(await getBook(book.id)).toMatchObject({ name: 'Sıralama Kitabı' });
});

test('kitap listesi güncelleme zamanı, ad ve kimlikle kararlı sıralanır', async () => {
  await db.books.bulkAdd([
    { id: 'b2', name: 'Beta', createdAt: NOW, updatedAt: NOW },
    { id: 'b1', name: 'Alfa', createdAt: NOW, updatedAt: NOW },
    { id: 'b3', name: 'Gama', createdAt: NOW, updatedAt: '2026-06-01T10:00:00.000Z' },
    { id: 'b4', name: 'Alfa', createdAt: NOW, updatedAt: NOW },
  ]);

  expect((await listBooks()).map((book) => book.id)).toEqual(['b3', 'b1', 'b4', 'b2']);
});

test('kitap silme yalnızca kitabı ve konu kayıtlarını siler', async () => {
  const { bookId, turev, polinomlar } = await seedBookWithRecords();
  const subject = await subjectByKey('tyt-mat');
  await addNoteAndPhoto(turev, subject);
  await db.exams.add({
    id: 'exam-1',
    type: 'TYT',
    name: 'Deneme',
    date: '2026-05-01',
    note: '',
    createdAt: NOW,
  });
  await db.examResults.add({
    id: 'result-1',
    examId: 'exam-1',
    subjectId: subject.id,
    correct: 1,
    wrong: 0,
    blank: 0,
    net: 1,
  });

  await deleteBookCascade(bookId);

  expect(await getBook(bookId)).toBeUndefined();
  expect(await db.topicBooks.where('bookId').equals(bookId).count()).toBe(0);
  expect(await db.topics.get(turev.id)).toBeDefined();
  expect(await db.topics.get(polinomlar.id)).toBeDefined();
  expect(await db.notes.get(turev.id)).toBeDefined();
  expect((await db.photos.get('photo-1'))?.topicId).toBe(turev.id);
  expect(await db.exams.get('exam-1')).toBeDefined();
  expect(await db.examResults.get('result-1')).toBeDefined();
});

test('mevcut test kaydı farklı konuya taşınamaz', async () => {
  const book = await createBook({ name: 'Eşleşme Kitabı' });
  const turev = await topicByKey('tyt-mat-turev');
  const polinomlar = await topicByKey('tyt-mat-pol');
  const record = await upsertTopicBook({
    topicId: turev.id,
    bookId: book.id,
    totalTests: 5,
    solvedTests: 1,
  });

  await expect(
    upsertTopicBook({
      id: record.id,
      topicId: polinomlar.id,
      bookId: book.id,
      totalTests: 6,
      solvedTests: 2,
    }),
  ).rejects.toThrow('Test kaydı konu veya kitapla eşleşmiyor');

  expect((await db.topicBooks.get(record.id))?.topicId).toBe(turev.id);
});

test('kitaplar sayfası kitabı, dersleri ve toplam ilerlemeyi gösterir', async () => {
  const { turev, polinomlar } = await seedBookWithRecords();

  renderApp('/kitaplar');

  expect(await screen.findByRole('heading', { level: 1, name: 'Kitaplar' })).toBeInTheDocument();
  expect(await screen.findByText('Karekök TYT')).toBeInTheDocument();
  expect(screen.getByText('Karekök')).toBeInTheDocument();
  expect(screen.getByText('Matematik')).toBeInTheDocument();
  expect(screen.getByText('9/16 test')).toBeInTheDocument();
  expect(screen.getAllByText('%56').length).toBeGreaterThan(0);
  expect(screen.getByRole('progressbar', { name: 'Karekök TYT ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '56',
  );

  await userEvent.click(screen.getByRole('link', { name: 'Karekök TYT' }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Karekök TYT' })).toBeInTheDocument();
  expect(screen.getByText('9/16 test · 7 test kaldı')).toBeInTheDocument();
  expect(screen.getByText('4/10 test')).toBeInTheDocument();
  expect(screen.getByText('5/6 test')).toBeInTheDocument();
  expect(screen.getByText('6 test kaldı')).toBeInTheDocument();
  expect(screen.getByText('1 test kaldı')).toBeInTheDocument();
  expect(screen.getAllByText('%40').length).toBeGreaterThan(0);
  expect(screen.getAllByText('%83').length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: 'Türev' })).toHaveAttribute(
    'href',
    `/tyt/${turev.subjectId}/${turev.id}`,
  );
  expect(screen.getByRole('link', { name: 'Polinomlar' })).toHaveAttribute(
    'href',
    `/tyt/${polinomlar.subjectId}/${polinomlar.id}`,
  );
});

test('karma sınav kitapları kullanıldığı ders adlarını gösterir', async () => {
  const book = await createBook({ name: 'Karma Kitap' });
  const tytFizik = await topicByKey('tyt-fiz-hareket');
  const aytMatematik = await topicByKey('ayt-mat-turev');
  await upsertTopicBook({
    topicId: tytFizik.id,
    bookId: book.id,
    totalTests: 5,
    solvedTests: 2,
  });
  await upsertTopicBook({
    topicId: aytMatematik.id,
    bookId: book.id,
    totalTests: 4,
    solvedTests: 3,
  });

  renderApp('/kitaplar');

  expect(await screen.findByText('Karma Kitap')).toBeInTheDocument();
  expect(await screen.findByText('Fizik · Matematik')).toBeInTheDocument();
  expect(screen.queryByText('TYT / AYT')).not.toBeInTheDocument();
});

test('iki sınavdaki aynı adlı dersler sınav türüyle ayrılır', async () => {
  const book = await createBook({ name: 'Ortak Ders Kitabı' });
  const tytMatematik = await topicByKey('tyt-mat-turev');
  const aytMatematik = await topicByKey('ayt-mat-turev');
  await upsertTopicBook({
    topicId: tytMatematik.id,
    bookId: book.id,
    totalTests: 8,
    solvedTests: 4,
  });
  await upsertTopicBook({
    topicId: aytMatematik.id,
    bookId: book.id,
    totalTests: 6,
    solvedTests: 2,
  });

  renderApp('/kitaplar');

  expect(await screen.findByText('Ortak Ders Kitabı')).toBeInTheDocument();
  expect(await screen.findByText('TYT Matematik · AYT Matematik')).toBeInTheDocument();
  expect(screen.queryByText('TYT / AYT')).not.toBeInTheDocument();
});

test('kitap silme onayı kayıt sayısını gösterir ve diğer verileri korur', async () => {
  const { bookId, turev } = await seedBookWithRecords();
  const subject = await subjectByKey('tyt-mat');
  await addNoteAndPhoto(turev, subject);
  await db.exams.add({
    id: 'exam-1',
    type: 'TYT',
    name: 'Deneme',
    date: '2026-05-01',
    note: '',
    createdAt: NOW,
  });

  renderApp(`/kitaplar/${bookId}`);
  expect(await screen.findByRole('heading', { level: 1, name: 'Karekök TYT' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Karekök TYT kitabını sil' }));
  const dialog = await screen.findByRole('dialog', { name: 'Kitabı sil' });
  expect(within(dialog).getByText('2 konu kaydı silinecek.')).toBeInTheDocument();
  expect(
    within(dialog).getByText('Konular, notlar, fotoğraflar ve denemeler silinmez.'),
  ).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Kitaplar' })).toBeInTheDocument();
  expect(await screen.findByText('Henüz kitap yok')).toBeInTheDocument();
  expect(await getBook(bookId)).toBeUndefined();
  expect(await db.topicBooks.where('bookId').equals(bookId).count()).toBe(0);
  expect(await db.topics.get(turev.id)).toBeDefined();
  expect(await db.notes.get(turev.id)).toBeDefined();
  expect((await db.photos.get('photo-1'))?.topicId).toBe(turev.id);
  expect(await db.exams.get('exam-1')).toBeDefined();
});

test('kitap adı ve yayınevini düzenler', async () => {
  const { bookId } = await seedBookWithRecords();

  renderApp(`/kitaplar/${bookId}`);
  expect(await screen.findByRole('heading', { level: 1, name: 'Karekök TYT' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Karekök TYT kitabını düzenle' }));
  const dialog = await screen.findByRole('dialog', { name: 'Kitabı düzenle' });
  const nameInput = within(dialog).getByLabelText('Kitap adı');
  const publisherInput = within(dialog).getByLabelText('Yayınevi');
  expect(nameInput).toHaveValue('Karekök TYT');
  expect(publisherInput).toHaveValue('Karekök');

  await userEvent.clear(nameInput);
  expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled();

  await userEvent.type(nameInput, 'Karekök TYT Yeni');
  await userEvent.clear(publisherInput);
  await userEvent.type(publisherInput, 'Yeni Yayınevi');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Karekök TYT Yeni' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(async () => {
    expect(await getBook(bookId)).toMatchObject({
      name: 'Karekök TYT Yeni',
      publisher: 'Yeni Yayınevi',
    });
  });
});

test('kitap araması ad, yayınevi ve dersle süzer', async () => {
  await seedBookWithRecords();
  await createBook({ name: 'Fizik Defteri', publisher: 'Palme' });

  renderApp('/kitaplar');
  expect(await screen.findByText('Karekök TYT')).toBeInTheDocument();
  expect(screen.getByText('Fizik Defteri')).toBeInTheDocument();

  const search = screen.getByLabelText('Kitap ara');

  await userEvent.type(search, 'matematik');
  expect(await screen.findByText('Karekök TYT')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Fizik Defteri')).not.toBeInTheDocument());

  await userEvent.clear(search);
  await userEvent.type(search, 'karekök');
  expect(await screen.findByText('Karekök TYT')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Fizik Defteri')).not.toBeInTheDocument());

  await userEvent.clear(search);
  await userEvent.type(search, 'palme');
  expect(await screen.findByText('Fizik Defteri')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Karekök TYT')).not.toBeInTheDocument());

  await userEvent.clear(search);
  await userEvent.type(search, 'bulunmayan');
  expect(await screen.findByText('Aramanla eşleşen kitap yok')).toBeInTheDocument();
});

test('aynı adlı kitapların erişilebilir adları farklıdır', async () => {
  await createBook({ name: 'Aynı Kitap' });
  await createBook({ name: 'Aynı Kitap' });
  await createBook({ name: 'Aynı Kitap', publisher: 'Palme' });

  renderApp('/kitaplar');

  expect(await screen.findAllByText('Aynı Kitap')).toHaveLength(3);
  const links = screen.getAllByRole('link', { name: /Aynı Kitap/ });
  const labels = links.map((link) => link.getAttribute('aria-label'));

  expect(labels).toHaveLength(3);
  expect(new Set(labels).size).toBe(3);
});

test('kitap seçenekleri yinelenen adlarda ayırt edilebilir', async () => {
  await createBook({ name: 'Aynı Kitap' });
  await createBook({ name: 'Aynı Kitap' });
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');

  renderApp(`/tyt/${subject.id}/${topic.id}`);
  await userEvent.click(await screen.findByRole('button', { name: 'Kitap / test ekle' }));
  const dialog = await screen.findByRole('dialog', { name: 'Kitap / test ekle' });
  const select = within(dialog).getByLabelText('Kitap') as HTMLSelectElement;
  const duplicateOptions = Array.from(select.options)
    .map((option) => option.textContent ?? '')
    .filter((optionLabel) => optionLabel.startsWith('Aynı Kitap'));

  expect(duplicateOptions).toHaveLength(2);
  expect(new Set(duplicateOptions).size).toBe(2);
});

test('kitap yokken boş durum gösterir', async () => {
  renderApp('/kitaplar');

  expect(await screen.findByRole('heading', { level: 1, name: 'Kitaplar' })).toBeInTheDocument();
  expect(await screen.findByText('Henüz kitap yok')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Derslere git' })).toHaveAttribute('href', '/tyt');
});

test('silinmiş kitap için geri dönüş bağlantısı gösterir', async () => {
  renderApp('/kitaplar/olmayan-kitap');

  expect(await screen.findByText('Kitap bulunamadı')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Kitaplara dön' })).toHaveAttribute(
    'href',
    '/kitaplar',
  );
});
