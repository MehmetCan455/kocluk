import { expect, test } from '@playwright/test';
import { ensureSignedIn, finishOnboarding } from './helpers';

test('ilk açılışta onboarding tamamlanır ve ana sayfa açılır', async ({ page }) => {
  await ensureSignedIn(page, 'Ada');
  await page.goto('./');

  await expect(page.getByRole('heading', { name: 'Seni tanıyalım' })).toBeVisible();
  await page.getByLabel('Adın').fill('Ada');
  await page.getByRole('button', { name: 'İleri' }).click();
  await page.getByRole('radio', { name: 'Sayısal' }).check();
  await page.getByRole('button', { name: 'İleri' }).click();
  await page.getByRole('button', { name: 'Turkuaz' }).click();
  await page.getByRole('button', { name: 'İleri' }).click();

  await expect(page.getByText('Ada')).toBeVisible();
  await page.getByRole('button', { name: 'Başla' }).click();

  await expect(page.getByRole('heading', { name: 'Genel Bakış' })).toBeVisible();
  await expect(page.getByText('Merhaba, Ada')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Alt menü' })).toBeVisible();
});

test('onboarding tamamlanmadan korumalı rota açılmaz', async ({ page }) => {
  await ensureSignedIn(page, 'Koruma Testi');
  await page.goto('./#/ayarlar');
  await expect(page.getByRole('heading', { name: 'Seni tanıyalım' })).toBeVisible();

  await finishOnboarding(page, 'Koruma Testi', 'Tümü');
  await page.goto('./#/ayarlar');
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible();
});
