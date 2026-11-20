import JSZip from 'jszip';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import type { BackupManifest, BackupProgress } from '@/db/backup';
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
  saveScheduleEntry,
  saveScheduleTable,
  upsertTopicBook,
  type CurriculumSeed,
} from '@/db/repositories';
import { createEmptyScheduleTable } from '@/domain/scheduleTable';
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
const SCHEDULE_IMAGE_BYTES = 'haftalık-program-görseli';
const SCHEDULE_PDF_BYTES = '%PDF-1.7 haftalık program';
const SCHEDULE_IMAGE_SIZE = new Blob([SCHEDULE_IMAGE_BYTES]).size;
const SCHEDULE_PDF_SIZE = new Blob([SCHEDULE_PDF_BYTES]).size;

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
  await seedOnboarded(seed, {
    profileName: 'Ada',
    // Keep the fixture's seed version current so the post-import curriculum
    // check does not add the full 22-subject curriculum to these fixtures.
    seedVersion: CURRICULUM.version,
  });
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

test('yinelenen seedKey mevcut veriyi değiştirmeden reddedilir', async () => {
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
    data.subjects = [subjects[0], { ...subjects[0], id: 'ikinci-ders' }];
  });

  await expect(importBackup(new File([invalid], 'cakisan.zip'))).rejects.toThrow(
    /Geçersiz yedek dosyası.*subjects\.seedKey/,
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

test('geçersiz profileName mevcut veriyi silmeden reddedilir', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });

  const invalid = await mutateZip(exported, async (_zip, data) => {
    const settings = data.settings as Array<{ key: string; value: unknown }>;
    settings.find((row) => row.key === 'profileName')!.value = 42;
  });

  await expect(importBackup(new File([invalid], 'bozuk.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.photos.count()).toBe(1);
});

test('geçersiz hiddenSubjects mevcut veriyi silmeden reddedilir', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });

  const invalid = await mutateZip(exported, async (_zip, data) => {
    const settings = data.settings as Array<{ key: string; value: unknown }>;
    settings.push({ key: 'hiddenSubjects', value: 42 });
  });

  await expect(importBackup(new File([invalid], 'bozuk.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.photos.count()).toBe(1);
});

test('geometryMode içermeyen eski yedek varsayılan ayrı ayarla yüklenir', async () => {
  await fullSeed();
  await patchSettings({ geometryMode: 'combined' });
  const exported = await exportBackup();

  const legacy = await mutateZip(exported, async (_zip, data) => {
    const settings = data.settings as Array<{ key: string; value: unknown }>;
    data.settings = settings.filter((row) => row.key !== 'geometryMode');
  });

  await importBackup(new File([legacy], 'eski-ayar.yedek.zip'));

  expect((await getSettings()).geometryMode).toBe('separate');
});

test('__proto__ ayar anahtarı mevcut veriyi silmeden reddedilir', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });

  const invalid = await mutateZip(exported, async (_zip, data) => {
    const settings = data.settings as Array<{ key: string; value: unknown }>;
    settings.push({ key: '__proto__', value: { polluted: true } });
  });

  await expect(importBackup(new File([invalid], 'bozuk.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.photos.count()).toBe(1);
});

test('yinelenen fotoğraf kimliği geri yüklemeden ve özetten önce reddedilir', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });

  const invalid = await mutateZip(exported, async (_zip, data) => {
    const photos = data.photos as Array<Record<string, unknown>>;
    data.photos = [photos[0], { ...photos[0], note: 'Kopya' }];
  });

  await expect(readBackupSummary(new File([invalid], 'ozet.zip'))).rejects.toThrow(
    /Geçersiz yedek dosyası.*photos\.id/,
  );
  await expect(importBackup(new File([invalid], 'cakisan.zip'))).rejects.toThrow(
    /Geçersiz yedek dosyası.*photos\.id/,
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.photos.count()).toBe(1);
});

test('yinelenen topicBook doğal anahtarı mevcut veriyi silmeden reddedilir', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });
  const before = await db.topicBooks.count();

  const invalid = await mutateZip(exported, async (_zip, data) => {
    const topicBooks = data.topicBooks as Array<Record<string, unknown>>;
    data.topicBooks = [topicBooks[0], { ...topicBooks[0], id: 'tb-kopya' }];
  });

  await expect(importBackup(new File([invalid], 'cakisan.zip'))).rejects.toThrow(
    /Geçersiz yedek dosyası.*topicBooks/,
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.topicBooks.count()).toBe(before);
});

