import JSZip from 'jszip';
import { beforeEach, expect, test } from 'vitest';
import { CATALOG_SEED, catalogBookId } from '@/data/catalogBooks';
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
import { addCatalogBookToShelf, getShelfBook, setBookPage } from '@/db/bookRepositories';
import { toPhotoSearch } from '@/db/photoSearch';
import {
  createBook,
  createPracticeSession,
  getExam,
  getScheduleTable,
  getSettings,
  listExamResults,
  patchSettings,
  saveExam,
  saveScheduleEntry,
  saveScheduleTable,
  upsertTopicBook,
  type CurriculumSeed,
} from '@/db/repositories';
import { addRow, addTask, getOrCreateWeek } from '@/db/scheduleRepository';
import { getTopicDone, setTopicDone } from '@/db/topicProgressRepository';
import { createEmptyScheduleTable } from '@/domain/scheduleTable';
import { deterministicId } from '@/lib/deterministicId';
import {
  CATALOG_NAMESPACE,
  LOCAL_SCOPE,
  TOPIC_PROGRESS_NAMESPACE,
  USER_BOOK_NAMESPACE,
} from '@/lib/namespaces';
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

/** Two subjects so the legacy conversion can exercise the "Genel" tie. */
const legacySeed: CurriculumSeed = {
  version: 1,
  subjects: [
    {
      seedKey: 'tyt-mat',
      exam: 'TYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [
        { seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 },
        { seedKey: 'tyt-mat-limit', name: 'Limit', order: 2 },
      ],
    },
    {
      seedKey: 'tyt-fiz',
      exam: 'TYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 2,
      topics: [{ seedKey: 'tyt-fiz-hareket', name: 'Hareket', order: 1 }],
    },
  ],
};

async function topicBySeedKey(seedKey: string) {
  const topic = await db.topics.where('seedKey').equals(seedKey).first();
  expect(topic).toBeDefined();
  return topic!;
}

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

const V6_TABLE_KEYS = [
  'catalogBooks',
  'userBooks',
  'activityLogs',
  'scheduleWeeks',
  'scheduleRows',
  'scheduleTasks',
  'topicProgress',
] as const;

/** Turns a current archive into a v5 archive: no v6 tables, schema version 5. */
async function asV5Archive(blob: Blob): Promise<Blob> {
  return mutateZip(blob, async (_zip, data, manifest) => {
    for (const key of V6_TABLE_KEYS) {
      delete data[key];
      manifest.counts[key] = 0;
    }
    manifest.schemaVersion = 5;
  });
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
  // The manifest version is part of the archive contract; pin the literal too.
  expect(manifest.schemaVersion).toBe(6);
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
            done: [true, false, false, false, false, false, true],
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
    done: [true, false, false, false, false, false, true],
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

test('done içermeyen eski çizelge yedeği yedi false ile yüklenir', async () => {
  await fullSeed();
  const source = createEmptyScheduleTable();
  await saveScheduleTable({
    rows: source.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            subject: 'Geometri',
            days: ['1 saat', '20 soru', '', '', '', '', ''],
            done: [true, true, false, false, false, false, false],
            total: '1 saat',
          }
        : row,
    ),
    totals: {
      ...source.totals,
      days: ['1 saat', '', '', '', '', '', ''],
      total: '1 saat',
    },
    note: 'Eski yedek',
  });

  const exported = await exportBackup();
  const legacy = await mutateZip(exported, async (_zip, data) => {
    const tables = data.scheduleTables as Array<{
      rows: Array<Record<string, unknown>>;
    }>;
    // Guard the mutation: the current archive must carry the ticks we strip.
    expect(tables[0].rows[0].done).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    for (const row of tables[0].rows) {
      delete row.done;
    }
  });

  await resetDb();
  await importBackup(new File([legacy], 'eski-tikler.zip'));

  const allFalse = [false, false, false, false, false, false, false];
  // The import itself must materialize the missing tuple, not only the read path.
  const stored = await db.scheduleTables.get('main');
  expect(stored?.rows).toHaveLength(5);
  expect(stored?.rows.map((row) => row.done)).toEqual(
    Array.from({ length: 5 }, () => allFalse),
  );

  const loaded = await getScheduleTable();
  expect(loaded?.rows).toHaveLength(5);
  expect(loaded?.rows.map((row) => row.done)).toEqual(
    Array.from({ length: 5 }, () => allFalse),
  );
  expect(loaded?.rows[0]).toMatchObject({
    subject: 'Geometri',
    days: ['1 saat', '20 soru', '', '', '', '', ''],
    total: '1 saat',
  });
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

test('branş denemesi tek sonuç satırıyla yedekten geri yüklenir', async () => {
  await fullSeed();
  const branchExam = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'TYT Sosyal 1',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });

  const exported = await exportBackup();
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(exported));
  const manifest = JSON.parse(
    (await zip.file('manifest.json')!.async('string')) as string,
  ) as BackupManifest;
  const data = JSON.parse((await zip.file('veri.json')!.async('string')) as string) as Record<
    string,
    Array<Record<string, unknown>>
  >;

  expect(manifest.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
  expect(data.exams).toHaveLength(2);
  expect(data.exams.find((exam) => exam.id === branchExam.id)).toMatchObject({
    kind: 'branch',
    branch: 'tyt-sosyal',
    type: 'TYT',
  });

  await resetDb();
  const imported = await importBackup(new File([exported], 'brans.zip'));

  expect(imported.counts).toMatchObject({ exams: 2, examResults: 2 });
  expect(await getExam(branchExam.id)).toMatchObject({
    kind: 'branch',
    branch: 'tyt-sosyal',
    type: 'TYT',
    name: 'TYT Sosyal 1',
    date: '2026-11-20',
  });
  const results = await listExamResults(branchExam.id);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    subjectId: 'tyt-sosyal',
    correct: 15,
    wrong: 3,
    blank: 2,
  });
  expect(results[0].net).toBeCloseTo(14.25);
});

