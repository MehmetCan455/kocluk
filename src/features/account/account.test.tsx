import Dexie from 'dexie';
import { saveAs } from 'file-saver';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { AUTH_HINT_KEY, AuthProvider } from '@/app/AuthProvider';
import { CURRICULUM } from '@/data/curriculum';
import { KoclukDB, getActiveDbOrNull } from '@/db/db';
import {
  LEGACY_DB_NAME,
  activeUserId,
  closeActiveDb,
  openUserDb,
  userDbName,
} from '@/db/dbManager';
import { patchSettings, seedCurriculum } from '@/db/repositories';
import { TRANSFER_DONE_KEY, TRANSFER_PROMPT_KEY } from '@/db/transfer';
import { AuthGate } from '@/features/auth/AuthGate';
import { seedOnboarded } from '@/test/fixtures';
import {
  installMockApi,
  type MockApi,
  type MockApiCall,
  type MockApiReply,
  type MockApiResponse,
} from '@/test/mockApi';
import { TEST_AUTH_USER, renderApp } from '@/test/renderApp';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

let mock: MockApi | null = null;
let openedUser: string | null = null;

function install(routes: Record<string, MockApiReply>): MockApi {
  mock = installMockApi(routes);
  return mock;
}

function syncRoutes(
  extra: Record<string, MockApiReply> = {},
): Record<string, MockApiReply> {
  return {
    'GET /api/sync/pull': { body: { changes: [], nextCursor: 0, hasMore: false } },
    'GET /api/sync/status': {
      body: {
        hasData: false,
        hasUserData: false,
        counts: {},
        cursor: 0,
        serverTime: new Date().toISOString(),
      },
    },
    'POST /api/sync/push': (call: MockApiCall) => {
      const body = call.body as { changes?: unknown[] } | null;
      return {
        body: {
          results: (body?.changes ?? []).map(() => ({ status: 'applied', row: null })),
        },
      };
    },
    ...extra,
  };
}

async function createEmptyLegacyDb(): Promise<void> {
  const legacy = new KoclukDB(LEGACY_DB_NAME);
  await legacy.open();
  legacy.close();
}

async function createLegacyExam(): Promise<void> {
  const legacy = new KoclukDB(LEGACY_DB_NAME);
  await legacy.open();
  try {
    await legacy.exams.add({
      id: 'old-exam',
      type: 'TYT',
      name: 'Eski Deneme',
      date: '2026-11-18',
      kind: 'full',
      note: '',
      createdAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-18T10:00:00.000Z',
    });
    await legacy.settings.bulkPut([
      { key: 'profileName', value: 'Eski Kullanıcı' },
      { key: 'onboardingDone', value: true },
    ]);
    await legacy.notes.add({
      topicId: 'missing-topic',
      contentHtml: '<p>Eksik konu</p>',
      plainText: 'Eksik konu',
      updatedAt: '2026-11-18T10:00:00.000Z',
    });
  } finally {
    legacy.close();
  }
}

async function createUserDatabase(): Promise<void> {
  const database = await openUserDb(TEST_AUTH_USER.id);
  openedUser = database.name;
  await seedCurriculum({ version: 1, subjects: [] });
  await patchSettings({ onboardingDone: true, profileName: 'Hesap Kullanıcısı' });
  await closeActiveDb();
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(saveAs).mockClear();
  openedUser = null;
});

afterEach(async () => {
  cleanup();
  mock?.restore();
  mock = null;
  vi.restoreAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
  await closeActiveDb();
  if (openedUser && openedUser !== 'kocluk-test') {
    await Dexie.delete(openedUser);
  }
  openedUser = null;
  await Dexie.delete(LEGACY_DB_NAME);
});

