import { vi, type Mock } from 'vitest';

/**
 * Minimal same-origin API stand-in for component and client tests.
 *
 * Routes are keyed by `"METHOD /path"`; the query string is ignored when
 * matching, so a route answers `/api/sync/pull?since=1` and `/api/sync/pull`
 * alike while `call.url` keeps the full value. Every call is recorded so tests
 * can assert headers and bodies without reaching the network.
 */

export interface MockApiCall {
  url: string;
  path: string;
  method: string;
  headers: Headers;
  body: unknown;
  init: RequestInit;
}

export interface MockApiResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Simulate a transport failure instead of an HTTP response. */
  networkError?: true;
}

export type MockApiReply =
  | MockApiResponse
  | ((call: MockApiCall) => MockApiResponse | Promise<MockApiResponse>);

export type MockFetch = Mock<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>;

export interface MockApi {
  fetchMock: MockFetch;
  calls: MockApiCall[];
  callsTo(method: string, path: string): MockApiCall[];
  restore(): void;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

function requestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  return body ?? null;
}

function toResponse(reply: MockApiResponse): Response {
  if (reply.networkError) {
    throw new TypeError('Failed to fetch');
  }

  const status = reply.status ?? 200;
  const headers = new Headers(reply.headers);
  let body: string | null = null;

  if (reply.body !== undefined && status !== 204) {
    body = JSON.stringify(reply.body);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
    }
  }

  return new Response(body, { status, headers });
}

export function installMockApi(routes: Record<string, MockApiReply>): MockApi {
  const calls: MockApiCall[] = [];

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = url.split('?')[0] ?? url;
      const call: MockApiCall = {
        url,
        path,
        method,
        headers: new Headers(init?.headers),
        body: requestBody(init?.body),
        init: init ?? {},
      };
      calls.push(call);

      const key = `${method} ${path}`;
      const reply = routes[key];

      if (reply === undefined) {
        throw new Error(`Beklenmeyen API çağrısı: ${key}`);
      }

      const resolved = typeof reply === 'function' ? await reply(call) : reply;
      return toResponse(resolved);
    },
  );

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    calls,
    callsTo(method: string, path: string): MockApiCall[] {
      const normalized = method.toUpperCase();
      return calls.filter((call) => call.method === normalized && call.path === path);
    },
    restore(): void {
      vi.unstubAllGlobals();
    },
  };
}
