import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { AppShell } from '@/app/AppShell';
import { SettingsProvider } from '@/app/SettingsProvider';
import { SyncProvider } from '@/app/SyncProvider';
import { AUTH_ONLY_PATHS, AuthRoutes, AppRoutes, PRIVACY_PATH, PUBLIC_AUTH_PATHS } from '@/app/routes';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { closeActiveDb, openUserDb } from '@/db/dbManager';
import { LegacyTransferPrompt } from '@/features/account/LegacyTransferPrompt';

function isOneOf(pathname: string, paths: readonly string[]): boolean {
  return paths.includes(pathname);
}

function AuthLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex min-h-dvh items-center justify-center gap-3 bg-canvas px-4 text-sm text-muted"
    >
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-[var(--accent)]"
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}

type DbStatus = 'idle' | 'opening' | 'ready' | 'error';

interface DbState {
  userId: string | null;
  status: DbStatus;
}

export interface AuthGateProps {
  /** Overridable for tests; production opens `kocluk-u-<userId>`. */
  openDb?: (userId: string) => Promise<unknown>;
  /** Overridable for tests; production closes the active account database. */
  closeDb?: () => Promise<void>;
}

/**
 * The route gate (design §9.1, §9.4). It is the only place that decides
 * between the auth screens and the application, and it opens the signed-in
 * user's database before `SettingsProvider` or `AppShell` can read from it.
 *
 * Leaving the signed-in state (logout, expired session, unmount) closes the
 * account database; a failed logout keeps the session, so the database stays
 * open as well.
 */
export function AuthGate({ openDb = openUserDb, closeDb = closeActiveDb }: AuthGateProps) {
  const { status, user } = useAuth();
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  const [dbState, setDbState] = useState<DbState>({ userId: null, status: 'idle' });
  const [retryKey, setRetryKey] = useState(0);

  const userId = user?.id ?? null;
  const isPublicAuthPath = isOneOf(pathname, PUBLIC_AUTH_PATHS);
  const isAuthOnlyPath = isOneOf(pathname, AUTH_ONLY_PATHS);
  const isPrivacyPath = pathname === PRIVACY_PATH;
  const requiresDb =
    (status === 'signedIn' || status === 'offline') && userId !== null && !isPublicAuthPath;

  useEffect(() => {
    if (!requiresDb || userId === null) {
      return;
    }

    let cancelled = false;
    setDbState((current) =>
      current.userId === userId &&
      (current.status === 'opening' || current.status === 'ready')
        ? current
        : { userId, status: 'opening' },
    );

    openDb(userId).then(
      () => {
        if (!cancelled) {
          setDbState({ userId, status: 'ready' });
        }
      },
      () => {
        if (!cancelled) {
          setDbState({ userId, status: 'error' });
        }
      },
    );

    return () => {
      cancelled = true;
      // The database is about to be closed; do not let a later sign-in for
      // the same account render the app before the new open finishes.
      setDbState((current) =>
        current.userId === userId ? { userId, status: 'idle' } : current,
      );
      void closeDb().catch(() => undefined);
    };
  }, [requiresDb, userId, openDb, closeDb, retryKey]);

  if (status === 'loading') {
    return <AuthLoading label="Oturum kontrol ediliyor…" />;
  }

  // Verification and reset links arrive from e-mail and must work whether the
  // browser happens to have a session or not.
  if (isPublicAuthPath) {
    return <AuthRoutes />;
  }

  if (status === 'signedOut') {
    return isAuthOnlyPath || isPrivacyPath ? <AuthRoutes /> : <Navigate to="/giris" replace />;
  }

  // A signed-in user never sees the login/register screens.
  if (isAuthOnlyPath) {
    return <Navigate to="/" replace />;
  }

  if (userId === null) {
    return <Navigate to="/giris" replace />;
  }

  if (dbState.status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <Card className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-lg font-semibold">Hesabın açılamadı</h1>
          <p role="alert" className="text-sm text-danger">
            Verilerine erişilemedi. Bağlantını kontrol edip tekrar dene.
          </p>
          <Button onClick={() => setRetryKey((value) => value + 1)}>Tekrar dene</Button>
        </Card>
      </div>
    );
  }

  if (dbState.status !== 'ready' || dbState.userId !== userId) {
    return <AuthLoading label="Hesabın açılıyor…" />;
  }

  return (
    <LegacyTransferPrompt key={userId} userId={userId}>
      <SyncProvider key={userId}>
        <SettingsProvider>
          <AppShell>
            <AppRoutes />
          </AppShell>
        </SettingsProvider>
      </SyncProvider>
    </LegacyTransferPrompt>
  );
}
