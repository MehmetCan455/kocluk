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

async function expectSevenDayTable(table: Locator) {
  for (const day of DAYS) {
    await expect(
      table.getByRole('columnheader', { name: day, exact: true }),
    ).toBeVisible();
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
  const cell = table.getByLabel('1. satır Salı', { exact: true });
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

test('768 px çizelgede yedi gün kaydırılarak görünür ve uzun hücre aşağı büyür', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.goto('./#/program');

  const table = page.getByRole('table', { name: 'Haftalık ders çalışma tablosu' });
  await expectSevenDayTable(table);

  const scroll = await table.evaluate((element) => {
    const wrapper = element.parentElement;
    return {
      table: element.scrollWidth,
      wrapper: wrapper?.clientWidth ?? 0,
      overflowX: wrapper ? getComputedStyle(wrapper).overflowX : '',
    };
  });
  expect(scroll.wrapper).toBeGreaterThan(0);
  expect(scroll.table).toBeGreaterThan(scroll.wrapper);
  expect(['auto', 'scroll']).toContain(scroll.overflowX);

  const originalScrollLeft = await table.evaluate((element) => {
    const wrapper = element.parentElement;
    if (!wrapper) return 0;
    const original = wrapper.scrollLeft;
    wrapper.scrollLeft = wrapper.scrollWidth;
    return original;
  });
  const scrolledLeft = await table.evaluate(
    (element) => element.parentElement?.scrollLeft ?? 0,
  );
  expect(scrolledLeft).toBeGreaterThan(0);

  // The subject column must stay pinned to the left edge while the days scroll.
  const sticky = await table.evaluate((element) => {
    const wrapper = element.parentElement;
    if (!wrapper) throw new Error('Kaydırma kapsayıcısı bulunamadı');
    const wrapperRect = wrapper.getBoundingClientRect();
    const headerRect = element
      .querySelector('thead th')
      ?.getBoundingClientRect();
    const subjectRect = element
      .querySelector('tbody tr textarea')
      ?.getBoundingClientRect();
    return {
      headerOffset: headerRect ? headerRect.left - wrapperRect.left : Number.NaN,
      subjectInside:
        subjectRect !== undefined &&
        subjectRect.width > 0 &&
        subjectRect.left >= wrapperRect.left - 2 &&
        subjectRect.right <= wrapperRect.right + 2,
    };
  });
  await expect(table.locator('thead th').first()).toContainText('DERSLER / TARİH');
  expect(Math.abs(sticky.headerOffset)).toBeLessThanOrEqual(2);
  expect(sticky.subjectInside).toBe(true);

  await table.evaluate((element, scrollLeft) => {
    const wrapper = element.parentElement;
    if (wrapper) wrapper.scrollLeft = scrollLeft;
  }, originalScrollLeft);

  const mondayWidth = await table
    .getByRole('columnheader', { name: 'Pazartesi', exact: true })
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(mondayWidth).toBeGreaterThanOrEqual(110);

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);

  const row = table.locator('tbody tr').first();
  const before = await row.evaluate((el) => el.getBoundingClientRect().height);
  const cell = table.getByLabel('1. satır Pazartesi', { exact: true });
  await cell.fill('X'.repeat(120));

  await expect
    .poll(async () => row.evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThan(before);

  await expectSevenDayTable(table);

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

  await table.evaluate((element, scrollLeft) => {
    const wrapper = element.parentElement;
    if (wrapper) wrapper.scrollLeft = scrollLeft;
  }, originalScrollLeft);
});

test('1440 px çizelgede tablo kartı doldurur ve toplam sütunu görünür', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.goto('./#/program');

  const table = page.getByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  await expectSevenDayTable(table);

  const totalHeader = table.getByRole('columnheader', {
    name: 'Toplam süre/soru',
  });
  await expect(totalHeader).toBeVisible();

  const layout = await table.evaluate((element) => {
    const wrapper = element.parentElement;
    const main = document.getElementById('icerik');
    const total = element.querySelector('th[aria-label="Toplam süre/soru"]');
    const wrapperRect = wrapper?.getBoundingClientRect();
    const totalRect = total?.getBoundingClientRect();
    return {
      tableWidth: element.getBoundingClientRect().width,
      wrapperWidth: wrapper?.clientWidth ?? 0,
      wrapperScrollWidth: wrapper?.scrollWidth ?? 0,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      totalRight: totalRect?.right ?? Number.NaN,
      wrapperRight: wrapperRect?.right ?? Number.NaN,
    };
  });

  // The card fills the wide main element, so both are wider than max-w-5xl.
  expect(layout.mainWidth).toBeGreaterThan(1100);
  expect(layout.tableWidth).toBeGreaterThanOrEqual(1000);

  // No in-card overflow: the table fits inside the scroll container.
  expect(layout.tableWidth).toBeGreaterThanOrEqual(layout.wrapperWidth - 1);
  expect(layout.wrapperScrollWidth).toBeLessThanOrEqual(layout.wrapperWidth + 1);

  // The total column is inside the visible card area.
  expect(layout.totalRight).toBeLessThanOrEqual(layout.wrapperRight + 1);

  const dayWidth = await table
    .getByRole('columnheader', { name: 'Pazartesi', exact: true })
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(dayWidth).toBeGreaterThanOrEqual(110);

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
});
