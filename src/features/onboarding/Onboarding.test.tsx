import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import { getSettings, listSubjects } from '@/db/repositories';
import { resetDb } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

beforeEach(async () => {
  await resetDb();
});

test('açılışta müfredatı seed eder ve onboarding gösterir', async () => {
  renderApp('/');

  expect(await screen.findByRole('heading', { name: 'Seni tanıyalım' })).toBeInTheDocument();

  await waitFor(async () => {
    expect(await listSubjects()).toHaveLength(22);
  });
  expect((await getSettings()).seedVersion).toBe(CURRICULUM.version);
});

test('ilk açılışta onboarding akışını tamamlar ve ayarları saklar', async () => {
  renderApp('/');

  expect(await screen.findByRole('heading', { name: 'Seni tanıyalım' })).toBeInTheDocument();

  await userEvent.type(await screen.findByLabelText('Adın'), 'Deniz');
  await userEvent.click(screen.getByRole('button', { name: 'İleri' }));

  await userEvent.click(await screen.findByRole('radio', { name: 'Sayısal' }));
  await userEvent.click(screen.getByRole('button', { name: 'İleri' }));

  await userEvent.click(await screen.findByRole('button', { name: 'Yeşil' }));
  await userEvent.click(screen.getByRole('button', { name: 'İleri' }));

  await userEvent.click(await screen.findByRole('button', { name: 'Başla' }));

  await waitFor(async () => {
    const settings = await getSettings();
    expect(settings.profileName).toBe('Deniz');
    expect(settings.aytAlan).toBe('sayisal');
    expect(settings.accent).toBe('#22C55E');
    expect(settings.onboardingDone).toBe(true);
    expect(settings.hiddenSubjects.length).toBeGreaterThan(0);
  });

  const settings = await getSettings();
  const aytSubjects = await listSubjects('AYT');
  const hiddenSeedKeys = aytSubjects
    .filter((subject) => settings.hiddenSubjects.includes(subject.id))
    .map((subject) => subject.seedKey)
    .sort();

  expect(hiddenSeedKeys).toEqual(
    [
      'ayt-cografya-1',
      'ayt-cografya-2',
      'ayt-din-kulturu',
      'ayt-edebiyat',
      'ayt-felsefe-grubu',
      'ayt-tarih-1',
      'ayt-tarih-2',
    ].sort(),
  );

  expect(await screen.findByRole('heading', { level: 1, name: 'Genel Bakış' })).toBeInTheDocument();
});

test('ayar yazımı başarısız olursa onboarding tamamlanmaz', async () => {
  const writeSpy = vi
    .spyOn(db.settings, 'bulkPut')
    .mockRejectedValueOnce(new Error('yazma hatası'));
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  renderApp('/');

  expect(await screen.findByRole('heading', { name: 'Seni tanıyalım' })).toBeInTheDocument();
  await userEvent.type(await screen.findByLabelText('Adın'), 'Deniz');
  await userEvent.click(screen.getByRole('button', { name: 'İleri' }));
  await userEvent.click(await screen.findByRole('radio', { name: 'Tümü' }));
  await userEvent.click(screen.getByRole('button', { name: 'İleri' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Mavi' }));
  await userEvent.click(screen.getByRole('button', { name: 'İleri' }));
  await userEvent.click(screen.getByRole('button', { name: 'Başla' }));

  expect(
    await screen.findByText('Kurulum tamamlanamadı. Lütfen tekrar dene.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Hazırsın' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Başla' })).toBeEnabled();
  expect((await getSettings()).onboardingDone).toBe(false);

  writeSpy.mockRestore();
  consoleSpy.mockRestore();
});