test('görünen adı günceller ve e-postayı salt okunur gösterir', async () => {
  const user = userEvent.setup();
  await seedOnboarded(CURRICULUM);
  const updated = { ...TEST_AUTH_USER, displayName: 'Yeni Ad' };
  const api = install(
    syncRoutes({
      'POST /api/auth/update-profile': { body: { user: updated } },
      'GET /api/auth/session': { body: { user: updated, csrfToken: 'csrf-new' } },
    }),
  );

  renderApp('/ayarlar');

  const nameInput = await screen.findByLabelText('Hesap görünen adı');
  expect(nameInput).toHaveValue(TEST_AUTH_USER.displayName);
  const email = screen.getByLabelText('E-posta');
  expect(email).toHaveValue(TEST_AUTH_USER.email);
  expect(email).toBeDisabled();

  await user.clear(nameInput);
  await waitFor(() => expect(nameInput).toHaveValue(''));
  await user.type(nameInput, 'Yeni Ad');
  await user.click(screen.getByRole('button', { name: 'Adı kaydet' }));

  expect(await screen.findByText('Görünen ad kaydedildi.')).toBeInTheDocument();
  const call = api.callsTo('POST', '/api/auth/update-profile')[0];
  expect(call?.body).toEqual({ displayName: 'Yeni Ad' });
  expect(call?.headers.get('X-CSRF-Token')).toBe('test-csrf-token');
});

test('şifre değiştirir; hatalı şifrede hata, başarıda bilgi gösterir', async () => {
  const user = userEvent.setup();
  await seedOnboarded(CURRICULUM);
  let attempt = 0;
  const api = install(
    syncRoutes({
      'POST /api/auth/change-password': () => {
        attempt += 1;
        if (attempt === 1) {
          return {
            status: 403,
            body: { error: { code: 'invalid_password', message: 'Şifre hatalı.' } },
          };
        }
        return {
          body: { user: TEST_AUTH_USER, csrfToken: 'csrf-rotated' },
        };
      },
      'GET /api/auth/session': {
        body: { user: TEST_AUTH_USER, csrfToken: 'csrf-rotated' },
      },
    }),
  );

  renderApp('/ayarlar');

  await screen.findByLabelText('Mevcut şifre');
  await user.type(screen.getByLabelText('Mevcut şifre'), 'yanlis-sifre');
  await user.type(screen.getByLabelText('Yeni şifre'), 'yeni-sifre-123');
  await user.type(screen.getByLabelText('Yeni şifre (tekrar)'), 'yeni-sifre-123');
  await user.click(screen.getByRole('button', { name: 'Şifreyi değiştir' }));

  expect(await screen.findByText('Şifre hatalı.')).toBeInTheDocument();

  await user.clear(screen.getByLabelText('Mevcut şifre'));
  await waitFor(() => expect(screen.getByLabelText('Mevcut şifre')).toHaveValue(''));
  await user.type(screen.getByLabelText('Mevcut şifre'), 'dogru-sifre-123');
  await user.click(screen.getByRole('button', { name: 'Şifreyi değiştir' }));

  expect(await screen.findByText('Şifren güncellendi.')).toBeInTheDocument();
  expect(api.callsTo('POST', '/api/auth/change-password')[1]?.body).toEqual({
    currentPassword: 'dogru-sifre-123',
    newPassword: 'yeni-sifre-123',
  });
});

