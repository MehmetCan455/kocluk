import { expect, test, type Locator } from '@playwright/test';
import { completeOnboarding, TEST_NAME } from './helpers';

const DAYS = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
] as const;

async function expectOnlyDayColumn(table: Locator, selectedDay: (typeof DAYS)[number]) {
  for (const day of DAYS) {
    const header = table.getByRole('columnheader', { name: day, exact: true });
    if (day === selectedDay) {
      await expect(header).toBeVisible();
    } else {
      await expect(header).toHaveCount(0);
    }
  }
}

async function expectDaysWithinWidth(table: Locator, width: number) {
  for (const day of DAYS) {
    const header = table.getByRole('columnheader', { name: day, exact: true });
    await expect(header).toBeVisible();
    const box = await header.boundingBox();
    if (!box) throw new Error(`${day} sütun başlığının konumu alınamadı`);
    expect(
      box.x + box.width,
      `${day} sütununun sağ kenarı ${width} px görünümünü aşıyor`,
    ).toBeLessThanOrEqual(width + 1);
  }
}

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
  await expectOnlyDayColumn(table, 'Pazartesi');

  await page.getByRole('button', { name: 'Salı' }).click();
  await expectOnlyDayColumn(table, 'Salı');

  // Text written before a day switch must survive a hide/reveal cycle and the
  // revealed field must autosize without an inner scrollbar.
  const cell = table.getByLabel('1. satır Salı');
  await cell.fill('X'.repeat(120));
  await page.getByRole('button', { name: 'Pazartesi' }).click();
  await page.getByRole('button', { name: 'Salı' }).click();

  await expect
    .poll(async () => cell.evaluate((field) => field.clientHeight))
    .toBeGreaterThan(44);
  const revealOverflow = await cell.evaluate(
    (field) => field.scrollHeight - field.clientHeight,
  );
  expect(revealOverflow).toBeLessThanOrEqual(1);
});

test('768 px çizelgede yedi gün sığar ve uzun hücre aşağı büyür', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.goto('./#/program');

  const table = page.getByRole('table', { name: 'Haftalık ders çalışma tablosu' });
  await expectDaysWithinWidth(table, 768);

  const tableOverflow = await table.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(tableOverflow).toBeLessThanOrEqual(1);

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);

  const row = table.locator('tbody tr').first();
  const before = await row.evaluate((el) => el.getBoundingClientRect().height);
  const cell = table.getByLabel('1. satır Pazartesi');
  await cell.fill('X'.repeat(120));

  await expect
    .poll(async () => row.evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThan(before);

  await expectDaysWithinWidth(table, 768);

  const cellOverflow = await cell.evaluate((element) => ({
    vertical: element.scrollHeight - element.clientHeight,
    horizontal: element.scrollWidth - element.clientWidth,
  }));
  expect(cellOverflow.vertical).toBeLessThanOrEqual(1);
  expect(cellOverflow.horizontal).toBeLessThanOrEqual(1);

  const overflowAfterFill = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflowAfterFill).toBeLessThanOrEqual(1);
});
