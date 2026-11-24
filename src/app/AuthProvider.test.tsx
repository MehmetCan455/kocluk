import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  ApiError,
  UNAUTHORIZED_EVENT,
  api,
  readUnauthorizedDetail,
  type UnauthorizedDetail,
} from '@/lib/api';
import { installMockApi, type MockApiResponse } from '@/test/mockApi';
import {
  AUTH_HINT_KEY,
  AuthProvider,
  readAuthHint,
  useAuth,
  type AuthHint,
  type AuthUser,
} from './AuthProvider';

const user: AuthUser = {
  id: 'u1',
  email: 'deniz@example.com',
  displayName: 'Deniz',
  emailVerifiedAt: null,
  createdAt: '2026-11-24T10:00:00.000Z',
};

const hint: AuthHint = {
  userId: 'u1',
  email: 'deniz@example.com',
  displayName: 'Deniz',
};

const unauthorized = {
  error: { code: 'unauthenticated', message: 'Oturum bulunamadı veya süresi dolmuş.' },
};

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    writable: true,
    value: online,
  });
}

function seedHint(value: AuthHint = hint): void {
  localStorage.setItem(AUTH_HINT_KEY, JSON.stringify(value));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider });
}

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setOnline(true);
});

test('oturum yokken signedOut olur', async () => {
  const mock = installMockApi({
    'GET /api/auth/session': { status: 401, body: unauthorized },
  });

  const { result } = renderAuth();
  expect(result.current.status).toBe('loading');

  await waitFor(() => expect(result.current.status).toBe('signedOut'));

  expect(result.current.user).toBeNull();
  expect(result.current.csrfToken).toBeNull();
  expect(readAuthHint()).toBeNull();
  expect(mock.callsTo('GET', '/api/auth/session')).toHaveLength(1);
});

