import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import type { CurriculumSeed } from '@/db/repositories';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';
import type { SearchResult } from './searchAll';

const { searchAllMock } = vi.hoisted(() => ({ searchAllMock: vi.fn() }));

vi.mock('./searchAll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./searchAll')>();
  return {
    ...actual,
    searchAll: searchAllMock,
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
      topics: [{ seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 }],
    },
  ],
};

const RAPID_TYPING = ['t', 'tü', 'tür', 'türe', 'türev'];

beforeEach(async () => {
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
  searchAllMock.mockReset();
  searchAllMock.mockImplementation(async (query: string): Promise<SearchResult[]> => {
    if (query.toLocaleLowerCase('tr-TR').includes('türev')) {
      return [
        {
          kind: 'topic',
          id: 'topic-1',
          title: 'Türev',
          subtitle: 'Matematik · TYT',
          href: '/tyt/subject-1/topic-1',
        },
      ];
    }
    return [];
  });
});

test('hızlı yazışta tek sorgu çalıştırır ve gecikme boyunca Aranıyor gösterir', async () => {
  renderApp('/');

  await userEvent.click(await screen.findByRole('button', { name: 'Ara' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ara' });
  const searchbox = within(dialog).getByRole('searchbox', { name: 'Genel arama' });

  // Tüm tuşlar aynı anda, debounce süresi dolmadan girilir.
  for (const value of RAPID_TYPING) {
    fireEvent.change(searchbox, { target: { value } });
  }

  expect(searchAllMock.mock.calls.filter(([query]) => query !== '')).toHaveLength(0);
  expect(within(dialog).getByText('Aranıyor…')).toBeInTheDocument();
  expect(within(dialog).queryByRole('list', { name: 'Konular' })).not.toBeInTheDocument();
  expect(within(dialog).queryByText('Eşleşen sonuç yok.')).not.toBeInTheDocument();

  await waitFor(
    () => {
      expect(within(dialog).getByRole('list', { name: 'Konular' })).toBeInTheDocument();
    },
    { timeout: 2000 },
  );

  expect(within(dialog).queryByText('Aranıyor…')).not.toBeInTheDocument();
  expect(searchAllMock.mock.calls.filter(([query]) => query !== '')).toHaveLength(1);
  expect(searchAllMock).toHaveBeenCalledWith('türev');
});
