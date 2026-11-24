import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { AuthLayout, authInputClass } from './AuthLayout';
import { authErrorMessage, isValidEmail } from './authError';

interface FieldErrors {
  email?: string;
  password?: string;
}

function passwordResetMessage(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) {
    return false;
  }
  return (state as { passwordReset?: unknown }).passwordReset === true;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const resetDone = passwordResetMessage(location.state);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next: FieldErrors = {};
    if (email.trim() === '') {
      next.email = 'E-posta adresini gir.';
    } else if (!isValidEmail(email)) {
      next.email = 'Geçerli bir e-posta adresi gir.';
    }
    if (password === '') {
      next.password = 'Şifreni gir.';
    }

    setFieldErrors(next);
    setError(null);
    if (next.email || next.password) {
      return;
    }

    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      navigate('/', { replace: true });
    } catch (caught: unknown) {
      setError(authErrorMessage(caught, 'Giriş yapılamadı. Lütfen tekrar dene.'));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Giriş yap"
      description="Hesabına giriş yaparak çalışmalarına kaldığın yerden devam et."
      footer={
        <p>
          Hesabın yok mu?{' '}
          <Link to="/kayit" className="font-semibold text-[var(--accent)] underline">
            Kayıt ol
          </Link>
        </p>
      }
    >
      <form noValidate className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        {resetDone ? (
          <p
            role="status"
            className="rounded-xl border border-line bg-raised/60 px-3 py-2 text-sm text-fg"
          >
            Şifren başarıyla sıfırlandı. Yeni şifrenle giriş yap.
          </p>
        ) : null}

        <Field label="E-posta" htmlFor="giris-eposta" error={fieldErrors.email}>
          <input
            id="giris-eposta"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? 'giris-eposta-error' : undefined}
            className={authInputClass}
          />
        </Field>

        <Field label="Şifre" htmlFor="giris-sifre" error={fieldErrors.password}>
          <input
            id="giris-sifre"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? 'giris-sifre-error' : undefined}
            className={authInputClass}
          />
        </Field>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </Button>

        <p className="text-center">
          <Link
            to="/sifremi-unuttum"
            className="text-sm font-medium text-muted underline hover:text-fg"
          >
            Şifremi unuttum
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
