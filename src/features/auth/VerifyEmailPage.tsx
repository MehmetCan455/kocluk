import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { api } from '@/lib/api';
import { AuthLayout } from './AuthLayout';
import { authErrorMessage } from './authError';

type VerifyState = 'verifying' | 'done' | 'error';

export function VerifyEmailPage() {
  const { status, csrfToken, refresh } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [state, setState] = useState<VerifyState>(token === '' ? 'error' : 'verifying');
  const [error, setError] = useState<string | null>(
    token === '' ? 'Doğrulama bağlantısı geçersiz veya eksik.' : null,
  );
  // The token is single use. React StrictMode runs effects twice in
  // development; a second request would consume nothing and wrongly report
  // the link as invalid, so each token is requested at most once. The request
  // itself is not cancelled when the effect re-runs, otherwise StrictMode's
  // setup/cleanup/setup cycle would swallow the only successful response.
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
        setState('error');
      }
    }

    void verify();
  }, [token, csrfToken, status, refresh]);

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
          <p className="text-sm text-muted">
            Bağlantı daha önce kullanılmış veya süresi dolmuş olabilir. Hesabına giriş
            yapıp yeni bir doğrulama e-postası isteyebilirsin.
          </p>
        </div>
      ) : null}
    </AuthLayout>
  );
}
