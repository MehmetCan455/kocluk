import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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
  updateUserBook,
  type ShelfBook,
} from '@/db/bookRepositories';
import { createPageChain } from '@/db/pageChainRepository';
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

// Same passthrough pattern for the skip action, so the error test can make it
// fail without breaking the repository for the rest of the suite.
const chainRepoMocks = vi.hoisted(() => ({
  skipUnscheduledChunk: vi.fn(),
  actualSkipUnscheduledChunk: undefined as unknown as typeof import('@/db/pageChainRepository').skipUnscheduledChunk,
}));

vi.mock('@/db/pageChainRepository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/db/pageChainRepository')>();
  chainRepoMocks.actualSkipUnscheduledChunk = actual.skipUnscheduledChunk;
  return {
    ...actual,
    skipUnscheduledChunk: (...args: Parameters<typeof actual.skipUnscheduledChunk>) =>
      chainRepoMocks.skipUnscheduledChunk(...args),
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

// The day-change test fakes Date only; restore it so no test inherits a clock.
afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
  vi.mocked(compressImage).mockClear();
  repoMocks.addRow.mockReset();
  repoMocks.addRow.mockImplementation(
    (weekId: string, label: string, subjectId?: string) =>
      repoMocks.actualAddRow(weekId, label, subjectId),
  );
  chainRepoMocks.skipUnscheduledChunk.mockReset();
  chainRepoMocks.skipUnscheduledChunk.mockImplementation(
    (...args: Parameters<typeof chainRepoMocks.actualSkipUnscheduledChunk>) =>
      chainRepoMocks.actualSkipUnscheduledChunk(...args),
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

function taskChip(title: string): HTMLElement {
  const line = screen.getByText(title, { selector: '[data-line="title"]' });
  const chip = line.closest('[data-status]');
  if (!(chip instanceof HTMLElement)) {
    throw new Error(`Görev çipi bulunamadı: ${title}`);
  }
  return chip;
}

async function seedPlanRow(
  weekStart = currentWeekStart(),
): Promise<{ weekStart: string; weekId: string; rowId: string }> {
  const { week } = await getOrCreateWeek(weekStart);
  const row = await addRow(week.id, 'Matematik');
  return { weekStart, weekId: week.id, rowId: row.id };
}

async function seedShelfBook(
  publisher: string,
  title: string,
): Promise<ShelfBook> {
  await seedCatalog();
  const catalogBook = (await listCatalogBooks()).find(
    (book) =>
      book.publisher === publisher &&
      book.exam === 'TYT' &&
      book.title === title,
  );
  if (!catalogBook) {
    throw new Error(`${publisher} katalog kitabı bulunamadı`);
  }
  const userBook = await addCatalogBookToShelf(catalogBook.id);
  const shelfBook = await getShelfBook(userBook.id);
  if (!shelfBook) {
    throw new Error('Raf kitabı bulunamadı');
  }
  return shelfBook;
}

function seedBilgiSarmalBook(): Promise<ShelfBook> {
  return seedShelfBook('Bilgi Sarmal', 'TYT Matematik Soru Bankası');
}

/**
 * Seeds a five-day chain in next week by default, so no day is auto-missed by
 * the calendar; a test's missed day is always the explicit one it marks.
 */
async function seedChainWithFiveDays(
  weekStart = shiftWeek(currentWeekStart(), 1),
): Promise<{
  weekStart: string;
  weekId: string;
  rowId: string;
}> {
  const { week } = await getOrCreateWeek(weekStart);
  const row = await addRow(week.id, 'Matematik');
  const shelfBook = await seedBilgiSarmalBook();
  await createPageChain({
    weekId: week.id,
    rowId: row.id,
    userBookId: shelfBook.userBook.id,
    startPage: 100,
    endPage: 150,
    days: [1, 2, 3, 4, 5],
  });
  return { weekStart, weekId: week.id, rowId: row.id };
}

/** Types into the picker search box and picks the matching shelf book. */
async function chooseShelfBook(
  dialog: HTMLElement,
  query: string,
  optionName: RegExp,
): Promise<void> {
  await within(dialog).findByRole('option', { name: optionName });
  await userEvent.type(within(dialog).getByLabelText('Kitap ara'), query);
  await userEvent.click(
    within(dialog).getByRole('option', { name: optionName }),
  );
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
  // Bugünün günü seçilir; geçmiş bir gün otomatik "Yapılmadı" olurdu.
  const today = SCHEDULE_DAYS[todayScheduleDayIndex()];
  const view = await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: `Matematik ${today.label} görev ekle` }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await chooseShelfBook(dialog, 'bilgi sarmal', /Bilgi Sarmal/);
  await userEvent.type(
    within(dialog).getByLabelText('Başlangıç sayfası'),
    '210',
  );
  await userEvent.type(within(dialog).getByLabelText('Bitiş sayfası'), '220');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByText(/Syf\. 210–220/)).toBeInTheDocument();
  expect(screen.getByText('Planlanan sayfa').parentElement).toHaveTextContent('11');
  expect(screen.getByText('Okunan sayfa').parentElement).toHaveTextContent('0');

  // Completion now goes through tick mode; the chip has no checkbox.
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));
  const bookChipTitle = 'Bilgi Sarmal · TYT Matematik Soru Bankası';
  const chipTitle = () =>
    screen.getByText(bookChipTitle, {
      selector: '[data-line="title"]',
    });
  await userEvent.click(chipTitle());
  await waitFor(() => {
    expect(taskChip(bookChipTitle)).toHaveAttribute('data-status', 'done');
  });
  expect(
    screen.getByRole('button', {
      name: `${bookChipTitle} Syf. 210–220: Yapıldı`,
    }),
  ).toBeInTheDocument();

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

  await userEvent.click(chipTitle());
  await waitFor(() => {
    expect(taskChip(bookChipTitle)).toHaveAttribute('data-status', 'pending');
  });
  await waitFor(async () => {
    expect((await getShelfBook(userBookId))?.progress.readPages).toBe(0);
  });
  expect(
    (await listBookActivity(userBookId)).filter(
      (log) => log.type === 'book_pages',
    ),
  ).toHaveLength(0);

  await userEvent.click(chipTitle());
  await waitFor(() => {
    expect(taskChip(bookChipTitle)).toHaveAttribute('data-status', 'done');
  });
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
    name: /Syf\. 210–220 görevini plana aç/,
  });
  expect(planLink).toHaveAttribute('href', `/program?week=${weekStart}`);
  // Week/day context and completion state stay in the accessible name.
  expect(planLink).toHaveAccessibleName(new RegExp(weekLabel(weekStart)));
  expect(planLink).toHaveAccessibleName(/Tamamlandı/);
  expect(planLink).toHaveTextContent(dayLabel(weekStart, today.day));
});

