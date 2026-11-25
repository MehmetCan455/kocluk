import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { finishOnboarding } from './helpers';

/**
 * End-to-end coverage for the account/sync migration against the local mock
 * API. Playwright starts `scripts/mock-api.mjs` and the Vite dev server (whose
 * `/api` proxy points at the mock) before this file runs; each test resets the
 * mock data through the test-only endpoint.
 */

const PASSWORD = 'gizli-sifre-123';
const NEW_PASSWORD = 'yeni-sifre-456';
const EMAIL = 'e2e@kocluk.local';
const NAME = 'E2E Öğrenci';
const BOOK_TITLE = 'Hiç Problem Değil';
const BOOK_PUBLISHER = 'Antrenman Yayınları';
const BOOK_ADD_LABEL = `${BOOK_TITLE} (${BOOK_PUBLISHER}) kitabını rafıma ekle`;
const BOOK_CARD_LABEL = `${BOOK_TITLE} (${BOOK_PUBLISHER}) kitabı`;
const SYNCED_LINK = 'Senkron durumu: Senkronize';
const OFFLINE_LINK = 'Senkron durumu: Çevrimdışı';

interface SyncStatusPayload {
  hasData: boolean;
  hasUserData: boolean;
  counts: Record<string, number>;
  cursor: number;
  serverTime: string;
}

interface ExportPayload {
  formatVersion: number;
  user: { displayName: string };
  tables: Record<string, unknown[]>;
}

function appBaseURL(): string {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) {
    throw new Error('Playwright baseURL tanımlı değil.');
  }
  return baseURL;
}

async function readSyncStatus(page: Page): Promise<SyncStatusPayload | null> {
  return page.evaluate(async () => {
    try {
      const response = await fetch('/api/sync/status', {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as SyncStatusPayload;
    } catch {
      return null;
    }
  });
}

async function readServerTable(
  page: Page,
  table: string,
): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (tableName) => {
    try {
      const response = await fetch('/api/sync/full', {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        return [];
      }
      const payload = (await response.json()) as {
        tables?: Record<string, Array<Record<string, unknown>>>;
      };
      return payload.tables?.[tableName] ?? [];
    } catch {
      return [];
    }
  }, table);
}

async function readLocalPending(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    try {
      const sessionResponse = await fetch('/api/auth/session', {
        credentials: 'same-origin',
      });
      if (!sessionResponse.ok) {
        return null;
      }
      const session = (await sessionResponse.json()) as {
        user?: { id?: unknown };
      };
      const userId = session.user?.id;
      if (typeof userId !== 'string' || userId === '') {
        return null;
      }

      const database = await new Promise<IDBDatabase | null>((resolve) => {
        const open = indexedDB.open(`kocluk-u-${userId}`);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
      });
      if (database === null) {
        return null;
      }

      try {
        return await new Promise<number>((resolve) => {
          const transaction = database.transaction('syncQueue', 'readonly');
          const request = transaction
            .objectStore('syncQueue')
            .index('status')
            .count('pending');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(-1);
        });
      } finally {
        database.close();
      }
    } catch {
      return null;
    }
  });
}

async function expectServerCount(
  page: Page,
  table: string,
  count: number,
): Promise<void> {
  await expect
    .poll(async () => (await readSyncStatus(page))?.counts[table] ?? -1, {
      timeout: 30_000,
    })
    .toBe(count);
}

async function registerAndOnboard(page: Page): Promise<void> {
  await page.goto('./#/kayit');
  await page.getByLabel('Adın').fill(NAME);
  await page.getByLabel('E-posta').fill(EMAIL);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Kayıt ol' }).click();
  await finishOnboarding(page, NAME, 'Tümü');
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('./#/giris');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(password);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
}

async function addCatalogBook(page: Page): Promise<void> {
  await page.goto('./#/kitaplar');
  await page.getByRole('button', { name: 'Kitap ekle' }).first().click();
  await page
    .getByLabel('Kitap, yayınevi veya ders ara')
    .fill(BOOK_TITLE);
  await page.getByRole('button', { name: BOOK_ADD_LABEL }).click();
  await expect(
    page.getByRole('link', { name: BOOK_CARD_LABEL }),
  ).toBeVisible();
}

async function expectSynced(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: SYNCED_LINK })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * The client pushes at most 100 queued rows per run. Onboarding seeds hundreds
 * of subjects/topics, so several visible "Şimdi senkronize et" runs are needed
 * before the user's own rows reach the server. The local `syncQueue` count is
 * authoritative; the top-bar indicator can still show the previous run.
 */
async function drainSync(page: Page): Promise<void> {
  await page.goto('./#/ayarlar');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ayarlar' }),
  ).toBeVisible();
  const syncButton = page.getByRole('button', { name: 'Şimdi senkronize et' });
  await expect(syncButton).toBeVisible();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const pending = (await readLocalPending(page)) ?? -1;
    if (pending === 0) {
      await expectSynced(page);
      return;
    }

    await syncButton.click();
    await expect(syncButton).toBeEnabled({ timeout: 30_000 });
    if (pending > 0) {
      await expect
        .poll(async () => (await readLocalPending(page)) ?? -1, {
          timeout: 30_000,
        })
        .toBeLessThan(pending);
    }
  }

  await expect
    .poll(() => readLocalPending(page), { timeout: 30_000 })
    .toBe(0);
  await expectSynced(page);
}

test.beforeEach(async ({ request }) => {
  const response = await request.delete('/api/__test__/reset');
  expect(response.status()).toBe(204);
});

