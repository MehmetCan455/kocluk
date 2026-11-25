import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { ApiError, api } from '@/lib/api';
import { AuthLayout } from './AuthLayout';
import { authErrorMessage } from './authError';

type VerifyState = 'verifying' | 'done' | 'error';

/**
 * A network failure, a timeout or a 5xx may succeed on a retry with the same
 * token. `invalid_token` and other 4xx answers are definitive and hidden behind
 * a "request a new link" hint instead of a retry loop.
 */
function isTransientVerifyError(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return true;
  }
  return (
    error.status === 0 ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

export function VerifyEmailPage() {
  const { status, csrfToken, refresh } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [state, setState] = useState<VerifyState>(token === '' ? 'error' : 'verifying');
  const [retryable, setRetryable] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [error, setError] = useState<string | null>(
    token === '' ? 'Doğrulama bağlantısı geçersiz veya eksik.' : null,
  );
  // The token is single use. React StrictMode runs effects twice in
  // development; a second request would consume nothing and wrongly report
  // the link as invalid, so each token is requested at most once (a manual
  // retry clears this marker). The request itself is not cancelled when the
  // effect re-runs, otherwise StrictMode's setup/cleanup/setup cycle would
  // swallow the only successful response.
  const requestedToken = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (token === '' || requestedToken.current === token) {
      return;
    }
    requestedToken.current = token;

    async function verify() {
      try {
        await api.post<{ ok: boolean }>(
          '/api/auth/verify-email',
          { token },
          csrfToken ?? undefined,
        );
        if (!mountedRef.current) {
          return;
        }
        setState('done');
        setRetryable(false);
        // The token is spent and must not stay in the address bar or history.
        setSearchParams(
          (current) => {
            if (!current.has('token')) {
              return current;
            }
            const next = new URLSearchParams(current);
            next.delete('token');
            return next;
          },
          { replace: true },
        );
        if (status === 'signedIn' || status === 'offline') {
          try {
            await refresh();
          } catch {
            // The verification already succeeded; the next request refreshes.
          }
        }
      } catch (caught: unknown) {
        if (!mountedRef.current) {
          return;
        }
        setError(
          authErrorMessage(caught, 'E-posta adresi doğrulanamadı. Lütfen tekrar dene.'),
        );
        setRetryable(isTransientVerifyError(caught));
        setState('error');
      }
    }

    void verify();
  }, [token, csrfToken, status, refresh, retryKey, setSearchParams]);

  function retry() {
    setError(null);
    setRetryable(false);
    setState('verifying');
    // Allow the same token to be sent once more.
    requestedToken.current = null;
    setRetryKey((value) => value + 1);
  }

  return (
    <AuthLayout
      title="E-posta doğrulama"
      description="E-posta adresini doğrulayarak hesabını tamamla."
      footer={
        <p>
          <Link to="/giris" className="font-semibold text-[var(--accent)] underline">
            Girişe dön
          </Link>
        </p>
      }
    >
      {state === 'verifying' ? (
        <p role="status" className="text-sm text-muted">
          E-posta adresin doğrulanıyor…
        </p>
      ) : null}

      {state === 'done' ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">E-posta adresin doğrulandı</h2>
          <p className="text-sm text-muted">
            Artık hesabını güvenle kullanabilirsin. Doğrulama bağlantısı tek kullanımlıktır.
          </p>
          <Link
            to={status === 'signedIn' || status === 'offline' ? '/' : '/giris'}
            className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] underline"
          >
            {status === 'signedIn' || status === 'offline' ? 'Ana sayfaya dön' : 'Giriş yap'}
          </Link>
        </div>
      ) : null}

      {state === 'error' ? (
        <div className="space-y-4">
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
          {retryable ? (
            <Button onClick={retry}>Tekrar dene</Button>
          ) : (
            <p className="text-sm text-muted">
              Bağlantı daha önce kullanılmış veya süresi dolmuş olabilir. Hesabına
              giriş yapıp yeni bir doğrulama e-postası isteyebilirsin.
            </p>
          )}
        </div>
      ) : null}
    </AuthLayout>
  );
}
