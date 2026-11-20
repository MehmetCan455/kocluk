import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CURRICULUM } from '@/data/curriculum';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

beforeEach(async () => {
  await seedOnboarded(CURRICULUM);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('ana navigasyonu gösterir', async () => {
  renderApp('/');
  expect(await screen.findByText('Ana Sayfa')).toBeInTheDocument();
  expect(screen.getAllByText('TYT').length).toBeGreaterThan(0);
  expect(screen.getAllByText('AYT').length).toBeGreaterThan(0);
});

test('menüden TYT sayfasına gider', async () => {
  renderApp('/');
  await userEvent.click(await screen.findByRole('link', { name: 'TYT' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'TYT Dersleri' })).toBeInTheDocument();
});

test('menüden Program sayfasına gider', async () => {
  renderApp('/');
  const nav = await screen.findByRole('navigation', { name: 'Ana menü' });
  await userEvent.click(within(nav).getByRole('link', { name: 'Program' }));
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Haftalık Program' }),
  ).toBeInTheDocument();
});

test('ayarlar rotasını açar', async () => {
  renderApp('/ayarlar');
  expect(await screen.findByRole('heading', { level: 1, name: 'Ayarlar' })).toBeInTheDocument();
});

test('henüz yazılmamış rotalar için yer tutucu gösterir', async () => {
  renderApp('/yanlislar');
  expect(await screen.findByRole('heading', { level: 1, name: 'Yanlışlar' })).toBeInTheDocument();
});

test('mobilde alt navigasyonu gösterir', async () => {
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
  expect(await screen.findByRole('navigation', { name: 'Alt menü' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Denemeler' })).toBeInTheDocument();
  expect(
    within(screen.getByRole('banner')).getByRole('link', { name: 'Program' }),
  ).toBeInTheDocument();
});

test('bilinmeyen rota için bulunamadı sayfası gösterir', async () => {
  renderApp('/bilinmeyen');
  expect(await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' })).toBeInTheDocument();
});
