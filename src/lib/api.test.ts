import { afterEach, expect, test, vi } from 'vitest';
import { installMockApi } from '@/test/mockApi';
import { ApiError, UNAUTHORIZED_EVENT, api } from './api';

const sessionError = {
  error: { code: 'unauthenticated', message: 'Oturum bulunamadı veya süresi dolmuş.' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('İstek hata vermedi');
}

test('200 JSON yanıtını çözer ve aynı origin isteği gönderir', async () => {
  const mock = installMockApi({
    'GET /api/health': { body: { ok: true, serverTime: '2026-11-25T10:00:00.000Z' } },
  });

  await expect(api.get<{ ok: boolean }>('/api/health')).resolves.toEqual({
    ok: true,
    serverTime: '2026-11-25T10:00:00.000Z',
  });

  expect(mock.fetchMock).toHaveBeenCalledTimes(1);
  const call = mock.callsTo('GET', '/api/health')[0];
  expect(call.url).toBe('/api/health');
  expect(call.init).toMatchObject({
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  expect(call.init.body).toBeUndefined();
  expect(call.headers.get('Accept')).toBe('application/json');
  expect(call.headers.get('Content-Type')).toBeNull();
  expect(call.headers.get('X-CSRF-Token')).toBeNull();
});

test('204 yanıtında gövde olmadan çözülür', async () => {
  const mock = installMockApi({
    'POST /api/auth/logout': { status: 204 },
  });

  await expect(api.post('/api/auth/logout', undefined, 'csrf-1')).resolves.toBeUndefined();

  const call = mock.callsTo('POST', '/api/auth/logout')[0];
  expect(call.init.body).toBeUndefined();
  expect(call.headers.get('Content-Type')).toBeNull();
  expect(call.headers.get('X-CSRF-Token')).toBe('csrf-1');
});

test('JSON gövde ve CSRF başlığını yazar gönderir', async () => {
  const mock = installMockApi({
    'POST /api/sync/push': { body: { applied: 1 } },
  });

  await expect(
    api.post<{ applied: number }>('/api/sync/push', { changes: [] }, 'csrf-abc'),
  ).resolves.toEqual({ applied: 1 });

  const call = mock.callsTo('POST', '/api/sync/push')[0];
  expect(call.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
  expect(call.headers.get('Accept')).toBe('application/json');
  expect(call.headers.get('Content-Type')).toBe('application/json');
  expect(call.headers.get('X-CSRF-Token')).toBe('csrf-abc');
  expect(call.body).toEqual({ changes: [] });
});

test('401 ApiError üretir ve kocluk:unauthorized olayını yayınlar', async () => {
  installMockApi({ 'GET /api/auth/session': { status: 401, body: sessionError } });
  const listener = vi.fn();
  window.addEventListener(UNAUTHORIZED_EVENT, listener);

  try {
    const error = await captureError(api.get('/api/auth/session'));

    expect(error.status).toBe(401);
    expect(error.code).toBe('unauthenticated');
    expect(error.message).toBe('Oturum bulunamadı veya süresi dolmuş.');
    expect(error.details).toMatchObject({ code: 'unauthenticated' });
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  }
});

test('401 dışı hata gövdesindeki kodu korur ve olay yayınlamaz', async () => {
  installMockApi({
    'POST /api/auth/register': {
      status: 422,
      body: { error: { code: 'validation_failed', message: 'E-posta geçersiz.' } },
    },
  });
  const listener = vi.fn();
  window.addEventListener(UNAUTHORIZED_EVENT, listener);

  try {
    const error = await captureError(
      api.post('/api/auth/register', { email: 'bozuk', password: 'gizli-sifre' }),
    );

    expect(error.status).toBe(422);
    expect(error.code).toBe('validation_failed');
    expect(error.message).toBe('E-posta geçersiz.');
    expect(error.details).toMatchObject({ code: 'validation_failed' });
    expect(JSON.stringify(error.details)).not.toContain('gizli-sifre');
    expect(listener).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  }
});

test('ağ hatasını status 0 ve network_error olarak döndürür', async () => {
  installMockApi({ 'GET /api/auth/session': { networkError: true } });

  const error = await captureError(api.get('/api/auth/session'));

  expect(error.status).toBe(0);
  expect(error.code).toBe('network_error');
  expect(error.details).toBeNull();
  expect(error.message).toContain('ulaşılamadı');
});
