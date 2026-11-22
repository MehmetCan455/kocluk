import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  SCHEDULE_FILE_MAX_BYTES,
  getSettings,
  listScheduleFiles,
  saveScheduleTable,
} from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import { listCatalogBooks, seedCatalog } from '@/db/catalogRepository';
import {
  addCatalogBookToShelf,
  getShelfBook,
  listBookActivity,
  type ShelfBook,
} from '@/db/bookRepositories';
import {
  addRow,
  addTask,
  getOrCreateWeek,
  getWeek,
  toggleTask,
} from '@/db/scheduleRepository';
import { getTopicDone, listTopicReviews } from '@/db/topicProgressRepository';
import {
  SCHEDULE_DAYS,
  todayScheduleDayIndex,
} from '@/features/schedule/scheduleDays';
import { dayLabel, shiftWeek, weekLabel, weekStartOf } from '@/domain/schedule';
import type { Subject, Topic } from '@/domain/types';
import { compressImage } from '@/lib/image';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

vi.mock('@/lib/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/image')>();
  return {
    ...actual,
    compressImage: vi.fn(async () => ({
      blob: new Blob(['sıkıştırılmış program'], { type: 'image/jpeg' }),
      thumbBlob: new Blob(['küçük program'], { type: 'image/jpeg' }),
      width: 2000,
      height: 1200,
    })),
  };
});

// Wrap addRow so one test can hold the insert open and exercise the queued
// save while the row id is still unknown.
const repoMocks = vi.hoisted(() => ({
  addRow: vi.fn(),
  actualAddRow: undefined as unknown as typeof import('@/db/scheduleRepository').addRow,
}));

vi.mock('@/db/scheduleRepository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/db/scheduleRepository')>();
  repoMocks.actualAddRow = actual.addRow;
  return {
    ...actual,
    addRow: (...args: Parameters<typeof actual.addRow>) =>
      repoMocks.addRow(...args),
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
      topics: [{ seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 }],
    },
  ],
};

const TABLE_NAME = 'Haftalık ders çalışma tablosu';

function currentWeekStart(): string {
  return weekStartOf(new Date());
}

beforeEach(async () => {
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
  vi.mocked(compressImage).mockClear();
  repoMocks.addRow.mockReset();
  repoMocks.addRow.mockImplementation(
    (weekId: string, label: string, subjectId?: string) =>
      repoMocks.actualAddRow(weekId, label, subjectId),
  );
});

async function openSchedule(path = '/program') {
  const view = renderApp(path);
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'Ders Çalışma Çizelgesi',
    }),
  ).toBeInTheDocument();
  return view;
}

function findPlanTable(): Promise<HTMLElement> {
  return screen.findByRole('table', { name: TABLE_NAME });
}

async function seedPlanRow(): Promise<{ weekStart: string; weekId: string; rowId: string }> {
  const weekStart = currentWeekStart();
  const { week } = await getOrCreateWeek(weekStart);
  const row = await addRow(week.id, 'Matematik');
  return { weekStart, weekId: week.id, rowId: row.id };
}

async function seedBilgiSarmalBook(): Promise<ShelfBook> {
  await seedCatalog();
  const catalogBook = (await listCatalogBooks()).find(
    (book) => book.publisher === 'Bilgi Sarmal',
  );
  if (!catalogBook) {
    throw new Error('Bilgi Sarmal katalog kitabı bulunamadı');
  }
  const userBook = await addCatalogBookToShelf(catalogBook.id);
  const shelfBook = await getShelfBook(userBook.id);
  if (!shelfBook) {
    throw new Error('Raf kitabı bulunamadı');
  }
  return shelfBook;
}

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

async function switchToUpload(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Fotoğraf/PDF' }));
  expect(await screen.findByText('Henüz çizelge dosyası yok')).toBeInTheDocument();
}

