import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  ATTACHMENT_MAX_BYTES,
  addAttachment,
  deleteAttachment,
  getNote,
  listAttachments,
  saveNote,
} from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import type { Attachment, Subject, Topic } from '@/domain/types';
import { AttachmentList } from '@/features/notes/AttachmentList';
import { NotesTab } from '@/features/notes/NotesTab';
import { compressImage } from '@/lib/image';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

vi.mock('@/lib/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/image')>();
  return {
    ...actual,
    compressImage: vi.fn(async () => ({
      blob: new Blob(['sıkıştırılmış görsel'], { type: 'image/jpeg' }),
      thumbBlob: new Blob(['küçük görsel'], { type: 'image/jpeg' }),
      width: 2000,
      height: 1000,
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
      topics: [
        { seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 },
        { seedKey: 'tyt-mat-pol', name: 'Polinomlar', order: 2 },
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

beforeEach(async () => {
  // Fixture seedVersion'ı güncel tutar; SettingsProvider tam müfredatı yüklemez.
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
});

async function topicByKey(seedKey: string): Promise<{ subject: Subject; topic: Topic }> {
  const topic = await db.topics.where('seedKey').equals(seedKey).first();
  if (!topic) {
    throw new Error(`Test konusu bulunamadı: ${seedKey}`);
  }
  const subject = await db.subjects.get(topic.subjectId);
  if (!subject) {
    throw new Error(`Test dersi bulunamadı: ${topic.subjectId}`);
  }
  return { subject, topic };
}

function path(subject: Subject, topic: Topic): string {
  return `/tyt/${subject.id}/${topic.id}`;
}

async function openNotes(): Promise<HTMLElement> {
  const { subject, topic } = await topicByKey('tyt-mat-turev');
  renderApp(path(subject, topic));

  await userEvent.click(await screen.findByRole('tab', { name: 'Notlar' }));
  return screen.findByRole('textbox', { name: 'Konu notu' });
}

interface FakeSizeFile extends File {
  size: number;
}

function fileWithSize(name: string, type: string, size: number): FakeSizeFile {
  const file = new File(['x'], name, { type }) as FakeSizeFile;
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

test('saveNote HTML temizler, düz metin türetir ve güncelleme zamanını yazar', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');

  await saveNote(
    topic.id,
    '<p>Merhaba <strong>dünya</strong></p><script>alert(1)</script>',
    'yok sayılır',
  );

  const note = await getNote(topic.id);
  expect(note).toBeDefined();
  expect(note?.contentHtml).toContain('<strong>dünya</strong>');
  expect(note?.contentHtml).not.toContain('<script');
  expect(note?.contentHtml).not.toContain('alert(1)');
  expect(note?.plainText).toBe('Merhaba dünya');
  expect(note?.updatedAt).toBeTruthy();

  await db.notes.update(topic.id, { updatedAt: '2000-01-01T00:00:00.000Z' });
  await saveNote(topic.id, '<p>Yeni not</p>', '');
  const updated = await getNote(topic.id);
  expect(updated?.plainText).toBe('Yeni not');
  expect(updated?.updatedAt.localeCompare('2000-01-01T00:00:00.000Z')).toBeGreaterThan(0);
  expect(await db.notes.count()).toBe(1);
});

test('saveNote blok sınırlarını düz metinde korur', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');

  await saveNote(
    topic.id,
    '<p>Birinci paragraf</p><p>İkinci paragraf</p><ul><li>Liste maddesi</li></ul>',
    '',
  );

  const note = await getNote(topic.id);
  expect(note?.plainText).toBe('Birinci paragraf\nİkinci paragraf\nListe maddesi');
  expect(note?.plainText).not.toContain('paragrafİkinci');
  expect(note?.plainText).not.toContain('paragrafListe');
});

test('saveNote yalnızca boşluk içeren HTML yerine kırpılmış düz metni saklar', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');

  await saveNote(topic.id, '<p>   </p>', '  Yedek metin  ');

  const note = await getNote(topic.id);
  expect(note?.plainText).toBe('Yedek metin');
});

test('aynı adlı ekler görünür sıra rozeti ve benzersiz erişilebilir ad alır', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  await addAttachment(
    topic.id,
    new File(['bir'], 'aynı-dosya.pdf', { type: 'application/pdf' }),
  );
  await addAttachment(
    topic.id,
    new File(['iki'], 'aynı-dosya.pdf', { type: 'application/pdf' }),
  );

  const attachments = await listAttachments(topic.id);
  render(<AttachmentList topicId={topic.id} attachments={attachments} />);

  expect(screen.getByText('(1. dosya)')).toBeInTheDocument();
  expect(screen.getByText('(2. dosya)')).toBeInTheDocument();

  const deleteButtons = screen.getAllByRole('button', { name: /dosyasını sil$/ });
  const labels = deleteButtons.map((button) => button.getAttribute('aria-label'));
  expect(labels).toHaveLength(2);
  expect(new Set(labels).size).toBe(2);
  expect(labels[0]).toContain('(1. dosya)');
  expect(labels[1]).toContain('(2. dosya)');

  await userEvent.click(deleteButtons[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Dosyayı sil' });
  expect(within(dialog).getByText(/\(1\. dosya\)/)).toBeInTheDocument();
});

test('addAttachment PDF dosyasını olduğu gibi saklar, listeler ve siler', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  const file = new File(['pdf-içeriği'], '  notlar.pdf  ', { type: 'application/pdf' });

  const attachment = await addAttachment(topic.id, file);

  expect(attachment).toMatchObject({
    topicId: topic.id,
    name: 'notlar.pdf',
    mime: 'application/pdf',
    size: file.size,
  });
  expect(attachment.blob.size).toBe(file.size);
  expect(attachment.createdAt).toBeTruthy();
  expect((await listAttachments(topic.id)).map((item) => item.id)).toEqual([attachment.id]);

  await deleteAttachment(attachment.id);

  expect(await listAttachments(topic.id)).toHaveLength(0);
  expect(await db.attachments.get(attachment.id)).toBeUndefined();
});

test('addAttachment görseli 2000 px sınırıyla sıkıştırır', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  vi.mocked(compressImage).mockClear();
  const file = new File(['png-içeriği'], 'grafik.png', { type: 'image/png' });

  const attachment = await addAttachment(topic.id, file);

  expect(compressImage).toHaveBeenCalledWith(file, 2000, 0.85);
  expect(attachment).toMatchObject({
    name: 'grafik.png',
    mime: 'image/jpeg',
    size: new Blob(['sıkıştırılmış görsel']).size,
  });
  expect(attachment.blob.type).toBe('image/jpeg');
});

test('ek önizlemesi aynı dosyanın yeni Blob örneğinde URL yeniden oluşturmaz', () => {
  const createUrlSpy = vi.spyOn(URL, 'createObjectURL');
  const attachment: Attachment = {
    id: 'ek-1',
    topicId: 'konu-1',
    name: 'grafik.png',
    mime: 'image/png',
    size: 1,
    blob: new Blob(['x'], { type: 'image/png' }),
    createdAt: '2026-11-01T00:00:00.000Z',
  };

  const { rerender } = render(
    <AttachmentList topicId="konu-1" attachments={[attachment]} />,
  );
  expect(createUrlSpy).toHaveBeenCalledTimes(1);

  rerender(
    <AttachmentList
      topicId="konu-1"
      attachments={[{ ...attachment, blob: new Blob(['x'], { type: 'image/png' }) }]}
    />,
  );
  expect(createUrlSpy).toHaveBeenCalledTimes(1);

  createUrlSpy.mockRestore();
});

test('ek görseli tıklanınca yakınlaştırılabilir görüntüleyici açılır', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  await addAttachment(
    topic.id,
    new File(['png-içeriği'], 'grafik.png', { type: 'image/png' }),
  );
  const attachments = await listAttachments(topic.id);

  render(<AttachmentList topicId={topic.id} attachments={attachments} />);

  await userEvent.click(
    screen.getByRole('button', { name: /grafik\.png görselini büyüt/ }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'grafik.png' });
  expect(within(dialog).getByRole('img', { name: 'grafik.png' })).toBeInTheDocument();

  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Yakınlaştır' }),
  );
  expect(within(dialog).getByText('125%')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Kapat' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

test('addAttachment 20 MB sınırını uygular ve Türkçe hata verir', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');

  const boundary = await addAttachment(
    topic.id,
    fileWithSize('sinir.pdf', 'application/pdf', ATTACHMENT_MAX_BYTES),
  );
  expect(boundary.size).toBe(ATTACHMENT_MAX_BYTES);

  await expect(
    addAttachment(
      topic.id,
      fileWithSize('büyük.pdf', 'application/pdf', ATTACHMENT_MAX_BYTES + 1),
    ),
  ).rejects.toThrow('Dosya boyutu 20 MB sınırını aşıyor');

  await expect(
    addAttachment(topic.id, new File(['x'], 'not.txt', { type: 'text/plain' })),
  ).rejects.toThrow('Yalnızca görsel veya PDF dosyası ekleyebilirsin');

  expect(await listAttachments(topic.id)).toHaveLength(1);
});

test('boş notta yer tutucu, araç çubuğu ve kaydedilmedi göstergesi görünür', async () => {
  const editor = await openNotes();

  expect(editor).toHaveAttribute('contenteditable', 'true');
  expect(
    editor.querySelector('[data-placeholder="Konu notunu buraya yaz…"]'),
  ).not.toBeNull();
  expect(screen.getByText('Henüz kaydedilmedi')).toBeInTheDocument();

  for (const name of [
    'Kalın',
    'İtalik',
    'Başlık',
    'Madde listesi',
    'Numaralı liste',
    'Alıntı',
    'Vurgu',
    'Altı çizili',
    'Bağlantı',
    'Satır içi kod',
  ]) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
});

test('notu yazar, 800 ms sonra kaydeder ve Kaydedildi gösterir', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  const editor = await openNotes();

  await userEvent.click(editor);
  await userEvent.type(editor, 'Türev kuralları');
  expect(editor).toHaveTextContent('Türev kuralları');

  await waitFor(
    async () => {
      const note = await getNote(topic.id);
      expect(note?.plainText).toContain('Türev kuralları');
    },
    { timeout: 3000 },
  );

  expect(screen.getByText('Kaydedildi')).toBeInTheDocument();
  expect(screen.getByText(/^Son kayıt:/)).toBeInTheDocument();
});

test('sekme değişince bekleyen not kaybolmaz', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  const editor = await openNotes();

  await userEvent.type(editor, 'Sekme değişiyor');
  await userEvent.click(screen.getByRole('tab', { name: 'Durum' }));

  await waitFor(
    async () => {
      const note = await getNote(topic.id);
      expect(note?.plainText).toContain('Sekme değişiyor');
    },
    { timeout: 3000 },
  );
});

