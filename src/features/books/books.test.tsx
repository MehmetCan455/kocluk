import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import { listCatalogBooks, seedCatalog } from '@/db/catalogRepository';
import {
  addBookPageRange,
  addCatalogBookToShelf,
  addCustomBook,
  getShelfBook,
  listBookActivity,
  listShelfBooks,
} from '@/db/bookRepositories';
import { LEGACY_SHELF_MIGRATED_KEY } from '@/db/legacyMigration';
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
  // this small curriculum with the full 339-topic seed. The catalog itself is
  // seeded explicitly so every shelf test starts from a known state.
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
  await seedCatalog();
});

async function catalogBookByPublisher(publisher: string) {
  const book = (await listCatalogBooks()).find(
    (candidate) => candidate.publisher === publisher,
  );
  if (!book) {
    throw new Error(`Katalog kitabı bulunamadı: ${publisher}`);
  }
  return book;
}

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

test('yerinde güncellemeden sonra eski kitap açılışta rafa taşınır', async () => {
  await db.settings.delete(LEGACY_SHELF_MIGRATED_KEY);
  const legacy = await createBook({ name: 'Eski Fizik Defteri', publisher: 'Palme' });
  await db.books.update(legacy.id, { note: 'Eski kitap notu' });

  renderApp('/kitaplar');

  expect(await screen.findByText('Eski Fizik Defteri')).toBeInTheDocument();
  await waitFor(async () => {
    expect(await db.userBooks.count()).toBe(1);
  });
  const [userBook] = await db.userBooks.toArray();
  expect(userBook.note).toBe('Eski kitap notu');
  expect((await db.settings.get(LEGACY_SHELF_MIGRATED_KEY))?.value).toBe(true);
  expect(await db.books.get(legacy.id)).toBeDefined();
});

test('boş rafta katalogdan ekleme çağrısı gösterir', async () => {
  renderApp('/kitaplar');

  expect(await screen.findByRole('heading', { level: 1, name: 'Kitaplar' })).toBeInTheDocument();
  expect(await screen.findByText('Rafın boş.')).toBeInTheDocument();
  expect(screen.getByText('Katalogdan ilk kitabını ekle.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kitap ekle' })).toBeInTheDocument();
});

test('katalogdan kitap ekler ve sayfa ilerlemesini gösterir', async () => {
  renderApp('/kitaplar');

  await userEvent.click(await screen.findByRole('button', { name: 'Kitap ekle' }));
  const dialog = await screen.findByRole('dialog', { name: 'Kitap ekle' });

  await userEvent.type(
    within(dialog).getByLabelText('Kitap, yayınevi veya ders ara'),
    'bilgi sarmal',
  );

  const addButton = await within(dialog).findByRole('button', {
    name: /Bilgi Sarmal\) kitabını rafıma ekle/,
  });
  await waitFor(() =>
    expect(within(dialog).queryByText('Karekök')).not.toBeInTheDocument(),
  );

  await userEvent.click(addButton);

  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Kitap ekle' })).not.toBeInTheDocument();
  });

  expect(await screen.findByText('TYT Matematik Soru Bankası')).toBeInTheDocument();
  expect(screen.getByText('Bilgi Sarmal')).toBeInTheDocument();
  expect(screen.getByText('Matematik')).toBeInTheDocument();
  expect(screen.getByText('0/400 sayfa')).toBeInTheDocument();
  expect(screen.getByText('400 sayfa kaldı')).toBeInTheDocument();
  expect(
    screen.getByRole('progressbar', { name: 'TYT Matematik Soru Bankası ilerlemesi' }),
  ).toHaveAttribute('aria-valuenow', '0');
});