test('yedek dışa aktarımı okuma, blob ve zip ilerlemesi bildirir', async () => {
  await fullSeed();
  const events: BackupProgress[] = [];

  await exportBackup((progress) => events.push(progress));

  expect(events[0]).toMatchObject({ phase: 'reading', percent: 0 });
  expect(events.some((event) => event.phase === 'blobs')).toBe(true);
  expect(events.some((event) => event.phase === 'zip')).toBe(true);
  expect(events.at(-1)).toMatchObject({ phase: 'zip', percent: 100 });
  const blobEvent = events.find((event) => event.phase === 'blobs');
  expect(blobEvent?.total).toBeGreaterThanOrEqual(3);
});

test('eksik fotoğraf blobu özet ve geri yüklemeden önce reddedilir', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });

  const broken = await mutateZip(exported, async (zip) => {
    zip.remove('fotograflar/yanlislar/foto-1.jpg');
  });

  await expect(readBackupSummary(new File([broken], 'eksik.zip'))).rejects.toThrow(
    /eksik dosya/,
  );
  await expect(importBackup(new File([broken], 'eksik.zip'))).rejects.toThrow(/eksik dosya/);
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.photos.count()).toBe(1);
});

test('geri yükleme bozuk net değerini yeniden hesaplar', async () => {
  await fullSeed();
  const exported = await exportBackup();
  const tampered = await mutateZip(exported, async (_zip, data) => {
    const results = data.examResults as Array<Record<string, unknown>>;
    results[0].net = 999;
  });

  await resetDb();
  await importBackup(new File([tampered], 'net.zip'));

  const results = await db.examResults.toArray();
  expect(results).toHaveLength(1);
  // 10 doğru - 2 yanlış / 4 = 9.5
  expect(results[0].net).toBe(9.5);
});

test('geçersiz deneme tarihi mevcut veriyi değiştirmeden reddedilir', async () => {
  await fullSeed();
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });

  const invalid = await mutateZip(exported, async (_zip, data) => {
    const exams = data.exams as Array<Record<string, unknown>>;
    exams[0].date = '2026-02-31';
  });

  await expect(importBackup(new File([invalid], 'tarih.zip'))).rejects.toThrow(
    /deneme tarihi geçersiz/,
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.exams.count()).toBe(1);
});

test('eski seed sürümlü yedekten sonra eksik müfredat tamamlanır', async () => {
  await seedOnboarded(seed, { profileName: 'Eski Yedek', seedVersion: 1 });
  const exported = await exportBackup();

  await resetDb();
  await importBackup(new File([exported], 'eski-mufredat.zip'));

  const settings = await getSettings();
  expect(settings.seedVersion).toBe(CURRICULUM.version);
  expect(await db.subjects.count()).toBeGreaterThanOrEqual(CURRICULUM.subjects.length);
  expect(
    await db.subjects.where('seedKey').equals('ayt-fizik').first(),
  ).toBeDefined();
  expect(await db.topics.count()).toBeGreaterThan(1);
});

test('tüm verileri silme ayarlar dahil tüm tabloları boşaltır', async () => {
  await fullSeed();
  await clearAllData();

  for (const table of db.tables) {
    expect(await table.count()).toBe(0);
  }
});