test('pagehide bekleyen notu beklemeden kaydeder', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  const editor = await openNotes();

  await userEvent.type(editor, 'Sayfa kapanıyor');
  fireEvent(window, new Event('pagehide'));

  await waitFor(
    async () => {
      const note = await getNote(topic.id);
      expect(note?.plainText).toContain('Sayfa kapanıyor');
    },
    { timeout: 2000 },
  );
});

test('kaydetme hatasında not korunur ve Tekrar dene ile kurtarılır', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  const editor = await openNotes();
  const putSpy = vi
    .spyOn(db.notes, 'put')
    .mockRejectedValueOnce(new Error('yazma hatası'));
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  await userEvent.type(editor, 'Kaybolmayacak not');

  expect(
    await screen.findByText('Kaydedilemedi', {}, { timeout: 3000 }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));

  await waitFor(
    async () => {
      const note = await getNote(topic.id);
      expect(note?.plainText).toContain('Kaybolmayacak not');
    },
    { timeout: 3000 },
  );
  expect(await screen.findByText('Kaydedildi')).toBeInTheDocument();

  putSpy.mockRestore();
  consoleSpy.mockRestore();
});

test('araç çubuğuyla kalın biçimlendirir ve HTML olarak saklar', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  const editor = await openNotes();

  await userEvent.click(editor);
  await userEvent.type(editor, 'Türev');
  await userEvent.keyboard('{Control>}a{/Control}');
  await userEvent.click(screen.getByRole('button', { name: 'Kalın' }));

  await waitFor(
    async () => {
      const note = await getNote(topic.id);
      expect(note?.contentHtml).toContain('<strong>Türev</strong>');
    },
    { timeout: 3000 },
  );
});

