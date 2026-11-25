import { expect, test } from '@playwright/test';
import { ensureSignedIn, finishOnboarding, TEST_NAME } from './helpers';

test('manifest kurulabilir ve uygulama ilk yüklemeden sonra çevrimdışı açılır', async ({
  context,
  page,
}) => {
  await ensureSignedIn(page, TEST_NAME);
  await page.goto('./');
  await finishOnboarding(page, TEST_NAME, 'Tümü');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      throw new Error('Manifest bağlantısı yok');
    }
    const response = await fetch(link.href);
    return (await response.json()) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      scope: string;
      theme_color: string;
      icons: Array<{ sizes: string; purpose?: string }>;
    };
  });

  expect(manifest.name).toBe('Zirve Akademi — YKS Takip');
  expect(manifest.short_name).toBe('Zirve Akademi');
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#07080A');
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');
  expect(manifest.icons.some((icon) => icon.sizes === '192x192')).toBe(true);
  expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

  // Wait until the generated service worker is active and controlling.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Genel Bakış' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Alt menü' })).toBeVisible();

  // A route whose lazy chunk was not needed yet must still open from precache.
  await page.getByRole('link', { name: 'Denemeler', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Denemeler' })).toBeVisible();
  await context.setOffline(false);
});

test('kurulum istemi beforeinstallprompt sonrası görünür ve kapatılabilir', async ({ page }) => {
  await ensureSignedIn(page, TEST_NAME);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Seni tanıyalım' })).toBeVisible();

  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    };
    event.prompt = async () => undefined;
    event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
    window.dispatchEvent(event);
  });

  await expect(page.getByLabel('Uygulama kurulumu')).toBeVisible();
  await page.getByRole('button', { name: 'Kurulum istemini kapat' }).click();
  await expect(page.getByLabel('Uygulama kurulumu')).not.toBeVisible();
});
