import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
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
import type { Subject, Topic } from '@/domain/types';
import { NotesTab } from '@/features/notes/NotesTab';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

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

test('addAttachment dosyayı olduğu gibi saklar, listeler ve siler', async () => {
  const { topic } = await topicByKey('tyt-mat-turev');
  const file = new File(['png-içeriği'], '  grafik.png  ', { type: 'image/png' });

  const attachment = await addAttachment(topic.id, file);

  expect(attachment).toMatchObject({
    topicId: topic.id,
    name: 'grafik.png',
    mime: 'image/png',
    size: file.size,
  });
  expect(attachment.blob.size).toBe(file.size);
  expect(attachment.createdAt).toBeTruthy();
  expect((await listAttachments(topic.id)).map((item) => item.id)).toEqual([attachment.id]);

  await deleteAttachment(attachment.id);

  expect(await listAttachments(topic.id)).toHaveLength(0);
  expect(await db.attachments.get(attachment.id)).toBeUndefined();
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
  await userEvent.click(screen.getByRole('tab', { name: 'Testler' }));

  await waitFor(
    async () => {
      const note = await getNote(topic.id);
      expect(note?.plainText).toContain('Sekme değişiyor');
    },
    { timeout: 3000 },
  );
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
  expect(stored[0]).toMatchObject({ name: 'grafik.png', mime: 'image/png' });

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
