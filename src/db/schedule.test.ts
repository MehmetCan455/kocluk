import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import type { CurriculumSeed } from '@/db/repositories';
import {
  SCHEDULE_FILE_MAX_BYTES,
  addScheduleFile,
  deleteScheduleEntry,
  deleteScheduleFile,
  listScheduleEntries,
  listScheduleFiles,
  saveScheduleEntry,
} from '@/db/repositories';
import { compressImage } from '@/lib/image';
import { seedOnboarded } from '@/test/fixtures';

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

async function subjectId(): Promise<string> {
  const subject = await db.subjects.where('seedKey').equals('tyt-mat').first();
  if (!subject) {
    throw new Error('Test dersi bulunamadı');
  }
  return subject.id;
}

interface FakeSizeFile extends File {
  size: number;
}

function fileWithSize(name: string, type: string, size: number): FakeSizeFile {
  const file = new File(['x'], name, { type }) as FakeSizeFile;
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

test('program kaydı oluşturur, düzenler ve gün/saate göre sıralar', async () => {
  const mat = await subjectId();
  const friday = await saveScheduleEntry({
    day: 5,
    startTime: '09:00',
    endTime: '10:00',
    title: '  Fizik tekrarı  ',
    subjectId: mat,
    note: '  Deneme çöz  ',
  });
  expect(friday).toMatchObject({
    day: 5,
    startTime: '09:00',
    endTime: '10:00',
    title: 'Fizik tekrarı',
    subjectId: mat,
    note: 'Deneme çöz',
  });
  expect(friday.createdAt).toBeTruthy();
  expect(friday.updatedAt).toBe(friday.createdAt);

  const lateMonday = await saveScheduleEntry({
    day: 1,
    startTime: '11:30',
    endTime: '12:15',
    title: 'Geç ders',
  });
  const earlyMonday = await saveScheduleEntry({
    day: 1,
    startTime: '08:00',
    endTime: '09:00',
    title: 'Erken ders',
  });

  expect((await listScheduleEntries()).map((entry) => entry.id)).toEqual([
    earlyMonday.id,
    lateMonday.id,
    friday.id,
  ]);

  await db.scheduleEntries.update(earlyMonday.id, {
    updatedAt: '2000-01-01T00:00:00.000Z',
  });
  const updated = await saveScheduleEntry({
    id: earlyMonday.id,
    day: 1,
    startTime: '08:15',
    endTime: '09:30',
    title: 'Erken matematik',
    note: '',
  });

  expect(updated.id).toBe(earlyMonday.id);
  expect(updated.createdAt).toBe(earlyMonday.createdAt);
  expect(updated.updatedAt > '2000-01-01T00:00:00.000Z').toBe(true);
  expect(updated).toMatchObject({
    day: 1,
    startTime: '08:15',
    endTime: '09:30',
    title: 'Erken matematik',
  });
  expect(updated.subjectId).toBeUndefined();
  expect(updated.note).toBeUndefined();

  await expect(
    saveScheduleEntry({
      id: 'olmayan-kayit',
      day: 1,
      startTime: '08:00',
      endTime: '09:00',
      title: 'Yok',
    }),
  ).rejects.toThrow('Program kaydı bulunamadı');

  await deleteScheduleEntry(updated.id);
  expect(await db.scheduleEntries.get(updated.id)).toBeUndefined();
  expect(await db.scheduleEntries.count()).toBe(2);
});

test('program kaydı doğrulamaları Türkçe hata verir', async () => {
  const base = {
    day: 1,
    startTime: '09:00',
    endTime: '10:00',
    title: 'Matematik',
  };

  await expect(saveScheduleEntry({ ...base, title: '   ' })).rejects.toThrow(
    'Program başlığı boş olamaz',
  );
  await expect(saveScheduleEntry({ ...base, day: 0 })).rejects.toThrow(
    'Gün 1 ile 7 arasında olmalı',
  );
  await expect(saveScheduleEntry({ ...base, day: 8 })).rejects.toThrow(
    'Gün 1 ile 7 arasında olmalı',
  );
  await expect(saveScheduleEntry({ ...base, day: 1.5 })).rejects.toThrow(
    'Gün 1 ile 7 arasında olmalı',
  );
  await expect(saveScheduleEntry({ ...base, startTime: '8:00' })).rejects.toThrow(
    'Başlangıç saati SS:DD biçiminde olmalı',
  );
  await expect(saveScheduleEntry({ ...base, endTime: '24:00' })).rejects.toThrow(
    'Bitiş saati SS:DD biçiminde olmalı',
  );
  await expect(saveScheduleEntry({ ...base, endTime: '09:00' })).rejects.toThrow(
    'Bitiş saati başlangıçtan sonra olmalı',
  );
  await expect(saveScheduleEntry({ ...base, endTime: '08:59' })).rejects.toThrow(
    'Bitiş saati başlangıçtan sonra olmalı',
  );

  expect(await listScheduleEntries()).toHaveLength(0);
});

test('program PDF dosyasını olduğu gibi, görseli sıkıştırarak saklar', async () => {
  const pdfBytes = '%PDF-1.7 haftalık program';
  const pdf = await addScheduleFile(
    new File([pdfBytes], '  haftalik.pdf  ', { type: 'application/pdf' }),
  );

  const pdfSize = new Blob([pdfBytes]).size;
  expect(pdf).toMatchObject({
    name: 'haftalik.pdf',
    mime: 'application/pdf',
    size: pdfSize,
  });
  expect(pdf.blob.size).toBe(pdfSize);
  expect(compressImage).not.toHaveBeenCalled();

  const imageFile = new File(['png-içeriği'], 'program.png', { type: 'image/png' });
  const image = await addScheduleFile(imageFile);

  expect(compressImage).toHaveBeenCalledWith(imageFile, 2000, 0.85);
  expect(image).toMatchObject({
    name: 'program.png',
    mime: 'image/jpeg',
    size: new Blob(['sıkıştırılmış program']).size,
  });
  expect(image.blob.type).toBe('image/jpeg');

  await db.scheduleFiles.update(pdf.id, { createdAt: '2020-01-01T00:00:00.000Z' });
  expect((await listScheduleFiles()).map((file) => file.id)).toEqual([image.id, pdf.id]);

  await deleteScheduleFile(image.id);
  expect(await db.scheduleFiles.get(image.id)).toBeUndefined();
  expect(await listScheduleFiles()).toHaveLength(1);
});

test('program dosyası 20 MB sınırını ve dosya türünü uygular', async () => {
  const boundary = await addScheduleFile(
    fileWithSize('sinir.pdf', 'application/pdf', SCHEDULE_FILE_MAX_BYTES),
  );
  expect(boundary.size).toBe(SCHEDULE_FILE_MAX_BYTES);

  await expect(
    addScheduleFile(
      fileWithSize('büyük.pdf', 'application/pdf', SCHEDULE_FILE_MAX_BYTES + 1),
    ),
  ).rejects.toThrow('Dosya boyutu 20 MB sınırını aşıyor');

  await expect(
    addScheduleFile(new File(['x'], 'not.txt', { type: 'text/plain' })),
  ).rejects.toThrow('Yalnızca görsel veya PDF dosyası ekleyebilirsin');

  expect(await listScheduleFiles()).toHaveLength(1);
});
