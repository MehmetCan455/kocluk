import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  SCHEDULE_FILE_MAX_BYTES,
  getScheduleTable,
  getSettings,
  listScheduleFiles,
} from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
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

beforeEach(async () => {
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
  vi.mocked(compressImage).mockClear();
});

async function openSchedule() {
  const view = renderApp('/program');
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'Ders Çalışma Çizelgesi',
    }),
  ).toBeInTheDocument();
  return view;
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

test('elle tablo beş boş satırla açılır, satır eklenip silinir', async () => {
  await openSchedule();

  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  expect(within(table).getAllByLabelText(/^\d+\. satır ders$/)).toHaveLength(5);
  expect(within(table).getByLabelText('1. satır ders').tagName).toBe('TEXTAREA');
  expect(within(table).getByText('DERSLER / TARİH')).toBeInTheDocument();
  expect(within(table).getAllByText('TOPLAM SÜRE/SORU')).toHaveLength(2);
  expect(screen.getByLabelText('Haftanın notu')).toBeInTheDocument();
  expect(screen.getByText('Henüz kaydedilmedi')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Satır ekle' }));
  expect(within(table).getAllByLabelText(/^\d+\. satır ders$/)).toHaveLength(6);

  await userEvent.click(screen.getByRole('button', { name: '6. satırı sil' }));
  expect(within(table).getAllByLabelText(/^\d+\. satır ders$/)).toHaveLength(5);
});

test('elle tablo doldurulur, kaydedilir ve yeniden açınca korunur', async () => {
  const view = await openSchedule();
  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });

  await userEvent.type(within(table).getByLabelText('1. satır ders'), 'Matematik');
  await userEvent.type(within(table).getByLabelText('1. satır Pazartesi'), '2 saat');
  await userEvent.type(within(table).getByLabelText('1. satır Salı'), '40 soru');
  await userEvent.type(within(table).getByLabelText('1. satır toplam'), '2 saat');
  await userEvent.type(
    within(table).getByLabelText('Toplam satırı Pazartesi'),
    '10 saat',
  );
  await userEvent.type(within(table).getByLabelText('Genel toplam'), '10 saat');
  await userEvent.type(screen.getByLabelText('Haftanın notu'), 'Türev tekrarı');

  expect(await screen.findByText('Kaydedilmemiş değişiklikler')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(await screen.findByText('Kaydedildi')).toBeInTheDocument();

  const stored = await getScheduleTable();
  expect(stored?.id).toBe('main');
  expect(stored?.rows[0]).toMatchObject({
    subject: 'Matematik',
    days: ['2 saat', '40 soru', '', '', '', '', ''],
    total: '2 saat',
  });
  expect(stored?.totals).toMatchObject({
    label: 'TOPLAM SÜRE/SORU',
    days: ['10 saat', '', '', '', '', '', ''],
    total: '10 saat',
  });
  expect(stored?.note).toBe('Türev tekrarı');

  view.unmount();
  await openSchedule();
  const reloaded = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  expect(within(reloaded).getByLabelText('1. satır ders')).toHaveValue('Matematik');
  expect(within(reloaded).getByLabelText('1. satır Pazartesi')).toHaveValue('2 saat');
  expect(within(reloaded).getByLabelText('Genel toplam')).toHaveValue('10 saat');
  expect(screen.getByLabelText('Haftanın notu')).toHaveValue('Türev tekrarı');
  expect(screen.getByText('Kaydedildi')).toBeInTheDocument();
});

test('elle tablo kısa bir gecikmeyle otomatik kaydedilir', async () => {
  await openSchedule();
  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });

  await userEvent.type(within(table).getByLabelText('1. satır ders'), 'Fizik');
  expect(await screen.findByText('Kaydedildi', {}, { timeout: 3000 })).toBeInTheDocument();

  const stored = await getScheduleTable();
  expect(stored?.rows[0].subject).toBe('Fizik');
});

