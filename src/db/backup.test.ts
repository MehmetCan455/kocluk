import JSZip from 'jszip';
import { beforeEach, expect, test } from 'vitest';
import type { BackupManifest } from '@/db/backup';
import {
  BACKUP_SCHEMA_VERSION,
  clearAllData,
  exportBackup,
  importBackup,
  readBackupSummary,
} from '@/db/backup';
import { db } from '@/db/db';
import { toPhotoSearch } from '@/db/photoSearch';
import {
  createBook,
  createPracticeSession,
  getSettings,
  patchSettings,
  saveExam,
  upsertTopicBook,
  type CurriculumSeed,
} from '@/db/repositories';
import { resetDb, seedOnboarded } from '@/test/fixtures';

const seed: CurriculumSeed = {
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

const PHOTO_BYTES = 'fotoğraf-baytları';
const THUMB_BYTES = 'küçük-fotoğraf-baytları';
const PDF_BYTES = '%PDF-1.7 yedek testi';

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Blob okunamadı'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Blob okunamadı'));
    reader.readAsArrayBuffer(blob);
  });
}

function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Blob okunamadı'));
    reader.readAsText(blob);
  });
}

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: 'application/json' });
}

function replaceJson(zip: JSZip, path: string, value: unknown): void {
  zip.file(path, jsonBlob(value));
}

async function zipBlob(zip: JSZip): Promise<Blob> {
  return zip.generateAsync({ type: 'blob' });
}

async function mutateZip(
  blob: Blob,
  mutate: (zip: JSZip, data: Record<string, unknown>, manifest: BackupManifest) => Promise<void>,
): Promise<Blob> {
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
  const data = JSON.parse((await zip.file('veri.json')!.async('string')) as string) as Record<
    string,
    unknown
  >;
  const manifest = JSON.parse(
    (await zip.file('manifest.json')!.async('string')) as string,
  ) as BackupManifest;
  await mutate(zip, data, manifest);
  replaceJson(zip, 'veri.json', data);
  replaceJson(zip, 'manifest.json', manifest);
  return zipBlob(zip);
}

async function fullSeed() {
  await seedOnboarded(seed, { profileName: 'Ada' });
  const subject = (await db.subjects.where('seedKey').equals('tyt-mat').first())!;
  const topic = (await db.topics.where('seedKey').equals('tyt-mat-turev').first())!;
  const book = await createBook({ name: 'Matematik Soru Bankası', publisher: 'Palme' });
  await upsertTopicBook({ topicId: topic.id, bookId: book.id, totalTests: 10, solvedTests: 4 });
  const exam = await saveExam({
    type: 'TYT',
    name: 'Deneme 1',
    date: '2026-11-18',
    note: 'İlk deneme',
    results: [{ subjectId: subject.id, correct: 10, wrong: 2, blank: 1 }],
  });

  await db.notes.put({
    topicId: topic.id,
    contentHtml:
      '<p>Güvenli <strong>not</strong></p><script>alert(1)</script><img src="x" onerror="alert(2)">',
    plainText: 'Güvenli not',
    updatedAt: '2026-11-18T10:00:00.000Z',
  });

  await db.attachments.add({
    id: 'ek-1',
    topicId: topic.id,
    name: 'çözümler.pdf',
    mime: 'application/pdf',
    size: PDF_BYTES.length,
    blob: new Blob([PDF_BYTES], { type: 'application/pdf' }),
    createdAt: '2026-11-18T10:01:00.000Z',
  });

  const photo = {
    id: 'foto-1',
    examId: exam.id,
    examType: 'TYT' as const,
    subjectId: subject.id,
    topicId: topic.id,
    note: 'Türev sorusu',
    blob: new Blob([PHOTO_BYTES], { type: 'image/jpeg' }),
    thumbBlob: new Blob([THUMB_BYTES], { type: 'image/jpeg' }),
    width: 1600,
    height: 900,
    mastered: true,
    practiceCount: 2,
    lastPracticedAt: '2026-11-18T11:00:00.000Z',
    createdAt: '2026-11-18T10:02:00.000Z',
  };
  await db.photos.add(photo);
  await db.photoSearch.put(toPhotoSearch(photo));
  await createPracticeSession({ filters: { examType: 'TYT' }, photoIds: [photo.id] });

  return { subject, topic, book, exam, photo };
}

beforeEach(async () => {
  await resetDb();
});

