import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

vi.mock('./searchAll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./searchAll')>();
  return {
    ...actual,
    searchAll: vi.fn().mockRejectedValue(new Error('IndexedDB okunamadı')),
  };
});

beforeEach(async () => {
  await seedOnboarded(CURRICULUM);
});

test('arama başarısız olursa modal kapanmadan yerel hata gösterir', async () => {
  renderApp('/');
  await userEvent.click(await screen.findByRole('button', { name: 'Ara' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ara' });
  await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Genel arama' }), 'türev');

  expect(
    await within(dialog).findByText('Arama yapılamadı. Lütfen tekrar dene.'),
  ).toBeInTheDocument();
  expect(within(dialog).getByRole('searchbox', { name: 'Genel arama' })).toBeInTheDocument();
});