test('kayıt, onboarding, kitap ekleme ve ikinci cihazda senkron', async ({
  page,
  browser,
}) => {
  await registerAndOnboard(page);
  await addCatalogBook(page);
  await drainSync(page);
  await expectServerCount(page, 'userBooks', 1);
  await expectSynced(page);

  const secondContext: Awaited<ReturnType<Browser['newContext']>> =
    await browser.newContext({
      baseURL: appBaseURL(),
      viewport: { width: 390, height: 844 },
    });
  const second = await secondContext.newPage();

  try {
    await login(second, EMAIL, PASSWORD);
    // The first pull's settings must be applied before AppRoutes decides
    // onboarding; a real second-device login lands on the dashboard directly.
    await expect(
      second.getByRole('heading', { level: 1, name: 'Genel Bakış' }),
    ).toBeVisible({ timeout: 30_000 });

    await second.goto('./#/kitaplar');
    await expect(
      second.getByRole('link', { name: BOOK_CARD_LABEL }),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await secondContext.close();
  }
});

test('onboarding tamamlandıktan sonra yenilemede onboarding geri gelmez', async ({
  page,
}) => {
  await registerAndOnboard(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Genel Bakış' }),
  ).toBeVisible();

  // The account's first sync already published the default settings row
  // (`onboardingDone:false`); the reload's pull must not downgrade the local
  // completed flag even while the seed backlog is still being pushed.
  await page.reload();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Genel Bakış' }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('heading', { name: 'Seni tanıyalım' }),
  ).not.toBeVisible();

  await page.goto('./#/kitaplar');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Kitaplar' }),
  ).toBeVisible({ timeout: 30_000 });

  // The completed flag eventually reaches the server as well.
  await expect
    .poll(
      async () => {
        const settings = await readServerTable(page, 'settings');
        return settings[0]?.onboardingDone ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
});

test('çevrimdışı işaretlenen konu çevrimiçi olunca senkronlanır', async ({
  page,
}) => {
  await registerAndOnboard(page);
  await drainSync(page);
  await expect
    .poll(async () => (await readSyncStatus(page))?.cursor ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  await page.goto('./#/tyt');
  await expect(
    page.getByRole('heading', { level: 1, name: 'TYT' }),
  ).toBeVisible();

  await page.locator('main ul li a[href^="#/tyt/"]').first().click();
  await page.waitForURL(/#\/tyt\/[^/]+$/);
  await page.locator('main ul li a[href^="#/tyt/"]').first().click();
  await page.waitForURL(/#\/tyt\/[^/]+\/[^/]+$/);

  const done = page.getByRole('checkbox', { name: 'Bu konuyu bitirdim' });
  await expect(done).toBeVisible();
  await expect(done).not.toBeChecked();

  await page.context().setOffline(true);
  await done.click();
  await expect(done).toBeChecked();
  await expect(page.getByRole('link', { name: OFFLINE_LINK })).toBeVisible({
    timeout: 15_000,
  });

  await page.context().setOffline(false);
  await expectSynced(page);
  await expectServerCount(page, 'topicProgress', 1);
  await expect
    .poll(
      async () =>
        (await readServerTable(page, 'topicProgress')).some(
          (row) => row.done === true,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
});

test('profil ve şifre değişir, çıkış/giriş verisi kalır, export indirilir', async ({
  page,
}) => {
  await registerAndOnboard(page);
  await addCatalogBook(page);
  await drainSync(page);
  await expectServerCount(page, 'userBooks', 1);

  await page.goto('./#/ayarlar');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ayarlar' }),
  ).toBeVisible();

  await page.getByLabel('Hesap görünen adı').fill('E2E Yeni Ad');
  await page.getByRole('button', { name: 'Adı kaydet' }).click();
  await expect(page.getByText('Görünen ad kaydedildi.')).toBeVisible();

  await page.getByLabel('Mevcut şifre').fill(PASSWORD);
  await page.getByLabel('Yeni şifre', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Yeni şifre (tekrar)').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Şifreyi değiştir' }).click();
  await expect(page.getByText('Şifren güncellendi.')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Verilerimi indir' }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const exported = JSON.parse(
    await readFile(filePath as string, 'utf8'),
  ) as ExportPayload;
  expect(exported.formatVersion).toBe(2);
  expect(exported.user.displayName).toBe('E2E Yeni Ad');
  expect(exported.tables.userBooks).toHaveLength(1);

  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Giriş yap' }),
  ).toBeVisible();

  await page.getByLabel('E-posta').fill(EMAIL);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page.getByText('E-posta veya şifre hatalı.')).toBeVisible();

  await page.getByLabel('Şifre').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Genel Bakış' }),
  ).toBeVisible();

  await page.goto('./#/ayarlar');
  await expect(page.getByLabel('Hesap görünen adı')).toHaveValue('E2E Yeni Ad');

  await page.goto('./#/kitaplar');
  await expect(page.getByRole('link', { name: BOOK_CARD_LABEL })).toBeVisible();
});

test('hesap silme sunucudaki hesabı ve oturumu kaldırır', async ({ page }) => {
  await registerAndOnboard(page);
  await page.goto('./#/ayarlar');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ayarlar' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Hesabımı sil' }).click();
  await expect(
    page.getByRole('heading', { name: 'Hesabımı sil' }),
  ).toBeVisible();

  await page.getByLabel('Şifren').fill(PASSWORD);
  await page
    .getByRole('button', { name: 'Hesabımı kalıcı olarak sil' })
    .click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Giriş yap' }),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('E-posta').fill(EMAIL);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page.getByText('E-posta veya şifre hatalı.')).toBeVisible();
});
