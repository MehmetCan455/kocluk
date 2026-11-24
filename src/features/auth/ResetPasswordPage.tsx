import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { AuthLayout, authInputClass } from './AuthLayout';
import { authErrorMessage } from './authError';

interface FieldErrors {
  password?: string;
  confirm?: string;
}

export function ResetPasswordPage() {
  const { status, csrfToken, refresh } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token')?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next: FieldErrors = {};
    if (password === '') {
      next.password = 'Yeni şifreni gir.';
    } else if (password.length < 8) {
      next.password = 'Şifre en az 8 karakter olmalı.';
    }
    if (confirm === '') {
      next.confirm = 'Yeni şifreni tekrar gir.';
    } else if (password !== confirm) {
      next.confirm = 'Şifreler eşleşmiyor.';
    }

    setFieldErrors(next);
    setError(null);
    if (next.password || next.confirm) {
      return;
    }

    setSubmitting(true);
    try {
      await api.post<{ ok: boolean }>(
        '/api/auth/reset-password',
        { token, password },
        csrfToken ?? undefined,
      );

      // The server revokes every session, including this browser's. Refresh
      // the provider so a signed-in tab does not keep showing an old session.
      if (status === 'signedIn' || status === 'offline') {
        try {
          await refresh();
        } catch {
          // A failed refresh is harmless: the next request signs out.
        }
      }

      navigate('/giris', { replace: true, state: { passwordReset: true } });
    } catch (caught: unknown) {
      setError(
        authErrorMessage(caught, 'Şifre sıfırlanamadı. Lütfen yeni bir bağlantı iste.'),
      );
      setSubmitting(false);
    }
  }

  if (token === '') {
    return (
      <AuthLayout
        title="Yeni şifre"
        description="Sıfırlama bağlantısındaki bilgiler eksik."
      >
        <div className="space-y-4">
          <p role="alert" className="text-sm text-danger">
            Sıfırlama bağlantısı geçersiz veya eksik.
          </p>
          <Link
            to="/sifremi-unuttum"
            className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] underline"
          >
            Yeni sıfırlama bağlantısı iste
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Yeni şifre"
      description="Hesabın için yeni bir şifre belirle."
      footer={
        <p>
          Vazgeçtin mi?{' '}
          <Link to="/giris" className="font-semibold text-[var(--accent)] underline">
            Giriş yap
          </Link>
        </p>
      }
    >
      <form noValidate className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <Field
          label="Yeni şifre"
          htmlFor="sifre-sifirla-yeni"
          hint="En az 8 karakter."
          error={fieldErrors.password}
        >
          <input
            id="sifre-sifirla-yeni"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={
              fieldErrors.password ? 'sifre-sifirla-yeni-error' : 'sifre-sifirla-yeni-hint'
            }
            className={authInputClass}
          />
        </Field>

        <Field
          label="Yeni şifre (tekrar)"
          htmlFor="sifre-sifirla-tekrar"
          error={fieldErrors.confirm}
        >
          <input
            id="sifre-sifirla-tekrar"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            aria-invalid={fieldErrors.confirm ? true : undefined}
            aria-describedby={fieldErrors.confirm ? 'sifre-sifirla-tekrar-error' : undefined}
            className={authInputClass}
          />
        </Field>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Kaydediliyor…' : 'Şifreyi kaydet'}
        </Button>
      </form>
    </AuthLayout>
  );
}
