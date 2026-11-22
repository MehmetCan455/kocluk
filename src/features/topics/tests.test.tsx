import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import { createBook, upsertTopicBook } from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import { getTopicDone } from '@/db/topicProgressRepository';
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

test('konu sayfası Durum sekmesini ve bitirme onayını gösterir', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');

  renderApp(path(subject, topic));

  expect(await screen.findByRole('heading', { level: 1, name: 'Türev' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Durum' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Notlar' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Yanlışlar' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Testler' })).not.toBeInTheDocument();

  expect(screen.getByText('Başlanmadı')).toBeInTheDocument();
  expect(screen.getByText('Henüz tekrar yok')).toBeInTheDocument();
  const doneCheckbox = await screen.findByRole('checkbox', {
    name: 'Bu konuyu bitirdim',
  });
  expect(doneCheckbox).not.toBeChecked();
  // The whole label row is a 44px touch target, not just the 20px box.
  expect(doneCheckbox.closest('label')).toHaveClass('min-h-11');
  expect(await screen.findByText('Eski test kaydı yok')).toBeInTheDocument();
});

test('konuyu bitirince ders sayfası 1/2 konu gösterir', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');

  renderApp(path(subject, topic));

  const checkbox = await screen.findByRole('checkbox', { name: 'Bu konuyu bitirdim' });
  await userEvent.click(checkbox);

  await waitFor(() => expect(checkbox).toBeChecked());
  expect(await screen.findByText('Bitti')).toBeInTheDocument();
  await waitFor(async () => expect(await getTopicDone(topic.id)).toBe(true));

  await userEvent.click(screen.getByRole('link', { name: 'Matematik' }));

  expect(await screen.findByText('1/2 konu · 1 konu kaldı')).toBeInTheDocument();
  expect(screen.getByText('Bitti')).toBeInTheDocument();
  expect(screen.getByText('Başlanmadı')).toBeInTheDocument();
});

test('tekrar geçmişini ve tekrar sayısını gösterir', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  await db.activityLogs.bulkAdd([
    {
      id: 'review-1',
      type: 'topic_review',
      topicId: topic.id,
      source: 'manual',
      createdAt: '2026-11-10T09:00:00.000Z',
    },
    {
      id: 'log-1',
      type: 'book_pages',
      userBookId: 'book-1',
      topicId: topic.id,
      fromPage: 1,
      toPage: 10,
      source: 'task',
      createdAt: '2026-11-11T09:00:00.000Z',
    },
  ]);

  renderApp(path(subject, topic));

  expect(await screen.findByText('1 tekrar')).toBeInTheDocument();
  // A review is a started signal even though the topic is not done.
  expect(screen.getByText('Devam ediyor')).toBeInTheDocument();
  const history = await screen.findByRole('list', { name: 'Tekrar geçmişi' });
  expect(within(history).getAllByRole('listitem')).toHaveLength(1);
  expect(within(history).getByText('10 Kas 2026')).toBeInTheDocument();
});

test('eski test kayıtlarını salt okunur arşiv olarak gösterir', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');
  const book = await createBook({ name: 'Eski Türev Kitabı', publisher: 'Palme' });
  await upsertTopicBook({
    topicId: topic.id,
    bookId: book.id,
    totalTests: 6,
    solvedTests: 5,
  });

  renderApp(path(subject, topic));

  expect(
    await screen.findByRole('heading', { name: 'Eski test kayıtları' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('5/6 test')).toBeInTheDocument();
  expect(screen.getByText('Eski Türev Kitabı')).toBeInTheDocument();
  expect(screen.getByText('Palme')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /düzenle/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /sil/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Kitap / test ekle' })).not.toBeInTheDocument();
});

test('Notlar ve Yanlışlar sekmeleri açılır', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topic = await topicByKey('tyt-mat-turev');

  renderApp(path(subject, topic));

  await userEvent.click(await screen.findByRole('tab', { name: 'Notlar' }));
  expect(await screen.findByRole('textbox', { name: 'Konu notu' })).toBeInTheDocument();
  expect(screen.getByText('Henüz dosya eklenmedi.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: 'Yanlışlar' }));
  expect(await screen.findByText('Henüz yanlış fotoğrafı yok')).toBeInTheDocument();
});

test('konu bulunamazsa derslere dön bağlantısı gösterir', async () => {
  const subject = await subjectByKey('tyt-mat');

  renderApp(`/tyt/${subject.id}/olmayan-konu`);

  expect(await screen.findByText('Konu bulunamadı')).toBeInTheDocument();
  expect(screen.getByText('Bu konu silinmiş ya da taşınmış olabilir.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Derslere dön' })).toBeInTheDocument();
});
