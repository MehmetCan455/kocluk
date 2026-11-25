import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { StrictMode, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/app/AuthProvider';
import { CURRICULUM } from '@/data/curriculum';
import { db, getActiveDbOrNull } from '@/db/db';
import { activeUserId, closeActiveDb } from '@/db/dbManager';
import { seedOnboarded } from '@/test/fixtures';
import { installMockApi, type MockApi, type MockApiResponse } from '@/test/mockApi';
import { TEST_AUTH_USER, renderApp } from '@/test/renderApp';
import { authErrorMessage } from './authError';
import { AuthGate } from './AuthGate';

const PASSWORD = 'gizli-sifre-123';

let mock: MockApi | null = null;

function install(routes: Parameters<typeof installMockApi>[0]): MockApi {
  mock = installMockApi(routes);
  return mock;
}

function LogoutButton() {
  const { logout } = useAuth();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void logout().catch((caught: unknown) => {
            setError(authErrorMessage(caught, 'Çıkış yapılamadı. Lütfen tekrar dene.'));
          });
        }}
      >
        Çıkış yap
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

beforeEach(async () => {
  localStorage.clear();
});

afterEach(async () => {
  mock?.restore();
  mock = null;
  localStorage.clear();
  vi.unstubAllGlobals();
  const active = getActiveDbOrNull();
  if (active?.name && active.name !== 'kocluk-test') {
    const name = active.name;
    await closeActiveDb();
    await Dexie.delete(name);
  }
});

test('giriş formu boş alanlarda Türkçe hata gösterir ve istek atmaz', async () => {
  const user = userEvent.setup();
  const api = install({});

  renderApp('/giris', { authUser: null });

  await user.click(screen.getByRole('button', { name: 'Giriş yap' }));

  expect(screen.getByText('E-posta adresini gir.')).toBeInTheDocument();
  expect(screen.getByText('Şifreni gir.')).toBeInTheDocument();
  expect(api.calls).toHaveLength(0);
});

test('yanlış girişte Türkçe hata gösterir ve giriş ekranında kalır', async () => {
  const user = userEvent.setup();
  install({
    'POST /api/auth/login': {
      status: 401,
      body: { error: { code: 'invalid_credentials', message: 'E-posta veya şifre hatalı.' } },
    },
  });

  renderApp('/giris', { authUser: null });

  await user.type(screen.getByLabelText('E-posta'), 'deniz@example.com');
  await user.type(screen.getByLabelText('Şifre'), 'yanlis-sifre');
  await user.click(screen.getByRole('button', { name: 'Giriş yap' }));

  expect(await screen.findByText('E-posta veya şifre hatalı.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
});

test('başarılı girişte ana sayfa açılır', async () => {
  const user = userEvent.setup();
  await seedOnboarded(CURRICULUM);
  install({
    'POST /api/auth/login': {
      body: { user: TEST_AUTH_USER, csrfToken: 'csrf-login' },
    },
  });

  renderApp('/giris', { authUser: null });

  await user.type(screen.getByLabelText('E-posta'), TEST_AUTH_USER.email);
  await user.type(screen.getByLabelText('Şifre'), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Giriş yap' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Genel Bakış' }),
  ).toBeInTheDocument();
});

test('kayıt formunda gizlilik onayı olmadan buton kapalıdır', async () => {
  const user = userEvent.setup();

  renderApp('/kayit', { authUser: null });

  await user.type(screen.getByLabelText('Adın'), 'Deniz');
  await user.type(screen.getByLabelText('E-posta'), 'deniz@example.com');
  await user.type(screen.getByLabelText('Şifre'), PASSWORD);

  expect(screen.getByRole('button', { name: 'Kayıt ol' })).toBeDisabled();

  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Kayıt ol' })).toBeEnabled();
});