test('session 200 ise signedIn olur ve ipucunu yazar', async () => {
  const mock = installMockApi({
    'GET /api/auth/session': { body: { user, csrfToken: 'csrf-1' } },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedIn'));

  expect(result.current.user).toEqual(user);
  expect(result.current.csrfToken).toBe('csrf-1');
  expect(readAuthHint()).toEqual(hint);

  const call = mock.callsTo('GET', '/api/auth/session')[0];
  expect(call.init.credentials).toBe('same-origin');
  expect(call.headers.get('Accept')).toBe('application/json');
});

test('online 401 ipucu olsa da signedOut yapar ve ipucunu siler', async () => {
  seedHint();
  installMockApi({
    'GET /api/auth/session': { status: 401, body: unauthorized },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedOut'));

  expect(result.current.user).toBeNull();
  expect(readAuthHint()).toBeNull();
});

test('çevrimdışı açılışta ipucu varsa offline olur ve istek atmaz', async () => {
  setOnline(false);
  seedHint();
  const mock = installMockApi({});

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('offline'));

  expect(result.current.user).toEqual({
    id: hint.userId,
    email: hint.email,
    displayName: hint.displayName,
  });
  expect(result.current.csrfToken).toBeNull();
  expect(mock.calls).toHaveLength(0);
  expect(readAuthHint()).toEqual(hint);
});

test('çevrimdışı açılışta ipucu yoksa signedOut olur', async () => {
  setOnline(false);
  const mock = installMockApi({});

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedOut'));

  expect(result.current.user).toBeNull();
  expect(mock.calls).toHaveLength(0);
});

test('bozuk ipucu çevrimdışı açılışta signedOut yapar', async () => {
  setOnline(false);
  localStorage.setItem(AUTH_HINT_KEY, '{bozuk');
  installMockApi({});

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedOut'));
  expect(result.current.user).toBeNull();
});

test('oturum doğrulanamazsa ipucu varsa offline kalır', async () => {
  seedHint();
  installMockApi({ 'GET /api/auth/session': { networkError: true } });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('offline'));

  expect(result.current.user).toEqual({
    id: hint.userId,
    email: hint.email,
    displayName: hint.displayName,
  });
  expect(readAuthHint()).toEqual(hint);
});

test('oturum doğrulanamazsa ve ipucu yoksa signedOut olur', async () => {
  installMockApi({ 'GET /api/auth/session': { networkError: true } });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedOut'));
  expect(result.current.user).toBeNull();
});

test('login başarılıysa ipucunu yazar ve signedIn olur', async () => {
  installMockApi({
    'GET /api/auth/session': { status: 401, body: unauthorized },
    'POST /api/auth/login': { body: { user, csrfToken: 'csrf-2' } },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedOut'));

  await act(async () => {
    await result.current.login({ email: user.email, password: 'gizli-sifre' });
  });

  expect(result.current.status).toBe('signedIn');
  expect(result.current.user).toEqual(user);
  expect(result.current.csrfToken).toBe('csrf-2');
  expect(readAuthHint()).toEqual(hint);
});

test('login isteği kimlik bilgilerini gövdede taşır', async () => {
  const mock = installMockApi({
    'GET /api/auth/session': { status: 401, body: unauthorized },
    'POST /api/auth/login': { body: { user, csrfToken: 'csrf-2' } },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedOut'));

  await act(async () => {
    await result.current.login({ email: user.email, password: 'gizli-sifre' });
  });

  const call = mock.callsTo('POST', '/api/auth/login')[0];
  expect(call.body).toEqual({ email: user.email, password: 'gizli-sifre' });
  expect(call.headers.get('Content-Type')).toBe('application/json');
  expect(call.headers.get('X-CSRF-Token')).toBeNull();
  expect(localStorage.getItem(AUTH_HINT_KEY)).not.toContain('gizli-sifre');
});

test('register başarılıysa ipucunu yazar ve signedIn olur', async () => {
  const mock = installMockApi({
    'GET /api/auth/session': { status: 401, body: unauthorized },
    'POST /api/auth/register': {
      status: 201,
      body: { user, csrfToken: 'csrf-3' },
    },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedOut'));

  await act(async () => {
    await result.current.register({
      email: user.email,
      password: 'gizli-sifre',
      displayName: user.displayName,
      inviteCode: 'DAVET-1',
      privacyAccepted: true,
    });
  });

  expect(result.current.status).toBe('signedIn');
  expect(result.current.csrfToken).toBe('csrf-3');
  expect(readAuthHint()).toEqual(hint);

  const call = mock.callsTo('POST', '/api/auth/register')[0];
  expect(call.body).toEqual({
    email: user.email,
    password: 'gizli-sifre',
    displayName: user.displayName,
    inviteCode: 'DAVET-1',
    privacyAccepted: true,
  });
});

test('logout API yi CSRF ile çağırır, ipucunu ve oturumu temizler', async () => {
  const mock = installMockApi({
    'GET /api/auth/session': { body: { user, csrfToken: 'csrf-1' } },
    'POST /api/auth/logout': { body: { ok: true } },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedIn'));
  expect(readAuthHint()).toEqual(hint);

  await act(async () => {
    await result.current.logout();
  });

  expect(result.current.status).toBe('signedOut');
  expect(result.current.user).toBeNull();
  expect(result.current.csrfToken).toBeNull();
  expect(readAuthHint()).toBeNull();

  const call = mock.callsTo('POST', '/api/auth/logout')[0];
  expect(call.headers.get('X-CSRF-Token')).toBe('csrf-1');
});

test('logout ağ hatasında oturumu ve ipucunu korur', async () => {
  installMockApi({
    'GET /api/auth/session': { body: { user, csrfToken: 'csrf-1' } },
    'POST /api/auth/logout': { networkError: true },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedIn'));

  await expect(result.current.logout()).rejects.toBeInstanceOf(ApiError);

  expect(result.current.status).toBe('signedIn');
  expect(result.current.csrfToken).toBe('csrf-1');
  expect(readAuthHint()).toEqual(hint);
});

test('login sürerken gelen eski 401 yeni oturumu iptal etmez', async () => {
  const sessionReply = deferred<MockApiResponse>();
  const loginReply = deferred<MockApiResponse>();
  const mock = installMockApi({
    'GET /api/auth/session': () => sessionReply.promise,
    'POST /api/auth/login': () => loginReply.promise,
  });

  const events: UnauthorizedDetail[] = [];
  const listener = (event: Event) => {
    const detail = readUnauthorizedDetail(event);
    if (detail) {
      events.push(detail);
    }
  };
  window.addEventListener(UNAUTHORIZED_EVENT, listener);

  try {
    const { result } = renderAuth();

    let loginPromise!: Promise<void>;
    await act(async () => {
      loginPromise = result.current.login({ email: user.email, password: 'gizli-sifre' });
    });

    const loginRequestId = api.lastRequestId();
    expect(mock.callsTo('GET', '/api/auth/session')).toHaveLength(1);
    expect(mock.callsTo('POST', '/api/auth/login')).toHaveLength(1);

    // The mount-time session request fails after the login attempt started.
    await act(async () => {
      sessionReply.resolve({ status: 401, body: unauthorized });
      await sessionReply.promise;
    });
    await waitFor(() => expect(events).toHaveLength(1));

    expect(events[0]).toMatchObject({
      path: '/api/auth/session',
      method: 'GET',
      code: 'unauthenticated',
    });
    expect(events[0].requestId).toBeLessThan(loginRequestId);
    expect(result.current.status).toBe('loading');
    expect(readAuthHint()).toBeNull();

    await act(async () => {
      loginReply.resolve({ body: { user, csrfToken: 'csrf-new' } });
      await loginPromise;
    });

    expect(result.current.status).toBe('signedIn');
    expect(result.current.user).toEqual(user);
    expect(result.current.csrfToken).toBe('csrf-new');
    expect(readAuthHint()).toEqual(hint);
  } finally {
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  }
});

test('logout sonrası refresh eski oturumu geri getirmez', async () => {
  let sessionCalls = 0;
  const mock = installMockApi({
    'GET /api/auth/session': () => {
      sessionCalls += 1;
      return sessionCalls === 1
        ? { body: { user, csrfToken: 'csrf-1' } }
        : { body: { user, csrfToken: 'csrf-old' } };
    },
    'POST /api/auth/logout': { body: { ok: true } },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedIn'));
  expect(readAuthHint()).toEqual(hint);

  await act(async () => {
    await result.current.logout();
  });
  expect(result.current.status).toBe('signedOut');
  expect(readAuthHint()).toBeNull();

  // A refresh after logout must not trust a 200 from the old session.
  await act(async () => {
    await result.current.refresh();
  });

  expect(result.current.status).toBe('signedOut');
  expect(result.current.user).toBeNull();
  expect(result.current.csrfToken).toBeNull();
  expect(readAuthHint()).toBeNull();
  expect(mock.callsTo('GET', '/api/auth/session')).toHaveLength(2);
});

test('başarısız login mevcut oturumu ve ipucunu silmez', async () => {
  installMockApi({
    'GET /api/auth/session': { body: { user, csrfToken: 'csrf-1' } },
    'POST /api/auth/login': {
      status: 401,
      body: { error: { code: 'invalid_credentials', message: 'E-posta veya şifre hatalı.' } },
    },
  });

  const events: UnauthorizedDetail[] = [];
  const listener = (event: Event) => {
    const detail = readUnauthorizedDetail(event);
    if (detail) {
      events.push(detail);
    }
  };
  window.addEventListener(UNAUTHORIZED_EVENT, listener);

  try {
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('signedIn'));
    expect(readAuthHint()).toEqual(hint);

    await act(async () => {
      await expect(
        result.current.login({ email: user.email, password: 'yanlis-sifre' }),
      ).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    });

    expect(result.current.status).toBe('signedIn');
    expect(result.current.user).toEqual(user);
    expect(result.current.csrfToken).toBe('csrf-1');
    expect(readAuthHint()).toEqual(hint);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      path: '/api/auth/login',
      method: 'POST',
      code: 'invalid_credentials',
    });
  } finally {
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  }
});

test('yeni bir isteğin 401 i oturumu kapatır', async () => {
  installMockApi({
    'GET /api/auth/session': { body: { user, csrfToken: 'csrf-1' } },
    'GET /api/sync/status': { status: 401, body: unauthorized },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedIn'));
  expect(readAuthHint()).toEqual(hint);

  await act(async () => {
    await expect(api.get('/api/sync/status')).rejects.toBeInstanceOf(ApiError);
  });

  await waitFor(() => expect(result.current.status).toBe('signedOut'));
  expect(result.current.user).toBeNull();
  expect(result.current.csrfToken).toBeNull();
  expect(readAuthHint()).toBeNull();
});

test('kocluk:unauthorized olayı oturumu ve ipucunu temizler', async () => {
  installMockApi({
    'GET /api/auth/session': { body: { user, csrfToken: 'csrf-1' } },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('signedIn'));
  expect(readAuthHint()).toEqual(hint);

  act(() => {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  });

  await waitFor(() => expect(result.current.status).toBe('signedOut'));
  expect(result.current.user).toBeNull();
  expect(result.current.csrfToken).toBeNull();
  expect(readAuthHint()).toBeNull();
});

test('online olayı offline oturumu doğrular', async () => {
  setOnline(false);
  seedHint();
  let sessionReady = false;
  installMockApi({
    'GET /api/auth/session': () =>
      sessionReady
        ? { body: { user, csrfToken: 'csrf-1' } }
        : { status: 401, body: unauthorized },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('offline'));

  setOnline(true);
  sessionReady = true;
  act(() => {
    window.dispatchEvent(new Event('online'));
  });

  await waitFor(() => expect(result.current.status).toBe('signedIn'));
  expect(result.current.csrfToken).toBe('csrf-1');
});

test('refresh çevrimdışıyken offline kalır, online olunca oturumu doğrular', async () => {
  setOnline(false);
  seedHint();
  let onlineSession = false;
  const mock = installMockApi({
    'GET /api/auth/session': () =>
      onlineSession
        ? { body: { user, csrfToken: 'csrf-1' } }
        : { status: 401, body: unauthorized },
  });

  const { result } = renderAuth();
  await waitFor(() => expect(result.current.status).toBe('offline'));
  expect(mock.calls).toHaveLength(0);

  setOnline(true);
  onlineSession = true;

  await act(async () => {
    await result.current.refresh();
  });

  expect(result.current.status).toBe('signedIn');
  expect(result.current.csrfToken).toBe('csrf-1');
  expect(mock.callsTo('GET', '/api/auth/session')).toHaveLength(1);
});