async function seedLegacyTable(): Promise<void> {
  await saveScheduleTable({
    rows: [
      {
        id: 'eski-matematik',
        subject: 'Matematik',
        days: ['2 saat', '40 soru', '', '', '', '', ''],
        done: [true, false, false, false, false, false, false],
        total: '3 saat',
      },
    ],
    note: 'Eski haftanın değerlendirmesi',
  });
}

interface FakeSizeFile extends File {
  size: number;
}

function fileWithSize(name: string, type: string, size: number): FakeSizeFile {
  const file = new File(['x'], name, { type }) as FakeSizeFile;
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

test('program geçerli haftayı, yedi gün sütununu ve boş planı gösterir', async () => {
  await openSchedule();

  expect(await screen.findByText(weekLabel(currentWeekStart()))).toBeInTheDocument();

  const table = await findPlanTable();
  for (const day of SCHEDULE_DAYS) {
    expect(
      within(table).getByRole('columnheader', { name: day.label }),
    ).toBeInTheDocument();
  }
  expect(within(table).getAllByRole('columnheader')).toHaveLength(8);
  expect(
    await within(table).findByText('Bu hafta için henüz satır yok'),
  ).toBeInTheDocument();

  const dayTabs = screen.getByRole('group', { name: 'Çizelge günü' });
  expect(within(dayTabs).getAllByRole('button')).toHaveLength(7);
  // The mobile day selector opens on today, not Monday.
  const today = SCHEDULE_DAYS[todayScheduleDayIndex()];
  expect(
    within(dayTabs).getByRole('button', {
      name: `${today.short} ${today.label}`,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  const otherDay = SCHEDULE_DAYS.find((day) => day.day !== today.day)!;
  const otherButton = within(dayTabs).getByRole('button', {
    name: `${otherDay.short} ${otherDay.label}`,
  });
  expect(otherButton).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(otherButton);
  expect(otherButton).toHaveAttribute('aria-pressed', 'true');

  expect(screen.getByLabelText('Haftanın notu')).toBeInTheDocument();
  expect(screen.getByText('Henüz kaydedilmedi')).toBeInTheDocument();
  expect(screen.queryByText('Eski çizelge')).not.toBeInTheDocument();
});

test('adresteki hafta parametresi açılış haftasını belirler', async () => {
  await openSchedule('/program?week=2025-03-12');

  expect(await screen.findByText(weekLabel('2025-03-10'))).toBeInTheDocument();
  expect(await findPlanTable()).toBeInTheDocument();
  expect((await getWeek('2025-03-10'))?.week.weekStart).toBe('2025-03-10');
});

test('geçersiz hafta parametresi geçerli haftaya döner', async () => {
  await openSchedule('/program?week=2026-02-30');

  expect(await screen.findByText(weekLabel(currentWeekStart()))).toBeInTheDocument();
});

test('hafta düğmeleri tarih aralığını değiştirir', async () => {
  await openSchedule();
  const current = currentWeekStart();
  expect(await screen.findByText(weekLabel(current))).toBeInTheDocument();

  const dayTabs = await screen.findByRole('group', { name: 'Çizelge günü' });
  await userEvent.click(
    within(dayTabs).getByRole('button', { name: 'Sal Salı' }),
  );

  const nextWeek = shiftWeek(current, 1);
  await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }));
  expect(await screen.findByText(weekLabel(nextWeek))).toBeInTheDocument();
  await waitFor(async () => {
    expect(await getWeek(nextWeek)).toBeDefined();
  });
  // The column title belongs to the newly loaded week, so the tab assertion
  // cannot accidentally read the previous table during the loading swap.
  await screen.findByTitle(dayLabel(nextWeek, 2));
  const nextDayTabs = screen.getByRole('group', { name: 'Çizelge günü' });
  expect(
    within(nextDayTabs).getByRole('button', { name: 'Sal Salı' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(screen.getByRole('button', { name: 'Bu hafta' }));
  expect(await screen.findByText(weekLabel(current))).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Önceki hafta' }));
  expect(
    await screen.findByText(weekLabel(shiftWeek(current, -1))),
  ).toBeInTheDocument();
});

test('satır eklenir, adlandırılır, silinir ve yeniden açınca korunur', async () => {
  const view = await openSchedule();
  const current = currentWeekStart();
  await screen.findByText('Bu hafta için henüz satır yok');

  await userEvent.click(screen.getByRole('button', { name: 'Satır ekle' }));
  const firstRow = screen.getByLabelText('1. satır');
  expect(firstRow.tagName).toBe('TEXTAREA');
  expect(firstRow).toHaveValue('');
  await userEvent.type(firstRow, 'Matematik');

  await waitFor(
    async () => {
      expect((await getWeek(current))?.rows.map((row) => row.label)).toEqual([
        'Matematik',
      ]);
    },
    { timeout: 3000 },
  );

  await userEvent.click(screen.getByRole('button', { name: 'Satır ekle' }));
  await userEvent.type(screen.getByLabelText('2. satır'), 'Fizik');
  await waitFor(
    async () => {
      expect((await getWeek(current))?.rows.map((row) => row.label)).toEqual([
        'Matematik',
        'Fizik',
      ]);
    },
    { timeout: 3000 },
  );

  await userEvent.click(screen.getByRole('button', { name: '2. satırı sil' }));
  let deleteDialog = await screen.findByRole('dialog', { name: 'Satırı sil' });
  expect(deleteDialog).toHaveTextContent('içindeki tüm görevler');
  await userEvent.click(
    within(deleteDialog).getByRole('button', { name: 'Vazgeç' }),
  );
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Satırı sil' })).not.toBeInTheDocument();
  });
  expect((await getWeek(current))?.rows.map((row) => row.label)).toEqual([
    'Matematik',
    'Fizik',
  ]);

  await userEvent.click(screen.getByRole('button', { name: '2. satırı sil' }));
  deleteDialog = await screen.findByRole('dialog', { name: 'Satırı sil' });
  await userEvent.click(within(deleteDialog).getByRole('button', { name: 'Sil' }));
  await waitFor(
    async () => {
      expect((await getWeek(current))?.rows.map((row) => row.label)).toEqual([
        'Matematik',
      ]);
    },
    { timeout: 3000 },
  );

  view.unmount();
  await openSchedule();
  const reloaded = await findPlanTable();
  expect(await within(reloaded).findByLabelText('1. satır')).toHaveValue(
    'Matematik',
  );
  expect(within(reloaded).queryByLabelText('2. satır')).not.toBeInTheDocument();
});

test('var olan satır adı düzenlenir ve yeniden açınca korunur', async () => {
  const current = currentWeekStart();
  const { week } = await getOrCreateWeek(current);
  await addRow(week.id, 'Matematik');

  const view = await openSchedule();
  const row = await screen.findByLabelText('1. satır');
  expect(row).toHaveValue('Matematik');

  await userEvent.clear(row);
  await userEvent.type(row, 'Geometri');
  await waitFor(
    async () => {
      expect((await getWeek(current))?.rows.map((item) => item.label)).toEqual([
        'Geometri',
      ]);
    },
    { timeout: 3000 },
  );

  view.unmount();
  await openSchedule();
  expect(await screen.findByLabelText('1. satır')).toHaveValue('Geometri');
});

test('var olan satır adı boşaltılınca sahte başarı gösterilmez', async () => {
  const current = currentWeekStart();
  const { week } = await getOrCreateWeek(current);
  await addRow(week.id, 'Matematik');

  await openSchedule();
  const row = await screen.findByLabelText('1. satır');
  expect(row).toHaveValue('Matematik');

  await userEvent.clear(row);
  expect(
    await screen.findByText('Kaydedilmedi', {}, { timeout: 3000 }),
  ).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Satır adı boş olamaz',
  );
  expect(row).toHaveValue('');
  expect(screen.queryByText('Kaydedildi')).not.toBeInTheDocument();
  expect((await getWeek(current))?.rows.map((item) => item.label)).toEqual([
    'Matematik',
  ]);
});

test('satır ekleme sürerken hafta değişse de satır iki kez eklenmez', async () => {
  const current = currentWeekStart();
  await openSchedule();
  await screen.findByText('Bu hafta için henüz satır yok');

  let releaseInsert: () => void = () => undefined;
  const insertGate = new Promise<void>((resolve) => {
    releaseInsert = resolve;
  });
  repoMocks.addRow.mockImplementationOnce(
    async (weekId: string, label: string, subjectId?: string) => {
      await insertGate;
      return repoMocks.actualAddRow(weekId, label, subjectId);
    },
  );

  await userEvent.click(screen.getByRole('button', { name: 'Satır ekle' }));
  await userEvent.type(screen.getByLabelText('1. satır'), 'Matematik');

  await waitFor(
    () => {
      expect(repoMocks.addRow).toHaveBeenCalledTimes(1);
    },
    { timeout: 3000 },
  );
  const firstInsert = repoMocks.addRow.mock.results[0]?.value as Promise<unknown>;

  await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }));
  await waitFor(async () => {
    expect(await getWeek(shiftWeek(current, 1))).toBeDefined();
  });

  await act(async () => {
    releaseInsert();
    await firstInsert;
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  });

  expect(repoMocks.addRow).toHaveBeenCalledTimes(1);
  expect((await getWeek(current))?.rows.map((item) => item.label)).toEqual([
    'Matematik',
  ]);
});