test('başarılı kayıt oturum açar ve onboarding ekranına gider', async () => {
  const user = userEvent.setup();
  const api = install({
    'POST /api/auth/register': {
      status: 201,
      body: { user: TEST_AUTH_USER, csrfToken: 'csrf-register' },
    },
  });

  renderApp('/kayit', { authUser: null });

  await user.type(screen.getByLabelText('Adın'), TEST_AUTH_USER.displayName);
  await user.type(screen.getByLabelText('E-posta'), TEST_AUTH_USER.email);
  await user.type(screen.getByLabelText('Şifre'), PASSWORD);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Kayıt ol' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Seni tanıyalım' }),
  ).toBeInTheDocument();

  const call = api.callsTo('POST', '/api/auth/register')[0];
  expect(call.body).toMatchObject({
    email: TEST_AUTH_USER.email,
    password: PASSWORD,
    displayName: TEST_AUTH_USER.displayName,
    privacyAccepted: true,
  });
  expect(call.body).not.toHaveProperty('inviteCode');
});

test('şifremi unuttum formu 202 sonrası nötr gönderildi mesajı gösterir', async () => {
  const user = userEvent.setup();
  const api = install({
    'POST /api/auth/forgot-password': { status: 202, body: { ok: true } },
  });

  renderApp('/sifremi-unuttum', { authUser: null });

  await user.type(screen.getByLabelText('E-posta'), 'deniz@example.com');
  await user.click(screen.getByRole('button', { name: 'Sıfırlama bağlantısı gönder' }));

  expect(await screen.findByRole('heading', { name: 'İstek alındı' })).toBeInTheDocument();
  expect(
    screen.getByText('Bu adres kayıtlıysa sıfırlama bağlantısı gönderildi.'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Hesabına bağlı/)).not.toBeInTheDocument();
  expect(api.callsTo('POST', '/api/auth/forgot-password')[0]?.body).toEqual({
    email: 'deniz@example.com',
  });
});

test('şifre sıfırlama token ile şifreyi değiştirir ve girişe döner', async () => {
  const user = userEvent.setup();
  const api = install({
    'POST /api/auth/reset-password': { body: { ok: true } },
  });

  renderApp('/sifre-sifirla?token=token-abc', { authUser: null });

  await user.type(screen.getByLabelText('Yeni şifre'), PASSWORD);
  await user.type(screen.getByLabelText('Yeni şifre (tekrar)'), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Şifreyi kaydet' }));

  expect(
    await screen.findByText('Şifren başarıyla sıfırlandı. Yeni şifrenle giriş yap.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
  expect(api.callsTo('POST', '/api/auth/reset-password')[0]?.body).toEqual({
    token: 'token-abc',
    password: PASSWORD,
  });
});

test('e-posta doğrulama tokenı tüketir ve başarı mesajı gösterir', async () => {
  const api = install({
    'POST /api/auth/verify-email': { body: { ok: true } },
  });

  renderApp('/eposta-dogrula?token=verify-abc', { authUser: null });

  expect(
    await screen.findByRole('heading', { name: 'E-posta adresin doğrulandı' }),
  ).toBeInTheDocument();
  expect(api.callsTo('POST', '/api/auth/verify-email')[0]?.body).toEqual({
    token: 'verify-abc',
  });
});

test('e-posta doğrulamada token yoksa istek atmadan hata gösterir', async () => {
  const api = install({});

  renderApp('/eposta-dogrula', { authUser: null });

  expect(await screen.findByText('Doğrulama bağlantısı geçersiz veya eksik.')).toBeInTheDocument();
  expect(api.calls).toHaveLength(0);
});

test('oturum yokken ana sayfa giriş ekranına yönlendirir', async () => {
  renderApp('/', { authUser: null });

  expect(await screen.findByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
});

test('oturum kontrolü sürerken yükleniyor gösterir', async () => {
  let resolveSession!: (response: MockApiResponse) => void;
  const sessionReply = new Promise<MockApiResponse>((resolve) => {
    resolveSession = resolve;
  });
  install({ 'GET /api/auth/session': () => sessionReply });

  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <AuthGate openDb={async () => undefined} closeDb={async () => undefined} />
      </AuthProvider>
    </MemoryRouter>,
  );

  expect(screen.getByRole('status')).toHaveTextContent('Oturum kontrol ediliyor…');

  await act(async () => {
    resolveSession({
      status: 401,
      body: { error: { code: 'unauthenticated', message: 'Oturum bulunamadı.' } },
    });
    await sessionReply;
  });

  expect(await screen.findByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
});

test('e-posta doğrulama StrictMode altında tokenı bir kez gönderir', async () => {
  const api = install({
    'POST /api/auth/verify-email': { body: { ok: true } },
  });

  render(
    <StrictMode>
      <MemoryRouter initialEntries={['/eposta-dogrula?token=strict-token']}>
        <AuthProvider
          initialAuth={{ status: 'signedOut', user: null, csrfToken: null }}
        >
          <AuthGate openDb={async () => undefined} closeDb={async () => undefined} />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );

  expect(
    await screen.findByRole('heading', { name: 'E-posta adresin doğrulandı' }),
  ).toBeInTheDocument();
  expect(api.callsTo('POST', '/api/auth/verify-email')).toHaveLength(1);
});

test('oturum varken giriş ekranı ana sayfaya yönlendirir', async () => {
  await seedOnboarded(CURRICULUM);

  renderApp('/giris', { authUser: TEST_AUTH_USER });

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Genel Bakış' }),
  ).toBeInTheDocument();
});

test('kullanıcı DB si açılmadan uygulama kabuğu gösterilmez', async () => {
  await seedOnboarded(CURRICULUM);

  let resolveOpen!: () => void;
  const openDb = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveOpen = resolve;
      }),
  );
  const closeDb = vi.fn(async () => undefined);

  renderApp('/', { openDb, closeDb });

  expect(screen.getByRole('status')).toHaveTextContent('Hesabın açılıyor…');
  expect(screen.queryByRole('heading', { name: 'Genel Bakış' })).not.toBeInTheDocument();
  expect(openDb).toHaveBeenCalledWith(TEST_AUTH_USER.id);

  await act(async () => {
    resolveOpen();
  });

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Genel Bakış' }),
  ).toBeInTheDocument();
});