test('yedek tüm tabloları ve blob dosyalarını kayıpsız geri yükler', async () => {
  const seeded = await fullSeed();
  const exported = await exportBackup();

  expect(exported).toBeInstanceOf(Blob);
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(exported));
  const manifest = JSON.parse(
    (await zip.file('manifest.json')!.async('string')) as string,
  ) as BackupManifest;
  const data = JSON.parse((await zip.file('veri.json')!.async('string')) as string) as Record<
    string,
    Array<Record<string, unknown>>
  >;

  expect(manifest).toMatchObject({ app: 'kocluk', schemaVersion: BACKUP_SCHEMA_VERSION });
  expect(manifest.counts.photos).toBe(1);
  expect(manifest.counts.photoSearch).toBe(1);
  expect(data.photoSearch).toHaveLength(1);
  expect(data.settings).toEqual(expect.any(Array));
  expect(data.practiceSessions).toHaveLength(1);
  expect(data.photos[0]).toMatchObject({
    id: 'foto-1',
    blobPath: 'fotograflar/yanlislar/foto-1.jpg',
    thumbBlobPath: 'fotograflar/yanlislar/foto-1-thumb.jpg',
  });
  expect(data.photos[0]).not.toHaveProperty('blob');
  expect(data.photos[0]).not.toHaveProperty('thumbBlob');
  expect(data.attachments[0]).toMatchObject({ id: 'ek-1', blobPath: 'ekler/ek-1.pdf' });
  expect(data.attachments[0]).not.toHaveProperty('blob');

  expect(zip.file('fotograflar/yanlislar/foto-1.jpg')).not.toBeNull();
  expect(zip.file('fotograflar/yanlislar/foto-1-thumb.jpg')).not.toBeNull();
  expect(zip.file('ekler/ek-1.pdf')).not.toBeNull();
  expect((await getSettings()).lastBackupAt).toBe(manifest.exportedAt);

  await resetDb();
  const summary = await readBackupSummary(new File([exported], 'yedek.zip'));
  expect(summary.exportedAt).toBe(manifest.exportedAt);
  expect(summary.counts).toMatchObject({ exams: 1, photos: 1, notes: 1, practiceSessions: 1 });

  const imported = await importBackup(new File([exported], 'yedek.zip'));

  expect(imported.exportedAt).toBe(manifest.exportedAt);
  expect(imported.counts).toMatchObject({
    subjects: 1,
    topics: 1,
    books: 1,
    topicBooks: 1,
    exams: 1,
    examResults: 1,
    photos: 1,
    photoSearch: 1,
    notes: 1,
    attachments: 1,
    practiceSessions: 1,
  });
  expect(await db.subjects.count()).toBe(1);
  expect(await db.topics.count()).toBe(1);
  expect(await db.books.count()).toBe(1);
  expect(await db.topicBooks.count()).toBe(1);
  expect(await db.exams.count()).toBe(1);
  expect(await db.examResults.count()).toBe(1);
  expect(await db.photos.count()).toBe(1);
  expect(await db.photoSearch.count()).toBe(1);
  expect(await db.notes.count()).toBe(1);
  expect(await db.attachments.count()).toBe(1);
  expect(await db.practiceSessions.count()).toBe(1);
  expect((await getSettings()).profileName).toBe('Ada');

  const photo = await db.photos.get('foto-1');
  expect(photo).toMatchObject({
    examId: seeded.exam.id,
    subjectId: seeded.subject.id,
    topicId: seeded.topic.id,
    note: 'Türev sorusu',
    width: 1600,
    height: 900,
    mastered: true,
    practiceCount: 2,
  });
  expect(await blobToText(photo!.blob)).toBe(PHOTO_BYTES);
  expect(photo!.blob.type).toBe('image/jpeg');
  expect(await blobToText(photo!.thumbBlob)).toBe(THUMB_BYTES);

  const attachment = await db.attachments.get('ek-1');
  expect(attachment).toMatchObject({
    topicId: seeded.topic.id,
    name: 'çözümler.pdf',
    mime: 'application/pdf',
    size: PDF_BYTES.length,
  });
  expect(await blobToText(attachment!.blob)).toBe(PDF_BYTES);

  const note = await db.notes.get(seeded.topic.id);
  expect(note!.contentHtml).toContain('<strong>not</strong>');
  expect(note!.contentHtml).not.toContain('<script');
  expect(note!.contentHtml).not.toContain('onerror');
  expect(note!.plainText).toBe('Güvenli not');

  expect(await db.photoSearch.get('foto-1')).toEqual(
    toPhotoSearch((await db.photos.get('foto-1'))!),
  );
  expect((await getSettings()).lastBackupAt).toBeUndefined();
  expect(await db.settings.get('lastBackupAt')).toBeUndefined();
});

