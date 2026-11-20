import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { completeOnboarding, TEST_NAME } from './helpers';

const PHOTO_FIXTURE = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));

test('fotoğraf yüklenir, filtrelenir ve rastgele test tamamlanır', async ({ page }) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  await page.getByRole('link', { name: 'Yanlışlar', exact: true }).click();
  await page.getByRole('button', { name: 'Fotoğraf ekle', exact: true }).click();

  await page.getByLabel('Galeriden seç').setInputFiles(PHOTO_FIXTURE);
  await page
    .getByRole('combobox', { name: 'Ders', exact: true })
    .selectOption({ label: 'Matematik' });
  await page
    .getByRole('textbox', { name: 'Not', exact: true })
    .fill('Türev sorusunda zincir kuralı');
  await page.getByRole('button', { name: 'Yükle' }).click();

  await expect(page.getByText('1 fotoğraf', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Türev sorusunda zincir kuralı/ })).toBeVisible();

  await page.getByLabel('Sınav türü filtresi').selectOption('TYT');
  await page.getByLabel('Ders filtresi').selectOption({ label: 'TYT · Matematik' });
  await expect(page.getByText('1 fotoğraf', { exact: false }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Test oluştur' }).click();
  await expect(page.getByRole('heading', { name: 'Rastgele Test' })).toBeVisible();
  await page.getByRole('button', { name: 'Testi başlat' }).click();

  await expect(page.getByRole('heading', { name: 'Test oturumu' })).toBeVisible();
  await page.getByRole('button', { name: 'Doğru', exact: true }).click();
  await page.getByRole('button', { name: 'Testi bitir' }).click();

  await expect(page.getByRole('heading', { name: 'Test tamamlandı' })).toBeVisible();
  await expect(page.getByText('1/1 doğru')).toBeVisible();
});