test('verileri JSON dosyası olarak indirir', async () => {
  const user = userEvent.setup();
  await seedOnboarded(CURRICULUM);
  const payload = {
    exportedAt: '2026-11-25T10:00:00.000Z',
    formatVersion: 2,
    user: { id: TEST_AUTH_USER.id, email: TEST_AUTH_USER.email },
    tables: { exams: [{ id: 'exam-1', name: 'Deneme' }] },
  };
  install(syncRoutes({ 'GET /api/account/export': { body: payload } }));

  renderApp('/ayarlar');

  await user.click(await screen.findByRole('button', { name: 'Verilerimi indir' }));

  await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
  const [blob, fileName] = vi.mocked(saveAs).mock.calls[0];
  expect(blob).toBeInstanceOf(Blob);
  expect(fileName).toMatch(/^kocluk-hesap-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await (blob as Blob).text();
  expect(JSON.parse(text)).toMatchObject({
    formatVersion: 2,
    user: { email: TEST_AUTH_USER.email },
  });
});

test('hesap silme şifre ister; onay sonrası çıkış yapar ve yerel kopyayı korur', async () => {
  const user = userEvent.setup();
  await createEmptyLegacyDb();
  await createUserDatabase();
  const api = install(
    syncRoutes({
      'POST /api/auth/delete-account': { body: { ok: true } },
    }),
  );
  localStorage.setItem(
    AUTH_HINT_KEY,
    JSON.stringify({
      userId: TEST_AUTH_USER.id,
      email: TEST_AUTH_USER.email,
      displayName: TEST_AUTH_USER.displayName,
    }),
  );

  renderApp('/ayarlar', { openDb: openUserDb });

  await user.click(await screen.findByRole('button', { name: 'Hesabımı sil' }));
  const dialog = await screen.findByRole('dialog', { name: 'Hesabımı sil' });

  // Without a password the destructive action stays disabled.
  expect(
    screen.getByRole('button', { name: 'Hesabımı kalıcı olarak sil' }),
  ).toBeDisabled();

  await user.type(screen.getByLabelText('Şifren'), 'gizli-sifre-123');
  await user.click(screen.getByRole('button', { name: 'Hesabımı kalıcı olarak sil' }));

  expect(await screen.findByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.callsTo('POST', '/api/auth/delete-account')[0]?.body).toEqual({
    password: 'gizli-sifre-123',
  });
  expect(api.callsTo('POST', '/api/auth/delete-account')[0]?.headers.get('X-CSRF-Token')).toBe(
    'test-csrf-token',
  );
  expect(activeUserId()).toBeNull();
  expect(localStorage.getItem(AUTH_HINT_KEY)).toBeNull();
  // Default keeps the local copy; the legacy database is never deleted.
  expect(await Dexie.exists(userDbName(TEST_AUTH_USER.id))).toBe(true);
  expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(true);
  expect(dialog).not.toBeInTheDocument();
});

test('hesap silmede açık onayla yerel kopya silinir, eski DB korunur', async () => {
  const user = userEvent.setup();
  await createEmptyLegacyDb();
  await createUserDatabase();
  install(syncRoutes({ 'POST /api/auth/delete-account': { body: { ok: true } } }));

  renderApp('/ayarlar', { openDb: openUserDb });

  await user.click(await screen.findByRole('button', { name: 'Hesabımı sil' }));
  await user.type(screen.getByLabelText('Şifren'), 'gizli-sifre-123');
  await user.click(
    screen.getByRole('checkbox', { name: /Bu cihazdaki yerel kopyayı da sil/ }),
  );
  await user.click(screen.getByRole('button', { name: 'Hesabımı kalıcı olarak sil' }));

  expect(await screen.findByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
  await waitFor(async () => {
    expect(await Dexie.exists(userDbName(TEST_AUTH_USER.id))).toBe(false);
  });
  expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(true);
  openedUser = null;
});

test('hesap silmede oturum önce düşmüşse yerel kopya silinmez', async () => {
  const user = userEvent.setup();
  await createEmptyLegacyDb();
  await createUserDatabase();
  install(
    syncRoutes({
      'POST /api/auth/delete-account': {
        status: 401,
        body: { error: { code: 'unauthenticated', message: 'Oturum yok.' } },
      },
    }),
  );

  renderApp('/ayarlar', { openDb: openUserDb });

  await user.click(await screen.findByRole('button', { name: 'Hesabımı sil' }));
  await user.type(screen.getByLabelText('Şifren'), 'gizli-sifre-123');
  await user.click(
    screen.getByRole('checkbox', { name: /Bu cihazdaki yerel kopyayı da sil/ }),
  );
  await user.click(screen.getByRole('button', { name: 'Hesabımı kalıcı olarak sil' }));

  expect(await screen.findByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
  expect(await Dexie.exists(userDbName(TEST_AUTH_USER.id))).toBe(true);
  expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(true);
});

test('durum okunamazsa taşıma kapısı tekrar denenebilir ve cevaplandı işaretlenmez', async () => {
  const user = userEvent.setup();
  await createUserDatabase();
  await createLegacyExam();
  let fail = true;
  install(
    syncRoutes({
      'GET /api/sync/status': (): MockApiResponse =>
        fail
          ? { networkError: true }
          : {
              body: {
                hasData: true,
                hasUserData: false,
                counts: {},
                cursor: 0,
                serverTime: new Date().toISOString(),
              },
            },
    }),
  );

  renderApp('/ayarlar', { openDb: openUserDb });

  expect(
    await screen.findByRole('heading', { name: 'Hesap durumu kontrol edilemedi' }),
  ).toBeInTheDocument();
  const active = getActiveDbOrNull();
  expect(await active?.syncMeta.get(TRANSFER_PROMPT_KEY)).toBeUndefined();

  fail = false;
  await user.click(screen.getByRole('button', { name: 'Tekrar dene' }));

  expect(await screen.findByRole('button', { name: 'Hesabıma aktar' })).toBeInTheDocument();
});

test('yerel hesapta kullanıcı verisi varsa hem ilk giriş hem Ayarlar taşımayı reddeder', async () => {
  const user = userEvent.setup();
  await createUserDatabase();
  const database = await openUserDb(TEST_AUTH_USER.id);
  openedUser = database.name;
  await database.exams.add({
    id: 'local-exam',
    type: 'TYT',
    name: 'Yerel Deneme',
    date: '2026-11-18',
    kind: 'full',
    note: '',
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
  });
  await closeActiveDb();
  await createLegacyExam();
  install(syncRoutes());

  renderApp('/ayarlar', { openDb: openUserDb });

  expect(
    await screen.findByRole('heading', { name: 'Bu cihazda hesap verisi var' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hesabıma aktar' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Kapat' }));
  expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument();
  const active = getActiveDbOrNull();
  expect(await active?.syncMeta.get(TRANSFER_PROMPT_KEY)).toBeUndefined();

  await user.click(
    await screen.findByRole('button', { name: 'Eski verileri aktar' }),
  );
  expect(
    await screen.findByText(/Bu hesapta zaten yerel veriler var/),
  ).toBeInTheDocument();
});

test('tamamlanan ayar aktarımı ilk giriş sorusunu tekrar göstermez', async () => {
  const database = await openUserDb(TEST_AUTH_USER.id);
  openedUser = database.name;
  await seedCurriculum({ version: 1, subjects: [] });
  await patchSettings({ onboardingDone: true });
  await database.syncMeta.put({ key: TRANSFER_DONE_KEY, value: true });
  await closeActiveDb();
  await createLegacyExam();
  install(syncRoutes());

  renderApp('/ayarlar', { openDb: openUserDb });

  expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hesabıma aktar' })).not.toBeInTheDocument();
});

test('sunucu yalnızca tohum verisi içeriyorsa Ayarlar üzerinden taşıma yapılabilir', async () => {
  const user = userEvent.setup();
  await createUserDatabase();
  await createLegacyExam();
  install(
    syncRoutes({
      'GET /api/sync/status': {
        body: {
          hasData: true,
          hasUserData: false,
          counts: { subjects: 12, topics: 200 },
          cursor: 3,
          serverTime: new Date().toISOString(),
        },
      },
    }),
  );

  renderApp('/ayarlar', { openDb: openUserDb });

  await user.click(await screen.findByRole('button', { name: 'Boş başla' }));
  expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument();

  await user.click(
    await screen.findByRole('button', { name: 'Eski verileri aktar' }),
  );
  expect(
    await screen.findByRole('dialog', { name: 'Eski verileri aktar' }),
  ).toBeInTheDocument();
  expect(screen.getByText(/atlanan sayısı aktarım sonunda gösterilir/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Aktar' }));
  expect(await screen.findByText(/Aktarım tamamlandı/)).toBeInTheDocument();
});

test('eski veri okuma hatası taşıma kapısında görünür ve tekrar denenebilir', async () => {
  const user = userEvent.setup();
  await createUserDatabase();
  const exists = vi
    .spyOn(Dexie, 'exists')
    .mockRejectedValueOnce(new Error('storage blocked'));

  install(syncRoutes());
  renderApp('/ayarlar', { openDb: openUserDb });

  expect(
    await screen.findByRole('heading', { name: 'Eski veriler kontrol edilemedi' }),
  ).toBeInTheDocument();

  exists.mockRestore();
  await user.click(screen.getByRole('button', { name: 'Tekrar dene' }));

  expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument();
});

test('yerel kopya silinemezse çıkış yapılır ve giriş ekranında bildirilir', async () => {
  const user = userEvent.setup();
  await createEmptyLegacyDb();
  await createUserDatabase();
  install(syncRoutes({ 'POST /api/auth/delete-account': { body: { ok: true } } }));
  vi.spyOn(Dexie, 'delete').mockRejectedValueOnce(new Error('blocked'));

  renderApp('/ayarlar', { openDb: openUserDb });

  await user.click(await screen.findByRole('button', { name: 'Hesabımı sil' }));
  await user.type(screen.getByLabelText('Şifren'), 'gizli-sifre-123');
  await user.click(
    screen.getByRole('checkbox', { name: /Bu cihazdaki yerel kopyayı da sil/ }),
  );
  await user.click(screen.getByRole('button', { name: 'Hesabımı kalıcı olarak sil' }));

  expect(await screen.findByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
  expect(
    await screen.findByText(
      'Yerel kopya silinemedi. Bu cihazdaki hesap verileri korunuyor.',
    ),
  ).toBeInTheDocument();
  expect(await Dexie.exists(userDbName(TEST_AUTH_USER.id))).toBe(true);
  expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(true);
  expect(activeUserId()).toBeNull();
});

test('gizlilik sayfası veri kategorilerini, Natro yu ve cihazda kalan fotoğrafları anlatır', async () => {
  renderApp('/gizlilik', { authUser: null });

  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: /Gizlilik ve KVKK Aydınlatma Metni/,
    }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Natro/)).toBeInTheDocument();
  expect(screen.getByText(/yurt dışına aktarılmaz/i)).toBeInTheDocument();
  expect(screen.getByText(/Fotoğraflar ve ekler yalnızca bu cihazda kalır/i)).toBeInTheDocument();
  expect(screen.getAllByText(/destek@zirveacademy\.com/).length).toBeGreaterThan(0);
  expect(screen.getByText(/14 gün/)).toBeInTheDocument();
});

test('ayarlardaki gizlilik bağlantısı /gizlilik yoluna gider', async () => {
  await seedOnboarded(CURRICULUM);
  install(syncRoutes());

  renderApp('/ayarlar');

  const link = await screen.findByRole('link', { name: /Gizlilik ve KVKK/ });
  expect(link).toHaveAttribute('href', '/gizlilik');
});

test('kayıt ekranındaki gizlilik bağlantısı gerçek /gizlilik linkidir', async () => {
  renderApp('/kayit', { authUser: null });

  const link = await screen.findByRole('link', { name: 'Aydınlatma metnini oku' });
  expect(link).toHaveAttribute('href', '/gizlilik');
});

test('şifremi unuttum metni hesabın varlığını ima etmez', async () => {
  const user = userEvent.setup();
  install({
    'POST /api/auth/forgot-password': { status: 202, body: { ok: true } },
  });

  renderApp('/sifremi-unuttum', { authUser: null });

  await user.type(screen.getByLabelText('E-posta'), 'deniz@example.com');
  await user.click(screen.getByRole('button', { name: 'Sıfırlama bağlantısı gönder' }));

  expect(
    await screen.findByText('Bu adres kayıtlıysa sıfırlama bağlantısı gönderildi.'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Hesabına bağlı/)).not.toBeInTheDocument();
  expect(screen.queryByText(/E-posta gönderildi/)).not.toBeInTheDocument();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderVerify(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialAuth={{ status: 'signedOut', user: null, csrfToken: null }}>
        <LocationProbe />
        <AuthGate openDb={async () => undefined} closeDb={async () => undefined} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

test('e-posta doğrulama başarıda tokenı URL den replace ile temizler', async () => {
  const api = install({
    'POST /api/auth/verify-email': { body: { ok: true } },
  });

  renderVerify('/eposta-dogrula?token=verify-abc');

  expect(
    await screen.findByRole('heading', { name: 'E-posta adresin doğrulandı' }),
  ).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByTestId('location')).not.toHaveTextContent('token');
  });
  expect(screen.getByTestId('location')).toHaveTextContent('/eposta-dogrula');
  expect(api.callsTo('POST', '/api/auth/verify-email')).toHaveLength(1);
});

test('e-posta doğrulama geçici hatada aynı tokenla tekrar dener', async () => {
  const user = userEvent.setup();
  let attempt = 0;
  const api = install({
    'POST /api/auth/verify-email': () => {
      attempt += 1;
      return attempt === 1 ? { networkError: true } : { body: { ok: true } };
    },
  });

  renderVerify('/eposta-dogrula?token=verify-retry');

  expect(
    await screen.findByText('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.'),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Tekrar dene' }));

  expect(
    await screen.findByRole('heading', { name: 'E-posta adresin doğrulandı' }),
  ).toBeInTheDocument();
  const calls = api.callsTo('POST', '/api/auth/verify-email');
  expect(calls).toHaveLength(2);
  expect(calls[1]?.body).toEqual({ token: 'verify-retry' });
});

test('bulut kullanıcı verisi doluysa otomatik birleştirme önermez, yedek ve kapat sunar', async () => {
  const user = userEvent.setup();
  await seedOnboarded(CURRICULUM);
  await createLegacyExam();
  install(
    syncRoutes({
      'GET /api/sync/status': {
        body: {
          hasData: true,
          hasUserData: true,
          counts: { exams: 1 },
          cursor: 3,
          serverTime: new Date().toISOString(),
        },
      },
    }),
  );

  renderApp('/ayarlar');

  expect(
    await screen.findByRole('heading', {
      name: 'Hesabında kayıtlı kullanıcı verisi var',
    }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hesabıma aktar' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Yedek indir' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Kapat' }));

  expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument();
  // Nothing was merged automatically; the old database is still there.
  expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(true);
  const active = getActiveDbOrNull();
  expect(active).not.toBeNull();
  expect(await active!.exams.count()).toBe(0);
});

test('sunucuda yalnızca tohum verisi varsa taşıma önerilir', async () => {
  const user = userEvent.setup();
  await createUserDatabase();
  await createLegacyExam();
  install(
    syncRoutes({
      'GET /api/sync/status': {
        body: {
          hasData: true,
          hasUserData: false,
          counts: { subjects: 12, topics: 200 },
          cursor: 3,
          serverTime: new Date().toISOString(),
        },
      },
    }),
  );

  renderApp('/ayarlar', { openDb: openUserDb });

  await user.click(await screen.findByRole('button', { name: 'Hesabıma aktar' }));
  expect(await screen.findByText(/Aktarım tamamlandı/)).toBeInTheDocument();
});

test('program açılışının oluşturduğu boş hafta taşımayı engellemez', async () => {
  await createUserDatabase();
  install(syncRoutes());

  const first = renderApp('/program', { openDb: openUserDb });

  expect(
    await screen.findByRole('heading', { name: 'Ders Çalışma Çizelgesi' }),
  ).toBeInTheDocument();
  await waitFor(async () => {
    const active = getActiveDbOrNull();
    expect(await active?.scheduleWeeks.count()).toBe(1);
  });

  first.unmount();
  mock?.restore();
  mock = null;
  await createLegacyExam();
  install(
    syncRoutes({
      'GET /api/sync/status': {
        body: {
          hasData: true,
          hasUserData: false,
          counts: { subjects: 12, topics: 200, scheduleWeeks: 1 },
          cursor: 3,
          serverTime: new Date().toISOString(),
        },
      },
    }),
  );

  renderApp('/ayarlar', { openDb: openUserDb });

  expect(await screen.findByRole('button', { name: 'Hesabıma aktar' })).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Bu cihazda hesap verisi var' }),
  ).not.toBeInTheDocument();
});

test('ilk girişte eski veriyi hesaba aktarır ve uygulamayı açar', async () => {
  const user = userEvent.setup();
  await createUserDatabase();
  await createLegacyExam();
  install(syncRoutes());

  renderApp('/ayarlar', { openDb: openUserDb });

  expect(
    await screen.findByText(/üst kaydı bulunmayan bağlı kayıtlar atlanabilir/),
  ).toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: 'Hesabıma aktar' }));

  expect(await screen.findByText(/Aktarım tamamlandı/)).toBeInTheDocument();
  expect(
    screen.getByText(/1 bağlı kayıt eksik üst kayıt nedeniyle atlandı/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Uygulamaya devam et' }));

  expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument();
  const active = getActiveDbOrNull();
  expect(active?.name).toBe(userDbName(TEST_AUTH_USER.id));
  expect(await active?.exams.get('old-exam')).toMatchObject({ name: 'Eski Deneme' });
});

test('boş başla eski veriyi silmez ve bir daha sormaz', async () => {
  const user = userEvent.setup();
  await createUserDatabase();
  await createLegacyExam();
  install(syncRoutes());

  const first = renderApp('/ayarlar', { openDb: openUserDb });

  await user.click(await screen.findByRole('button', { name: 'Boş başla' }));
  expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument();
  expect(await Dexie.exists(LEGACY_DB_NAME)).toBe(true);

  const active = getActiveDbOrNull();
  expect((await active?.syncMeta.get('legacyTransferPrompt'))?.value).toBe('dismissed');

  first.unmount();
  mock?.restore();
  mock = null;
  install(syncRoutes());
  renderApp('/ayarlar', { openDb: openUserDb });
  await screen.findByRole('heading', { name: 'Ayarlar' });
  expect(screen.queryByRole('button', { name: 'Hesabıma aktar' })).not.toBeInTheDocument();
});
