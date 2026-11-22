import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  addCustomBook,
  getShelfBook,
  setBookPage,
} from '@/db/bookRepositories';
import { patchSettings, saveExam } from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import { addRow, addTask, getOrCreateWeek } from '@/db/scheduleRepository';
import { setTopicDone } from '@/db/topicProgressRepository';
import { weekStartOf } from '@/domain/schedule';
import type { Exam } from '@/domain/types';
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
      topics: [{ seedKey: 'tyt-turkce-paragraf', name: 'Paragraf', order: 1 }],
    },
    {
      seedKey: 'tyt-matematik',
      exam: 'TYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 2,
      topics: [{ seedKey: 'tyt-matematik-temel', name: 'Temel Kavramlar', order: 1 }],
    },
    {
      seedKey: 'ayt-matematik',
      exam: 'AYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [{ seedKey: 'ayt-matematik-turev', name: 'Türev', order: 1 }],
    },
    {
      seedKey: 'ayt-fizik',
      exam: 'AYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 2,
      topics: [{ seedKey: 'ayt-fizik-vektorler', name: 'Vektörler', order: 1 }],
    },
  ],
};

beforeEach(async () => {
  // Keep seedVersion current so SettingsProvider does not replace the fixture
  // with the full curriculum.
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version, profileName: 'Deniz' });
});

async function subjectId(seedKey: string): Promise<string> {
  const subject = await db.subjects.where('seedKey').equals(seedKey).first();
  if (!subject) {
    throw new Error(`Test dersi bulunamadı: ${seedKey}`);
  }
  return subject.id;
}

async function topicId(seedKey: string): Promise<string> {
  const topic = await db.topics.where('seedKey').equals(seedKey).first();
  if (!topic) {
    throw new Error(`Test konusu bulunamadı: ${seedKey}`);
  }
  return topic.id;
}

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function addShelfBook(
  title: string,
  totalPages: number,
  updatedAt: string,
): Promise<string> {
  const userBook = await addCustomBook({ title, totalPages });
  await db.userBooks.update(userBook.id, { updatedAt });
  return userBook.id;
}

/** Seeds an absolute page baseline, then restores the shelf sort timestamp. */
async function seedPage(
  userBookId: string,
  page: number,
  updatedAt: string,
): Promise<void> {
  await setBookPage(userBookId, page);
  await db.userBooks.update(userBookId, { updatedAt });
}

function todayDayIndex(): number {
  return ((new Date().getDay() + 6) % 7) + 1;
}

interface DashboardSeed {
  turkce: string;
  tytMatematik: string;
  aytMatematik: string;
  aytFizik: string;
  books: { bilgi: string; fizik: string };
  exams: Exam[];
}

async function seedDashboardData(): Promise<DashboardSeed> {
  const turkce = await subjectId('tyt-turkce');
  const tytMatematik = await subjectId('tyt-matematik');
  const aytMatematik = await subjectId('ayt-matematik');
  const aytFizik = await subjectId('ayt-fizik');

  const bilgi = await addShelfBook(
    'Bilgi Sarmal TYT Matematik',
    400,
    '2026-11-20T10:00:00.000Z',
  );
  await seedPage(bilgi, 220, '2026-11-20T10:00:00.000Z');
  const fizik = await addShelfBook(
    '3D AYT Fizik',
    320,
    '2026-11-19T10:00:00.000Z',
  );
  await addShelfBook('Palme TYT Türkçe', 384, '2026-11-18T10:00:00.000Z');
  await addShelfBook('Karekök AYT Matematik', 392, '2026-11-17T10:00:00.000Z');
  await addShelfBook('Limit TYT Deneme', 200, '2026-11-16T10:00:00.000Z');
  await addShelfBook('Eski Kitap', 100, '2026-10-01T10:00:00.000Z');

  const latest = await saveExam({
    type: 'TYT',
    name: '3D TYT 5',
    date: '2026-11-17',
    results: [
      { subjectId: turkce, correct: 30, wrong: 8, blank: 2 },
      { subjectId: tytMatematik, correct: 20, wrong: 10, blank: 0 },
    ],
  });
  const ayt = await saveExam({
    type: 'AYT',
    name: '3D AYT 2',
    date: '2026-11-16',
    alan: 'sayisal',
    results: [{ subjectId: aytMatematik, correct: 12, wrong: 4, blank: 0 }],
  });
  const first = await saveExam({
    type: 'TYT',
    name: 'Eylül TYT',
    date: '2026-09-01',
    results: [{ subjectId: turkce, correct: 10, wrong: 0, blank: 0 }],
  });

  return {
    turkce,
    tytMatematik,
    aytMatematik,
    aytFizik,
    books: { bilgi, fizik },
    exams: [latest, ayt, first],
  };
}

