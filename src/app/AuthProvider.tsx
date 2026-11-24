import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, UNAUTHORIZED_EVENT, api, readUnauthorizedDetail } from '@/lib/api';

/**
 * Account session state and the offline hint (design §9.1, §9.4).
 *
 * The HttpOnly cookie is the only credential; the provider keeps the CSRF
 * token returned by the API in memory. A small localStorage hint (user id,
 * e-mail, display name — never a token or password) lets an offline start
 * open `kocluk-u-<userId>` before the session can be validated. When the
 * browser is online `/api/auth/session` is authoritative: a 401 signs the
 * user out and clears the hint, while a transport failure falls back to
 * `offline` if a hint exists.
 */

export const AUTH_HINT_KEY = 'kocluk.authHint';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'offline';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt?: string | null;
  createdAt?: string;
}

/** The offline-only subset stored in localStorage; no tokens. */
export interface AuthHint {
  userId: string;
  email: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  inviteCode?: string;
  privacyAccepted: boolean;
}

interface SessionResponse {
  user: AuthUser;
  csrfToken: string;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  csrfToken: string | null;
}

/**
 * Known starting state for tests and previews. When given, the provider trusts
 * it instead of calling `/api/auth/session` on mount.
 */
export interface InitialAuthState {
  status: Exclude<AuthStatus, 'loading'>;
  user: AuthUser | null;
  csrfToken?: string | null;
}

interface AuthContextValue extends AuthState {
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function createInitialState(initialAuth?: InitialAuthState): AuthState {
  if (!initialAuth) {
    return { status: 'loading', user: null, csrfToken: null };
  }

  return {
    status: initialAuth.status,
    user: initialAuth.user,
    csrfToken: initialAuth.csrfToken ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSessionResponse(value: unknown): value is SessionResponse {
  if (!isRecord(value) || !isRecord(value.user)) {
    return false;
  }

  return (
    typeof value.user.id === 'string' &&
    value.user.id !== '' &&
    typeof value.user.email === 'string' &&
    value.user.email !== '' &&
    typeof value.user.displayName === 'string' &&
    typeof value.csrfToken === 'string' &&
    value.csrfToken !== ''
  );
}

function browserIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Reads the offline hint. Corrupt JSON or a partially written value is
 * treated as "no hint", never as a crash on startup.
 */
export function readAuthHint(): AuthHint | null {
  try {
    const raw = localStorage.getItem(AUTH_HINT_KEY);
    if (!raw) {
      return null;
    }

    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) {
      return null;
    }

    const { userId, email, displayName } = value;
    if (
      typeof userId !== 'string' ||
      userId === '' ||
      typeof email !== 'string' ||
      email === '' ||
      typeof displayName !== 'string'
    ) {
      return null;
    }

    return { userId, email, displayName };
  } catch {
    return null;
  }
}

function writeAuthHint(user: AuthUser): void {
  const hint: AuthHint = {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
  };

  try {
    localStorage.setItem(AUTH_HINT_KEY, JSON.stringify(hint));
  } catch {
    // Storage can be unavailable (private mode). The hint is an offline
    // convenience; the server session stays authoritative.
  }
}

function clearAuthHint(): void {
  try {
    localStorage.removeItem(AUTH_HINT_KEY);
  } catch {
    // Nothing to do; a stale hint is revalidated or rejected at startup.
  }
}

function userFromHint(hint: AuthHint): AuthUser {
  return { id: hint.userId, email: hint.email, displayName: hint.displayName };
}

export interface AuthProviderProps {
  children: ReactNode;
  /**
   * Test/embedding seam: start from a known state and skip the mount refresh.
   * Production never passes this, so the server session stays authoritative.
   */
  initialAuth?: InitialAuthState;
}

export function AuthProvider({ children, initialAuth }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(() => createInitialState(initialAuth));
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const skipInitialRefresh = useRef(initialAuth !== undefined);
  // Every auth transition gets an id; a slower response from an earlier
  // transition must never overwrite the newer one.
  const sequenceRef = useRef(0);
  // Request id floor of the current attempt: a 401 from a request issued at
  // or before this point belongs to a superseded attempt and is ignored.
  const attemptFloorRef = useRef(0);
  // A successful logout is authoritative: a later refresh must not resurrect
  // the old session from an in-flight or stale 200 response. Only an explicit
  // login/register clears the barrier.
  const logoutBarrierRef = useRef(false);

  const commit = useCallback((next: AuthState) => {
    stateRef.current = next;
    if (mountedRef.current) {
      setState(next);
    }
  }, []);

  const beginAuthAttempt = useCallback((): number => {
    const requestId = sequenceRef.current + 1;
    sequenceRef.current = requestId;
    attemptFloorRef.current = api.lastRequestId();
    return requestId;
  }, []);

  const applySignedIn = useCallback(
    (response: SessionResponse) => {
      if (!isSessionResponse(response)) {
        throw new ApiError(
          200,
          'invalid_response',
          'Oturum yanıtı beklenen biçimde değil.',
        );
      }

      writeAuthHint(response.user);
      commit({
        status: 'signedIn',
        user: response.user,
        csrfToken: response.csrfToken,
      });
      // Requests issued while this one was in flight may have used an older
      // cookie; their 401s must not undo the session just established.
      attemptFloorRef.current = api.lastRequestId();
    },
    [commit],
  );

  const applySignedOut = useCallback(() => {
    sequenceRef.current += 1;
    clearAuthHint();
    commit({ status: 'signedOut', user: null, csrfToken: null });
    attemptFloorRef.current = api.lastRequestId();
  }, [commit]);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = beginAuthAttempt();
    const previous = stateRef.current;
    const hint = readAuthHint();

    const fallBack = () => {
      if (hint) {
        commit({
          status: 'offline',
          user: userFromHint(hint),
          // Keep the token when it belongs to the same user so a short
          // network hiccup does not disable queued writes after reconnect.
          csrfToken: previous.user?.id === hint.userId ? previous.csrfToken : null,
        });
        return;
      }

      commit({ status: 'signedOut', user: null, csrfToken: null });
    };

    if (browserIsOffline()) {
      fallBack();
      return;
    }

    try {
      const response = await api.get<SessionResponse>('/api/auth/session');
      if (requestId !== sequenceRef.current) {
        return;
      }
      // A logout completed while this refresh was in flight; the server's
      // old 200 must not sign the user back in.
      if (logoutBarrierRef.current) {
        return;
      }
      applySignedIn(response);
    } catch (error: unknown) {
      if (requestId !== sequenceRef.current) {
        return;
      }
      // A 401 is definitive: the session is gone, not merely unreachable.
      if (error instanceof ApiError && error.status === 401) {
        applySignedOut();
        return;
      }
      fallBack();
    }
  }, [applySignedIn, applySignedOut, beginAuthAttempt, commit]);

