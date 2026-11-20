import { expect, type Page } from '@playwright/test';

export const TEST_NAME = 'E2E Öğrenci';

/** Walks the four onboarding steps assuming the onboarding route is visible. */
export async function finishOnboarding(
  page: Page,
  name = TEST_NAME,
  alan: 'Sayısal' | 'Eşit Ağırlık' | 'Sözel' | 'Tümü' = 'Tümü',
): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Seni tanıyalım' })).toBeVisible();
  await page.getByLabel('Adın').fill(name);
  await page.getByRole('button', { name: 'İleri' }).click();
  await page.getByRole('radio', { name: alan }).check();
  await page.getByRole('button', { name: 'İleri' }).click();
  await page.getByRole('button', { name: 'Mavi' }).click();
  await page.getByRole('button', { name: 'İleri' }).click();
  await page.getByRole('button', { name: 'Başla' }).click();
  await expect(page.getByRole('heading', { name: 'Genel Bakış' })).toBeVisible();
}

/** Opens the deployed base path and completes onboarding in a fresh context. */
export async function completeOnboarding(
  page: Page,
  name = TEST_NAME,
  alan: 'Sayısal' | 'Eşit Ağırlık' | 'Sözel' | 'Tümü' = 'Tümü',
): Promise<void> {
  await page.goto('./');
  await finishOnboarding(page, name, alan);
}

/** Creates a TYT exam with a known net (20 - 5/4 = 18.75). */
export async function createTytExam(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Denemeler', exact: true }).click();
  await page.getByRole('link', { name: 'Yeni deneme' }).click();
  await page.getByLabel('Deneme adı').fill(name);
  await page.getByLabel('Matematik doğru').fill('20');
  await page.getByLabel('Matematik yanlış').fill('5');
  await page.getByLabel('Matematik boş').fill('5');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByRole('heading', { name: 'Denemeler' })).toBeVisible();
}