test('ana sayfa konu yüzdelerini, sayfa tabanlı kitapları, net grafiğini ve son denemeleri gösterir', async () => {
  const seed = await seedDashboardData();
  await setTopicDone(await topicId('tyt-turkce-paragraf'), true);
  await setTopicDone(await topicId('tyt-matematik-temel'), true);
  await setTopicDone(await topicId('ayt-matematik-turev'), true);
  await patchSettings({ examDate: isoDaysFromNow(50) });

  renderApp('/');

  expect(await screen.findByText('Merhaba, Deniz')).toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Genel Bakış' }),
  ).toBeInTheDocument();
  expect(await screen.findByText(/YKS'ye 50 gün/)).toBeInTheDocument();

  expect(
    await screen.findByRole('progressbar', { name: 'Genel konu ilerlemesi' }),
  ).toHaveAttribute('aria-valuenow', '75');
  expect(screen.getByRole('progressbar', { name: 'TYT konu ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  expect(screen.getByRole('progressbar', { name: 'AYT konu ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  expect(screen.getByText('3/4 konu')).toBeInTheDocument();

  const bilgiLink = screen.getByRole('link', { name: /Bilgi Sarmal TYT Matematik/ });
  expect(within(bilgiLink).getByText('220/400 sayfa')).toBeInTheDocument();
  expect(within(bilgiLink).getByText('%55')).toBeInTheDocument();
  expect(
    within(bilgiLink).getByRole('progressbar', {
      name: 'Bilgi Sarmal TYT Matematik ilerlemesi',
    }),
  ).toHaveAttribute('aria-valuenow', '55');
  expect(screen.getByText('Palme TYT Türkçe')).toBeInTheDocument();
  expect(screen.queryByText('Eski Kitap')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Bugünün planı' })).toBeInTheDocument();

  expect(screen.getByRole('img', { name: 'TYT net trend grafiği' })).toBeInTheDocument();
  expect(screen.getByText('Deneme başarı grafiği')).toBeInTheDocument();
  expect(screen.getByText(/Eylül TYT · 1 Eyl: 10,00 net/)).toBeInTheDocument();
  expect(screen.getByText(/3D TYT 5 · 17 Kas: 45,50 net/)).toBeInTheDocument();

  const tytCard = screen.getByRole('group', { name: 'TYT netleri' });
  expect(within(tytCard).getByText('45,50')).toBeInTheDocument();
  expect(within(tytCard).getByText('27,75')).toBeInTheDocument();
  expect(within(tytCard).getByText('2 deneme')).toBeInTheDocument();
  const aytCard = screen.getByRole('group', { name: 'AYT netleri' });
  expect(within(aytCard).getAllByText('11,00')).toHaveLength(2);
  expect(within(aytCard).getByText('1 deneme')).toBeInTheDocument();

  const latestLink = screen.getByRole('link', { name: /3D TYT 5/ });
  expect(latestLink).toHaveAttribute('href', `/denemeler/${seed.exams[0].id}`);
  expect(within(latestLink).getByText('45,50')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /3D AYT 2/ })).toHaveAttribute(
    'href',
    `/denemeler/${seed.exams[1].id}`,
  );

  expect(screen.getByRole('link', { name: 'Deneme' })).toHaveAttribute(
    'href',
    '/denemeler/yeni',
  );
  expect(screen.getByRole('link', { name: 'Yanlış fotoğrafı' })).toHaveAttribute(
    'href',
    '/yanlislar',
  );
  expect(screen.getByRole('link', { name: 'Test kaydı' })).toHaveAttribute('href', '/tyt');
  const quickAdd = screen.getByRole('heading', { name: 'Hızlı ekle' }).parentElement;
  expect(quickAdd).not.toBeNull();
  expect(
    within(quickAdd as HTMLElement).getByRole('link', {
      name: 'Ders Çalışma Çizelgesi',
    }),
  ).toHaveAttribute('href', '/program');
});

test('bugünün planı bugünün görevlerini gösterir ve tik kitap ilerlemesini günceller', async () => {
  const seed = await seedDashboardData();
  const { week } = await getOrCreateWeek(weekStartOf(new Date()));
  const row = await addRow(week.id, 'Fizik');
  const today = todayDayIndex();
  await addTask({
    weekId: week.id,
    rowId: row.id,
    dayIndex: today,
    type: 'book',
    userBookId: seed.books.fizik,
    fromPage: 1,
    toPage: 20,
  });
  await addTask({
    weekId: week.id,
    rowId: row.id,
    dayIndex: (today % 7) + 1,
    type: 'free',
    title: 'Yarına kalan görev',
  });

  renderApp('/');

  expect(
    await screen.findByRole('heading', { name: 'Bugünün planı' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('Yarına kalan görev')).not.toBeInTheDocument();

  const checkbox = await screen.findByRole('checkbox', {
    name: '3D AYT Fizik s. 1–20 görevini tamamla',
  });
  expect(checkbox).not.toBeChecked();

  const fizikLink = screen.getByRole('link', { name: /3D AYT Fizik/ });
  expect(within(fizikLink).getByText('0/320 sayfa')).toBeInTheDocument();
  expect(within(fizikLink).getByText('%0')).toBeInTheDocument();

  await userEvent.click(checkbox);

  await waitFor(() => {
    expect(
      screen.getByRole('checkbox', {
        name: '3D AYT Fizik s. 1–20 görevini tamamla',
      }),
    ).toBeChecked();
  });
  await waitFor(() => {
    const link = screen.getByRole('link', { name: /3D AYT Fizik/ });
    expect(within(link).getByText('20/320 sayfa')).toBeInTheDocument();
  });
  expect(
    within(screen.getByRole('link', { name: /3D AYT Fizik/ })).getByText('%6'),
  ).toBeInTheDocument();

  const shelfBook = await getShelfBook(seed.books.fizik);
  expect(shelfBook?.progress.currentPage).toBe(20);
});

test('en yüksek ve ortalama net son beşle sınırlı kalmadan tür bazında tüm denemeleri kapsar', async () => {
  const seed = await seedDashboardData();
  // Üç eski deneme ekle; en yüksek net yapan deneme son beşin dışında kalır.
  await saveExam({
    type: 'TYT',
    name: 'Ağustos Düşük',
    date: '2026-08-02',
    results: [{ subjectId: seed.turkce, correct: 5, wrong: 0, blank: 0 }],
  });
  await saveExam({
    type: 'TYT',
    name: 'Ağustos Düşük 2',
    date: '2026-08-01',
    results: [{ subjectId: seed.turkce, correct: 5, wrong: 0, blank: 0 }],
  });
  await saveExam({
    type: 'TYT',
    name: 'Temmuz Yüksek',
    date: '2026-07-01',
    results: [
      { subjectId: seed.turkce, correct: 40, wrong: 0, blank: 0 },
      { subjectId: seed.tytMatematik, correct: 30, wrong: 0, blank: 0 },
    ],
  });

  renderApp('/');

  const tytCard = await screen.findByRole('group', { name: 'TYT netleri' });
  expect(within(tytCard).getByText('70,00')).toBeInTheDocument();
  // (45,5 + 10 + 5 + 5 + 70) / 5 = 27,10
  expect(within(tytCard).getByText('27,10')).toBeInTheDocument();
  expect(within(tytCard).getByText('5 deneme')).toBeInTheDocument();

  // TYT denemeleri AYT ortalamasına karışmaz.
  const aytCard = screen.getByRole('group', { name: 'AYT netleri' });
  expect(within(aytCard).getAllByText('11,00')).toHaveLength(2);
  expect(within(aytCard).getByText('1 deneme')).toBeInTheDocument();
});

test('sonucu girilmemiş deneme en yüksek ve ortalama nete katılmaz', async () => {
  await seedDashboardData();
  await saveExam({
    type: 'TYT',
    name: 'Boş Deneme',
    date: '2026-11-18',
    results: [],
  });

  renderApp('/');

  const tytCard = await screen.findByRole('group', { name: 'TYT netleri' });
  expect(within(tytCard).getByText('45,50')).toBeInTheDocument();
  expect(within(tytCard).getByText('27,75')).toBeInTheDocument();
  expect(within(tytCard).getByText('2 deneme')).toBeInTheDocument();
  // Son denemeler listesinde boş deneme görünse de net kartları 0,00'a düşmez.
  expect(within(tytCard).queryByText('0,00')).not.toBeInTheDocument();
});

test('yalnızca sonucu olmayan deneme varsa TYT ve AYT kartları ayrı boş durum gösterir', async () => {
  await saveExam({
    type: 'TYT',
    name: 'Boş Deneme',
    date: '2026-11-18',
    results: [],
  });

  renderApp('/');

  const tytCard = await screen.findByRole('group', { name: 'TYT netleri' });
  const aytCard = screen.getByRole('group', { name: 'AYT netleri' });
  expect(within(tytCard).getByText('Henüz TYT denemesi yok')).toBeInTheDocument();
  expect(within(aytCard).getByText('Henüz AYT denemesi yok')).toBeInTheDocument();
  expect(within(tytCard).queryByText('0,00')).not.toBeInTheDocument();
  expect(within(aytCard).queryByText('0,00')).not.toBeInTheDocument();
  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
});

test('yalnızca AYT denemesi varsa TYT kartı boş kalır', async () => {
  const aytMatematik = await subjectId('ayt-matematik');
  await saveExam({
    type: 'AYT',
    name: 'Tek AYT',
    date: '2026-11-18',
    alan: 'sayisal',
    results: [{ subjectId: aytMatematik, correct: 20, wrong: 5, blank: 0 }],
  });

  renderApp('/');

  const tytCard = await screen.findByRole('group', { name: 'TYT netleri' });
  const aytCard = screen.getByRole('group', { name: 'AYT netleri' });
  expect(within(tytCard).getByText('Henüz TYT denemesi yok')).toBeInTheDocument();
  expect(within(aytCard).getAllByText('18,75')).toHaveLength(2);
  expect(within(aytCard).getByText('1 deneme')).toBeInTheDocument();
});

test('branş denemesi ana sayfa net kartlarını ve son denemeleri değiştirmez', async () => {
  const turkceId = await subjectId('tyt-turkce');
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
    name: 'Branş Sosyal',
    date: '2026-11-19',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });
  renderApp('/');
  // Net kartı yalnızca tam denemeyi sayar; branş denemesi 2. deneme olarak
  // eklenmez.
  const tytCard = await screen.findByRole('group', { name: 'TYT netleri' });
  expect(within(tytCard).getByText('1 deneme')).toBeInTheDocument();
  expect(screen.getByText('Tam TYT')).toBeInTheDocument();
  expect(screen.queryByText('Branş Sosyal')).not.toBeInTheDocument();
  expect(screen.queryByText('2 deneme')).not.toBeInTheDocument();

  // En yüksek ve ortalama yalnızca tam denemeden: 30 - 5/4 = 28,75.
  // Branş denemesi 15 - 3/4 = 14,25 olsaydı ortalama değişirdi.
  expect(within(tytCard).getAllByText('28,75')).toHaveLength(2);
  expect(within(tytCard).queryByText('14,25')).not.toBeInTheDocument();
});

test('gizlenen dersler konu yüzdelerine katılmaz', async () => {
  const seed = await seedDashboardData();
  await setTopicDone(await topicId('tyt-turkce-paragraf'), true);
  await setTopicDone(await topicId('ayt-matematik-turev'), true);
  await patchSettings({ hiddenSubjects: [seed.aytFizik] });

  renderApp('/');

  expect(
    await screen.findByRole('progressbar', { name: 'Genel konu ilerlemesi' }),
  ).toHaveAttribute('aria-valuenow', '67');
  expect(screen.getByRole('progressbar', { name: 'TYT konu ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  expect(screen.getByRole('progressbar', { name: 'AYT konu ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
});

test.each(['', 'bozuk', '2026-02-31'])(
  'geçersiz sınav tarihi (%s) geri sayımı çökertmez',
  async (examDate) => {
    await patchSettings({ examDate });

    renderApp('/');

    expect(await screen.findByText('Merhaba, Deniz')).toBeInTheDocument();
    expect(screen.getByText('Sınav tarihi ayarlanmadı')).toBeInTheDocument();
    expect(screen.queryByText(/YKS'ye/)).not.toBeInTheDocument();
  },
);

test('veri yokken bölümler boş durum gösterir', async () => {
  renderApp('/');

  expect((await screen.findAllByText('Henüz deneme yok')).length).toBeGreaterThan(0);
  expect(screen.getByText('Henüz kitap yok')).toBeInTheDocument();
  expect(screen.getByText('Henüz deneme kaydı yok')).toBeInTheDocument();
  expect(await screen.findByText('Bugün için görev yok.')).toBeInTheDocument();
  expect(
    within(screen.getByRole('group', { name: 'TYT netleri' })).getByText(
      'Henüz TYT denemesi yok',
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('group', { name: 'AYT netleri' })).getByText(
      'Henüz AYT denemesi yok',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  expect(
    screen.getByRole('progressbar', { name: 'Genel konu ilerlemesi' }),
  ).toHaveAttribute('aria-valuenow', '0');
});
