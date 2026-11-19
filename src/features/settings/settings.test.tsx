import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getSettings, patchSettings } from '@/db/repositories';
import { resetDb } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

beforeEach(async () => {
  await resetDb();
});

test('vurgu rengi değişir ve saklanır', async () => {
  renderApp('/ayarlar');
  await userEvent.click(await screen.findByRole('button', { name: 'Yeşil' }));
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#22C55E');
  expect((await getSettings()).accent).toBe('#22C55E');
});

test('kayıtlı vurgu rengini açılışta uygular', async () => {
  await patchSettings({ accent: '#A855F7' });
  renderApp('/');
  await waitFor(() => {
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#A855F7');
  });
});

test('profil adını anında saklar', async () => {
  renderApp('/ayarlar');
  const input = await screen.findByLabelText('Ad soyad');
  fireEvent.change(input, { target: { value: 'Ada' } });
  await waitFor(async () => {
    expect((await getSettings()).profileName).toBe('Ada');
  });
});

test('AYT alanı seçimini saklar', async () => {
  renderApp('/ayarlar');
  await userEvent.selectOptions(await screen.findByLabelText('AYT alanı'), 'sayisal');
  await waitFor(async () => {
    expect((await getSettings()).aytAlan).toBe('sayisal');
  });
});

test('özel hex rengi uygular ve saklar', async () => {
  renderApp('/ayarlar');
  const input = await screen.findByLabelText('Özel renk');
  await userEvent.type(input, '#EC4899');
  await userEvent.click(screen.getByRole('button', { name: 'Uygula' }));
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#EC4899');
  await waitFor(async () => {
    expect((await getSettings()).accent).toBe('#EC4899');
  });
});
