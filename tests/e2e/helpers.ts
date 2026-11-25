import { expect, test, type Page } from '@playwright/test';

export const TEST_NAME = 'E2E Öğrenci';

const E2E_PASSWORD = 'e2e-sifre-123';

/**
 * Registers a throwaway account and leaves its session cookie in the page
 * context. Every legacy spec assumed a pre-auth app with a single local
 * database; the shared auth gate now requires a signed-in user before the
 * onboarding flow is reachable.
 */
export async function ensureSignedIn(
  page: Page,
  displayName = TEST_NAME,
): Promise<void> {
  const session = await page.request.get('/api/auth/session');
  if (session.ok()) {
    return;
  }

  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kocluk.local`;
  const baseURL = test.info().project.use.baseURL ?? 'http://localhost:4173/';
  const registered = await page.request.post('/api/auth/register', {
    headers: { Origin: new URL(baseURL).origin },
    data: {
      email,
      password: E2E_PASSWORD,
      displayName,
      privacyAccepted: true,
    },
  });

  expect(registered.status()).toBe(201);
}

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

/**
 * Opens the deployed base path with a signed-in account and completes
 * onboarding in a fresh context. An already signed-in context (for example
 * after clearing all local data) reuses its session.
 */
export async function completeOnboarding(
  page: Page,
  name = TEST_NAME,
  alan: 'Sayısal' | 'Eşit Ağırlık' | 'Sözel' | 'Tümü' = 'Tümü',
): Promise<void> {
  await ensureSignedIn(page, name);
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
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByRole('heading', { name: 'Denemeler' })).toBeVisible();
}