test('haftanın notu kısa bir gecikmeyle kaydedilir ve yeniden açınca korunur', async () => {
  const view = await openSchedule();
  const current = currentWeekStart();

  const note = await screen.findByLabelText('Haftanın notu');
  await userEvent.type(note, 'Türev tekrarı');
  expect(await screen.findByText('Kaydedilmemiş değişiklikler')).toBeInTheDocument();
  expect(
    await screen.findByText('Kaydedildi', {}, { timeout: 3000 }),
  ).toBeInTheDocument();
  expect((await getWeek(current))?.week.note).toBe('Türev tekrarı');

  view.unmount();
  await openSchedule();
  expect(await screen.findByLabelText('Haftanın notu')).toHaveValue(
    'Türev tekrarı',
  );
  expect(screen.getByText('Kaydedildi')).toBeInTheDocument();
});

test('not kaydedilemezse taslak korunur ve hata gösterilir', async () => {
  await openSchedule();
  const note = await screen.findByLabelText('Haftanın notu');
  const update = vi
    .spyOn(db.scheduleWeeks, 'update')
    .mockRejectedValueOnce(new Error('Disk dolu'));

  try {
    await userEvent.type(note, 'Deneme');
    expect(
      await screen.findByText('Kaydedilmedi', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk dolu');
    expect(note).toHaveValue('Deneme');
  } finally {
    update.mockRestore();
  }

  await userEvent.type(note, ' notu');
  expect(
    await screen.findByText('Kaydedildi', {}, { timeout: 3000 }),
  ).toBeInTheDocument();
  expect((await getWeek(currentWeekStart()))?.week.note).toBe('Deneme notu');
});

test('mod seçimi kalıcıdır; yükleme ve elle plan arasında geçilir', async () => {
  const view = await openSchedule();
  expect(await findPlanTable()).toBeInTheDocument();

  await switchToUpload();
  expect(screen.queryByRole('table', { name: TABLE_NAME })).not.toBeInTheDocument();
  expect((await getSettings()).scheduleMode).toBe('upload');

  view.unmount();
  await openSchedule();
  expect(await screen.findByText('Henüz çizelge dosyası yok')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Elle tablo' }));
  expect(await findPlanTable()).toBeInTheDocument();
  expect((await getSettings()).scheduleMode).toBe('manual');
});

test('eski çizelge salt okunur gösterilir ve yeni haftalık plan çalışır', async () => {
  await seedLegacyTable();
  await openSchedule();

  const plan = await findPlanTable();
  expect(
    await within(plan).findByText('Bu hafta için henüz satır yok'),
  ).toBeInTheDocument();

  const summary = await screen.findByText('Eski çizelge');
  const details = summary.closest('details');
  if (!(details instanceof HTMLElement)) {
    throw new Error('Eski çizelge bir details öğesi içinde değil');
  }
  await userEvent.click(summary);

  const legacy = await screen.findByRole('table', {
    name: 'Eski çizelge tablosu',
  });
  for (const day of SCHEDULE_DAYS) {
    expect(
      within(legacy).getByRole('columnheader', { name: day.label }),
    ).toBeInTheDocument();
  }
  expect(within(legacy).getAllByRole('columnheader')).toHaveLength(9);

  const doneCell = within(legacy).getByText('2 saat');
  expect(doneCell).toBeVisible();
  expect(doneCell.closest('td')).toHaveAttribute('data-done', 'true');
  expect(within(legacy).getByText('40 soru')).toBeVisible();
  expect(within(legacy).getByText('3 saat')).toBeVisible();
  expect(
    within(details).getByText('Eski çizelgenin notu'),
  ).toBeVisible();
  expect(
    within(details).getByText('Eski haftanın değerlendirmesi'),
  ).toBeVisible();

  expect(within(details).queryAllByRole('textbox')).toHaveLength(0);
  expect(within(details).queryAllByRole('button')).toHaveLength(0);
  expect(within(details).queryByText('Kaydet')).not.toBeInTheDocument();
});

test('eski çizelge yükleme modunda gösterilmez', async () => {
  await seedLegacyTable();
  await openSchedule();
  expect(await screen.findByText('Eski çizelge')).toBeInTheDocument();

  await switchToUpload();
  expect(screen.queryByText('Eski çizelge')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Elle tablo' }));
  expect(await screen.findByText('Eski çizelge')).toBeInTheDocument();
});

test('program görselini büyütür, PDF bağlantısını açar ve dosyaları siler', async () => {
  await openSchedule();
  await switchToUpload();

  const input = screen.getByLabelText('Çizelge dosyası seç');
  await userEvent.upload(
    input,
    new File(['png-içeriği'], 'program.png', { type: 'image/png' }),
  );

  expect(await screen.findByText('program.png')).toBeInTheDocument();
  const preview = await screen.findByRole('img', { name: 'program.png' });
  expect(preview).toHaveAttribute('src', expect.stringContaining('blob:'));

  const stored = await listScheduleFiles();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ name: 'program.png', mime: 'image/jpeg' });
  expect(compressImage).toHaveBeenCalled();

  await userEvent.click(
    screen.getByRole('button', { name: 'program.png görselini büyüt' }),
  );
  const viewDialog = await screen.findByRole('dialog', { name: 'program.png' });
  expect(within(viewDialog).getByRole('img', { name: 'program.png' })).toBeInTheDocument();
  await userEvent.click(within(viewDialog).getByRole('button', { name: 'Kapat' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  await userEvent.upload(
    input,
    new File(['pdf-içeriği'], 'program.pdf', { type: 'application/pdf' }),
  );

  expect(await screen.findByText('program.pdf')).toBeInTheDocument();
  const openLink = await screen.findByRole('link', {
    name: 'program.pdf dosyasını aç',
  });
  await waitFor(() => {
    expect(openLink).toHaveAttribute('href', expect.stringContaining('blob:'));
  });
  expect(openLink).toHaveAttribute('target', '_blank');

  await userEvent.click(
    screen.getByRole('button', { name: 'program.pdf dosyasını sil' }),
  );
  const deleteDialog = await screen.findByRole('dialog', {
    name: 'Çizelge dosyasını sil',
  });
  await userEvent.click(within(deleteDialog).getByRole('button', { name: 'Sil' }));

  await waitFor(() => {
    expect(screen.queryByText('program.pdf')).not.toBeInTheDocument();
  });
  expect(await listScheduleFiles()).toHaveLength(1);
});

test('20 MB üzerindeki çizelge dosyasını yüklemez', async () => {
  await openSchedule();
  await switchToUpload();

  await userEvent.upload(
    screen.getByLabelText('Çizelge dosyası seç'),
    fileWithSize('büyük.pdf', 'application/pdf', SCHEDULE_FILE_MAX_BYTES + 1),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Dosya boyutu 20 MB sınırını aşıyor',
  );
  expect(await listScheduleFiles()).toHaveLength(0);
});

test('kitap görevi eklenir, tiklenir ve ilerleme iki kez sayılmaz', async () => {
  const { weekStart } = await seedPlanRow();
  const shelfBook = await seedBilgiSarmalBook();
  const userBookId = shelfBook.userBook.id;
  const view = await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: 'Matematik Çarşamba görev ekle' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await within(dialog).findByRole('option', { name: /Bilgi Sarmal/ });
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Kitap'),
    userBookId,
  );
  await userEvent.type(
    within(dialog).getByLabelText('Başlangıç sayfası'),
    '210',
  );
  await userEvent.type(within(dialog).getByLabelText('Bitiş sayfası'), '220');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByText(/s\. 210–220/)).toBeInTheDocument();
  expect(screen.getByText('Planlanan sayfa').parentElement).toHaveTextContent('11');
  expect(screen.getByText('Okunan sayfa').parentElement).toHaveTextContent('0');

  const checkboxName =
    'TYT Matematik Soru Bankası s. 210–220 görevini tamamla';
  await userEvent.click(
    await screen.findByRole('checkbox', { name: checkboxName }),
  );

  await waitFor(async () => {
    expect((await getShelfBook(userBookId))?.progress.readPages).toBe(11);
  });
  expect(
    (await listBookActivity(userBookId)).filter(
      (log) => log.type === 'book_pages',
    ),
  ).toHaveLength(1);
  await waitFor(() => {
    expect(screen.getByText('Okunan sayfa').parentElement).toHaveTextContent(
      '11',
    );
  });

  await userEvent.click(screen.getByRole('checkbox', { name: checkboxName }));
  await waitFor(async () => {
    expect((await getShelfBook(userBookId))?.progress.readPages).toBe(0);
  });
  expect(
    (await listBookActivity(userBookId)).filter(
      (log) => log.type === 'book_pages',
    ),
  ).toHaveLength(0);

  await userEvent.click(screen.getByRole('checkbox', { name: checkboxName }));
  await waitFor(async () => {
    expect((await getShelfBook(userBookId))?.progress.readPages).toBe(11);
  });
  expect(
    (await listBookActivity(userBookId)).filter(
      (log) => log.type === 'book_pages',
    ),
  ).toHaveLength(1);

  view.unmount();
  renderApp(`/kitaplar/${userBookId}`);
  expect(await screen.findByText('11/400 sayfa okundu')).toBeInTheDocument();
  const planLink = await screen.findByRole('link', {
    name: /s\. 210–220 görevini plana aç/,
  });
  expect(planLink).toHaveAttribute('href', `/program?week=${weekStart}`);
  // Week/day context and completion state stay in the accessible name.
  expect(planLink).toHaveAccessibleName(new RegExp(weekLabel(weekStart)));
  expect(planLink).toHaveAccessibleName(/Tamamlandı/);
  expect(planLink).toHaveTextContent(dayLabel(weekStart, 3));
});

test('ondalık sayfa girişi kırpılmadan reddedilir', async () => {
  await seedPlanRow();
  const shelfBook = await seedBilgiSarmalBook();
  await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: 'Matematik Cuma görev ekle' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await within(dialog).findByRole('option', { name: /Bilgi Sarmal/ });
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Kitap'),
    shelfBook.userBook.id,
  );
  await userEvent.type(
    within(dialog).getByLabelText('Başlangıç sayfası'),
    '210.5',
  );
  await userEvent.type(within(dialog).getByLabelText('Bitiş sayfası'), '220');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'tam sayı olmalı',
  );
  expect(await db.scheduleTasks.count()).toBe(0);
});

test('konu tekrarı görevi tiklenince tekrar kaydı oluşturur ama konuyu bitirmez', async () => {
  await seedPlanRow();
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  const view = await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: 'Matematik Perşembe görev ekle' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Konu tekrarı' }),
  );
  await within(dialog).findByRole('option', { name: 'Türev' });
  await userEvent.selectOptions(within(dialog).getByLabelText('Konu'), topic.id);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'Türev görevini tamamla' }),
  );
  await waitFor(async () => {
    expect(await listTopicReviews(topic.id)).toHaveLength(1);
  });
  expect(await getTopicDone(topic.id)).toBe(false);

  view.unmount();
  renderApp(`/tyt/${subject.id}/${topic.id}`);
  expect(await screen.findByText('1 tekrar')).toBeInTheDocument();
  expect(screen.getByText('Devam ediyor')).toBeInTheDocument();
});

