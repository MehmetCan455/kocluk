import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  SCHEDULE_FILE_MAX_BYTES,
  listScheduleEntries,
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

async function openProgram(): Promise<void> {
  renderApp('/program');
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Haftalık Program' }),
  ).toBeInTheDocument();
}

interface FakeSizeFile extends File {
  size: number;
}

function fileWithSize(name: string, type: string, size: number): FakeSizeFile {
  const file = new File(['x'], name, { type }) as FakeSizeFile;
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

test('program kaydı ekler, düzenler ve siler', async () => {
  const subject = await db.subjects.where('seedKey').equals('tyt-mat').first();
  if (!subject) {
    throw new Error('Test dersi bulunamadı');
  }
  await openProgram();

  expect(screen.getAllByText('Kayıt yok')).toHaveLength(7);

  await userEvent.click(screen.getByRole('button', { name: 'Kayıt ekle' }));
  const createDialog = await screen.findByRole('dialog', { name: 'Yeni program kaydı' });

  await userEvent.selectOptions(within(createDialog).getByLabelText(/^Gün/), 'Pazartesi');
  fireEvent.change(within(createDialog).getByLabelText(/^Başlangıç saati/), {
    target: { value: '09:00' },
  });
  fireEvent.change(within(createDialog).getByLabelText(/^Bitiş saati/), {
    target: { value: '10:30' },
  });
  await userEvent.type(within(createDialog).getByLabelText(/^Başlık/), 'Matematik çalışması');
  await userEvent.selectOptions(
    within(createDialog).getByLabelText('Ders (isteğe bağlı)'),
    subject.id,
  );
  await userEvent.type(
    within(createDialog).getByLabelText('Not (isteğe bağlı)'),
    'Türev tekrarı',
  );
  await userEvent.click(within(createDialog).getByRole('button', { name: 'Kaydet' }));

  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  expect(await screen.findByText('Matematik çalışması')).toBeInTheDocument();
  expect(screen.getByText('09:00–10:30')).toBeInTheDocument();
  expect(screen.getByText('Matematik')).toBeInTheDocument();
  expect(screen.getByText('Türev tekrarı')).toBeInTheDocument();

  const stored = await listScheduleEntries();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    day: 1,
    startTime: '09:00',
    endTime: '10:30',
    title: 'Matematik çalışması',
    subjectId: subject.id,
    note: 'Türev tekrarı',
  });

  await userEvent.click(
    screen.getByRole('button', {
      name: /Matematik çalışması, Pazartesi 09:00 kaydını düzenle/,
    }),
  );
  const editDialog = await screen.findByRole('dialog', { name: 'Program kaydını düzenle' });
  const titleInput = within(editDialog).getByLabelText(/^Başlık/);
  expect(titleInput).toHaveValue('Matematik çalışması');

  await userEvent.clear(titleInput);
  await userEvent.type(titleInput, 'Matematik tekrarı');
  await userEvent.click(within(editDialog).getByRole('button', { name: 'Kaydet' }));

  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  expect(await screen.findByText('Matematik tekrarı')).toBeInTheDocument();
  expect(screen.queryByText('Matematik çalışması')).not.toBeInTheDocument();
  expect((await listScheduleEntries())[0]?.title).toBe('Matematik tekrarı');

  await userEvent.click(
    screen.getByRole('button', {
      name: /Matematik tekrarı, Pazartesi 09:00 kaydını sil/,
    }),
  );
  const deleteDialog = await screen.findByRole('dialog', { name: 'Program kaydını sil' });
  await userEvent.click(within(deleteDialog).getByRole('button', { name: 'Sil' }));

  await waitFor(() => {
    expect(screen.queryByText('Matematik tekrarı')).not.toBeInTheDocument();
  });
  expect(await listScheduleEntries()).toHaveLength(0);
});

test('program formu başlık ve saat doğrulaması gösterir', async () => {
  await openProgram();

  await userEvent.click(screen.getByRole('button', { name: 'Kayıt ekle' }));
  const dialog = await screen.findByRole('dialog', { name: 'Yeni program kaydı' });

  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
  expect(await within(dialog).findByText('Başlık boş olamaz')).toBeInTheDocument();

  await userEvent.type(within(dialog).getByLabelText(/^Başlık/), 'Fizik');
  fireEvent.change(within(dialog).getByLabelText(/^Bitiş saati/), {
    target: { value: '07:00' },
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(
    await within(dialog).findByText('Bitiş saati başlangıçtan sonra olmalı'),
  ).toBeInTheDocument();
  expect(await listScheduleEntries()).toHaveLength(0);
});

test('program görselini büyütür, PDF bağlantısını açar ve dosyaları siler', async () => {
  await openProgram();

  expect(screen.getByText('Henüz program dosyası yok')).toBeInTheDocument();

  const input = screen.getByLabelText('Program dosyası seç');
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
    name: 'Program dosyasını sil',
  });
  await userEvent.click(within(deleteDialog).getByRole('button', { name: 'Sil' }));

  await waitFor(() => {
    expect(screen.queryByText('program.pdf')).not.toBeInTheDocument();
  });
  expect(await listScheduleFiles()).toHaveLength(1);
});

test('20 MB üzerindeki program dosyasını yüklemez', async () => {
  await openProgram();

  await userEvent.upload(
    screen.getByLabelText('Program dosyası seç'),
    fileWithSize('büyük.pdf', 'application/pdf', SCHEDULE_FILE_MAX_BYTES + 1),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Dosya boyutu 20 MB sınırını aşıyor',
  );
  expect(await listScheduleFiles()).toHaveLength(0);
});