test('iki yayınevinden kitap varken arama eşleşeni bırakır ve doğru kitap kaydedilir', async () => {
  await seedPlanRow();
  const bilgiSarmal = await seedBilgiSarmalBook();
  const threeD = await seedShelfBook(
    '3D Yayınları',
    'TYT Matematik Soru Bankası',
  );
  await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: 'Matematik Çarşamba görev ekle' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await within(dialog).findByRole('option', { name: /Bilgi Sarmal/ });
  expect(
    within(dialog).getByRole('option', { name: /3D Yayınları/ }),
  ).toBeInTheDocument();

  await userEvent.type(within(dialog).getByLabelText('Kitap ara'), '3d');

  const options = within(dialog).getAllByRole('option');
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveTextContent('3D Yayınları');
  expect(
    within(dialog).queryByRole('option', { name: /Bilgi Sarmal/ }),
  ).not.toBeInTheDocument();

  await userEvent.click(options[0]);
  await userEvent.type(
    within(dialog).getByLabelText('Başlangıç sayfası'),
    '10',
  );
  await userEvent.type(within(dialog).getByLabelText('Bitiş sayfası'), '19');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  await waitFor(async () => {
    const tasks = await db.scheduleTasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].userBookId).toBe(threeD.userBook.id);
  });
  expect(bilgiSarmal.userBook.id).not.toBe(threeD.userBook.id);
});