test('geçen haftadan kopyala görevleri tamamlanmadan kopyalar ve çoğaltmaz', async () => {
  const current = currentWeekStart();
  const source = await getOrCreateWeek(shiftWeek(current, -1));
  const sourceRow = await addRow(source.week.id, 'Matematik');
  const completed = await addTask({
    weekId: source.week.id,
    rowId: sourceRow.id,
    dayIndex: 1,
    type: 'free',
    title: 'Türev tekrarı',
  });
  await toggleTask(completed.id, true);
  await addTask({
    weekId: source.week.id,
    rowId: sourceRow.id,
    dayIndex: 2,
    type: 'free',
    title: 'Deneme çözümü',
  });

  const view = await openSchedule();
  await findPlanTable();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Geçen haftadan kopyala' }),
  );

  expect(await screen.findByText('Türev tekrarı')).toBeInTheDocument();
  expect(await screen.findByText('Deneme çözümü')).toBeInTheDocument();
  await waitFor(async () => {
    expect((await getWeek(current))?.tasks).toHaveLength(2);
  });
  const firstCopy = (await getWeek(current))?.tasks ?? [];
  expect(firstCopy.every((task) => task.completedAt === undefined)).toBe(true);

  await userEvent.click(
    screen.getByRole('button', { name: 'Geçen haftadan kopyala' }),
  );
  const confirmDialog = await screen.findByRole('dialog', {
    name: 'Geçen haftadan kopyala',
  });
  await userEvent.click(
    within(confirmDialog).getByRole('button', { name: 'Kopyala' }),
  );
  await waitFor(async () => {
    expect((await getWeek(current))?.tasks).toHaveLength(2);
  });
  expect(await screen.findAllByText('Türev tekrarı')).toHaveLength(1);

  view.unmount();
  expect((await getWeek(current))?.tasks).toHaveLength(2);
});

