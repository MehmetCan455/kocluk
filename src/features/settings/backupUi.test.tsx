import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { saveAs } from 'file-saver';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import JSZip from 'jszip';
import { CURRICULUM } from '@/data/curriculum';
import { exportBackup } from '@/db/backup';
import { addCustomBook, setBookPage } from '@/db/bookRepositories';
import { db } from '@/db/db';
import { toPhotoSearch } from '@/db/photoSearch';
import {
  addScheduleFile,
  createBook,
  createPracticeSession,
  getSettings,
  patchSettings,
  saveExam,
  saveScheduleEntry,
  saveScheduleTable,
  type CurriculumSeed,
} from '@/db/repositories';
import { addRow, addTask, getOrCreateWeek } from '@/db/scheduleRepository';
import { setTopicDone } from '@/db/topicProgressRepository';
import { createEmptyScheduleTable } from '@/domain/scheduleTable';
import { resetDb, seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

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

async function seedPanelData(profileName = 'Yedek Profili') {
  await seedOnboarded(seed, { profileName, seedVersion: CURRICULUM.version });
  const subject = (await db.subjects.where('seedKey').equals('tyt-mat').first())!;
  const topic = (await db.topics.where('seedKey').equals('tyt-mat-turev').first())!;
  await createBook({ name: 'Matematik Soru Bankası' });
  await saveExam({
    type: 'TYT',
    name: 'Deneme 1',
    date: '2026-11-18',
    results: [{ subjectId: subject.id, correct: 10, wrong: 2, blank: 1 }],
  });
  await db.notes.put({
    topicId: topic.id,
    contentHtml: '<p>Not</p>',
    plainText: 'Not',
    updatedAt: '2026-11-18T10:00:00.000Z',
  });
  const photo = {
    id: 'panel-foto',
    examType: 'TYT' as const,
    subjectId: subject.id,
    topicId: topic.id,
    note: 'Panel fotoğrafı',
    blob: new Blob(['foto'], { type: 'image/jpeg' }),
    thumbBlob: new Blob(['kucuk'], { type: 'image/jpeg' }),
    width: 10,
    height: 10,
    mastered: false,
    practiceCount: 0,
    createdAt: '2026-11-18T10:02:00.000Z',
  };
  await db.photos.add(photo);
  await db.photoSearch.put(toPhotoSearch(photo));
  await createPracticeSession({ filters: { examType: 'TYT' }, photoIds: [photo.id] });
  await saveScheduleEntry({
    day: 1,
    startTime: '09:00',
    endTime: '10:00',
    title: 'Panel programı',
    subjectId: subject.id,
  });
  await addScheduleFile(
    new File(['%PDF-1.4 panel'], 'panel-program.pdf', { type: 'application/pdf' }),
  );
  const table = createEmptyScheduleTable();
  await saveScheduleTable({
    rows: table.rows.map((row, index) =>
      index === 0 ? { ...row, subject: 'Panel dersi' } : row,
    ),
    note: 'Panel notu',
  });
  return { subject, topic };
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

async function asV5Archive(blob: Blob): Promise<Blob> {
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
  const data = JSON.parse(
    (await zip.file('veri.json')!.async('string')) as string,
  ) as Record<string, unknown>;
  const manifest = JSON.parse(
    (await zip.file('manifest.json')!.async('string')) as string,
  ) as { schemaVersion: number; counts: Record<string, number> };
  for (const key of V6_TABLE_KEYS) {
    delete data[key];
    manifest.counts[key] = 0;
  }
  manifest.schemaVersion = 5;
  zip.file('veri.json', JSON.stringify(data));
  zip.file('manifest.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'blob' });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
  sessionStorage.clear();
});

test('yedek indirir, dosya adını üretir ve son yedek tarihini gösterir', async () => {
  await seedPanelData();
  renderApp('/ayarlar');

  expect(await screen.findByText(/Henüz yedek alınmadı/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Yedek indir' }));

  await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
  const [blob, fileName] = vi.mocked(saveAs).mock.calls[0];
  expect(blob).toBeInstanceOf(Blob);
  expect(fileName).toMatch(/^kocluk-yedek-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
  expect((await getSettings()).lastBackupAt).toBeTruthy();
  await waitFor(() => {
    expect(screen.getByText(/Son yedek:/)).not.toHaveTextContent('Henüz yedek alınmadı');
  });
});

test('dosya seçince özet gösterir ve onaydan sonra tüm veriyi değiştirir', async () => {
  const { topic } = await seedPanelData('Yedek Profili');
  const shelfBook = await addCustomBook({ title: 'Panel Raf Kitabı', totalPages: 120 });
  await setBookPage(shelfBook.id, 10);
  const { week } = await getOrCreateWeek('2026-11-16');
  const row = await addRow(week.id, 'Matematik');
  await addTask({
    weekId: week.id,
    rowId: row.id,
    dayIndex: 1,
    type: 'free',
    title: 'Panel görevi',
  });
  await setTopicDone(topic.id, true);
  const backup = await exportBackup();
  await patchSettings({ profileName: 'Mevcut Profil' });

  renderApp('/ayarlar');
  const input = await screen.findByLabelText('Yedek dosyası seç');
  await userEvent.upload(input, new File([backup], 'yedek.zip', { type: 'application/zip' }));

  expect(await screen.findByText('Yedek özeti')).toBeInTheDocument();
  expect(screen.getByText(/1 deneme/)).toBeInTheDocument();
  expect(screen.getByText(/1 fotoğraf/)).toBeInTheDocument();
  expect(screen.getByText(/1 not/)).toBeInTheDocument();
  expect(screen.getByText(/1 test oturumu/)).toBeInTheDocument();
  expect(screen.getByText(/1 eski çizelge kaydı/)).toBeInTheDocument();
  expect(screen.getByText(/1 eski çizelge dosyası/)).toBeInTheDocument();
  expect(screen.getByText(/1 çizelge tablosu/)).toBeInTheDocument();
  expect(screen.getByText(/1 raf kitabı/)).toBeInTheDocument();
  expect(screen.getByText(/1 ilerleme kaydı/)).toBeInTheDocument();
  expect(screen.getByText(/1 plan haftası/)).toBeInTheDocument();
  expect(screen.getByText(/1 plan satırı/)).toBeInTheDocument();
  expect(screen.getByText(/1 plan görevi/)).toBeInTheDocument();
  expect(screen.getByText(/1 konu durumu/)).toBeInTheDocument();
  expect(screen.queryByText(/eski sürüm/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Mevcut verileri değiştir' }));

  await waitFor(async () => {
    expect((await getSettings()).profileName).toBe('Yedek Profili');
  });
  expect(await screen.findByText('Yedek geri yüklendi.')).toBeInTheDocument();
  expect(await screen.findByLabelText('Ad soyad')).toHaveValue('Yedek Profili');
  expect((await getSettings()).lastBackupAt).toBeUndefined();
});

test('eski sürüm yedeğinin özeti rafa taşıma uyarısını gösterir', async () => {
  await seedPanelData('Eski Yedek');
  const legacy = await asV5Archive(await exportBackup());

  renderApp('/ayarlar');
  const input = await screen.findByLabelText('Yedek dosyası seç');
  await userEvent.upload(input, new File([legacy], 'v5.zip', { type: 'application/zip' }));

  expect(await screen.findByText('Yedek özeti')).toBeInTheDocument();
  expect(screen.getByText(/eski sürüm \(v5\)/)).toBeInTheDocument();
  expect(screen.getByText(/eski kitaplar rafa taşınır/)).toBeInTheDocument();
  expect(screen.getByText(/1 raf kitabı/)).toBeInTheDocument();
});

test('bozuk yedek dosyasını özetlemez ve hata bildirir', async () => {
  await seedPanelData();
  renderApp('/ayarlar');
  const input = await screen.findByLabelText('Yedek dosyası seç');

  await userEvent.upload(
    input,
    new File(['bu bir zip değil'], 'bozuk.zip', { type: 'application/zip' }),
  );

  expect(await screen.findByText('Geçersiz yedek dosyası')).toBeInTheDocument();
  expect(screen.queryByText('Yedek özeti')).not.toBeInTheDocument();
});

test('tüm verileri silme iki onay ister ve yedeği önerir', async () => {
  await seedPanelData();
  renderApp('/ayarlar');

  await userEvent.click(await screen.findByRole('button', { name: 'Tüm verileri sil' }));
  expect(screen.getByText(/Önce yedek almanı öneririz/)).toBeInTheDocument();
  expect(screen.getByText(/ders çalışma çizelgesi/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Devam et' }));
  expect(screen.getByText(/Bu işlem geri alınamaz/)).toBeInTheDocument();
  expect(await db.subjects.count()).toBeGreaterThan(0);

  await userEvent.click(
    screen.getByRole('button', { name: 'Tüm verileri kalıcı olarak sil' }),
  );

  await waitFor(async () => {
    expect(await db.subjects.count()).toBe(0);
  });
  expect(await db.scheduleEntries.count()).toBe(0);
  expect(await db.scheduleFiles.count()).toBe(0);
  expect(await db.scheduleTables.count()).toBe(0);
  expect(await screen.findByRole('heading', { name: 'Seni tanıyalım' })).toBeInTheDocument();
});

test('depolama kullanımını ve kalıcı izin durumunu gösterir', async () => {
  await seedPanelData();
  const estimate = vi.fn().mockResolvedValue({
    usage: 50 * 1024 * 1024,
    quota: 200 * 1024 * 1024,
  });
  const persisted = vi.fn().mockResolvedValue(false);
  const persist = vi.fn().mockResolvedValue(true);
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate, persisted, persist },
  });

  renderApp('/ayarlar');

  expect(await screen.findByText('50 MB / 200 MB')).toBeInTheDocument();
  expect(screen.getByText('Kalıcı depolama kapalı')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kalıcı depolama izni iste' }));
  await waitFor(() => expect(persist).toHaveBeenCalled());
  expect(await screen.findByText('Kalıcı depolama açık')).toBeInTheDocument();
});

test('depolama API yoksa desteklenmediğini söyler', async () => {
  await seedPanelData();
  renderApp('/ayarlar');
  expect(await screen.findByText('Bu tarayıcı desteklemiyor')).toBeInTheDocument();
});

test('yedek geri yüklendikten sonra depolama kullanımı yenilenir', async () => {
  await seedPanelData();
  const backup = await exportBackup();
  const estimate = vi.fn().mockResolvedValue({
    usage: 10 * 1024 * 1024,
    quota: 100 * 1024 * 1024,
  });
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate, persisted: vi.fn().mockResolvedValue(false), persist: vi.fn() },
  });

  renderApp('/ayarlar');
  expect(await screen.findByText('10 MB / 100 MB')).toBeInTheDocument();
  expect(estimate).toHaveBeenCalledTimes(1);

  const input = await screen.findByLabelText('Yedek dosyası seç');
  await userEvent.upload(input, new File([backup], 'yedek.zip', { type: 'application/zip' }));
  await screen.findByText('Yedek özeti');
  await userEvent.click(screen.getByRole('button', { name: 'Mevcut verileri değiştir' }));

  await waitFor(() => expect(estimate).toHaveBeenCalledTimes(2));
});

test('son yedek eskiyse dashboard yedek şeridi gösterir', async () => {
  await seedPanelData();
  await patchSettings({ lastBackupAt: '2020-01-01T00:00:00.000Z' });

  renderApp('/');

  const banner = await screen.findByLabelText('Yedek hatırlatıcısı');
  expect(banner).toHaveTextContent('Yedeğini almayı unutma');
  expect(banner.querySelector('a')).toHaveAttribute('href', '/ayarlar');
});

test('son yedek yeniyse ve fotoğraf sayısı düşükse şerit göstermez', async () => {
  await seedPanelData();
  await patchSettings({ lastBackupAt: new Date().toISOString() });

  renderApp('/');

  await screen.findByText('Genel Bakış');
  await waitFor(() => {
    expect(screen.queryByLabelText('Yedek hatırlatıcısı')).not.toBeInTheDocument();
  });
});

test('son yedekten sonra eklenen 100 fotoğraf yedek şeridini tetikler', async () => {
  const { subject } = await seedPanelData();
  await patchSettings({
    lastBackupAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  });
  const createdAt = new Date().toISOString();
  await db.photos.bulkAdd(
    Array.from({ length: 100 }, (_, index) => ({
      id: `foto-${index}`,
      examType: 'TYT' as const,
      subjectId: subject.id,
      note: '',
      blob: new Blob(['foto'], { type: 'image/jpeg' }),
      thumbBlob: new Blob(['kucuk'], { type: 'image/jpeg' }),
      width: 10,
      height: 10,
      mastered: false,
      practiceCount: 0,
      createdAt,
    })),
  );

  renderApp('/');

  expect(await screen.findByLabelText('Yedek hatırlatıcısı')).toHaveTextContent(
    'Son yedekten bu yana 100 fotoğraf',
  );
});

test('son yedekten önceki fotoğraflar yedek şeridini tetiklemez', async () => {
  const { subject } = await seedPanelData();
  await patchSettings({ lastBackupAt: new Date().toISOString() });
  const createdAt = '2026-01-01T00:00:00.000Z';
  await db.photos.bulkAdd(
    Array.from({ length: 100 }, (_, index) => ({
      id: `eski-foto-${index}`,
      examType: 'TYT' as const,
      subjectId: subject.id,
      note: '',
      blob: new Blob(['foto'], { type: 'image/jpeg' }),
      thumbBlob: new Blob(['kucuk'], { type: 'image/jpeg' }),
      width: 10,
      height: 10,
      mastered: false,
      practiceCount: 0,
      createdAt,
    })),
  );

  renderApp('/');
  await screen.findByText('Genel Bakış');

  expect(screen.queryByLabelText('Yedek hatırlatıcısı')).not.toBeInTheDocument();
});

test('yedek hatırlatıcısı kapatılabilir', async () => {
  await seedPanelData();
  await patchSettings({ lastBackupAt: '2020-01-01T00:00:00.000Z' });

  renderApp('/');

  const banner = await screen.findByLabelText('Yedek hatırlatıcısı');
  await userEvent.click(
    screen.getByRole('button', { name: 'Yedek hatırlatıcısını kapat' }),
  );
  expect(banner).not.toBeInTheDocument();
});