test('rafta başka aktif kitap yokken de raf dışı kitabı uyarır ve kaydetmeyi engeller', async () => {
  const { weekId, rowId } = await seedPlanRow();
  const archived = await seedBilgiSarmalBook();
  await addTask({
    weekId,
    rowId,
    dayIndex: 1,
    type: 'book',
    userBookId: archived.userBook.id,
    fromPage: 10,
    toPage: 20,
  });
  await updateUserBook(archived.userBook.id, { status: 'archived' });
  const before = await db.scheduleTasks.toArray();
  await openSchedule();

  const chipTitle = 'Bilgi Sarmal · TYT Matematik Soru Bankası';
  await screen.findByText(chipTitle, { selector: '[data-line="title"]' });
  await userEvent.click(
    screen.getByRole('button', {
      name: new RegExp(`${chipTitle} Syf\\. 10–20 görevini düzenle`),
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görevi düzenle' });

  // The active shelf is empty, so the picker shows its empty-shelf message;
  // the task's missing book still needs its own warning.
  expect(
    within(dialog).getByText(
      'Rafında kitap yok. Kitaplar sayfasından ekleyebilirsin.',
    ),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText('Seçili kitap rafında bulunamadı.'),
  ).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
  await waitFor(() => {
    expect(
      screen.queryByRole('dialog', { name: 'Görevi düzenle' }),
    ).not.toBeInTheDocument();
  });
  expect(await db.scheduleTasks.toArray()).toEqual(before);
});

test('ondalık sayfa girişi kırpılmadan reddedilir', async () => {
  await seedPlanRow();
  await seedBilgiSarmalBook();
  await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: 'Matematik Cuma görev ekle' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await chooseShelfBook(dialog, 'bilgi sarmal', /Bilgi Sarmal/);
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

  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));
  await userEvent.click(
    await screen.findByText('Türev', { selector: '[data-line="title"]' }),
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

  const planChip = taskChip('Bugünün görevi');
  // The three-line body and the icon buttons keep the 44px touch target rule.
  expect(planChip).toHaveAttribute('aria-label', 'Bugünün görevi: Planlandı');
  expect(
    planChip.querySelector('[data-line="title"]')?.closest('div'),
  ).toHaveClass('min-h-11');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
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

test('tik modu sol tıkla yapıldı, sağ tıkla yapılmadı, tekrar tıkla nötr olur', async () => {
  const { weekId, rowId } = await seedPlanRow();
  // Bugünün görevi: işaretsizken nötr kalır, geçmiş gün otomatik kaçırılmış olurdu.
  const task = await addTask({
    weekId,
    rowId,
    dayIndex: todayScheduleDayIndex() + 1,
    type: 'free',
    title: 'Türev tekrarı',
  });
  await openSchedule();

  await screen.findByText('Türev tekrarı', {
    selector: '[data-line="title"]',
  });
  expect(taskChip('Türev tekrarı')).toHaveAttribute('data-status', 'pending');

  const tickButton = screen.getByRole('button', { name: 'Tik modu' });
  expect(tickButton).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(tickButton);
  expect(tickButton).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByText('Sol tık: yapıldı · Sağ tık: yapılmadı'),
  ).toBeInTheDocument();
  // Tik modunda düzenle/sil gizlenir; çipin tamamı tıklama hedefi olur.
  expect(
    screen.queryByRole('button', { name: 'Türev tekrarı görevini düzenle' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Türev tekrarı görevini sil' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(taskChip('Türev tekrarı')).toHaveAttribute('role', 'button');
  expect(taskChip('Türev tekrarı')).toHaveAttribute('tabindex', '0');
  expect(taskChip('Türev tekrarı')).toHaveAttribute(
    'aria-label',
    'Türev tekrarı: Planlandı',
  );

  await userEvent.click(
    screen.getByText('Türev tekrarı', { selector: '[data-line="title"]' }),
  );
  await waitFor(() => {
    expect(taskChip('Türev tekrarı')).toHaveAttribute('data-status', 'done');
  });
  expect(taskChip('Türev tekrarı').className).toContain('bg-success/10');
  await waitFor(async () => {
    expect((await db.scheduleTasks.get(task.id))?.completedAt).toBeDefined();
  });

  await userEvent.click(
    screen.getByText('Türev tekrarı', { selector: '[data-line="title"]' }),
  );
  await waitFor(() => {
    expect(taskChip('Türev tekrarı')).toHaveAttribute('data-status', 'pending');
  });
  expect((await db.scheduleTasks.get(task.id))?.completedAt).toBeUndefined();

  // Sağ tık tarayıcı menüsünü açmaz; görevi yapılmadı işaretler.
  expect(fireEvent.contextMenu(taskChip('Türev tekrarı'))).toBe(false);
  await waitFor(() => {
    expect(taskChip('Türev tekrarı')).toHaveAttribute('data-status', 'missed');
  });
  expect(taskChip('Türev tekrarı').className).toContain('bg-danger/10');
  await waitFor(async () => {
    expect((await db.scheduleTasks.get(task.id))?.missedAt).toBeDefined();
  });

  fireEvent.contextMenu(taskChip('Türev tekrarı'));
  await waitFor(() => {
    expect(taskChip('Türev tekrarı')).toHaveAttribute('data-status', 'pending');
  });
  const cleared = await db.scheduleTasks.get(task.id);
  expect(cleared?.missedAt).toBeUndefined();
  expect(cleared?.completedAt).toBeUndefined();
});

test('normal modda görev çipi tıklanınca durum değiştirmez', async () => {
  const { weekId, rowId } = await seedPlanRow();
  const task = await addTask({
    weekId,
    rowId,
    dayIndex: todayScheduleDayIndex() + 1,
    type: 'free',
    title: 'Türev tekrarı',
  });
  await openSchedule();

  await screen.findByText('Türev tekrarı', { selector: '[data-line="title"]' });
  const chip = taskChip('Türev tekrarı');
  expect(chip).not.toHaveAttribute('role');
  expect(chip).toHaveAttribute('aria-label', 'Türev tekrarı: Planlandı');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

  await userEvent.click(chip);

  expect(chip).toHaveAttribute('data-status', 'pending');
  expect((await db.scheduleTasks.get(task.id))?.completedAt).toBeUndefined();
  expect(
    screen.getByRole('button', { name: 'Türev tekrarı görevini düzenle' }),
  ).toBeInTheDocument();
});

test('tik modunda çip klavyeyle yapıldı ve yapılmadı işaretlenir', async () => {
  const { weekId, rowId } = await seedPlanRow();
  const task = await addTask({
    weekId,
    rowId,
    dayIndex: todayScheduleDayIndex() + 1,
    type: 'free',
    title: 'Türev tekrarı',
  });
  await openSchedule();

  await screen.findByText('Türev tekrarı', { selector: '[data-line="title"]' });
  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));

  const chip = screen.getByRole('button', {
    name: 'Türev tekrarı: Planlandı',
  });
  expect(chip).toHaveAttribute('tabindex', '0');
  chip.focus();
  expect(chip).toHaveFocus();

  await userEvent.keyboard('{Enter}');
  await waitFor(() => {
    expect(taskChip('Türev tekrarı')).toHaveAttribute('data-status', 'done');
  });
  expect(chip).toHaveFocus();
  await waitFor(async () => {
    expect((await db.scheduleTasks.get(task.id))?.completedAt).toBeDefined();
  });

  await userEvent.keyboard(' ');
  await waitFor(() => {
    expect(taskChip('Türev tekrarı')).toHaveAttribute('data-status', 'pending');
  });
  expect((await db.scheduleTasks.get(task.id))?.completedAt).toBeUndefined();

  await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
  await waitFor(() => {
    expect(taskChip('Türev tekrarı')).toHaveAttribute('data-status', 'missed');
  });
  await waitFor(async () => {
    expect((await db.scheduleTasks.get(task.id))?.missedAt).toBeDefined();
  });
});

test('geçmiş haftada işaretsiz görev kırmızı, tamamlanan görev yeşil görünür', async () => {
  const previous = shiftWeek(currentWeekStart(), -1);
  const source = await getOrCreateWeek(previous);
  const row = await addRow(source.week.id, 'Matematik');
  const completed = await addTask({
    weekId: source.week.id,
    rowId: row.id,
    dayIndex: 1,
    type: 'free',
    title: 'Bitirilen görev',
  });
  await addTask({
    weekId: source.week.id,
    rowId: row.id,
    dayIndex: 2,
    type: 'free',
    title: 'Kaçırılan görev',
  });
  await toggleTask(completed.id, true);

  await openSchedule(`/program?week=${previous}`);

  await screen.findByText('Kaçırılan görev', { selector: '[data-line="title"]' });
  expect(taskChip('Kaçırılan görev')).toHaveAttribute('data-status', 'missed');
  expect(taskChip('Kaçırılan görev').className).toContain('bg-danger/10');
  expect(taskChip('Kaçırılan görev').className).toContain('text-danger');
  expect(taskChip('Bitirilen görev')).toHaveAttribute('data-status', 'done');
  expect(taskChip('Bitirilen görev').className).toContain('bg-success/10');
  expect(taskChip('Bitirilen görev').className).toContain('text-success');
});

test('görev çipi üç satırı kırar, eylemleri hover/focus ile açar ve dolu hücrede ekleme sunmaz', async () => {
  const { weekId, rowId } = await seedPlanRow();
  const shelfBook = await seedBilgiSarmalBook();
  await addTask({
    weekId,
    rowId,
    dayIndex: 1,
    type: 'book',
    userBookId: shelfBook.userBook.id,
    fromPage: 123,
    toPage: 128,
    title: 'Türev',
  });
  await openSchedule();

  const bookChipTitle = 'Bilgi Sarmal · TYT Matematik Soru Bankası';
  const titleLine = await screen.findByText(bookChipTitle, {
    selector: '[data-line="title"]',
  });
  // Yayınevi başta kalır; uzun başlık kısaltılsa da ilk satır yayıneviyle başlar.
  expect(titleLine).toHaveTextContent(/^Bilgi Sarmal · /);
  expect(titleLine).toHaveAttribute('title', bookChipTitle);
  expect(titleLine).toHaveClass('truncate', 'whitespace-nowrap');
  expect(titleLine.className).not.toContain('break-words');

  const subtitleLine = screen.getByText('Türev', {
    selector: '[data-line="subtitle"]',
  });
  expect(subtitleLine).toHaveAttribute('title', 'Türev');
  expect(subtitleLine).toHaveClass('truncate', 'whitespace-nowrap');

  const detailLine = screen.getByText('Syf. 123–128', {
    selector: '[data-line="detail"]',
  });
  expect(detailLine).toHaveAttribute('title', 'Syf. 123–128');
  expect(detailLine).toHaveClass('truncate', 'whitespace-nowrap');
  expect(taskChip(bookChipTitle).querySelector('.break-words')).toBeNull();

  const label = `${bookChipTitle} Syf. 123–128`;
  const editButton = screen.getByRole('button', {
    name: `${label} görevini düzenle`,
  });
  const deleteButton = screen.getByRole('button', {
    name: `${label} görevini sil`,
  });
  for (const button of [editButton, deleteButton]) {
    expect(button).toHaveClass('h-11', 'w-11');
  }
  expect(editButton.parentElement).toHaveClass(
    'opacity-0',
    'group-hover/cell:opacity-100',
    'group-focus-within/cell:opacity-100',
    'max-[767px]:opacity-100',
    'min-[768px]:absolute',
  );

  // Dolu hücrede ne büyük kesikli kutu ne de kompakt + vardır; hücre başına
  // tek görev kuralı yeni ikinci görev eklemeyi engeller.
  expect(
    screen.queryByRole('button', { name: 'Matematik Pazartesi görev ekle' }),
  ).not.toBeInTheDocument();
  const mondayCell = taskChip(bookChipTitle).closest('td');
  if (!(mondayCell instanceof HTMLElement)) {
    throw new Error('Pazartesi hücresi bulunamadı');
  }
  expect(mondayCell.querySelector('.border-dashed')).toBeNull();
  expect(mondayCell.querySelectorAll('[data-status]')).toHaveLength(1);
  expect(mondayCell.querySelectorAll('button[aria-label*="görev ekle"]')).toHaveLength(0);

  // Boş hücrede büyük kesikli + kalır ve yedi günün yalnızca altısında görünür.
  const emptyAdd = screen.getByRole('button', {
    name: 'Matematik Salı görev ekle',
  });
  expect(emptyAdd).toHaveClass('w-full', 'border-dashed');
  expect(
    screen.getAllByRole('button', { name: /Matematik .* görev ekle/ }),
  ).toHaveLength(6);
});

test('kitap görevine isteğe bağlı Konu eklenir ve çipte ikinci satır olur', async () => {
  await seedPlanRow();
  await seedBilgiSarmalBook();
  await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(
    screen.getByRole('button', { name: 'Matematik Cuma görev ekle' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await chooseShelfBook(dialog, 'bilgi sarmal', /Bilgi Sarmal/);
  await userEvent.type(within(dialog).getByLabelText('Konu'), 'Türev');
  await userEvent.type(
    within(dialog).getByLabelText('Başlangıç sayfası'),
    '10',
  );
  await userEvent.type(within(dialog).getByLabelText('Bitiş sayfası'), '20');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByText('Türev', { selector: '[data-line="subtitle"]' }),
  ).toBeInTheDocument();
  expect(
    screen.getByText('Syf. 10–20', { selector: '[data-line="detail"]' }),
  ).toBeInTheDocument();
  const stored = await db.scheduleTasks.toArray();
  expect(stored).toHaveLength(1);
  expect(stored[0].title).toBe('Türev');

  // Konu boş bırakılırsa satır etiketi ikinci satıra düşer.
  await userEvent.click(
    screen.getByRole('button', { name: 'Matematik Cumartesi görev ekle' }),
  );
  const secondDialog = await screen.findByRole('dialog', { name: 'Görev ekle' });
  await chooseShelfBook(secondDialog, 'bilgi sarmal', /Bilgi Sarmal/);
  await userEvent.type(
    within(secondDialog).getByLabelText('Başlangıç sayfası'),
    '21',
  );
  await userEvent.type(
    within(secondDialog).getByLabelText('Bitiş sayfası'),
    '30',
  );
  await userEvent.click(
    within(secondDialog).getByRole('button', { name: 'Kaydet' }),
  );

  const subtitles = await screen.findAllByText('Matematik', {
    selector: '[data-line="subtitle"]',
  });
  expect(subtitles).toHaveLength(1);
  expect(subtitles[0]).toHaveAttribute('title', 'Matematik');
});

test('sayfa zinciri paneli beş günü önizler ve oluşturur', async () => {
  const { weekStart } = await seedPlanRow(
    shiftWeek(currentWeekStart(), 1),
  );
  await seedBilgiSarmalBook();
  await openSchedule(`/program?week=${weekStart}`);

  await screen.findByLabelText('1. satır');
  await userEvent.click(screen.getByRole('button', { name: 'Sayfa zinciri' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Sayfa zinciri oluştur',
  });

  await userEvent.selectOptions(
    within(dialog).getByLabelText('Satır'),
    within(dialog).getByRole('option', { name: 'Matematik' }),
  );
  for (const day of ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']) {
    await userEvent.click(within(dialog).getByRole('checkbox', { name: day }));
  }

  await chooseShelfBook(dialog, 'bilgi sarmal', /Bilgi Sarmal/);
  await userEvent.type(
    within(dialog).getByLabelText('Başlangıç sayfası'),
    '100',
  );
  await userEvent.type(within(dialog).getByLabelText('Bitiş sayfası'), '150');

  expect(within(dialog).getByText('Pzt 100–109')).toBeInTheDocument();
  expect(within(dialog).getAllByText('10 sayfa')).toHaveLength(4);
  expect(within(dialog).getByText('11 sayfa')).toBeInTheDocument();
  expect(
    within(dialog).getByText('Toplam 51 sayfa · 5 gün'),
  ).toBeInTheDocument();
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Zinciri oluştur' }),
  );

  expect(await screen.findByText('Zincir oluşturuldu.')).toBeInTheDocument();
  await waitFor(async () => expect(await db.scheduleTasks.count()).toBe(5));
  expect(await db.schedulePageChains.count()).toBe(1);
  const chunks = (await db.scheduleTasks.toArray())
    .sort((left, right) => left.dayIndex - right.dayIndex)
    .map((task) => [task.fromPage, task.toPage]);
  expect(chunks).toEqual([
    [100, 109],
    [110, 119],
    [120, 129],
    [130, 139],
    [140, 150],
  ]);
  await waitFor(() => {
    expect(
      screen.queryByRole('dialog', { name: 'Sayfa zinciri oluştur' }),
    ).not.toBeInTheDocument();
  });
});

test('sayfa zinciri paneli boş rafta kitaplar sayfasına yönlendirir', async () => {
  await seedPlanRow();
  await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(screen.getByRole('button', { name: 'Sayfa zinciri' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Sayfa zinciri oluştur',
  });

  const booksLink = within(dialog).getByRole('link', { name: 'Kitaplar' });
  expect(booksLink).toHaveAttribute('href', '/kitaplar');
  expect(booksLink.closest('p')).toHaveTextContent(
    'Önce Kitaplar sayfasından rafına kitap ekle.',
  );
});

test('sayfa zinciri dolu günü kapatır ve geçersiz aralıkla oluşturmaz', async () => {
  const { weekId, rowId } = await seedPlanRow();
  await seedBilgiSarmalBook();
  await addTask({
    weekId,
    rowId,
    dayIndex: 1,
    type: 'free',
    title: 'Mevcut görev',
  });
  await openSchedule();

  await screen.findByLabelText('1. satır');
  await userEvent.click(screen.getByRole('button', { name: 'Sayfa zinciri' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Sayfa zinciri oluştur',
  });
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Satır'),
    within(dialog).getByRole('option', { name: 'Matematik' }),
  );

  // Pazartesi already holds a task; every other day stays selectable.
  const occupiedDay = within(dialog).getByRole('checkbox', {
    name: 'Pazartesi',
  });
  expect(occupiedDay).toBeDisabled();
  expect(occupiedDay).toHaveAccessibleDescription(
    'Dolu günler seçilemez: bu güne zaten bir görev eklenmiş.',
  );
  expect(within(dialog).getByText('dolu')).toBeInTheDocument();
  expect(
    within(dialog).getByRole('checkbox', { name: 'Salı' }),
  ).toBeEnabled();
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Salı' }));
  await userEvent.click(
    within(dialog).getByRole('checkbox', { name: 'Çarşamba' }),
  );

  await chooseShelfBook(dialog, 'bilgi sarmal', /Bilgi Sarmal/);
  await userEvent.type(
    within(dialog).getByLabelText('Başlangıç sayfası'),
    '50',
  );
  await userEvent.type(within(dialog).getByLabelText('Bitiş sayfası'), '100');
  const createButton = within(dialog).getByRole('button', {
    name: 'Zinciri oluştur',
  });
  expect(createButton).toBeEnabled();

  const toPage = within(dialog).getByLabelText('Bitiş sayfası');
  await userEvent.clear(toPage);
  await userEvent.type(toPage, '40');
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Başlangıç sayfası bitiş sayfasından büyük olamaz.',
  );
  expect(createButton).toBeDisabled();
  expect(within(dialog).queryByText(/^Pzt /)).not.toBeInTheDocument();
  expect(await db.schedulePageChains.count()).toBe(0);
});

test('zincir görevi rozet taşır, düzenleme ve silme zinciri çözeceğini söyler', async () => {
  const { weekStart, weekId, rowId } = await seedPlanRow(
    shiftWeek(currentWeekStart(), 1),
  );
  const shelfBook = await seedBilgiSarmalBook();
  await createPageChain({
    weekId,
    rowId,
    userBookId: shelfBook.userBook.id,
    startPage: 100,
    endPage: 150,
    days: [1, 2, 3, 4, 5],
  });
  await addTask({
    weekId,
    rowId,
    dayIndex: 6,
    type: 'free',
    title: 'Zincirsiz görev',
  });
  await openSchedule(`/program?week=${weekStart}`);

  const chipTitle = 'Bilgi Sarmal · TYT Matematik Soru Bankası';
  const titleLines = await screen.findAllByText(chipTitle, {
    selector: '[data-line="title"]',
  });
  expect(titleLines).toHaveLength(5);
  const mondayChip = titleLines[0].closest('[data-status]');
  if (!(mondayChip instanceof HTMLElement)) {
    throw new Error('Pazartesi zincir çipi bulunamadı');
  }
  // The parent aria-label overrides the sr-only badge, so chain membership is
  // part of the accessible name itself.
  expect(within(mondayChip).getByText('Sayfa zinciri')).toBeInTheDocument();
  const accessibleName = mondayChip.getAttribute('aria-label') ?? '';
  expect(accessibleName).toContain(`${chipTitle} Syf. 100–109`);
  expect(accessibleName).toContain('Sayfa zinciri');

  const normalChip = taskChip('Zincirsiz görev');
  expect(within(normalChip).queryByText('Sayfa zinciri')).not.toBeInTheDocument();
  expect(normalChip).toHaveAttribute('aria-label', 'Zincirsiz görev: Planlandı');

  await userEvent.click(
    within(mondayChip).getByRole('button', {
      name: `${chipTitle} Syf. 100–109 görevini düzenle`,
    }),
  );
  const editDialog = await screen.findByRole('dialog', { name: 'Görevi düzenle' });
  expect(editDialog).toHaveTextContent(
    'Bu görev bir sayfa zincirinin parçası. Düzenlersen zincir çözülür.',
  );
  await userEvent.click(
    within(editDialog).getByRole('button', { name: 'Vazgeç' }),
  );

  await userEvent.click(
    within(mondayChip).getByRole('button', {
      name: `${chipTitle} Syf. 100–109 görevini sil`,
    }),
  );
  const deleteDialog = await screen.findByRole('dialog', { name: 'Görevi sil' });
  expect(deleteDialog).toHaveTextContent(
    'Bu görev bir sayfa zincirinin parçası; silmek zinciri çözer.',
  );
  await userEvent.click(
    within(deleteDialog).getByRole('button', { name: 'Vazgeç' }),
  );
  await waitFor(() => {
    expect(
      screen.queryByRole('dialog', { name: 'Görevi sil' }),
    ).not.toBeInTheDocument();
  });
});

test('kaçırılan gün planlanmamış aralığı gösterir ve sonraki boş güne ekler', async () => {
  const { weekStart } = await seedChainWithFiveDays();
  await openSchedule(`/program?week=${weekStart}`);

  const chipTitle = 'Bilgi Sarmal · TYT Matematik Soru Bankası';
  await screen.findAllByText(chipTitle, { selector: '[data-line="title"]' });
  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));
  // user-event has no context-menu helper; the existing tick test uses
  // fireEvent for the right click as well.
  fireEvent.contextMenu(
    screen.getByRole('button', { name: /110–119.*Planlandı/ }),
  );

  expect(await screen.findByText('Planlanmamış sayfalar')).toBeInTheDocument();
  expect(screen.getByText('140–150')).toBeInTheDocument();
  const addButton = screen.getByRole('button', {
    name: 'Sonraki boş güne ekle',
  });
  expect(addButton).toHaveAccessibleDescription(/Matematik.*140–150/);
  await userEvent.click(addButton);

  await waitFor(async () => {
    const tasks = await db.scheduleTasks.toArray();
    expect(tasks.find((task) => task.dayIndex === 6)).toMatchObject({
      fromPage: 140,
      toPage: 150,
    });
  });
  await waitFor(() =>
    expect(screen.queryByText('Planlanmamış sayfalar')).not.toBeInTheDocument(),
  );
});

test('planlanmamış aralık Sil ile yok sayılır, görevler ve zincir kalır', async () => {
  const { weekStart, weekId } = await seedChainWithFiveDays();
  await openSchedule(`/program?week=${weekStart}`);

  const chipTitle = 'Bilgi Sarmal · TYT Matematik Soru Bankası';
  await screen.findAllByText(chipTitle, { selector: '[data-line="title"]' });
  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));
  fireEvent.contextMenu(
    screen.getByRole('button', { name: /110–119.*Planlandı/ }),
  );

  expect(await screen.findByText('Planlanmamış sayfalar')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Sil, yalnızca bu aralığı yok sayar; plandaki görevler silinmez.',
    ),
  ).toBeInTheDocument();
  const skipButton = screen.getByRole('button', {
    name: 'Matematik planlanmamış 140–150 aralığını sil',
  });
  expect(skipButton).toHaveAccessibleDescription(/Matematik.*140–150/);
  await userEvent.click(skipButton);

  await waitFor(() =>
    expect(screen.queryByText('Planlanmamış sayfalar')).not.toBeInTheDocument(),
  );
  await waitFor(async () => {
    const chains = await db.schedulePageChains
      .where('weekId')
      .equals(weekId)
      .toArray();
    expect(JSON.parse(chains[0].skippedChunks)).toEqual([4]);
    const tasks = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
    expect(tasks).toHaveLength(5);
    expect(tasks.find((task) => task.dayIndex === 5)).toMatchObject({
      fromPage: 130,
      toPage: 139,
    });
  });
  expect(await db.schedulePageChains.where('weekId').equals(weekId).count()).toBe(1);
});

test('Sil başarısız olursa hata gösterir ve aralık kalır', async () => {
  const { weekStart } = await seedChainWithFiveDays();
  await openSchedule(`/program?week=${weekStart}`);

  const chipTitle = 'Bilgi Sarmal · TYT Matematik Soru Bankası';
  await screen.findAllByText(chipTitle, { selector: '[data-line="title"]' });
  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));
  fireEvent.contextMenu(
    screen.getByRole('button', { name: /110–119.*Planlandı/ }),
  );

  expect(await screen.findByText('Planlanmamış sayfalar')).toBeInTheDocument();
  chainRepoMocks.skipUnscheduledChunk.mockRejectedValueOnce(
    new Error('Aralık silinemedi.'),
  );
  const skipButton = screen.getByRole('button', {
    name: 'Matematik planlanmamış 140–150 aralığını sil',
  });
  await userEvent.click(skipButton);

  expect(await screen.findByText('Aralık silinemedi.')).toBeInTheDocument();
  expect(screen.getByText('Planlanmamış sayfalar')).toBeInTheDocument();
  expect(skipButton).toBeEnabled();
});