test('çıkışta aktif kullanıcı DB si kapatılır', async () => {
  const user = userEvent.setup();
  install({ 'POST /api/auth/logout': { body: { ok: true } } });
  const userDbName = `kocluk-u-${TEST_AUTH_USER.id}`;

  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider
        initialAuth={{ status: 'signedIn', user: TEST_AUTH_USER, csrfToken: 'csrf-test' }}
      >
        <LogoutButton />
        <AuthGate />
      </AuthProvider>
    </MemoryRouter>,
  );

  await waitFor(() => expect(activeUserId()).toBe(TEST_AUTH_USER.id));
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Seni tanıyalım' }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Çıkış yap' }));

  expect(await screen.findByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
  await waitFor(() => expect(activeUserId()).toBeNull());
  expect(getActiveDbOrNull()).toBeNull();
  await Dexie.delete(userDbName);
});

test('başarısız çıkışta oturum ve kullanıcı DB si açık kalır', async () => {
  const user = userEvent.setup();
  install({ 'POST /api/auth/logout': { networkError: true } });
  const userDbName = `kocluk-u-${TEST_AUTH_USER.id}`;

  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider
        initialAuth={{ status: 'signedIn', user: TEST_AUTH_USER, csrfToken: 'csrf-test' }}
      >
        <LogoutButton />
        <AuthGate />
      </AuthProvider>
    </MemoryRouter>,
  );

  await waitFor(() => expect(activeUserId()).toBe(TEST_AUTH_USER.id));
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Seni tanıyalım' }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Çıkış yap' }));

  expect(
    await screen.findByText('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.'),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Seni tanıyalım' }),
  ).toBeInTheDocument();
  expect(activeUserId()).toBe(TEST_AUTH_USER.id);
  expect(db.name).toBe(userDbName);

  await closeActiveDb();
  await Dexie.delete(userDbName);
});