test('kayıtlı notu yükler ve script içeriğini çalıştırmaz', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  await saveNote(
    topic.id,
    '<p>Güvenli not</p><script>window.__koclukXss = true</script>',
    'Güvenli not',
  );

  const editor = await openNotes();

  expect(editor).toHaveTextContent('Güvenli not');
  expect(editor.innerHTML).not.toContain('<script');
  expect((window as unknown as Record<string, unknown>).__koclukXss).toBeUndefined();
  expect(screen.getByText('Kaydedildi')).toBeInTheDocument();
});

test('konu değişince önceki konunun notu gösterilmez', async () => {
  const first = await topicByKey('tyt-mat-turev');
  const second = await topicByKey('tyt-mat-pol');
  await saveNote(first.topic.id, '<p>Birinci not</p>', 'Birinci not');
  await saveNote(second.topic.id, '<p>İkinci not</p>', 'İkinci not');

  const { rerender } = render(<NotesTab topicId={first.topic.id} />);
  expect(await screen.findByRole('textbox', { name: 'Konu notu' })).toHaveTextContent(
    'Birinci not',
  );

  rerender(<NotesTab topicId={second.topic.id} />);

  await waitFor(() => {
    expect(screen.getByRole('textbox', { name: 'Konu notu' })).toHaveTextContent('İkinci not');
  });
  expect(screen.getByRole('textbox', { name: 'Konu notu' })).not.toHaveTextContent(
    'Birinci not',
  );
});