test('program kaydı, görsel ve PDF yedekten kayıpsız geri yüklenir', async () => {
  const seeded = await fullSeed();
  const entry = await saveScheduleEntry({
    day: 3,
    startTime: '14:00',
    endTime: '15:30',
    title: 'Geometri tekrarı',
    subjectId: seeded.subject.id,
    note: 'Üçgenler',
  });
  const tableSource = createEmptyScheduleTable();
  const table = await saveScheduleTable({
    rows: tableSource.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            subject: 'Matematik',
            days: ['2 saat', '40 soru', '', '', '', '', ''],
            total: '2 saat',
          }
        : row,
    ),
    totals: {
      ...tableSource.totals,
      days: ['10 saat', '', '', '', '', '', ''],
      total: '10 saat',
    },
    note: 'Haftanın notu',
  });
  await db.scheduleFiles.bulkAdd([
    {
      id: 'program-gorsel',
      name: 'program.png',
      mime: 'image/png',
      size: SCHEDULE_IMAGE_SIZE,
      blob: new Blob([SCHEDULE_IMAGE_BYTES], { type: 'image/png' }),
      createdAt: '2026-11-18T12:00:00.000Z',
    },
    {
      id: 'program-pdf',
      name: 'haftalik.pdf',
      mime: 'application/pdf',
      size: SCHEDULE_PDF_SIZE,
      blob: new Blob([SCHEDULE_PDF_BYTES], { type: 'application/pdf' }),
      createdAt: '2026-11-18T12:01:00.000Z',
    },
  ]);

  const exported = await exportBackup();
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(exported));
  const data = JSON.parse((await zip.file('veri.json')!.async('string')) as string) as Record<
    string,
    Array<Record<string, unknown>>
  >;

  expect(data.scheduleEntries).toHaveLength(1);
  expect(data.scheduleEntries[0]).toMatchObject({
    id: entry.id,
    day: 3,
    startTime: '14:00',
    endTime: '15:30',
    title: 'Geometri tekrarı',
    subjectId: seeded.subject.id,
    note: 'Üçgenler',
  });
  expect(data.scheduleFiles).toHaveLength(2);
  expect(data.scheduleFiles.find((file) => file.id === 'program-gorsel')).toMatchObject({
    filePath: 'program/program-gorsel.png',
  });
  expect(data.scheduleFiles.find((file) => file.id === 'program-pdf')).toMatchObject({
    filePath: 'program/program-pdf.pdf',
  });
  expect(data.scheduleFiles[0]).not.toHaveProperty('blob');
  expect(zip.file('program/program-gorsel.png')).not.toBeNull();
  expect(zip.file('program/program-pdf.pdf')).not.toBeNull();
  expect(data.scheduleTables).toHaveLength(1);
  expect(data.scheduleTables[0]).toMatchObject({
    id: 'main',
    totals: { label: 'TOPLAM SÜRE/SORU', total: '10 saat' },
    note: 'Haftanın notu',
  });
  const serializedRows = data.scheduleTables[0].rows as Array<Record<string, unknown>>;
  expect(serializedRows).toHaveLength(5);
  expect(serializedRows[0]).toMatchObject({
    subject: 'Matematik',
    days: ['2 saat', '40 soru', '', '', '', '', ''],
    total: '2 saat',
  });

  await resetDb();
  const imported = await importBackup(new File([exported], 'program.zip'));

  expect(imported.counts).toMatchObject({
    scheduleEntries: 1,
    scheduleFiles: 2,
    scheduleTables: 1,
  });
  expect(await db.scheduleEntries.count()).toBe(1);
  expect(await db.scheduleTables.get('main')).toEqual(table);
  expect(await db.scheduleEntries.get(entry.id)).toMatchObject({
    day: 3,
    startTime: '14:00',
    endTime: '15:30',
    title: 'Geometri tekrarı',
    subjectId: seeded.subject.id,
    note: 'Üçgenler',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  });

  const image = await db.scheduleFiles.get('program-gorsel');
  expect(image).toMatchObject({
    name: 'program.png',
    mime: 'image/png',
    size: SCHEDULE_IMAGE_SIZE,
  });
  expect(await blobToText(image!.blob)).toBe(SCHEDULE_IMAGE_BYTES);

  const pdf = await db.scheduleFiles.get('program-pdf');
  expect(pdf).toMatchObject({
    name: 'haftalik.pdf',
    mime: 'application/pdf',
    size: SCHEDULE_PDF_SIZE,
  });
  expect(await blobToText(pdf!.blob)).toBe(SCHEDULE_PDF_BYTES);
});

test('program tabloları ve elle çizelge olmayan eski yedek boş yüklenir', async () => {
  await fullSeed();
  const exported = await exportBackup();

  const old = await mutateZip(exported, async (_zip, data, manifest) => {
    delete data.scheduleEntries;
    delete data.scheduleFiles;
    delete data.scheduleTables;
    manifest.schemaVersion = 2;
    manifest.counts = {
      ...manifest.counts,
      scheduleEntries: 0,
      scheduleFiles: 0,
      scheduleTables: 0,
    };
  });

  await resetDb();
  const imported = await importBackup(new File([old], 'eski-program.zip'));

  expect(imported.counts).toMatchObject({
    scheduleEntries: 0,
    scheduleFiles: 0,
    scheduleTables: 0,
  });
  expect(await db.scheduleEntries.count()).toBe(0);
  expect(await db.scheduleFiles.count()).toBe(0);
  expect(await db.scheduleTables.count()).toBe(0);
  // The rest of the old archive still restores normally.
  expect(await db.photos.count()).toBe(1);
  expect(await db.attachments.count()).toBe(1);
  expect((await getSettings()).profileName).toBe('Ada');
});