test('boş gün kalmayınca planlanmamış aralık eklenemez', async () => {
  const { weekStart, weekId, rowId } = await seedChainWithFiveDays();
  await addTask({
    weekId,
    rowId,
    dayIndex: 6,
    type: 'free',
    title: 'Cumartesi görevi',
  });
  await addTask({
    weekId,
    rowId,
    dayIndex: 7,
    type: 'free',
    title: 'Pazar görevi',
  });
  await openSchedule(`/program?week=${weekStart}`);

  await screen.findByText('Cumartesi görevi', { selector: '[data-line="title"]' });
  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));
  fireEvent.contextMenu(
    screen.getByRole('button', { name: /110–119.*Planlandı/ }),
  );

  expect(await screen.findByText('Planlanmamış sayfalar')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Sonraki boş güne ekle' }),
  ).toBeDisabled();
  expect(screen.getByText('Bu haftada boş gün kalmadı.')).toBeInTheDocument();
});

test('plan açılışında zincirleri reconcile eder', async () => {
  const { weekStart, weekId } = await seedChainWithFiveDays();
  const second = (
    await db.scheduleTasks.where('weekId').equals(weekId).toArray()
  ).find((task) => task.dayIndex === 2)!;
  await db.scheduleTasks.update(second.id, {
    missedAt: new Date().toISOString(),
  });
  await openSchedule(`/program?week=${weekStart}`);

  await waitFor(async () => {
    const tasks = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
    expect(tasks.find((task) => task.dayIndex === 3)).toMatchObject({
      fromPage: 110,
      toPage: 119,
    });
  });
});

test('gün değişimi görünürlükte zinciri yeniden hesaplar', async () => {
  // Pazartesi akşamı açılan plan; gün dönünce Salı sabahı geri gelir.
  vi.setSystemTime(new Date(2026, 10, 23, 20));
  const { weekId } = await seedChainWithFiveDays(currentWeekStart());
  await openSchedule();

  const chipTitle = 'Bilgi Sarmal · TYT Matematik Soru Bankası';
  await screen.findAllByText(chipTitle, { selector: '[data-line="title"]' });
  // Pazartesi gecesi zincir henüz kaymadı.
  const mondayTasks = await db.scheduleTasks
    .where('weekId')
    .equals(weekId)
    .toArray();
  expect(mondayTasks.find((task) => task.dayIndex === 3)).toMatchObject({
    fromPage: 120,
    toPage: 129,
  });

  vi.setSystemTime(new Date(2026, 10, 24, 9));
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await waitFor(async () => {
    const tasks = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
    expect(tasks.find((task) => task.dayIndex === 3)).toMatchObject({
      fromPage: 110,
      toPage: 119,
    });
  });
});