test('kendi kitabını ekler ve ders seçilmeyince Genel gösterir', async () => {
  renderApp('/kitaplar');

  await userEvent.click(await screen.findByRole('button', { name: 'Kitap ekle' }));
  const catalogDialog = await screen.findByRole('dialog', { name: 'Kitap ekle' });
  await userEvent.click(
    within(catalogDialog).getByRole('button', { name: 'Kendi kitabımı ekle' }),
  );

  const dialog = await screen.findByRole('dialog', { name: 'Yeni kitap' });
  await userEvent.type(within(dialog).getByLabelText('Kitap adı'), 'Kendi Fizik Kitabım');
  await userEvent.type(within(dialog).getByLabelText('Toplam sayfa'), '240');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Yeni kitap' })).not.toBeInTheDocument();
  });

  expect(await screen.findByText('Kendi Fizik Kitabım')).toBeInTheDocument();
  expect(screen.getByText('Genel')).toBeInTheDocument();
  expect(screen.getByText('0/240 sayfa')).toBeInTheDocument();
  expect(screen.getByText('240 sayfa kaldı')).toBeInTheDocument();

  await waitFor(async () => {
    const shelf = await listShelfBooks();
    expect(shelf).toHaveLength(1);
    expect(shelf[0].catalogBook).toMatchObject({
      title: 'Kendi Fizik Kitabım',
      totalPages: 240,
    });
  });
});