  const login = useCallback(
    async (input: LoginInput): Promise<void> => {
      const requestId = beginAuthAttempt();

      const response = await api.post<SessionResponse>('/api/auth/login', input);
      if (requestId !== sequenceRef.current) {
        return;
      }
      logoutBarrierRef.current = false;
      applySignedIn(response);
    },
    [applySignedIn, beginAuthAttempt],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<void> => {
      const requestId = beginAuthAttempt();

      const response = await api.post<SessionResponse>('/api/auth/register', input);
      if (requestId !== sequenceRef.current) {
        return;
      }
      logoutBarrierRef.current = false;
      applySignedIn(response);
    },
    [applySignedIn, beginAuthAttempt],
  );

  const logout = useCallback(async (): Promise<void> => {
    const requestId = beginAuthAttempt();
    const csrfToken = stateRef.current.csrfToken;

    try {
      await api.post<{ ok: boolean }>('/api/auth/logout', undefined, csrfToken ?? undefined);
    } catch (error: unknown) {
      // A 401 means the session was already gone; the unauthorized event has
      // signed out locally. Other failures keep the session because the
      // HttpOnly cookie was not revoked.
      if (error instanceof ApiError && error.status === 401) {
        return;
      }
      throw error;
    }

    // A newer transition (e.g. a concurrent login) wins over this delayed
    // logout response; otherwise logout is authoritative for refresh().
    if (requestId === sequenceRef.current) {
      logoutBarrierRef.current = true;
      applySignedOut();
    }
  }, [applySignedOut, beginAuthAttempt]);

  useEffect(() => {
    mountedRef.current = true;
    const handleUnauthorized = (event: Event) => {
      const detail = readUnauthorizedDetail(event);

      if (detail !== null) {
        // A 401 from a request issued before this auth attempt started is
        // stale, even if it arrives while a newer login is in flight.
        if (detail.requestId <= attemptFloorRef.current) {
          return;
        }
        // Bad credentials prove nothing about an existing session; the login
        // screen reports the failure and the current session/hint stays.
        if (detail.path === '/api/auth/login' || detail.path === '/api/auth/register') {
          return;
        }
      }

      applySignedOut();
    };

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    if (!skipInitialRefresh.current) {
      void refresh();
    }

    return () => {
      mountedRef.current = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    };
  }, [applySignedOut, refresh]);

  useEffect(() => {
    // An offline start trusts the hint until connectivity returns; the first
    // `online` event then validates the session instead of leaving the app
    // offline forever.
    const handleOnline = () => {
      if (stateRef.current.status === 'offline') {
        void refresh();
      }
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      csrfToken: state.csrfToken,
      login,
      register,
      logout,
      refresh,
    }),
    [state, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth yalnızca AuthProvider içinde kullanılabilir');
  }
  return context;
}
