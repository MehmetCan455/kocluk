import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { completeOnboarding, TEST_NAME } from './helpers';

const PHOTO_FIXTURE = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));

async function uploadPhoto(
  page: import('@playwright/test').Page,
  options: { examType: 'TYT' | 'AYT'; subject: string; note: string },
): Promise<void> {
  await page.getByRole('button', { name: 'Fotoğraf ekle', exact: true }).click();
  await page.getByLabel('Galeriden seç').setInputFiles(PHOTO_FIXTURE);
  await page
    .getByRole('combobox', { name: 'Sınav türü', exact: true })
    .selectOption(options.examType);
  await page
    .getByRole('combobox', { name: 'Ders', exact: true })
    .selectOption({ label: options.subject });
  await page
    .getByRole('textbox', { name: 'Not', exact: true })
    .fill(options.note);
  await page.getByRole('button', { name: 'Yükle' }).click();
}

test('fotoğraf yüklenir, filtre sonucu değiştirir ve rastgele test tamamlanır', async ({
  page,
}) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  await page.getByRole('link', { name: 'Yanlışlar', exact: true }).click();

  await uploadPhoto(page, {
    examType: 'TYT',
    subject: 'Matematik',
    note: 'Türev sorusunda zincir kuralı',
  });
  await uploadPhoto(page, {
    examType: 'AYT',
    subject: 'Fizik',
    note: 'Manyetik alan sorusu',
  });

  await expect(page.getByText('2 fotoğraf', { exact: false }).first()).toBeVisible();
  const tytPhoto = page.getByRole('button', { name: /Türev sorusunda zincir kuralı/ });
  const aytPhoto = page.getByRole('button', { name: /Manyetik alan sorusu/ });
  await expect(tytPhoto).toBeVisible();
  await expect(aytPhoto).toBeVisible();

  // The type filter must actually remove one of the two visible cards.
  await page.getByLabel('Sınav türü filtresi').selectOption('TYT');
  await expect(page.getByText('1 fotoğraf', { exact: false }).first()).toBeVisible();
  await expect(tytPhoto).toBeVisible();
  await expect(aytPhoto).not.toBeVisible();

  await page.getByLabel('Sınav türü filtresi').selectOption('AYT');
  await expect(page.getByText('1 fotoğraf', { exact: false }).first()).toBeVisible();
  await expect(aytPhoto).toBeVisible();
  await expect(tytPhoto).not.toBeVisible();

  await page.getByLabel('Sınav türü filtresi').selectOption('TYT');
  await page.getByLabel('Ders filtresi').selectOption({ label: 'TYT · Matematik' });
  await expect(page.getByText('1 fotoğraf', { exact: false }).first()).toBeVisible();
  await expect(tytPhoto).toBeVisible();

  await page.getByRole('link', { name: 'Test oluştur' }).click();
  await expect(page.getByRole('heading', { name: 'Rastgele Test' })).toBeVisible();

  // Narrow the test to the TYT Matematik photo so the score is deterministic.
  await page.getByLabel('Sınav türü').selectOption('TYT');
  await page.getByRole('checkbox', { name: 'TYT · Matematik' }).check();
  await expect(page.getByText('Test 1 fotoğraftan oluşacak.')).toBeVisible();
  await page.getByRole('button', { name: 'Testi başlat' }).click();

  await expect(page.getByRole('heading', { name: 'Test oturumu' })).toBeVisible();
  await page.getByRole('button', { name: 'Doğru', exact: true }).click();
  await page.getByRole('button', { name: 'Testi bitir' }).click();

  await expect(page.getByRole('heading', { name: 'Test tamamlandı' })).toBeVisible();
  await expect(page.getByText('1/1 doğru')).toBeVisible();
});
