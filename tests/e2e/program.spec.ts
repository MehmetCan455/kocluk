import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { completeOnboarding, TEST_NAME } from './helpers';

const PROGRAM_IMAGE = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));
const PROGRAM_PDF = fileURLToPath(new URL('./fixtures/program.pdf', import.meta.url));

test('elle çizelge kaydedilir, görsel ve PDF önizlenir, dosyalar silinir', async ({
  page,
}) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  await page
    .locator('header')
    .getByRole('link', { name: 'Ders Çalışma Çizelgesi', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ders Çalışma Çizelgesi' }),
  ).toBeVisible();

  // Manual table is the default mode.
  const table = page.getByRole('table', { name: 'Haftalık ders çalışma tablosu' });
  await expect(table).toBeVisible();
  await table.getByLabel('1. satır ders').fill('Matematik');
  await table.getByLabel('1. satır Pazartesi').fill('2 saat');
  await table.getByLabel('1. satır Salı').fill('40 soru');
  await table.getByLabel('1. satır toplam').fill('2 saat');
  await table.getByLabel('Toplam satırı Pazartesi').fill('10 saat');
  await table.getByLabel('Genel toplam').fill('10 saat');
  await page.getByLabel('Haftanın notu').fill('E2E hafta notu');
  // The table autosaves shortly after the last edit.
  await expect(page.getByText('Kaydedildi', { exact: true })).toBeVisible({
    timeout: 5_000,
  });

  // Upload mode still keeps the photo/PDF archive.
  await page.getByRole('button', { name: 'Fotoğraf/PDF', exact: true }).click();
  await expect(page.getByText('Henüz çizelge dosyası yok')).toBeVisible();

  const fileInput = page.getByLabel('Çizelge dosyası seç');
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
  const pdfDeleteDialog = page.getByRole('dialog', { name: 'Çizelge dosyasını sil' });
  await pdfDeleteDialog.getByRole('button', { name: 'Sil' }).click();
  await expect(pdfDeleteDialog).not.toBeVisible();
  await expect(page.getByText('program.pdf', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: 'photo.png dosyasını sil' }).click();
  const imageDeleteDialog = page.getByRole('dialog', { name: 'Çizelge dosyasını sil' });
  await imageDeleteDialog.getByRole('button', { name: 'Sil' }).click();
  await expect(imageDeleteDialog).not.toBeVisible();
  await expect(page.getByText('Henüz çizelge dosyası yok')).toBeVisible();

  // The upload mode choice survives a reload; the saved table is still there.
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ders Çalışma Çizelgesi' }),
  ).toBeVisible();
  await expect(page.getByText('Henüz çizelge dosyası yok')).toBeVisible();
  await page.getByRole('button', { name: 'Elle tablo', exact: true }).click();
  const reloadedTable = page.getByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  await expect(reloadedTable.getByLabel('1. satır ders')).toHaveValue('Matematik');
  await expect(reloadedTable.getByLabel('1. satır Pazartesi')).toHaveValue('2 saat');
  await expect(page.getByLabel('Haftanın notu')).toHaveValue('E2E hafta notu');
});