test('arayüzden eklenen görev ISO gün indeksiyle saklanır ve bugünün planında görünür', async () => {
  const { weekId } = await seedPlanRow();
  const today = ((new Date().getDay() + 6) % 7) + 1;
  const day = SCHEDULE_DAYS.find((item) => item.day === today);
  if (!day) {
    throw new Error('Bugünün çizelge günü bulunamadı');
  }

  const view = await openSchedule();
  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: `Matematik ${day.label} görev ekle` }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Serbest görev' }),
  );
  await userEvent.type(
    within(dialog).getByLabelText('Görev adı'),
    'Bugünün görevi',
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  await waitFor(async () => {
    const tasks = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].dayIndex).toBeGreaterThanOrEqual(1);
    expect(tasks[0].dayIndex).toBeLessThanOrEqual(7);
    expect(tasks[0].dayIndex).toBe(today);
  });

  const chipCheckbox = screen.getByRole('checkbox', {
    name: 'Bugünün görevi görevini tamamla',
  });
  // The tick label and the icon buttons keep the 44px touch target rule.
  expect(chipCheckbox.closest('label')).toHaveClass('min-h-11', 'min-w-11');
  expect(
    screen.getByRole('button', { name: 'Bugünün görevi görevini düzenle' }),
  ).toHaveClass('h-11', 'w-11');
  expect(
    screen.getByRole('button', { name: 'Bugünün görevi görevini sil' }),
  ).toHaveClass('h-11', 'w-11');

  view.unmount();
  renderApp('/');
  expect(
    await screen.findByRole('checkbox', {
      name: 'Bugünün görevi görevini tamamla',
    }),
  ).toBeInTheDocument();
});

