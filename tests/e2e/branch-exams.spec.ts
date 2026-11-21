import { expect, test } from '@playwright/test';
import { completeOnboarding, TEST_NAME } from './helpers';

test('branş denemesi eklenir, ayrı sekmede grafiklenir ve ana istatistiğe girmez', async ({
  page,
}) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.getByRole('link', { name: 'Denemeler', exact: true }).click();

  await page.getByRole('button', { name: 'Branş', exact: true }).click();
  await page.getByRole('link', { name: 'Yeni deneme' }).click();
  await page.getByRole('button', { name: 'Branş denemesi' }).click();
  await page.getByLabel('Deneme adı').fill('TYT Sosyal 1');
  await page.getByLabel('Branş').selectOption('tyt-sosyal');
  await page.getByLabel('Sosyal doğru').fill('15');
  await page.getByLabel('Sosyal yanlış').fill('3');
  await page.getByRole('button', { name: 'Kaydet' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'TYT Sosyal 1' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Branş', exact: true })).toBeVisible();

  // The branch exam must survive a full reload, not just the in-memory flow.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'TYT Sosyal 1' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Branş', exact: true })).toBeVisible();

  // The detail page's own "Denemeler" link is the breadcrumb; the bottom nav
  // carries the same accessible name, so scope the click to the page path.
  await page
    .getByRole('navigation', { name: 'Sayfa yolu' })
    .getByRole('link', { name: 'Denemeler', exact: true })
    .click();

  // A plain /denemeler visit opens the TYT full tab, where the branch exam
  // must never appear.
  await expect(page.getByRole('heading', { level: 1, name: 'Denemeler' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TYT', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: /TYT Sosyal 1/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Branş', exact: true }).click();
  await expect(page.getByRole('link', { name: /TYT Sosyal 1.*14,25 net/ })).toBeVisible();
  await expect(page.getByText('TYT Sosyal branş denemeleri')).toBeVisible();

  await page.getByRole('button', { name: 'TYT', exact: true }).click();
  await expect(page.getByRole('link', { name: /TYT Sosyal 1/ })).toHaveCount(0);

  await page.getByRole('link', { name: 'Ana Sayfa', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Genel Bakış' })).toBeVisible();
  await expect(page.getByRole('link', { name: /TYT Sosyal 1/ })).toHaveCount(0);
});
