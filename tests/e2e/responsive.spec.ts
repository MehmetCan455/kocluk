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

test('390 px çizelgede tek gün görünür ve gün değiştirilir', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.goto('./#/program');

  const table = page.getByRole('table', { name: 'Haftalık ders çalışma tablosu' });
  await expect(table.getByRole('columnheader', { name: 'Pazartesi' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Salı' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Salı', exact: true }).click();
  await expect(table.getByRole('columnheader', { name: 'Salı' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Pazartesi' })).toHaveCount(0);

  const height = await table
    .getByLabel('1. satır Salı')
    .evaluate((field) => field.clientHeight);
  expect(height).toBeGreaterThan(40);
});

test('768 px çizelgede yedi gün sığar ve uzun hücre aşağı büyür', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.goto('./#/program');

  const table = page.getByRole('table', { name: 'Haftalık ders çalışma tablosu' });
  await expect(
    table.getByRole('columnheader', { name: 'Pazar', exact: true }),
  ).toBeVisible();

  const tableOverflow = await table.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(tableOverflow).toBeLessThanOrEqual(1);

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);

  const row = table.locator('tbody tr').first();
  const before = await row.boundingBox();
  const cell = table.getByLabel('1. satır Pazartesi');
  await cell.fill('X'.repeat(120));

  await expect
    .poll(async () => (await row.boundingBox())?.height ?? 0)
    .toBeGreaterThan(before?.height ?? 0);

  const cellOverflow = await cell.evaluate((element) => ({
    vertical: element.scrollHeight - element.clientHeight,
    horizontal: element.scrollWidth - element.clientWidth,
  }));
  expect(cellOverflow.vertical).toBeLessThanOrEqual(1);
  expect(cellOverflow.horizontal).toBeLessThanOrEqual(1);
});