test('otomatik kaydetme başarısız olursa taslak korunur ve hata gösterilir', async () => {
  await openSchedule();
  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  const put = vi
    .spyOn(db.scheduleTables, 'put')
    .mockRejectedValueOnce(new Error('Disk dolu'));

  try {
    await userEvent.type(
      within(table).getByLabelText('1. satır ders'),
      'Biyoloji',
    );
    expect(
      await screen.findByText('Kaydedilmedi', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(within(table).getByLabelText('1. satır ders')).toHaveValue('Biyoloji');
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk dolu');
  } finally {
    put.mockRestore();
  }

  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(
    await screen.findByText('Kaydedildi', {}, { timeout: 3000 }),
  ).toBeInTheDocument();
  expect((await getScheduleTable())?.rows[0].subject).toBe('Biyoloji');
});

test('mod değişiminde kaydedilmemiş taslak korunur', async () => {
  await openSchedule();
  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });

  await userEvent.type(
    within(table).getByLabelText('1. satır ders'),
    'Geometri',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Fotoğraf/PDF' }));
  expect(await screen.findByText('Henüz çizelge dosyası yok')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Elle tablo' }));
  const returned = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  expect(within(returned).getByLabelText('1. satır ders')).toHaveValue('Geometri');
});

test('rotadan ayrılırken elle tablo taslağı boşaltılır', async () => {
  await openSchedule();
  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  await userEvent.type(within(table).getByLabelText('1. satır ders'), 'Kimya');

  await userEvent.click(screen.getByRole('link', { name: 'Ana Sayfa' }));
  await waitFor(
    async () => {
      expect((await getScheduleTable())?.rows[0].subject).toBe('Kimya');
    },
    { timeout: 3000 },
  );
});

test('mod seçimi kalıcıdır; yükleme ve elle tablo arasında geçilir', async () => {
  const view = await openSchedule();

  await switchToUpload();
  expect(
    screen.queryByRole('table', { name: 'Haftalık ders çalışma tablosu' }),
  ).not.toBeInTheDocument();
  expect((await getSettings()).scheduleMode).toBe('upload');

  view.unmount();
  await openSchedule();
  expect(await screen.findByText('Henüz çizelge dosyası yok')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Elle tablo' }));
  expect(
    await screen.findByRole('table', { name: 'Haftalık ders çalışma tablosu' }),
  ).toBeInTheDocument();
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

test('gün seçicisi seçili günü değiştirir', async () => {
  await openSchedule();

  const pazartesi = screen.getByRole('button', { name: 'Pzt Pazartesi' });
  const sali = screen.getByRole('button', { name: 'Sal Salı' });
  expect(pazartesi).toHaveAttribute('aria-pressed', 'true');
  expect(sali).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(sali);

  expect(sali).toHaveAttribute('aria-pressed', 'true');
  expect(pazartesi).toHaveAttribute('aria-pressed', 'false');
});

test('gün tiki hücreyi yeşile çevirir, geri alınır ve yeniden açınca korunur', async () => {
  const view = await openSchedule();
  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });

  expect(within(table).getAllByRole('checkbox')).toHaveLength(35);

  const tick = within(table).getByRole('checkbox', {
    name: '1. satır Pazartesi tamamlandı',
  });
  expect(tick).not.toBeChecked();
  expect(tick.closest('label')).toHaveClass('h-11', 'w-11');

  await userEvent.click(tick);

  expect(tick).toBeChecked();
  expect(tick.closest('td')).toHaveClass('bg-success/10');
  expect(within(table).getByLabelText('1. satır Pazartesi')).toHaveClass(
    'text-muted',
    'opacity-80',
  );

  await userEvent.click(tick);

  expect(tick).not.toBeChecked();
  expect(tick.closest('td')).not.toHaveClass('bg-success/10');
  expect(within(table).getByLabelText('1. satır Pazartesi')).not.toHaveClass(
    'text-muted',
  );
  expect(within(table).getByLabelText('1. satır Pazartesi')).not.toHaveClass(
    'opacity-80',
  );

  // Check it one more time so the persisted state can be verified after reload.
  await userEvent.click(tick);
  expect(tick).toBeChecked();
  expect(await screen.findByText('Kaydedilmemiş değişiklikler')).toBeInTheDocument();
  expect(
    await screen.findByText('Kaydedildi', {}, { timeout: 3000 }),
  ).toBeInTheDocument();

  view.unmount();
  await openSchedule();

  const reloaded = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  expect(
    within(reloaded).getByRole('checkbox', {
      name: '1. satır Pazartesi tamamlandı',
    }),
  ).toBeChecked();
  expect(within(reloaded).getByLabelText('1. satır Pazartesi')).toHaveClass(
    'text-muted',
    'opacity-80',
  );
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
