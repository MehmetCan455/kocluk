import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, type AuthStatus, type AuthUser } from '@/app/AuthProvider';
import { AuthGate } from '@/features/auth/AuthGate';

/**
 * A signed-in account for tests that exercise the app shell and feature
 * pages. `renderApp` uses it by default, so existing tests keep their seeded
 * test database; a test that checks the signed-out screens passes
 * `{ authUser: null }`.
 */
export const TEST_AUTH_USER: AuthUser = {
  id: 'test-user',
  email: 'test@example.com',
  displayName: 'Test Kullanıcı',
  emailVerifiedAt: '2026-11-24T10:00:00.000Z',
  createdAt: '2026-11-24T09:00:00.000Z',
};

export interface RenderAppOptions {
  /** `null` renders the auth screens; omitted means the signed-in test user. */
  authUser?: AuthUser | null;
  authStatus?: Exclude<AuthStatus, 'loading'>;
  /**
   * Injected database opener. The default keeps the active test database, so
   * seeded fixtures and the app share one database and production's `kocluk`
   * name is never touched.
   */
  openDb?: (userId: string) => Promise<unknown>;
  closeDb?: () => Promise<void>;
}

/**
 * Renders the real gate inside a memory router. The auth provider starts from
 * a known state, which skips the session request; tests that exercise login
 * still get the real provider transitions.
 */
export function renderApp(path = '/', options: RenderAppOptions = {}): RenderResult {
  const user = options.authUser === undefined ? TEST_AUTH_USER : options.authUser;
  const status = options.authStatus ?? (user ? 'signedIn' : 'signedOut');

  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider
        initialAuth={{ status, user, csrfToken: user ? 'test-csrf-token' : null }}
      >
        <AuthGate
          openDb={options.openDb ?? (async () => undefined)}
          closeDb={options.closeDb ?? (async () => undefined)}
        />
      </AuthProvider>
    </MemoryRouter>,
  );
}
