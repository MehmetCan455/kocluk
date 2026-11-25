import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import { saveNote } from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
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
  const topic = await db.topics.where('seedKey').equals('tyt-mat-turev').first();
  if (!topic) {
    throw new Error('Türev konusu bulunamadı');
  }
  await saveNote(topic.id, '<p>Türev konu anlatımı</p><p>Limit ve süreklilik</p>', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('arama düğmesi modalı açar, boş sorguda hızlı bağlantıları gösterir', async () => {
  renderApp('/');

  await userEvent.click(await screen.findByRole('button', { name: 'Ara' }));

  const dialog = await screen.findByRole('dialog', { name: 'Ara' });
  const searchbox = within(dialog).getByRole('searchbox', { name: 'Genel arama' });
  expect(searchbox).toHaveFocus();

  const quickLinks = within(dialog).getByRole('list', { name: 'Hızlı erişim' });
  expect(within(quickLinks).getByRole('link', { name: 'Denemeler' })).toBeInTheDocument();
  expect(within(quickLinks).getByRole('link', { name: 'Kitaplar' })).toBeInTheDocument();

  expect(await within(dialog).findByText('Son eklenen konular')).toBeInTheDocument();
  expect(within(dialog).queryByRole('list', { name: 'Konular' })).not.toBeInTheDocument();
});

test('türev araması sonuçları gruplar ve sonuca tıklayınca konuya gider', async () => {
  renderApp('/');

  await userEvent.click(await screen.findByRole('button', { name: 'Ara' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ara' });
  await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Genel arama' }), 'türev');

  const topicResults = await within(dialog).findByRole('list', { name: 'Konular' });
  const noteResults = within(dialog).getByRole('list', { name: 'Notlar' });
  expect(within(topicResults).getByRole('link', { name: /Türev/ })).toBeInTheDocument();
  expect(within(noteResults).getByRole('link', { name: /Türev konu anlatımı/ })).toBeInTheDocument();

  await userEvent.click(within(topicResults).getByRole('link', { name: /Türev/ }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Türev' })).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Ara' })).not.toBeInTheDocument();
  });
});

test('Ctrl+K ile açılır, Escape ile kapanır', async () => {
  renderApp('/');

  // Wait for the app shell: the auth gate mounts it after its local checks.
  await screen.findByRole('button', { name: 'Ara' });
  await userEvent.keyboard('{Control>}k{/Control}');
  expect(await screen.findByRole('dialog', { name: 'Ara' })).toBeInTheDocument();

  await userEvent.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Ara' })).not.toBeInTheDocument();
  });
});

test('eşleşmeyen sorgu için boş sonuç mesajı gösterir', async () => {
  renderApp('/');

  await userEvent.click(await screen.findByRole('button', { name: 'Ara' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ara' });
  await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Genel arama' }), 'zzzz');

  expect(await within(dialog).findByText('Eşleşen sonuç yok.')).toBeInTheDocument();
});

test('mobil üst bardaki arama düğmesi modalı açar', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  renderApp('/');

  await userEvent.click(await screen.findByRole('button', { name: 'Ara' }));
  expect(await screen.findByRole('dialog', { name: 'Ara' })).toBeInTheDocument();
});
