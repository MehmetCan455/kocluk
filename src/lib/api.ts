/**
 * Same-origin JSON API client (design §9.1).
 *
 * The SPA and the PHP API share one host, so the client only uses relative
 * paths and never hardcodes an origin. The HttpOnly session cookie travels
 * automatically with `credentials: 'same-origin'`; authenticated writes get
 * the CSRF token from the caller. A 401 emits `kocluk:unauthorized` so the
 * auth provider can leave the signed-in state without every caller handling
 * it separately.
 */

export const UNAUTHORIZED_EVENT = 'kocluk:unauthorized';

const NETWORK_ERROR_MESSAGE = 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.';

/**
 * Payload of `kocluk:unauthorized`. The request id is monotonic, so an auth
 * transition can ignore 401s from requests it has already superseded; the
 * path and code let the provider distinguish a failed credential attempt
 * from an expired session.
 */
export interface UnauthorizedDetail {
  requestId: number;
  path: string;
  method: 'GET' | 'POST';
  code: string | null;
}

/** Id assigned to the most recent request; 0 before the first one. */
let requestSequence = 0;

function emitUnauthorized(
  requestId: number,
  path: string,
  method: 'GET' | 'POST',
  code: string | null,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const detail: UnauthorizedDetail = { requestId, path, method, code };
  window.dispatchEvent(new CustomEvent<UnauthorizedDetail>(UNAUTHORIZED_EVENT, { detail }));
}

/**
 * Reads and validates the event payload. A listener that does not understand
 * the detail can still treat the event itself as a session-expired signal.
 */
export function readUnauthorizedDetail(event: Event): UnauthorizedDetail | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }

  const detail: unknown = event.detail;
  if (!isRecord(detail)) {
    return null;
  }

  const { requestId, path, method, code } = detail;
  if (
    typeof requestId !== 'number' ||
    !Number.isInteger(requestId) ||
    requestId <= 0 ||
    typeof path !== 'string' ||
    path === '' ||
    (method !== 'GET' && method !== 'POST') ||
    (code !== null && typeof code !== 'string')
  ) {
    return null;
  }

  return { requestId, path, method, code };
}

export class ApiError extends Error {
  /** HTTP status; 0 when the request never reached the server. */
  readonly status: number;

  /** Server error code such as `unauthenticated` or `validation_failed`. */
  readonly code: string;

  /** The server's `error` object when one was returned, otherwise null. */
  readonly details: unknown;

  /** `Retry-After` in seconds for a 429/503 response, when the server sent it. */
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(1, Math.ceil((date - Date.now()) / 1000));
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  csrfToken?: string,
): Promise<T> {
  const requestId = ++requestSequence;
  const headers: Record<string, string> = { Accept: 'application/json' };

  // Only writes with a body are JSON; logout and similar empty POSTs must not
  // claim a content type they do not send.
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  // Serialize before the transport try so a bad payload is not reported as a
  // network failure.
  const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(serializedBody !== undefined ? { body: serializedBody } : {}),
    });
  } catch {
    throw new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    // The status line already arrived, so a 401 is definitive even when the
    // body stream breaks.
    if (response.status === 401) {
      emitUnauthorized(requestId, path, method, null);
    }
    throw new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE);
  }

  const payload = text === '' ? undefined : parseJson(text);
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  const code = typeof error?.code === 'string' && error.code !== '' ? error.code : null;
  const message =
    typeof error?.message === 'string' && error.message !== '' ? error.message : null;

  if (response.status === 401) {
    emitUnauthorized(requestId, path, method, code);
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      code ?? 'http_error',
      message ?? `İstek başarısız oldu (${response.status}).`,
      error,
      parseRetryAfter(response.headers.get('Retry-After')),
    );
  }

  if (text === '') {
    return undefined as T;
  }
  if (payload === undefined) {
    // A 2xx that is not JSON is not an application answer: a host/WAF page, a
    // captive portal or a proxy interrupted the response. Keep the status and
    // content type so a beta report identifies the source without logging the
    // body (which may contain a portal or account page).
    const contentType = response.headers.get('Content-Type');
    const server = response.headers.get('Server');
    const details = { status: response.status, contentType, server, path };
    const typeLabel = contentType?.split(';')[0]?.trim() || 'bilinmeyen içerik';

    console.warn('kocluk-api: JSON olmayan yanıt', details);

    throw new ApiError(
      response.status,
      'invalid_response',
      `Sunucudan beklenmeyen bir yanıt geldi (HTTP ${response.status}, ${typeLabel}); otomatik olarak yeniden denenecek.`,
      details,
    );
  }

  return payload as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>('GET', path);
  },
  post<T>(path: string, body?: unknown, csrfToken?: string): Promise<T> {
    return request<T>('POST', path, body, csrfToken);
  },
  /**
   * The id of the most recently issued request (0 before the first). An auth
   * transition captures this before issuing its request, so 401 events from
   * requests at or below that floor belong to an earlier attempt.
   */
  lastRequestId(): number {
    return requestSequence;
  },
};
