import { expect, test } from '@playwright/test';
import { completeOnboarding, TEST_NAME } from './helpers';

const PAGES: ReadonlyArray<{ path: string; heading: string }> = [
  { path: './#/', heading: 'Genel Bakış' },
  { path: './#/tyt', heading: 'TYT Dersleri' },
  { path: './#/denemeler', heading: 'Denemeler' },
  { path: './#/yanlislar', heading: 'Yanlışlar' },
  { path: './#/program', heading: 'Ders Çalışma Çizelgesi' },
  { path: './#/kitaplar', heading: 'Kitaplar' },
  { path: './#/ayarlar', heading: 'Ayarlar' },
];

test('360 px genişlikte sayfalarda yatay kaydırma olmaz', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  for (const { path, heading } of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} yatay kaydırma üretti`).toBeLessThanOrEqual(1);
  }
});

test('390, 768 ve 1024 px ana sayfada yatay kaydırma olmaz', async ({ page }) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./#/');
    await expect(page.getByRole('heading', { level: 1, name: 'Genel Bakış' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${width} px yatay kaydırma üretti`).toBeLessThanOrEqual(1);
  }
});

test('1024 px program sayfasında yatay kaydırma olmaz', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.goto('./#/program');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Ders Çalışma Çizelgesi' }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('1440 px masaüstünde yan menü görünür ve yatay kaydırma olmaz', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  await expect(page.getByRole('navigation', { name: 'Ana menü' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
