import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { completeOnboarding, TEST_NAME } from './helpers';

const PROGRAM_IMAGE = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));
const PROGRAM_PDF = fileURLToPath(new URL('./fixtures/program.pdf', import.meta.url));

test('program kaydı eklenir, görsel ve PDF önizlenir, dosyalar silinir', async ({
  page,
}) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  await page.locator('header').getByRole('link', { name: 'Program', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Haftalık Program' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Kayıt ekle', exact: true }).click();
  const entryDialog = page.getByRole('dialog', { name: 'Yeni program kaydı' });
  await entryDialog.getByLabel(/^Başlık/).fill('E2E program kaydı');
  await entryDialog.getByRole('button', { name: 'Kaydet' }).click();
  await expect(entryDialog).not.toBeVisible();
  await expect(page.getByText('E2E program kaydı', { exact: true })).toBeVisible();

  const fileInput = page.getByLabel('Program dosyası seç');
  await fileInput.setInputFiles(PROGRAM_IMAGE);
  await expect(page.getByText('photo.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'photo.png görselini büyüt' }).click();
  const lightbox = page.getByRole('dialog', { name: 'photo.png' });
  await expect(lightbox.getByRole('img', { name: 'photo.png' })).toBeVisible();
  await lightbox.getByRole('button', { name: 'Kapat' }).click();
  await expect(lightbox).not.toBeVisible();

  await fileInput.setInputFiles(PROGRAM_PDF);
  await expect(page.getByText('program.pdf', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'program.pdf dosyasını aç' }),
  ).toHaveAttribute('href', /^blob:/);

  await page.getByRole('button', { name: 'program.pdf dosyasını sil' }).click();
  const pdfDeleteDialog = page.getByRole('dialog', { name: 'Program dosyasını sil' });
  await pdfDeleteDialog.getByRole('button', { name: 'Sil' }).click();
  await expect(pdfDeleteDialog).not.toBeVisible();
  await expect(page.getByText('program.pdf', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: 'photo.png dosyasını sil' }).click();
  const imageDeleteDialog = page.getByRole('dialog', { name: 'Program dosyasını sil' });
  await imageDeleteDialog.getByRole('button', { name: 'Sil' }).click();
  await expect(imageDeleteDialog).not.toBeVisible();
  await expect(page.getByText('Henüz program dosyası yok')).toBeVisible();
});
