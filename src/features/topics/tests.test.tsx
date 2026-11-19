import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import { createBook, listTopicBooks, upsertTopicBook } from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import type { Subject, Topic } from '@/domain/types';
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
  // Kesit seedVersion'ı güncel tutar; SettingsProvider küçük fixture'ı ezmez.
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
});

async function subjectByKey(seedKey: string): Promise<Subject> {
  const subject = (await db.subjects.where('seedKey').equals(seedKey).first()) ?? undefined;
  if (!subject) {
    throw new Error(`Test dersi bulunamadı: ${seedKey}`);
  }
  return subject;
}

async function topicByKey(seedKey: string): Promise<Topic> {
  const topic = await db.topics.where('seedKey').equals(seedKey).first();
  if (!topic) {
    throw new Error(`Test konusu bulunamadı: ${seedKey}`);
  }
  return topic;
}

function path(subject: Subject, topic: Topic): string {
  return `/tyt/${subject.id}/${topic.id}`;
}

async function openAddDialog(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: 'Kitap / test ekle' }));
  return screen.findByRole('dialog', { name: 'Kitap / test ekle' });
}

async function typeCounts(dialog: HTMLElement, total: string, solved: string): Promise<void> {
  const totalInput = within(dialog).getByLabelText('Toplam test');
  await userEvent.clear(totalInput);
  await userEvent.type(totalInput, total);

  const solvedInput = within(dialog).getByLabelText('Çözülen test');
  await userEvent.clear(solvedInput);
  await userEvent.type(solvedInput, solved);
}

test('kitap seçerek test ekler ve ilerlemeyi anında günceller', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  const book = await createBook({ name: 'Türev Soru Bankası', publisher: 'Palme' });

  renderApp(path(subject, topic));

  expect(await screen.findByText('Henüz test eklenmedi')).toBeInTheDocument();

  const dialog = await openAddDialog();
  await userEvent.selectOptions(within(dialog).getByLabelText('Kitap'), book.id);
  await typeCounts(dialog, '6', '5');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByText('5/6 test')).toBeInTheDocument();
  expect(screen.getByText('1 test kaldı')).toBeInTheDocument();
  expect(screen.getAllByText('%83').length).toBeGreaterThan(0);
  expect(screen.getByRole('progressbar', { name: 'Toplam test ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '83',
  );
  expect(screen.getByRole('button', { name: 'Türev Soru Bankası kaydını düzenle' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  const records = await listTopicBooks(topic.id);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ bookId: book.id, totalTests: 6, solvedTests: 5 });
});

test('yeni kitap oluşturur, aynı adlı kitapta uyarır ama engellemez', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  await createBook({ name: 'Karekök TYT' });

  renderApp(path(subject, topic));
  const dialog = await openAddDialog();

  const select = within(dialog).getByLabelText('Kitap');
  await userEvent.selectOptions(select, within(select).getByRole('option', { name: 'Yeni kitap…' }));

  const nameInput = within(dialog).getByLabelText('Yeni kitap adı');
  await userEvent.type(nameInput, 'Karekök TYT');
  expect(
    await screen.findByText('Bu adda bir kitap zaten var. Yine de yeni bir kitap olarak eklenecek.'),
  ).toBeInTheDocument();

  await userEvent.type(within(dialog).getByLabelText('Yayınevi'), 'Karekök');
  await typeCounts(dialog, '8', '2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByText('2/8 test')).toBeInTheDocument();

  const records = await listTopicBooks(topic.id);
  expect(records).toHaveLength(1);
  const createdBook = await db.books.get(records[0].bookId);
  expect(createdBook).toMatchObject({ name: 'Karekök TYT', publisher: 'Karekök' });
  expect(await db.books.where('name').equals('Karekök TYT').count()).toBe(2);
});

test('test sayılarını canlı doğrular ve hatalı kaydı engeller', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  await createBook({ name: 'Doğrulama Kitabı' });

  renderApp(path(subject, topic));
  const dialog = await openAddDialog();
  const saveButton = within(dialog).getByRole('button', { name: 'Kaydet' });

  expect(saveButton).toBeDisabled();

  const totalInput = within(dialog).getByLabelText('Toplam test');
  await userEvent.type(totalInput, '0');
  expect(await within(dialog).findByText('Toplam test sayısı en az 1 olmalı')).toBeInTheDocument();
  expect(saveButton).toBeDisabled();

  await userEvent.clear(totalInput);
  await userEvent.type(totalInput, '4');
  const solvedInput = within(dialog).getByLabelText('Çözülen test');
  await userEvent.clear(solvedInput);
  await userEvent.type(solvedInput, '5');
  expect(
    await within(dialog).findByText('Çözülen test sayısı toplamdan fazla olamaz'),
  ).toBeInTheDocument();
  expect(saveButton).toBeDisabled();

  await userEvent.clear(solvedInput);
  await userEvent.type(solvedInput, '4');
  await waitFor(() => {
    expect(
      within(dialog).queryByText('Çözülen test sayısı toplamdan fazla olamaz'),
    ).not.toBeInTheDocument();
  });
  expect(saveButton).toBeEnabled();

  await userEvent.clear(totalInput);
  await userEvent.type(totalInput, '2.5');
  expect(await within(dialog).findByText('Toplam test sayısı tam sayı olmalı')).toBeInTheDocument();
  expect(saveButton).toBeDisabled();
});