test('kind ve branch içermeyen v4 yedeği tam deneme olarak yükler', async () => {
  const seeded = await fullSeed();
  const exported = await exportBackup();

  const legacy = await mutateZip(exported, async (_zip, data, manifest) => {
    const exams = data.exams as Array<Record<string, unknown>>;
    // Guard the mutation: the current archive must carry the fields we strip.
    expect(exams.find((exam) => exam.id === seeded.exam.id)).toMatchObject({
      kind: 'full',
    });
    for (const exam of exams) {
      delete exam.kind;
      delete exam.branch;
    }
    manifest.schemaVersion = 4;
  });

  await resetDb();
  await importBackup(new File([legacy], 'v4-brans.zip'));

  const restored = await getExam(seeded.exam.id);
  expect(restored).toMatchObject({ name: 'Deneme 1', type: 'TYT' });
  // The schema default materializes `kind`; no branch may leak in.
  expect(restored?.kind).toBe('full');
  expect(restored?.branch).toBeUndefined();
  expect(await listExamResults(seeded.exam.id)).toHaveLength(1);
});

test('geçersiz branş bilgisi mevcut veriyi değiştirmeden reddedilir', async () => {
  await fullSeed();
  await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'TYT Sosyal 1',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });
  const exported = await exportBackup();
  await patchSettings({ profileName: 'Korunacak Profil' });

  const unknownBranch = await mutateZip(exported, async (_zip, data) => {
    const exams = data.exams as Array<Record<string, unknown>>;
    const branchExam = exams.find((exam) => exam.kind === 'branch');
    expect(branchExam).toBeDefined();
    branchExam!.branch = 'tyt-uzay';
  });
  await expect(importBackup(new File([unknownBranch], 'bilinmeyen-brans.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );

  const fullWithBranch = await mutateZip(exported, async (_zip, data) => {
    const exams = data.exams as Array<Record<string, unknown>>;
    const fullExam = exams.find((exam) => exam.kind === 'full');
    expect(fullExam).toBeDefined();
    fullExam!.branch = 'tyt-sosyal';
  });
  await expect(importBackup(new File([fullWithBranch], 'tam-bransli.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );

  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.exams.count()).toBe(2);
  expect(await db.examResults.count()).toBe(2);
});

async function seedBranchExam() {
  await fullSeed();
  const branchExam = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'TYT Sosyal 1',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });
  return { exported: await exportBackup(), branchExam };
}

test('branş denemesindeki ikinci sonuç satırı mevcut veriyi koruyarak reddedilir', async () => {
  const { exported, branchExam } = await seedBranchExam();
  await patchSettings({ profileName: 'Korunacak Profil' });
  const before = {
    exams: await db.exams.count(),
    results: await db.examResults.count(),
  };

  const invalid = await mutateZip(exported, async (_zip, data) => {
    const results = data.examResults as Array<Record<string, unknown>>;
    const row = results.find((result) => result.examId === branchExam.id);
    expect(row).toBeDefined();
    // A different subjectId keeps this past the unique (examId, subjectId)
    // check so the branch row-count rule is what rejects the archive.
    results.push({ ...row!, id: 'brans-ikinci-satir', subjectId: 'tyt-fen' });
  });

  await expect(readBackupSummary(new File([invalid], 'brans-ozet.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );
  await expect(importBackup(new File([invalid], 'brans-iki-satir.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.exams.count()).toBe(before.exams);
  expect(await db.examResults.count()).toBe(before.results);
});

test('branş sonucu farklı derse aitse yedek reddedilir', async () => {
  const { exported, branchExam } = await seedBranchExam();
  await patchSettings({ profileName: 'Korunacak Profil' });
  const before = await db.examResults.count();

  const invalid = await mutateZip(exported, async (_zip, data) => {
    const results = data.examResults as Array<Record<string, unknown>>;
    const row = results.find((result) => result.examId === branchExam.id);
    expect(row).toBeDefined();
    row!.subjectId = 'tyt-fen';
  });

  await expect(importBackup(new File([invalid], 'yanlis-brans-dersi.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.examResults.count()).toBe(before);
});

test('branş soru sayısını aşan sonuç yedeği reddedilir', async () => {
  const { exported, branchExam } = await seedBranchExam();
  await patchSettings({ profileName: 'Korunacak Profil' });
  const before = await db.examResults.count();

  // tyt-sosyal has 20 questions; 18 + 3 + 0 is an impossible total.
  const invalid = await mutateZip(exported, async (_zip, data) => {
    const results = data.examResults as Array<Record<string, unknown>>;
    const row = results.find((result) => result.examId === branchExam.id);
    expect(row).toBeDefined();
    row!.correct = 18;
    row!.wrong = 3;
    row!.blank = 0;
  });

  await expect(importBackup(new File([invalid], 'asiri-soru.zip'))).rejects.toThrow(
    'Geçersiz yedek dosyası',
  );
  expect((await getSettings()).profileName).toBe('Korunacak Profil');
  expect(await db.examResults.count()).toBe(before);
});

test('AYT branş denemesi alanı ve sonucuyla yedekten geri yüklenir', async () => {
  await fullSeed();
  const branchExam = await saveExam({
    kind: 'branch',
    type: 'AYT',
    alan: 'sayisal',
    branch: 'ayt-sayisal-fen',
    name: 'AYT Fen 3',
    date: '2026-11-21',
    results: [{ subjectId: 'ayt-sayisal-fen', correct: 30, wrong: 6, blank: 4 }],
  });

  const exported = await exportBackup();
  await resetDb();
  const imported = await importBackup(new File([exported], 'ayt-brans.zip'));

  expect(imported.counts).toMatchObject({ exams: 2, examResults: 2 });
  expect(await getExam(branchExam.id)).toMatchObject({
    kind: 'branch',
    type: 'AYT',
    alan: 'sayisal',
    branch: 'ayt-sayisal-fen',
    name: 'AYT Fen 3',
    date: '2026-11-21',
  });
  const results = await listExamResults(branchExam.id);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    subjectId: 'ayt-sayisal-fen',
    correct: 30,
    wrong: 6,
    blank: 4,
  });
  expect(results[0].net).toBeCloseTo(28.5);
});

test('kitap, sayfa kaydı ve haftalık plan v6 yedeğinden kayıpsız geri yüklenir', async () => {
  const seeded = await fullSeed();
  const createdAt = '2026-11-01T09:00:00.000Z';
  await db.catalogBooks.add({
    id: 'katalog-test-1',
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2026',
    createdAt,
    updatedAt: createdAt,
  });
  const userBook = await addCatalogBookToShelf('katalog-test-1');
  await setBookPage(userBook.id, 40);
  const { week } = await getOrCreateWeek('2026-11-16');
  const row = await addRow(week.id, 'Matematik', seeded.subject.id);
  const task = await addTask({
    weekId: week.id,
    rowId: row.id,
    dayIndex: 2,
    type: 'book',
    userBookId: userBook.id,
    fromPage: 41,
    toPage: 60,
  });
  await setTopicDone(seeded.topic.id, true);

  const storedUserBook = (await db.userBooks.get(userBook.id))!;
  const storedLog = (
    await db.activityLogs.where('userBookId').equals(userBook.id).first()
  )!;
  const storedWeek = (await db.scheduleWeeks.get(week.id))!;
  const storedRow = (await db.scheduleRows.get(row.id))!;
  const storedTask = (await db.scheduleTasks.get(task.id))!;
  const storedProgress = (
    await db.topicProgress.where('topicId').equals(seeded.topic.id).first()
  )!;

  const exported = await exportBackup();
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(exported));
  const manifest = JSON.parse(
    (await zip.file('manifest.json')!.async('string')) as string,
  ) as BackupManifest;
  const data = JSON.parse((await zip.file('veri.json')!.async('string')) as string) as Record<
    string,
    Array<Record<string, unknown>>
  >;

  expect(manifest.schemaVersion).toBe(6);
  expect(manifest.counts).toMatchObject({
    catalogBooks: 1,
    userBooks: 1,
    activityLogs: 1,
    scheduleWeeks: 1,
    scheduleRows: 1,
    scheduleTasks: 1,
    topicProgress: 1,
  });
  expect(data.catalogBooks).toHaveLength(1);
  expect(data.userBooks).toHaveLength(1);
  expect(data.activityLogs).toHaveLength(1);
  expect(data.scheduleWeeks).toHaveLength(1);
  expect(data.scheduleRows).toHaveLength(1);
  expect(data.scheduleTasks).toHaveLength(1);
  expect(data.topicProgress).toHaveLength(1);
  expect(data.activityLogs[0]).toMatchObject({
    id: storedLog.id,
    type: 'page_set',
    userBookId: userBook.id,
    toPage: 40,
  });
  expect(data.scheduleTasks[0]).toMatchObject({
    id: task.id,
    type: 'book',
    dayIndex: 2,
    fromPage: 41,
    toPage: 60,
  });
  // These tables do not exist yet; the archive must not claim them.
  expect(manifest.counts).not.toHaveProperty('syncQueue');
  expect(manifest.counts).not.toHaveProperty('syncMeta');

  await resetDb();
  const imported = await importBackup(new File([exported], 'v6-kitaplar.zip'));

  expect(imported.counts).toMatchObject({
    catalogBooks: 1,
    userBooks: 1,
    activityLogs: 1,
    scheduleWeeks: 1,
    scheduleRows: 1,
    scheduleTasks: 1,
    topicProgress: 1,
  });
  // The import seeds missing catalog rows next to the restored custom row.
  expect(await db.catalogBooks.count()).toBe(CATALOG_SEED.length + 1);
  expect(await db.catalogBooks.get('katalog-test-1')).toMatchObject({
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 400,
    edition: '2026',
  });
  expect(await db.userBooks.get(userBook.id)).toEqual(storedUserBook);
  expect(await db.activityLogs.get(storedLog.id)).toEqual(storedLog);
  expect(await db.scheduleWeeks.get(week.id)).toEqual(storedWeek);
  expect(await db.scheduleRows.get(row.id)).toEqual(storedRow);
  expect(await db.scheduleTasks.get(task.id)).toEqual(storedTask);
  expect(await db.topicProgress.get(storedProgress.id)).toEqual(storedProgress);
  expect((await getShelfBook(userBook.id))?.progress.currentPage).toBe(40);
  expect(await getTopicDone(seeded.topic.id)).toBe(true);
});

test('içe aktarma eksik katalog tohumunu ekler ve düzenlenen satırı ezmez', async () => {
  await fullSeed();
  const [firstSeed] = CATALOG_SEED;
  const seededId = catalogBookId(firstSeed.title, firstSeed.publisher, firstSeed.edition);
  await db.catalogBooks.add({
    id: seededId,
    title: 'Kullanıcının Düzenlediği Kitap',
    totalPages: 123,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-02T09:00:00.000Z',
  });

  const exported = await exportBackup();
  await resetDb();
  await importBackup(new File([exported], 'katalog.zip'));

  expect(await db.catalogBooks.count()).toBe(CATALOG_SEED.length);
  expect(await db.catalogBooks.get(seededId)).toMatchObject({
    title: 'Kullanıcının Düzenlediği Kitap',
    totalPages: 123,
  });
});

test('v6 tabloları içermeyen v5 yedeği legacy kitabı rafa taşıyarak yüklenir', async () => {
  const seeded = await fullSeed();
  const legacy = await asV5Archive(await exportBackup());

  await resetDb();
  const imported = await importBackup(new File([legacy], 'v5.zip'));

  // Sayaçlar arşivdeki tabloları yansıtır; dönüşüm satırları arşivde yoktur.
  expect(imported.counts).toMatchObject({
    catalogBooks: 0,
    userBooks: 0,
    activityLogs: 0,
    scheduleWeeks: 0,
    scheduleRows: 0,
    scheduleTasks: 0,
    topicProgress: 0,
  });
  // Eski kitap rafa taşınır; kısmi test kaydı konuyu tamamlamış saymaz.
  expect(await db.userBooks.count()).toBe(1);
  expect(await db.topicProgress.count()).toBe(0);
  expect(await db.activityLogs.count()).toBe(0);
  expect(await db.scheduleWeeks.count()).toBe(0);
  expect(await db.scheduleRows.count()).toBe(0);
  expect(await db.scheduleTasks.count()).toBe(0);
  // Katalog tohumu ve türetilen özel kitap birlikte bulunur.
  expect(await db.catalogBooks.count()).toBe(CATALOG_SEED.length + 1);
  expect(await db.books.get(seeded.book.id)).toBeDefined();
  expect(await db.photos.count()).toBe(1);
});

test('v5 yedeği eski kitabı rafa taşır, notu ve tamamlanan konuyu aktarır', async () => {
  await seedOnboarded(legacySeed, { seedVersion: CURRICULUM.version });
  const turev = await topicBySeedKey('tyt-mat-turev');
  const hareket = await topicBySeedKey('tyt-fiz-hareket');
  const book = await createBook({ name: 'Eski Kitap', publisher: 'Eski Yayın' });
  await db.books.update(book.id, { note: 'Eski kitap notu' });
  await upsertTopicBook({ topicId: turev.id, bookId: book.id, totalTests: 10, solvedTests: 10 });
  await upsertTopicBook({ topicId: hareket.id, bookId: book.id, totalTests: 8, solvedTests: 3 });

  const legacy = await asV5Archive(await exportBackup());
  await resetDb();
  await importBackup(new File([legacy], 'v5-eski-kitap.zip'));

  const userBooks = await db.userBooks.toArray();
  expect(userBooks).toHaveLength(1);
  const userBook = userBooks[0];
  expect(userBook).toMatchObject({ status: 'active', note: 'Eski kitap notu' });
  expect(userBook.id).toBe(
    deterministicId(USER_BOOK_NAMESPACE, `${LOCAL_SCOPE}:${userBook.bookId}`),
  );

  const catalogBook = await db.catalogBooks.get(userBook.bookId);
  expect(catalogBook).toMatchObject({
    id: deterministicId(CATALOG_NAMESPACE, `${LOCAL_SCOPE}:legacy:${book.id}`),
    ownerId: LOCAL_SCOPE,
    title: 'Eski Kitap',
    publisher: 'Eski Yayın',
    totalPages: 0,
  });
  // Konular iki derse dağıldığı için ders/sınav boş ("Genel") kalır.
  expect(catalogBook?.subjectSlug).toBeUndefined();
  expect(catalogBook?.exam).toBeUndefined();

  expect(await getTopicDone(turev.id)).toBe(true);
  expect(await getTopicDone(hareket.id)).toBe(false);
  expect(await db.topicProgress.count()).toBe(1);
  expect(
    await db.topicProgress.get(
      deterministicId(TOPIC_PROGRESS_NAMESPACE, `${LOCAL_SCOPE}:${turev.id}`),
    ),
  ).toMatchObject({ topicId: turev.id, done: true });

  // Legacy tablolar arşiv olarak korunur.
  expect(await db.books.get(book.id)).toMatchObject({
    name: 'Eski Kitap',
    note: 'Eski kitap notu',
  });
  expect(await db.topicBooks.count()).toBe(2);
});

test('v5 yedeğinde eşleşen eski kitaplar tek katalog kitabında birleşir', async () => {
  await seedOnboarded(seed, { seedVersion: CURRICULUM.version });
  const topic = await topicBySeedKey('tyt-mat-turev');
  const first = await createBook({ name: 'TYT Matematik Soru Bankası', publisher: 'Bilgi Sarmal' });
  const second = await createBook({
    name: 'tyt matematik soru bankası',
    publisher: 'BİLGİ SARMAL',
  });
  await db.books.update(first.id, { note: 'İlk kitabın notu' });
  await db.books.update(second.id, { note: 'İkinci kitabın notu' });
  await upsertTopicBook({ topicId: topic.id, bookId: first.id, totalTests: 12, solvedTests: 12 });
  await upsertTopicBook({ topicId: topic.id, bookId: second.id, totalTests: 6, solvedTests: 6 });

  const legacy = await asV5Archive(await exportBackup());
  await resetDb();
  await importBackup(new File([legacy], 'v5-katalog.zip'));

  const seedRow = CATALOG_SEED[0];
  const catalogId = catalogBookId(seedRow.title, seedRow.publisher, seedRow.edition);
  const userBooks = await db.userBooks.toArray();
  expect(userBooks).toHaveLength(1);
  const ordered = [first, second].sort((left, right) => left.id.localeCompare(right.id));
  const expectedNote =
    ordered[0].id === first.id ? 'İlk kitabın notu' : 'İkinci kitabın notu';
  expect(userBooks[0]).toMatchObject({
    bookId: catalogId,
    note: expectedNote,
    status: 'active',
  });
  expect(await db.catalogBooks.get(catalogId)).toMatchObject({
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    totalPages: 400,
    edition: '2025',
  });
  // Birleştirme eski kitap ve test kayıtlarını silmez.
  expect(await db.books.count()).toBe(2);
  expect(await db.topicBooks.count()).toBe(2);
  expect(await getTopicDone(topic.id)).toBe(true);
});

test('v5 yedeğinde kitabın dersi eski konuların çoğunluğundan türetilir', async () => {
  await seedOnboarded(legacySeed, { seedVersion: CURRICULUM.version });
  const turev = await topicBySeedKey('tyt-mat-turev');
  const limit = await topicBySeedKey('tyt-mat-limit');
  const hareket = await topicBySeedKey('tyt-fiz-hareket');
  const book = await createBook({ name: 'Dersli Kitap' });
  await upsertTopicBook({ topicId: turev.id, bookId: book.id, totalTests: 10, solvedTests: 10 });
  await upsertTopicBook({ topicId: limit.id, bookId: book.id, totalTests: 10, solvedTests: 2 });
  await upsertTopicBook({ topicId: hareket.id, bookId: book.id, totalTests: 10, solvedTests: 10 });

  const legacy = await asV5Archive(await exportBackup());
  await resetDb();
  await importBackup(new File([legacy], 'v5-ders.zip'));

  const [userBook] = await db.userBooks.toArray();
  expect(await db.catalogBooks.get(userBook.bookId)).toMatchObject({
    ownerId: LOCAL_SCOPE,
    title: 'Dersli Kitap',
    subjectSlug: 'matematik',
    exam: 'TYT',
    totalPages: 0,
  });
  // Kısmi konu tamamlanmış sayılmaz; diğer iki konu aktarılır.
  expect(await getTopicDone(turev.id)).toBe(true);
  expect(await getTopicDone(limit.id)).toBe(false);
  expect(await getTopicDone(hareket.id)).toBe(true);
});