test('serbest görev eklenir, düzenlenir ve silinir', async () => {
  await seedPlanRow();
  await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: 'Matematik Cuma görev ekle' }),
  );
  let dialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Serbest görev' }),
  );
  await userEvent.type(
    within(dialog).getByLabelText('Görev adı'),
    'Deneme çözümü',
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
  expect(await screen.findByText('Deneme çözümü')).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', {
      name: 'Deneme çözümü görevini düzenle',
    }),
  );
  dialog = await screen.findByRole('dialog', { name: 'Görevi düzenle' });
  const titleInput = within(dialog).getByLabelText('Görev adı');
  await userEvent.clear(titleInput);
  await userEvent.type(titleInput, 'Deneme analizi');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
  expect(await screen.findByText('Deneme analizi')).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', {
      name: 'Deneme analizi görevini sil',
    }),
  );
  const deleteDialog = await screen.findByRole('dialog', { name: 'Görevi sil' });
  expect(deleteDialog).toHaveTextContent('tiki kaldır');
  await userEvent.click(within(deleteDialog).getByRole('button', { name: 'Sil' }));
  await waitFor(() => {
    expect(screen.queryByText('Deneme analizi')).not.toBeInTheDocument();
  });
  expect((await getWeek(currentWeekStart()))?.tasks).toEqual([]);
});

