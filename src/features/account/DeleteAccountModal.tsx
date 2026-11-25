import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { getActiveDbOrNull } from '@/db/db';
import {
  closeActiveDb,
  deleteUserDatabaseCopy,
  userDbName,
} from '@/db/dbManager';
import { ApiError, api } from '@/lib/api';
import { setAccountNotice } from '@/lib/accountNotice';
import { authErrorMessage } from '@/features/auth/authError';

/**
 * Hard account deletion (design §7.1, §11).
 *
 * The password is checked by the server; the CSRF token authenticates the
 * session. The local database is closed first and only deleted when the user
 * ticks the explicit second confirmation. Only the account database
 * `kocluk-u-<userId>` may ever be deleted: the legacy `kocluk` database is
 * never touched here.
 */

export interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
}

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

export function DeleteAccountModal({ open, onClose }: DeleteAccountModalProps) {
  const { user, csrfToken, signOutLocally } = useAuth();
  const [password, setPassword] = useState('');
  const [deleteLocalCopy, setDeleteLocalCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassword('');
      setDeleteLocalCopy(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || busy) {
      return;
    }
    if (password === '') {
      setError('Devam etmek için şifreni gir.');
      return;
    }

    setBusy(true);
    setError(null);

    const accountDatabaseName = getActiveDbOrNull()?.name ?? null;
    const expectedDatabaseName = userDbName(user.id);

    try {
      await api.post<{ ok: boolean }>(
        '/api/auth/delete-account',
        { password },
        csrfToken ?? undefined,
      );
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 401) {
        // The session expired before the server deleted anything: leave the
        // local database (and its device-only photos) untouched.
        setBusy(false);
        signOutLocally();
        onClose();
        return;
      }
      setError(authErrorMessage(caught, 'Hesap silinemedi. Lütfen tekrar dene.'));
      setBusy(false);
      return;
    }

    // Close the open connection before deleting the database. A failure here
    // must not block the local sign-out; the copy is simply kept.
    await closeActiveDb().catch(() => undefined);

    let localCopyFailed = false;
    if (deleteLocalCopy && accountDatabaseName === expectedDatabaseName) {
      try {
        await deleteUserDatabaseCopy(expectedDatabaseName);
      } catch {
        // Blocked/rejected deletes keep the data (the safe direction) and are
        // reported on the login screen after sign-out.
        localCopyFailed = true;
      }
    } else if (deleteLocalCopy) {
      // Never delete a database that is not this account's copy.
      localCopyFailed = true;
    }

    if (localCopyFailed) {
      setAccountNotice(
        'Yerel kopya silinemedi. Bu cihazdaki hesap verileri korunuyor.',
      );
    }

    setBusy(false);
    // The server account is gone; sign out even when the local copy failed.
    signOutLocally();
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Hesabımı sil"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="hesap-sil-form"
            variant="danger"
            disabled={busy || password === ''}
          >
            {busy ? 'Siliniyor…' : 'Hesabımı kalıcı olarak sil'}
          </Button>
        </>
      }
    >
      <div
        role="note"
        className="flex gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          Bu işlem geri alınamaz. Sunucudaki hesabın, çalışma verilerin ve
          oturumların silinir. Yedek kopyalar en fazla 14 gün içinde döner.
        </p>
      </div>

      <form id="hesap-sil-form" noValidate className="space-y-4" onSubmit={handleSubmit}>
        <Field
          label="Şifren"
          htmlFor="hesap-sil-sifre"
          hint="Hesap silme isteği şifrenle doğrulanır."
        >
          <input
            id="hesap-sil-sifre"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="hesap-sil-sifre-hint"
            className={inputClass}
          />
        </Field>

        <div className="flex items-start gap-2">
          <input
            id="hesap-sil-yerel"
            type="checkbox"
            checked={deleteLocalCopy}
            onChange={(event) => setDeleteLocalCopy(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <label htmlFor="hesap-sil-yerel" className="text-sm text-muted">
            Bu cihazdaki yerel kopyayı da sil
          </label>
        </div>
        <p className="text-xs text-muted">
          İşaretlemezsen bu cihazdaki hesap verileri kalır; eski{' '}
          <span className="font-medium text-fg">kocluk</span> verileri hiçbir
          durumda silinmez.
        </p>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
