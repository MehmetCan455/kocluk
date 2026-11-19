import { screen } from '@testing-library/react';
import { CURRICULUM } from '@/data/curriculum';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

beforeEach(async () => {
  await seedOnboarded(CURRICULUM);
});

test('uygulama kabuğunu ve ana sayfayı gösterir', async () => {
  renderApp('/');
  expect(await screen.findByRole('heading', { level: 1, name: 'Genel Bakış' })).toBeInTheDocument();
  expect(screen.getAllByText('Koçluk').length).toBeGreaterThan(0);
});
