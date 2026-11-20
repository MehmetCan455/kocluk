import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { computeHiddenSubjects } from '@/data/alanSubjects';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import { getSettings, listSubjects, patchSettings } from '@/db/repositories';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

beforeEach(async () => {
  await seedOnboarded(CURRICULUM);
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

test('tarih ipucu yokken sınav tarihi tanımsız bir açıklamaya bağlanmaz', async () => {
  renderApp('/ayarlar');
  const input = await screen.findByLabelText('Sınav tarihi');
  expect(input).toHaveAttribute('aria-describedby', 'sinav-tarihi-hint');

  fireEvent.change(input, { target: { value: '' } });
  await waitFor(() => expect(input).not.toHaveAttribute('aria-describedby'));
});

test('AYT alanı seçimini saklar ve gizli dersleri yeniden hesaplar', async () => {
  renderApp('/ayarlar');
  await userEvent.selectOptions(await screen.findByLabelText('AYT alanı'), 'sayisal');
  await waitFor(async () => {
    const settings = await getSettings();
    expect(settings.aytAlan).toBe('sayisal');
    expect(settings.hiddenSubjects).toEqual(
      computeHiddenSubjects('sayisal', await listSubjects()),
    );
  });
});

test('denemelerde geometri ayarı varsayılan ayrı ve değiştirilebilir', async () => {
  renderApp('/ayarlar');

  const select = await screen.findByLabelText('Denemelerde geometri');
  expect(select).toHaveValue('separate');
  expect((await getSettings()).geometryMode).toBe('separate');

  await userEvent.selectOptions(select, 'combined');
  expect(select).toHaveValue('combined');
  await waitFor(async () => {
    expect((await getSettings()).geometryMode).toBe('combined');
  });

  await userEvent.selectOptions(select, 'separate');
  await waitFor(async () => {
    expect((await getSettings()).geometryMode).toBe('separate');
  });
});

test('ders görünürlüğü TYT ve AYT derslerini birlikte listeler', async () => {
  renderApp('/ayarlar');

  expect(await screen.findByRole('checkbox', { name: 'TYT · Matematik' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'AYT · Matematik' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'TYT · Fizik' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'AYT · Fizik' })).toBeChecked();
});

test('ders görünürlüğü tek tek değiştirilebilir', async () => {
  const fizik = await db.subjects.where('seedKey').equals('ayt-fizik').first();
  expect(fizik).toBeDefined();

  renderApp('/ayarlar');
  const checkbox = await screen.findByRole('checkbox', { name: 'AYT · Fizik' });
  expect(checkbox).toBeChecked();

  await userEvent.click(checkbox);
  expect(checkbox).not.toBeChecked();
  await waitFor(async () => {
    expect((await getSettings()).hiddenSubjects).toContain(fizik!.id);
  });

  await userEvent.click(await screen.findByRole('button', { name: 'Tümünü göster' }));
  expect(await screen.findByRole('checkbox', { name: 'AYT · Fizik' })).toBeChecked();
  await waitFor(async () => {
    expect((await getSettings()).hiddenSubjects).toEqual([]);
  });
});

test('ayar yazımı başarısız olursa görünür uyarı verir ve seçimi geri alır', async () => {
  const fizik = await db.subjects.where('seedKey').equals('ayt-fizik').first();
  expect(fizik).toBeDefined();
  const writeSpy = vi
    .spyOn(db.settings, 'bulkPut')
    .mockRejectedValueOnce(new Error('yazma hatası'));
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  renderApp('/ayarlar');
  const checkbox = await screen.findByRole('checkbox', { name: 'AYT · Fizik' });
  expect(checkbox).toBeChecked();

  await userEvent.click(checkbox);

  expect(
    await screen.findByText('Ayarlar kaydedilemedi. Lütfen tekrar dene.'),
  ).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByRole('checkbox', { name: 'AYT · Fizik' })).toBeChecked();
  });
  expect((await getSettings()).hiddenSubjects).not.toContain(fizik!.id);

  writeSpy.mockRestore();
  consoleSpy.mockRestore();
});

test('geçersiz özel renk hata bildirir ve alanı işaretler', async () => {
  renderApp('/ayarlar');
  const input = await screen.findByLabelText('Özel renk');
  await userEvent.type(input, '#GGGGGG');

  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-describedby', 'ozel-renk-error');
  expect(screen.getByRole('alert')).toHaveTextContent('Geçerli bir hex kodu gir');
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