test('kaydı düzenler ve ilerlemeyi günceller', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  const book = await createBook({ name: 'Düzenleme Kitabı' });
  const record = await upsertTopicBook({
    topicId: topic.id,
    bookId: book.id,
    totalTests: 4,
    solvedTests: 2,
  });

  renderApp(path(subject, topic));

  expect(await screen.findByText('2/4 test')).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Düzenleme Kitabı kaydını düzenle' }),
  );

  const dialog = await screen.findByRole('dialog', { name: 'Test kaydını düzenle' });
  expect(within(dialog).getByText('Düzenleme Kitabı')).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Toplam test')).toHaveValue(4);
  expect(within(dialog).getByLabelText('Çözülen test')).toHaveValue(2);

  await typeCounts(dialog, '10', '10');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByText('10/10 test')).toBeInTheDocument();
  expect(screen.getAllByText('%100').length).toBeGreaterThan(0);
  expect(screen.queryByText('0 test kaldı')).not.toBeInTheDocument();

  const updated = await db.topicBooks.get(record.id);
  expect(updated).toMatchObject({ totalTests: 10, solvedTests: 10 });
});

test('kaydı siler, kitabı korur', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  const book = await createBook({ name: 'Silinen Kitap' });
  await upsertTopicBook({ topicId: topic.id, bookId: book.id, totalTests: 6, solvedTests: 2 });

  renderApp(path(subject, topic));

  expect(await screen.findByText('2/6 test')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Silinen Kitap kaydını sil' }));

  const dialog = await screen.findByRole('dialog', { name: 'Test kaydını sil' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));

  expect(await screen.findByText('Henüz test eklenmedi')).toBeInTheDocument();
  expect(screen.queryByText('2/6 test')).not.toBeInTheDocument();
  expect(await listTopicBooks(topic.id)).toHaveLength(0);
  expect(await db.books.get(book.id)).toBeDefined();
});

test('aynı kitap aynı konuya eklenince mevcut kayıt güncellenir', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  const book = await createBook({ name: 'Tekrar Kitabı' });
  const existing = await upsertTopicBook({
    topicId: topic.id,
    bookId: book.id,
    totalTests: 4,
    solvedTests: 2,
  });

  renderApp(path(subject, topic));

  expect(await screen.findByText('2/4 test')).toBeInTheDocument();
  const dialog = await openAddDialog();
  await userEvent.selectOptions(within(dialog).getByLabelText('Kitap'), book.id);
  await typeCounts(dialog, '9', '7');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByText('7/9 test')).toBeInTheDocument();
  const records = await listTopicBooks(topic.id);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ id: existing.id, totalTests: 9, solvedTests: 7 });
});

test('kitap başka konuda yeniden kullanılabilir', async () => {
  const subject = await subjectByKey('tyt-mat');
  const turev = await topicByKey('tyt-mat-turev');
  const polinomlar = await topicByKey('tyt-mat-pol');
  const book = await createBook({ name: 'Ortak Kitap' });
  await upsertTopicBook({
    topicId: turev.id,
    bookId: book.id,
    totalTests: 10,
    solvedTests: 4,
  });

  renderApp(path(subject, polinomlar));

  expect(await screen.findByText('Henüz test eklenmedi')).toBeInTheDocument();
  const dialog = await openAddDialog();
  await userEvent.selectOptions(within(dialog).getByLabelText('Kitap'), book.id);
  await typeCounts(dialog, '8', '3');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByText('3/8 test')).toBeInTheDocument();
  expect(await listTopicBooks(turev.id)).toHaveLength(1);
  expect(await listTopicBooks(polinomlar.id)).toHaveLength(1);
  expect(await db.books.count()).toBe(1);
});

test('kitap adı boşken kaydetmeyi engeller', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');

  renderApp(path(subject, topic));
  const dialog = await openAddDialog();

  expect(within(dialog).getByLabelText('Yeni kitap adı')).toHaveValue('');
  await typeCounts(dialog, '5', '1');
  expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled();

  await userEvent.type(within(dialog).getByLabelText('Yeni kitap adı'), '   ');
  expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled();
  expect(await within(dialog).findByText('Kitap adı boş olamaz')).toBeInTheDocument();
});

test('konu ilerlemesi test kaydıyla birlikte güncellenir', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  const book = await createBook({ name: 'İlerleme Kitabı' });

  renderApp(path(subject, topic));

  const dialog = await openAddDialog();
  await userEvent.selectOptions(within(dialog).getByLabelText('Kitap'), book.id);
  await typeCounts(dialog, '4', '2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByText('2/4 test · 2 test kaldı')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Türev ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
});