test('görsel ekler, önizler ve onaylayarak siler', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  await openNotes();

  const file = new File(['png-içeriği'], 'grafik.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText('Dosya seç'), file);

  expect(await screen.findByText('grafik.png')).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: 'grafik.png' })).toHaveAttribute(
    'src',
    expect.stringContaining('blob:'),
  );

  const stored = await listAttachments(topic.id);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ name: 'grafik.png', mime: 'image/jpeg' });
  expect(compressImage).toHaveBeenCalled();

  await userEvent.click(
    screen.getByRole('button', { name: 'grafik.png dosyasını sil' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Dosyayı sil' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));

  await waitFor(() => {
    expect(screen.queryByText('grafik.png')).not.toBeInTheDocument();
  });
  expect(await listAttachments(topic.id)).toHaveLength(0);
});

test('PDF ekler, aç ve indir bağlantılarını gösterir', async () => {
  await openNotes();

  const file = new File(['pdf-içeriği'], 'notlar.pdf', { type: 'application/pdf' });
  await userEvent.upload(screen.getByLabelText('Dosya seç'), file);

  expect(await screen.findByText('notlar.pdf')).toBeInTheDocument();

  const openLink = await screen.findByRole('link', { name: 'notlar.pdf dosyasını aç' });
  await waitFor(() => {
    expect(openLink).toHaveAttribute('href', expect.stringContaining('blob:'));
  });
  expect(openLink).toHaveAttribute('target', '_blank');

  const downloadLink = screen.getByRole('link', { name: 'notlar.pdf dosyasını indir' });
  expect(downloadLink).toHaveAttribute('download', 'notlar.pdf');
  await waitFor(() => {
    expect(downloadLink).toHaveAttribute('href', expect.stringContaining('blob:'));
  });
});

test('20 MB üzerindeki dosyayı yüklemez ve Türkçe hata gösterir', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  await openNotes();

  await userEvent.upload(
    screen.getByLabelText('Dosya seç'),
    fileWithSize('büyük.pdf', 'application/pdf', ATTACHMENT_MAX_BYTES + 1),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Dosya boyutu 20 MB sınırını aşıyor',
  );
  expect(await listAttachments(topic.id)).toHaveLength(0);
});
