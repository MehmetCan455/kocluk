import { expect, test } from '@playwright/test';
import { completeOnboarding, createTytExam } from './helpers';

test('yedek indirilir, veriler silinir ve yedekten geri yüklenir', async ({ page }) => {
  await completeOnboarding(page, 'Yedek Kullanıcı', 'Tümü');
  await createTytExam(page, 'Yedeğe Giren Deneme');

  await page.getByRole('link', { name: 'Ayarlar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Yedek indir' }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  expect(download.suggestedFilename()).toMatch(/^kocluk-yedek-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);

  await page.getByRole('button', { name: 'Tüm verileri sil' }).click();
  await page.getByRole('button', { name: 'Devam et' }).click();
  await page.getByRole('button', { name: 'Tüm verileri kalıcı olarak sil' }).click();
  await expect(page.getByRole('heading', { name: 'Seni tanıyalım' })).toBeVisible();

  // Onboarding after a reset restores the seed; the backup import below then
  // replaces every table, including the profile name.
  await completeOnboarding(page, 'Geçici Profil', 'Tümü');
  await page.getByRole('link', { name: 'Ayarlar', exact: true }).click();
  await page
    .getByLabel('Yedek dosyası seç')
    .setInputFiles(backupPath as string);
  await page.getByRole('button', { name: 'Mevcut verileri değiştir' }).click();
  await expect(page.getByText('Yedek geri yüklendi.')).toBeVisible();
  await expect(page.getByLabel('Ad soyad')).toHaveValue('Yedek Kullanıcı');

  await page.getByRole('link', { name: 'Denemeler', exact: true }).click();
  await expect(page.getByRole('link', { name: /Yedeğe Giren Deneme/ })).toBeVisible();
});
