import { expect, test } from '@playwright/test';
import { completeOnboarding, TEST_NAME } from './helpers';

test('TYT konusu bitirilince durum ve ilerleme güncellenir', async ({ page }) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  await page.getByRole('link', { name: 'TYT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'TYT Dersleri' })).toBeVisible();

  await page.getByRole('link', { name: /Matematik/ }).click();
  await page.getByRole('link', { name: 'Temel Kavramlar' }).click();
  await expect(page.getByRole('heading', { name: 'Temel Kavramlar' })).toBeVisible();

  await expect(page.getByRole('tab', { name: 'Durum' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const doneCheckbox = page.getByRole('checkbox', { name: 'Bu konuyu bitirdim' });
  // The checkbox is controlled by a live Dexie query, so its checked state
  // settles asynchronously; click and let the assertion retry.
  await doneCheckbox.click();
  await expect(doneCheckbox).toBeChecked();

  await expect(page.getByText('Bitti', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Temel Kavramlar ilerlemesi' }),
  ).toHaveAttribute('aria-valuenow', '100');

  await expect(page.getByRole('heading', { name: 'Tekrar geçmişi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Eski test kayıtları' })).toBeVisible();
  await expect(page.getByText('Eski test kaydı yok')).toBeVisible();
});
