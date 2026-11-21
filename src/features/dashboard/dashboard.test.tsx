import { screen, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import { patchSettings, saveExam } from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
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

async function addBook(id: string, name: string, updatedAt: string): Promise<void> {
  await db.books.add({ id, name, createdAt: updatedAt, updatedAt });
}

async function addTests(
  id: string,
  topicIdValue: string,
  bookId: string,
  solvedTests: number,
): Promise<void> {
  await db.topicBooks.add({
    id,
    topicId: topicIdValue,
    bookId,
    totalTests: 10,
    solvedTests,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  });
}

interface DashboardSeed {
  turkce: string;
  tytMatematik: string;
  aytMatematik: string;
  aytFizik: string;
  exams: Exam[];
}

async function seedDashboardData(): Promise<DashboardSeed> {
  const turkce = await subjectId('tyt-turkce');
  const tytMatematik = await subjectId('tyt-matematik');
  const aytMatematik = await subjectId('ayt-matematik');
  const aytFizik = await subjectId('ayt-fizik');

  await addBook('book-1', 'Bilgi Sarmal TYT Matematik', '2026-11-20T10:00:00.000Z');
  await addBook('book-2', '3D AYT Fizik', '2026-11-19T10:00:00.000Z');
  await addBook('book-3', 'Palme TYT Türkçe', '2026-11-18T10:00:00.000Z');
  await addBook('book-4', 'Karekök AYT Matematik', '2026-11-17T10:00:00.000Z');
  await addBook('book-5', 'Limit TYT Deneme', '2026-11-16T10:00:00.000Z');
  await addBook('book-6', 'Eski Kitap', '2026-10-01T10:00:00.000Z');

  await addTests('tb-1', await topicId('tyt-turkce-paragraf'), 'book-3', 5);
  await addTests('tb-2', await topicId('tyt-matematik-temel'), 'book-1', 10);
  await addTests('tb-3', await topicId('ayt-matematik-turev'), 'book-4', 3);
  await addTests('tb-4', await topicId('ayt-fizik-vektorler'), 'book-2', 0);

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

  return { turkce, tytMatematik, aytMatematik, aytFizik, exams: [latest, ayt, first] };
}

test('ana sayfa istatistikleri, kitapları, net grafiğini ve son denemeleri gösterir', async () => {
  const seed = await seedDashboardData();
  await patchSettings({ examDate: isoDaysFromNow(50) });

  renderApp('/');

  expect(await screen.findByText('Merhaba, Deniz')).toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Genel Bakış' }),
  ).toBeInTheDocument();
  expect(await screen.findByText(/YKS'ye 50 gün/)).toBeInTheDocument();

  expect(await screen.findByRole('progressbar', { name: 'Genel ilerleme' })).toHaveAttribute(
    'aria-valuenow',
    '45',
  );
  expect(screen.getByRole('progressbar', { name: 'TYT ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '75',
  );
  expect(screen.getByRole('progressbar', { name: 'AYT ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '15',
  );

  expect(screen.getByText('Bilgi Sarmal TYT Matematik')).toBeInTheDocument();
  expect(screen.getByText('Palme TYT Türkçe')).toBeInTheDocument();
  expect(screen.queryByText('Eski Kitap')).not.toBeInTheDocument();

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
  // "Genel ilerleme" ve "TYT netleri" sayaçlarının ikisi de yalnızca tam
  // denemeyi sayar; branş denemesi 2. deneme olarak eklenmez.
  expect(await screen.findAllByText('1 deneme')).toHaveLength(2);
  expect(screen.getByText('Tam TYT')).toBeInTheDocument();
  expect(screen.queryByText('Branş Sosyal')).not.toBeInTheDocument();
  expect(screen.queryByText('2 deneme')).not.toBeInTheDocument();
});

test('gizlenen dersler genel ve AYT yüzdelerine katılmaz', async () => {
  const seed = await seedDashboardData();
  await patchSettings({ hiddenSubjects: [seed.aytFizik] });

  renderApp('/');

  expect(await screen.findByRole('progressbar', { name: 'Genel ilerleme' })).toHaveAttribute(
    'aria-valuenow',
    '60',
  );
  expect(screen.getByRole('progressbar', { name: 'TYT ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '75',
  );
  expect(screen.getByRole('progressbar', { name: 'AYT ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '30',
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
  expect(screen.getByRole('progressbar', { name: 'Genel ilerleme' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
});
