import { expect, test } from '@playwright/test';
import { completeOnboarding, TEST_NAME } from './helpers';

test('haftalık planda sayfa zinciri oluşturur, kaçırır ve sonraki güne ekler', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  await page.goto('./#/kitaplar');
  await page.getByRole('button', { name: 'Kitap ekle' }).first().click();
  await page.getByLabel('Kitap, yayınevi veya ders ara').fill('Hiç Problem Değil');
  await page.getByRole('button', { name: /Hiç Problem Değil.*rafıma ekle/ }).click();

  await page.goto('./#/program');
  // Use next week so the Mon–Fri chain is entirely in the future; otherwise a
  // run on a later weekday would auto-miss some days before the explicit test.
  await page.getByRole('button', { name: 'Sonraki hafta' }).click();
  await page.getByRole('button', { name: 'Satır ekle' }).click();
  await page.getByLabel('1. satır', { exact: true }).fill('Matematik');
  await expect(page.getByText('Kaydedildi', { exact: true })).toBeVisible({ timeout: 5_000 });

  await page.getByRole('button', { name: 'Sayfa zinciri' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sayfa zinciri oluştur' });
  // Days stay disabled until the chain is bound to a plan row.
  await dialog.getByLabel('Satır').selectOption({ label: 'Matematik' });
  for (const day of ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']) {
    // The checkbox is sr-only; the visible label tile is the real tap target.
    await dialog.locator(`label:has(input[aria-label="${day}"])`).click();
    await expect(
      dialog.getByRole('checkbox', { name: day, exact: true }),
    ).toBeChecked();
  }
  await dialog.getByLabel('Kitap ara').fill('Hiç Problem Değil');
  await dialog.getByRole('option', { name: /Hiç Problem Değil/ }).click();
  await dialog.getByLabel('Başlangıç sayfası').fill('100');
  await dialog.getByLabel('Bitiş sayfası').fill('150');
  await expect(dialog.getByText('Pzt 100–109')).toBeVisible();
  await dialog.getByRole('button', { name: 'Zinciri oluştur' }).click();

  await page.getByRole('button', { name: 'Tik modu' }).click();
  // The mobile plan renders only the selected day; open Tuesday for its chip.
  await page
    .getByRole('group', { name: 'Çizelge günü' })
    .getByRole('button', { name: 'Sal Salı' })
    .click();
  await page.getByRole('button', { name: /110–119.*Planlandı/ }).click({ button: 'right' });
  await expect(page.getByText('Planlanmamış sayfalar')).toBeVisible();
  await expect(page.getByText('140–150')).toBeVisible();
  await page.getByRole('button', { name: 'Sonraki boş güne ekle' }).click();
  await expect(page.getByText('Planlanmamış sayfalar')).not.toBeVisible();

  await page.reload();
  // Reload resets the plan to the current week; return to the chain week.
  await page.getByRole('button', { name: 'Sonraki hafta' }).click();
  await page
    .getByRole('group', { name: 'Çizelge günü' })
    .getByRole('button', { name: 'Cmt Cumartesi' })
    .click();
  await expect(page.getByText(/Syf\. 140–150/)).toBeVisible();
});
