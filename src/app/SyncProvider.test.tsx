import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AuthProvider } from '@/app/AuthProvider';
import { TEST_AUTH_USER } from '@/test/renderApp';
import {
  installMockApi,
  type MockApi,
  type MockApiResponse,
} from '@/test/mockApi';
import {
  INITIAL_SYNC_GATE_TIMEOUT_MS,
  SyncProvider,
} from './SyncProvider';

/**
 * First-login ordering: the app shell (and therefore SettingsProvider /
 * AppRoutes) must not mount until the app-open sync has applied the server
 * settings. Otherwise a fresh second device sees onboardingDone=false and
 * lands on `/onboarding` even though the account is already onboarded.
 */

let mock: MockApi | null = null;

afterEach(() => {
  mock?.restore();
  mock = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function statusBody() {
  return {
    hasData: false,
    hasUserData: false,
    counts: {},
    cursor: 0,
    serverTime: new Date().toISOString(),
  };
}

function renderSyncProvider(): void {
  render(
    <AuthProvider
      initialAuth={{
        status: 'signedIn',
        user: TEST_AUTH_USER,
        csrfToken: 'csrf-test',
      }}
    >
      <SyncProvider>
        <p>uygulama hazır</p>
      </SyncProvider>
    </AuthProvider>,
  );
}

test('ilk senkron bitmeden uygulama kabuğu gösterilmez', async () => {
  let resolvePull!: (response: MockApiResponse) => void;
  const pull = new Promise<MockApiResponse>((resolve) => {
    resolvePull = resolve;
  });
  mock = installMockApi({
    'GET /api/sync/pull': () => pull,
    'GET /api/sync/status': { body: statusBody() },
    'POST /api/sync/push': {
      body: { results: [], serverTime: new Date().toISOString() },
    },
  });

  renderSyncProvider();

  expect(screen.getByRole('status')).toHaveTextContent('Hesabın hazırlanıyor…');
  expect(screen.queryByText('uygulama hazır')).not.toBeInTheDocument();

  await act(async () => {
    resolvePull({
      body: { changes: [], nextCursor: 0, hasMore: false },
    });
    await pull;
  });

  expect(await screen.findByText('uygulama hazır')).toBeInTheDocument();
});

test('ilk senkron çevrimdışıysa kabuk hemen açılır', async () => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
  // The offline engine path never reaches the network, but the provider still
  // needs a reachable active database; the test setup provides one.
  renderSyncProvider();

  expect(await screen.findByText('uygulama hazır')).toBeInTheDocument();
});

test('ilk senkron yanıt vermezse sınırlı süre sonra kabuk açılır', async () => {
  vi.useFakeTimers();
  const pull = new Promise<MockApiResponse>(() => undefined);
  mock = installMockApi({
    'GET /api/sync/pull': () => pull,
    'GET /api/sync/status': { body: statusBody() },
    'POST /api/sync/push': {
      body: { results: [], serverTime: new Date().toISOString() },
    },
  });

  renderSyncProvider();

  expect(screen.getByRole('status')).toHaveTextContent('Hesabın hazırlanıyor…');
  expect(screen.queryByText('uygulama hazır')).not.toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(INITIAL_SYNC_GATE_TIMEOUT_MS);
  });

  expect(screen.getByText('uygulama hazır')).toBeInTheDocument();
});