test('geçersiz manifest mevcut veriye dokunmadan reddedilir', async () => {
  await fullSeed();
  const exported = await exportBackup();

  await patchSettings({ profileName: 'Mevcut Kullanıcı' });
  const before = await db.photos.count();
  const malformed = await mutateZip(exported, async (_zip, _data, manifest) => {
    (manifest as { app: string }).app = 'baska-uygulama';
  });

  await expect(importBackup(new File([malformed], 'bozuk.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );
  expect((await getSettings()).profileName).toBe('Mevcut Kullanıcı');
  expect(await db.photos.count()).toBe(before);
});

test('yeni şema sürümü açık hata verir ve eski veriyi korur', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Mevcut Kullanıcı' });

  const newer = await mutateZip(exported, async (_zip, _data, manifest) => {
    manifest.schemaVersion = BACKUP_SCHEMA_VERSION + 1;
  });

  await expect(importBackup(new File([newer], 'yeni.zip'))).rejects.toThrow(/Daha yeni sürüm/);
  expect((await getSettings()).profileName).toBe('Mevcut Kullanıcı');
});

test('photoSearch içermeyen eski yedek fotoğraflardan projeksiyonu yeniden kurar', async () => {
  await fullSeed();
  const exported = await exportBackup();

  const old = await mutateZip(exported, async (_zip, data, manifest) => {
    delete data.photoSearch;
    manifest.schemaVersion = 1;
    manifest.counts = { ...manifest.counts, photoSearch: 0 };
  });

  await resetDb();
  await importBackup(new File([old], 'eski.zip'));

  expect(await db.photos.count()).toBe(1);
  expect(await db.photoSearch.count()).toBe(1);
  expect(await db.photoSearch.get('foto-1')).toEqual(
    toPhotoSearch((await db.photos.get('foto-1'))!),
  );
});

test('geri yükleme lastBackupAt satırını siler', async () => {
  await fullSeed();
  await patchSettings({ lastBackupAt: '2026-01-01T00:00:00.000Z' });
  const exported = await exportBackup();

  const zip = await JSZip.loadAsync(await blobToArrayBuffer(exported));
  const data = JSON.parse((await zip.file('veri.json')!.async('string')) as string) as {
    settings: Array<{ key: string; value: unknown }>;
  };
  expect(data.settings).toContainEqual({
    key: 'lastBackupAt',
    value: '2026-01-01T00:00:00.000Z',
  });

  await resetDb();
  await importBackup(new File([exported], 'yedek.zip'));

  expect(await db.settings.get('lastBackupAt')).toBeUndefined();
  expect((await getSettings()).lastBackupAt).toBeUndefined();
});

test('işlem sırasında oluşan hata eski veriyi geri getirir', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });
  const before = {
    subjects: await db.subjects.count(),
    photos: await db.photos.count(),
    notes: await db.notes.count(),
  };

  const invalid = await mutateZip(exported, async (_zip, data) => {
    const subjects = data.subjects as Array<Record<string, unknown>>;
    // A unique `seedKey` is enforced by IndexedDB; the bulk write fails after
    // the transaction has already cleared the current rows.
    data.subjects = [subjects[0], { ...subjects[0], id: 'ikinci-ders' }];
  });

  await expect(importBackup(new File([invalid], 'cakisan.zip'))).rejects.toThrow(
    'Mevcut veriler değiştirilmedi',
  );

  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.subjects.count()).toBe(before.subjects);
  expect(await db.photos.count()).toBe(before.photos);
  expect(await db.notes.count()).toBe(before.notes);
});

test('geçersiz veri dosyası mevcut veriyi silmez', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });

  const invalid = await mutateZip(exported, async (_zip, data) => {
    data.notes = 'dizi değil';
  });

  await expect(importBackup(new File([invalid], 'bozuk.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.photos.count()).toBe(1);
});

test('tüm verileri silme ayarlar dahil tüm tabloları boşaltır', async () => {
  await fullSeed();
  await clearAllData();

  for (const table of db.tables) {
    expect(await table.count()).toBe(0);
  }
});
