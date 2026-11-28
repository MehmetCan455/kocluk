import { expect, test, type Page } from '@playwright/test';
import { completeOnboarding, TEST_NAME } from './helpers';

/**
 * Mirrors `SCHEDULE_DAYS` and `todayScheduleDay` in
 * `src/features/schedule/scheduleDays.ts`; importing the app module would put a
 * source file outside the e2e TypeScript project.
 */
const SCHEDULE_DAYS = [
  { day: 1, short: 'Pzt', label: 'Pazartesi' },
  { day: 2, short: 'Sal', label: 'Salı' },
  { day: 3, short: 'Çar', label: 'Çarşamba' },
  { day: 4, short: 'Per', label: 'Perşembe' },
  { day: 5, short: 'Cum', label: 'Cuma' },
  { day: 6, short: 'Cmt', label: 'Cumartesi' },
  { day: 7, short: 'Paz', label: 'Pazar' },
] as const;

function todayScheduleDay(
  now = new Date(),
): (typeof SCHEDULE_DAYS)[number] {
  return SCHEDULE_DAYS[(now.getDay() + 6) % 7];
}

async function openProgram(page: Page): Promise<void> {
  await page.goto('./#/program');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ders Çalışma Çizelgesi' }),
  ).toBeVisible();
}

/**
 * Creates the first plan row and one free task on today's weekday. The row
 * autosaves before its cell offers the add-task button.
 */
async function createPlanTask(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Satır ekle' }).click();
  await page.getByLabel('1. satır', { exact: true }).fill('Matematik');
  await expect(page.getByText('Kaydedildi', { exact: true })).toBeVisible({
    timeout: 5_000,
  });

  const today = todayScheduleDay();
  await page
    .getByRole('button', { name: `Matematik ${today.label} görev ekle` })
    .click();
  const taskDialog = page.getByRole('dialog', { name: 'Görev ekle' });
  await expect(taskDialog).toBeVisible();
  await taskDialog
    .getByRole('button', { name: 'Serbest görev', exact: true })
    .click();
  await taskDialog.getByLabel('Görev adı').fill(title);
  await taskDialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(taskDialog).not.toBeVisible();
}

test.describe('dokunmatik', () => {
  // Touch input with a tablet-sized viewport: the chip tap must reach the
  // editor without relying on hover actions.
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('tablette görev çipine dokunup düzenler ve siler', async ({ page }) => {
    await completeOnboarding(page, TEST_NAME, 'Tümü');
    await openProgram(page);
    await createPlanTask(page, 'E2E dokunmatik görev');

    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ders Çalışma Çizelgesi' }),
    ).toBeVisible();
    await expect(page.locator('[data-status]')).toHaveCount(1);

    await page.locator('[data-status]').first().tap();
    await expect(
      page.getByRole('dialog', { name: 'Görevi düzenle' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Görevi sil' }).tap();
    const deleteDialog = page.getByRole('dialog', { name: 'Görevi sil' });
    await expect(deleteDialog).toBeVisible();

    await deleteDialog.getByRole('button', { name: 'Sil', exact: true }).tap();
    await expect(deleteDialog).not.toBeVisible();
    await expect(page.locator('[data-status]')).toHaveCount(0);
  });
});

test('masaüstünde çip tıklaması düzenler, tik modunda tamamlar', async ({
  page,
}) => {
  // No hasTouch here: this context keeps the desktop mouse input.
  await page.setViewportSize({ width: 1280, height: 800 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await openProgram(page);
  await createPlanTask(page, 'E2E masaüstü görevi');

  const chip = page.locator('[data-status]').first();
  await expect(chip).toHaveAttribute('data-status', 'pending');

  // A normal-mode chip click opens the editor; there are no hover icons to
  // intercept the centre of the chip.
  await chip.click();
  const editDialog = page.getByRole('dialog', { name: 'Görevi düzenle' });
  await expect(editDialog).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Görevi sil' })).toHaveCount(0);
  await editDialog.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(editDialog).not.toBeVisible();

  // Tick mode turns the chip itself into the completion target.
  await page.getByRole('button', { name: 'Tik modu' }).click();
  const tickChip = page.getByRole('button', {
    name: 'E2E masaüstü görevi: Planlandı',
  });
  await expect(tickChip).toBeVisible();
  await tickChip.click();
  await expect(
    page.getByRole('button', { name: 'E2E masaüstü görevi: Yapıldı' }),
  ).toBeVisible();
  await expect(editDialog).not.toBeVisible();
});