test('hedef haftada satır varsa kopyalama onay ister', async () => {
  const current = currentWeekStart();
  const target = await getOrCreateWeek(current);
  await addRow(target.week.id, 'Mevcut satır');
  const source = await getOrCreateWeek(shiftWeek(current, -1));
  const sourceRow = await addRow(source.week.id, 'Kaynak satır');
  await addTask({
    weekId: source.week.id,
    rowId: sourceRow.id,
    dayIndex: 1,
    type: 'free',
    title: 'Kaynak görev',
  });

  await openSchedule();
  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: 'Geçen haftadan kopyala' }),
  );

  const dialog = await screen.findByRole('dialog', {
    name: 'Geçen haftadan kopyala',
  });
  expect(dialog).toHaveTextContent('satır veya görev');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));

  expect((await getWeek(current))?.rows.map((row) => row.label)).toEqual([
    'Mevcut satır',
  ]);
  expect((await getWeek(current))?.tasks).toEqual([]);
});

test('görev silme onayı vazgeçilince görev korunur', async () => {
  const { weekStart, weekId, rowId } = await seedPlanRow();
  await addTask({
    weekId,
    rowId,
    dayIndex: 1,
    type: 'free',
    title: 'Kalacak görev',
  });

  await openSchedule(`/program?week=${weekStart}`);
  await screen.findByText('Kalacak görev');
  await userEvent.click(
    screen.getByRole('button', { name: 'Kalacak görev görevini sil' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görevi sil' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));

  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Görevi sil' })).not.toBeInTheDocument();
  });
  expect(screen.getByText('Kalacak görev')).toBeInTheDocument();
  expect((await getWeek(weekStart))?.tasks).toHaveLength(1);
});