test('durum filtresi arşivlenen kitabı aktif raftan ayırır', async () => {
  const catalog = await catalogBookByPublisher('Bilgi Sarmal');
  const archived = await addCatalogBookToShelf(catalog.id);
  await db.userBooks.update(archived.id, { status: 'archived' });
  await addCustomBook({ title: 'Rafta Kalan', totalPages: 100 });

  renderApp('/kitaplar');

  expect(await screen.findByRole('button', { name: 'Aktif' })).toBeInTheDocument();
  expect(await screen.findByText('Rafta Kalan')).toBeInTheDocument();
  expect(screen.queryByText('TYT Matematik Soru Bankası')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Arşiv' }));

  expect(await screen.findByText('TYT Matematik Soru Bankası')).toBeInTheDocument();
  expect(screen.queryByText('Rafta Kalan')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Bitenler' }));

  expect(await screen.findByText('Bu filtreye uygun kitap yok')).toBeInTheDocument();
});

test('bitenler filtresi tamamlanmış kitabı durum alanından bağımsız gösterir', async () => {
  const catalog = await catalogBookByPublisher('Bilgi Sarmal');
  const userBook = await addCatalogBookToShelf(catalog.id);
  await addBookPageRange(userBook.id, 1, catalog.totalPages);
  // Yeniden eklenen %100 kitap `active` kalabilir; filtre ilerlemeye bakmalı.
  await db.userBooks.update(userBook.id, { status: 'active' });

  renderApp('/kitaplar');

  await screen.findByRole('button', { name: 'Aktif' });
  expect(screen.queryByText('TYT Matematik Soru Bankası')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Bitenler' }));

  expect(await screen.findByText('TYT Matematik Soru Bankası')).toBeInTheDocument();
  expect(screen.getByText('%100')).toBeInTheDocument();
  expect(screen.getByText('400/400 sayfa')).toBeInTheDocument();
  expect(screen.getByText('Bitti')).toBeInTheDocument();
});

test('toplam sayfası olmayan kitap sayfa sayısını girmeyi ister', async () => {
  await addCustomBook({ title: 'Sayfasız Kitap', totalPages: 0 });

  renderApp('/kitaplar');

  expect(await screen.findByText('Sayfasız Kitap')).toBeInTheDocument();
  expect(screen.getByText('Sayfa sayısını gir')).toBeInTheDocument();
  expect(screen.getByText('Toplam sayfa belirtilmedi')).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('raf araması ad, yayınevi ve dersle süzer', async () => {
  await addCustomBook({
    title: 'Fizik Defteri',
    publisher: 'Palme',
    subjectSlug: 'fizik',
    totalPages: 120,
  });
  await addCustomBook({
    title: 'Matematik Defteri',
    subjectSlug: 'matematik',
    totalPages: 200,
  });

  renderApp('/kitaplar');

  expect(await screen.findByText('Fizik Defteri')).toBeInTheDocument();
  expect(screen.getByText('Matematik Defteri')).toBeInTheDocument();

  const search = screen.getByLabelText('Kitap ara');

  await userEvent.type(search, 'palme');
  expect(await screen.findByText('Fizik Defteri')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText('Matematik Defteri')).not.toBeInTheDocument(),
  );

  await userEvent.clear(search);
  await userEvent.type(search, 'matematik');
  expect(await screen.findByText('Matematik Defteri')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Fizik Defteri')).not.toBeInTheDocument());

  await userEvent.clear(search);
  await userEvent.type(search, 'bulunmayan');
  expect(await screen.findByText('Aramanla eşleşen kitap yok')).toBeInTheDocument();
});

async function addCatalogShelfBook(): Promise<{ id: string }> {
  const catalog = await catalogBookByPublisher('Bilgi Sarmal');
  return addCatalogBookToShelf(catalog.id);
}

test('kitap detayı sayfa aralığı eklemeyi ve geçmişten silmeyi gösterir', async () => {
  const userBook = await addCatalogShelfBook();

  renderApp(`/kitaplar/${userBook.id}`);

  expect(
    await screen.findByRole('heading', { level: 1, name: 'TYT Matematik Soru Bankası' }),
  ).toBeInTheDocument();
  expect(screen.getByText('0/400 sayfa okundu')).toBeInTheDocument();
  expect(screen.getByText('400 sayfa kaldı')).toBeInTheDocument();
  expect(
    screen.getByRole('progressbar', { name: 'TYT Matematik Soru Bankası ilerlemesi' }),
  ).toHaveAttribute('aria-valuenow', '0');

  const pageForm = screen.getByRole('form', { name: 'Sayfa aralığı ekle' });
  expect(pageForm).toHaveClass(
    'rounded-2xl',
    'border',
    'border-line',
    'bg-surface',
    'p-4',
  );
  expect(
    within(pageForm).getByText(
      'Okuduğun sayfaları aralık olarak gir; atlanan sayfalar sayılmaz.',
    ),
  ).toBeInTheDocument();
  // The total-page hint is shared, not repeated under both inputs.
  expect(within(pageForm).getAllByText(/1 ile 400 arasında/)).toHaveLength(1);
  const addButton = within(pageForm).getByRole('button', {
    name: 'Aralığı ekle',
  });
  expect(addButton).toHaveClass('w-full', 'sm:w-auto');

  const fromInput = screen.getByLabelText('Başlangıç sayfası');
  const toInput = screen.getByLabelText('Bitiş sayfası');
  await userEvent.clear(fromInput);
  await userEvent.type(fromInput, '1');
  await userEvent.clear(toInput);
  await userEvent.type(toInput, '220');
  await userEvent.click(addButton);

  expect(await screen.findByText('220/400 sayfa okundu')).toBeInTheDocument();
  expect(screen.getByText('%55')).toBeInTheDocument();
  expect(screen.getByText('Son sayfa: 220')).toBeInTheDocument();

  const nextFrom = screen.getByLabelText('Başlangıç sayfası');
  const nextTo = screen.getByLabelText('Bitiş sayfası');
  await userEvent.clear(nextFrom);
  await userEvent.type(nextFrom, '221');
  await userEvent.clear(nextTo);
  await userEvent.type(nextTo, '300');
  await userEvent.click(screen.getByRole('button', { name: 'Aralığı ekle' }));

  expect(await screen.findByText('300/400 sayfa okundu')).toBeInTheDocument();
  expect(screen.getByText('%75')).toBeInTheDocument();
  expect(screen.getByText('Son sayfa: 300')).toBeInTheDocument();

  const history = await screen.findByRole('list', { name: 'İlerleme geçmişi' });
  let items = within(history).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByText('s. 221–300')).toBeInTheDocument();
  expect(within(items[1]).getByText('s. 1–220')).toBeInTheDocument();
  expect(within(items[0]).getByText('Manuel')).toBeInTheDocument();
  expect(within(items[1]).getByText('Manuel')).toBeInTheDocument();

  await userEvent.click(within(items[0]).getByRole('button', { name: /sil/i }));

  expect(await screen.findByText('220/400 sayfa okundu')).toBeInTheDocument();
  expect(screen.getByText('%55')).toBeInTheDocument();
  items = within(
    screen.getByRole('list', { name: 'İlerleme geçmişi' }),
  ).getAllByRole('listitem');
  expect(items).toHaveLength(1);
  expect(within(items[0]).getByText('s. 1–220')).toBeInTheDocument();

  const activity = await listBookActivity(userBook.id);
  expect(activity).toHaveLength(1);
  expect(activity[0]).toMatchObject({
    type: 'book_pages',
    fromPage: 1,
    toPage: 220,
    source: 'manual',
  });
});

test('480 sayfalık kitapta 250–255 altı sayfa sayılır, 1–250 birleşimi 255 yapar', async () => {
  const userBook = await addCustomBook({ title: '480 Sayfalık Kitap', totalPages: 480 });

  renderApp(`/kitaplar/${userBook.id}`);

  const heading = await screen.findByRole('heading', {
    level: 1,
    name: '480 Sayfalık Kitap',
  });
  expect(heading).toBeInTheDocument();
  expect(screen.getByText('0/480 sayfa okundu')).toBeInTheDocument();

  const fromInput = screen.getByLabelText('Başlangıç sayfası');
  const toInput = screen.getByLabelText('Bitiş sayfası');
  await userEvent.clear(fromInput);
  await userEvent.type(fromInput, '250');
  await userEvent.clear(toInput);
  await userEvent.type(toInput, '255');
  await userEvent.click(screen.getByRole('button', { name: 'Aralığı ekle' }));

  expect(await screen.findByText('6/480 sayfa okundu')).toBeInTheDocument();
  expect(screen.getByText('%1')).toBeInTheDocument();
  expect(screen.getByText('Son sayfa: 255')).toBeInTheDocument();
  expect(screen.queryByText('%53')).not.toBeInTheDocument();

  const nextFrom = screen.getByLabelText('Başlangıç sayfası');
  const nextTo = screen.getByLabelText('Bitiş sayfası');
  await userEvent.clear(nextFrom);
  await userEvent.type(nextFrom, '1');
  await userEvent.clear(nextTo);
  await userEvent.type(nextTo, '250');
  await userEvent.click(screen.getByRole('button', { name: 'Aralığı ekle' }));

  expect(await screen.findByText('255/480 sayfa okundu')).toBeInTheDocument();
  expect(screen.getByText('%53')).toBeInTheDocument();
  expect(screen.getByText('Son sayfa: 255')).toBeInTheDocument();

  const progress = (await getShelfBook(userBook.id))?.progress;
  expect(progress).toMatchObject({ readPages: 255, currentPage: 255, percent: 53 });
});

test('eski page_set kaydı geçmişte Konum (eski) olarak görünür, ilerlemeye sayılmaz', async () => {
  const userBook = await addCatalogShelfBook();
  await db.activityLogs.add({
    id: 'legacy-page-set',
    type: 'page_set',
    userBookId: userBook.id,
    toPage: 240,
    source: 'manual',
    createdAt: NOW,
  });

  renderApp(`/kitaplar/${userBook.id}`);

  expect(await screen.findByText('0/400 sayfa okundu')).toBeInTheDocument();
  expect(screen.queryByText(/^Son sayfa:/)).not.toBeInTheDocument();
  expect(
    screen.getByRole('progressbar', { name: 'TYT Matematik Soru Bankası ilerlemesi' }),
  ).toHaveAttribute('aria-valuenow', '0');

  const history = await screen.findByRole('list', { name: 'İlerleme geçmişi' });
  const items = within(history).getAllByRole('listitem');
  expect(items).toHaveLength(1);
  expect(within(items[0]).getByText('Konum (eski)')).toBeInTheDocument();
  expect(within(items[0]).getByText('Manuel')).toBeInTheDocument();
});

test('kitap düzenleme toplam sayfayı ve notu günceller', async () => {
  const userBook = await addCatalogShelfBook();

  renderApp(`/kitaplar/${userBook.id}`);

  await userEvent.click(
    await screen.findByRole('button', {
      name: 'TYT Matematik Soru Bankası kitabını düzenle',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Kitabı düzenle' });
  expect(within(dialog).queryByLabelText('Kitap adı')).not.toBeInTheDocument();

  const pages = within(dialog).getByLabelText('Toplam sayfa');
  await userEvent.clear(pages);
  await userEvent.type(pages, '500');
  await userEvent.type(within(dialog).getByLabelText('Not'), 'Yeni baskı notu');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Kitabı düzenle' })).not.toBeInTheDocument();
  });

  expect(await screen.findByText('0/500 sayfa okundu')).toBeInTheDocument();
  expect(screen.getByText('500 sayfa kaldı')).toBeInTheDocument();
  // The note is no longer write-only: it is visible on the detail page.
  expect(screen.getByText('Kitap notu')).toBeInTheDocument();
  expect(screen.getByText('Yeni baskı notu')).toBeInTheDocument();

  const shelfBook = await getShelfBook(userBook.id);
  expect(shelfBook?.totalPages).toBe(500);
  expect(shelfBook?.userBook.totalPagesOverride).toBe(500);
  expect(shelfBook?.userBook.note).toBe('Yeni baskı notu');
});

test('özel kitapta ad, yayınevi, sınav ve ders düzenlenebilir', async () => {
  const userBook = await addCustomBook({ title: 'Fizik Defteri', totalPages: 120 });

  renderApp(`/kitaplar/${userBook.id}`);

  await userEvent.click(
    await screen.findByRole('button', { name: 'Fizik Defteri kitabını düzenle' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Kitabı düzenle' });

  const title = within(dialog).getByLabelText('Kitap adı');
  await userEvent.clear(title);
  await userEvent.type(title, 'Fizik Defteri 2');
  await userEvent.type(within(dialog).getByLabelText('Yayınevi'), 'Palme');
  await userEvent.selectOptions(within(dialog).getByLabelText('Sınav'), 'TYT');
  await userEvent.selectOptions(within(dialog).getByLabelText('Ders'), 'fizik');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Kitabı düzenle' })).not.toBeInTheDocument();
  });

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Fizik Defteri 2' }),
  ).toBeInTheDocument();

  const shelfBook = await getShelfBook(userBook.id);
  expect(shelfBook?.catalogBook).toMatchObject({
    title: 'Fizik Defteri 2',
    publisher: 'Palme',
    exam: 'TYT',
    subjectSlug: 'fizik',
  });
});

test('toplam sayfa son okunan sayfanın altına inerse uyarı verir ve ilerleme %100 kalır', async () => {
  const userBook = await addCatalogShelfBook();
  await addBookPageRange(userBook.id, 1, 220);

  renderApp(`/kitaplar/${userBook.id}`);

  expect(await screen.findByText('220/400 sayfa okundu')).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', {
      name: 'TYT Matematik Soru Bankası kitabını düzenle',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Kitabı düzenle' });

  const pages = within(dialog).getByLabelText('Toplam sayfa');
  await userEvent.clear(pages);
  await userEvent.type(pages, '150');

  expect(
    await within(dialog).findByText(/son okunan 220 sayfadan az/),
  ).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Kitabı düzenle' })).not.toBeInTheDocument();
  });

  expect(await screen.findByText('150/150 sayfa okundu')).toBeInTheDocument();
  expect(screen.getByText('%100')).toBeInTheDocument();
  expect(screen.getByText('Bitti')).toBeInTheDocument();

  const activity = await listBookActivity(userBook.id);
  expect(
    activity.some(
      (log) => log.type === 'book_pages' && log.fromPage === 1 && log.toPage === 220,
    ),
  ).toBe(true);
});

test('geçmişi olan kitabın silme onayı arşivlemeyi önerir', async () => {
  const userBook = await addCatalogShelfBook();
  await addBookPageRange(userBook.id, 1, 120);

  renderApp(`/kitaplar/${userBook.id}`);

  await userEvent.click(
    await screen.findByRole('button', {
      name: 'TYT Matematik Soru Bankası kitabını sil',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Kitabı sil' });

  expect(
    within(dialog).getByText('Bu kitapta okuma geçmişi var. Silmeden önce arşivlemen önerilir.'),
  ).toBeInTheDocument();
});

test('plan görevi ve manuel aralık okunan sayfada birleşir', async () => {
  const userBook = await addCatalogShelfBook();
  await db.activityLogs.add({
    id: 'book-pages-1',
    type: 'book_pages',
    userBookId: userBook.id,
    fromPage: 200,
    toPage: 260,
    source: 'task',
    createdAt: NOW,
  });
  await addBookPageRange(userBook.id, 100, 199);

  renderApp(`/kitaplar/${userBook.id}`);

  const history = await screen.findByRole('list', { name: 'İlerleme geçmişi' });
  const items = within(history).getAllByRole('listitem');

  expect(items).toHaveLength(2);
  expect(within(items[0]).getByText('s. 100–199')).toBeInTheDocument();
  expect(within(items[0]).getByText('Manuel')).toBeInTheDocument();
  expect(within(items[1]).getByText('s. 200–260')).toBeInTheDocument();
  expect(within(items[1]).getByText('Plan görevi')).toBeInTheDocument();
  expect(screen.getByText('161/400 sayfa okundu')).toBeInTheDocument();
  expect(screen.getByText('Son sayfa: 260')).toBeInTheDocument();
});

test('toplam sayfası olmayan kitapta sayfa aralığı ekleme kapalıdır', async () => {
  const userBook = await addCustomBook({ title: 'Sayfasız Kitap', totalPages: 0 });

  renderApp(`/kitaplar/${userBook.id}`);

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Sayfasız Kitap' }),
  ).toBeInTheDocument();
  expect(
    screen.getByText('İlerleme için sayfa sayısı gerekli. Düzenle.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Başlangıç sayfası')).toBeDisabled();
  expect(screen.getByLabelText('Bitiş sayfası')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Aralığı ekle' })).toBeDisabled();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('arşivleme kitabı aktif raftan gizler', async () => {
  const userBook = await addCatalogShelfBook();

  renderApp(`/kitaplar/${userBook.id}`);

  await userEvent.click(
    await screen.findByRole('button', {
      name: 'TYT Matematik Soru Bankası kitabını arşivle',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Kitabı arşivle' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Arşivle' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Kitaplar' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('Bu filtreye uygun kitap yok')).toBeInTheDocument();
  expect(await listShelfBooks()).toHaveLength(0);
});

test('kitap silme onay ister ve rafı boşaltır', async () => {
  const userBook = await addCatalogShelfBook();

  renderApp(`/kitaplar/${userBook.id}`);

  await userEvent.click(
    await screen.findByRole('button', {
      name: 'TYT Matematik Soru Bankası kitabını sil',
    }),
  );
  let dialog = await screen.findByRole('dialog', { name: 'Kitabı sil' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Kitabı sil' })).not.toBeInTheDocument();
  });
  expect(await getShelfBook(userBook.id)).toBeDefined();

  await userEvent.click(
    screen.getByRole('button', { name: 'TYT Matematik Soru Bankası kitabını sil' }),
  );
  dialog = await screen.findByRole('dialog', { name: 'Kitabı sil' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Kitaplar' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('Rafın boş.')).toBeInTheDocument();
  expect(await getShelfBook(userBook.id)).toBeUndefined();
});

// The legacy tables and repositories stay in place, so their regression tests
// keep running while the page-based shelf replaces the old UI.

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
