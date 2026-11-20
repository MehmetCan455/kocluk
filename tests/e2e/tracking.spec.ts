import { expect, test } from '@playwright/test';
import { completeOnboarding, TEST_NAME } from './helpers';

test('TYT konusuna kitap ve test eklenir, yüzde güncellenir', async ({ page }) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  await page.getByRole('link', { name: 'TYT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'TYT Dersleri' })).toBeVisible();

  await page.getByRole('link', { name: /Matematik/ }).click();
  await page.getByRole('link', { name: 'Temel Kavramlar' }).click();
  await expect(page.getByRole('heading', { name: 'Temel Kavramlar' })).toBeVisible();

  await page.getByRole('button', { name: 'Kitap / test ekle' }).click();
  await page.getByLabel('Yeni kitap adı').fill('3D TYT Soru Bankası');
  await page.getByLabel('Yayınevi').fill('3D');
  await page.getByLabel('Toplam test').fill('10');
  await page.getByLabel('Çözülen test').fill('4');
  await page.getByRole('button', { name: 'Kaydet' }).click();

  await expect(page.getByText('4/10 test').first()).toBeVisible();
  await expect(page.getByText('%40').first()).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Temel Kavramlar ilerlemesi' }),
  ).toHaveAttribute('aria-valuenow', '40');
  await expect(page.getByText('3D TYT Soru Bankası')).toBeVisible();
});
