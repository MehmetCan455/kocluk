import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { completeOnboarding, TEST_NAME } from './helpers';

const PROGRAM_IMAGE = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));
const PROGRAM_PDF = fileURLToPath(new URL('./fixtures/program.pdf', import.meta.url));

/**
 * Mirrors `weekLabel` in `src/domain/schedule.ts`; importing the app module
 * would put a source file outside the e2e TypeScript project.
 */
function currentWeekLabel(now = new Date()): string {
  const dayIndex = now.getDay();
  const mondayOffset = dayIndex === 0 ? -6 : 1 - dayIndex;
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + mondayOffset,
  );
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 6,
  );
  const dayMonth = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
  });
  const full = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  if (start.getFullYear() !== end.getFullYear()) {
    return `${full.format(start)} – ${full.format(end)}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${dayMonth.format(start)} – ${full.format(end)}`;
  }
  return `${start.getDate()}–${full.format(end)}`;
}

async function openProgram(page: import('@playwright/test').Page): Promise<void> {
  await page
    .locator('header')
    .getByRole('link', { name: 'Ders Çalışma Çizelgesi', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ders Çalışma Çizelgesi' }),
  ).toBeVisible();
}

test('haftalık plan satırı ve görev tiklenir, yeniden yüklemede korunur', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await openProgram(page);

  await expect(page.getByText(currentWeekLabel(), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Satır ekle' })).toBeVisible();

  await page.getByRole('button', { name: 'Satır ekle' }).click();
  const rowLabel = page.getByLabel('1. satır', { exact: true });
  await rowLabel.fill('Matematik');

  // Rows autosave shortly after the last edit.
  await expect(page.getByText('Kaydedildi', { exact: true })).toBeVisible({
    timeout: 5_000,
  });

  // A saved row can carry a free-form task; ticking it must persist too.
  await page
    .getByRole('button', { name: 'Matematik Pazartesi görev ekle' })
    .click();
  const taskDialog = page.getByRole('dialog', { name: 'Görev ekle' });
  await expect(taskDialog).toBeVisible();
  await taskDialog.getByRole('button', { name: 'Serbest görev', exact: true }).click();
  await taskDialog.getByLabel('Görev adı').fill('E2E görev');
  await taskDialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(taskDialog).not.toBeVisible();

  const taskCheckbox = page.getByRole('checkbox', {
    name: 'E2E görev görevini tamamla',
  });
  await expect(taskCheckbox).toBeVisible();
  await taskCheckbox.click();
  await expect(taskCheckbox).toBeChecked();

  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ders Çalışma Çizelgesi' }),
  ).toBeVisible();
  await expect(page.getByText(currentWeekLabel(), { exact: true })).toBeVisible();
  await expect(page.getByLabel('1. satır', { exact: true })).toHaveValue('Matematik');
  await expect(
    page.getByRole('checkbox', { name: 'E2E görev görevini tamamla' }),
  ).toBeChecked();
});

test('çizelge fotoğrafı ve PDF dosyası yüklenir, önizlenir ve silinir', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await openProgram(page);

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

  // The upload mode choice survives a reload; the weekly plan still opens.
  await page.reload();
  await expect(page.getByText('Henüz çizelge dosyası yok')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Fotoğraf/PDF', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Elle tablo', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Haftalık ders çalışma tablosu' }),
  ).toBeVisible();
});
