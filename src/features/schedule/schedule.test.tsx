import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  SCHEDULE_FILE_MAX_BYTES,
  getSettings,
  listScheduleFiles,
} from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import {
  addRow,
  getOrCreateWeek,
  getWeek,
} from '@/db/scheduleRepository';
import { SCHEDULE_DAYS } from '@/features/schedule/scheduleDays';
import { dayLabel, shiftWeek, weekLabel, weekStartOf } from '@/domain/schedule';
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
      topics: [],
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

async function switchToUpload(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Fotoğraf/PDF' }));
  expect(await screen.findByText('Henüz çizelge dosyası yok')).toBeInTheDocument();
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
  const sali = within(dayTabs).getByRole('button', { name: 'Sal Salı' });
  expect(sali).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(sali);
  expect(sali).toHaveAttribute('aria-pressed', 'true');

  expect(screen.getByLabelText('Haftanın notu')).toBeInTheDocument();
  expect(screen.getByText('Henüz kaydedilmedi')).toBeInTheDocument();
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
