import { expect, test } from '@playwright/test';
import { completeOnboarding, createTytExam, TEST_NAME } from './helpers';

test('deneme eklenir, net ve grafik gösterilir', async ({ page }) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await createTytExam(page, '3D TYT 5');

  const examLink = page.getByRole('link', { name: /3D TYT 5.*18,75 net/ });
  await expect(examLink).toBeVisible();
  await expect(page.getByRole('img', { name: 'TYT net trend grafiği' })).toBeVisible();

  await examLink.click();
  await expect(page.getByRole('heading', { name: '3D TYT 5' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '18,75' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Matematik');
  await expect(page.getByRole('table')).toContainText('20');
});
