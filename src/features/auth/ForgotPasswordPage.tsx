import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { AuthLayout, authInputClass } from './AuthLayout';
import { authErrorMessage, isValidEmail } from './authError';

export function ForgotPasswordPage() {
  const { csrfToken } = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (email.trim() === '') {
      setFieldError('E-posta adresini gir.');
      return;
    }
    if (!isValidEmail(email)) {
      setFieldError('Geçerli bir e-posta adresi gir.');
      return;
    }

    setFieldError(null);
    setError(null);
    setSubmitting(true);

    try {
      await api.post<{ ok: boolean }>(
        '/api/auth/forgot-password',
        { email: email.trim() },
        csrfToken ?? undefined,
      );
      setSent(true);
    } catch (caught: unknown) {
      setError(
        authErrorMessage(caught, 'Sıfırlama bağlantısı gönderilemedi. Lütfen tekrar dene.'),
      );
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Şifremi unuttum"
        description="Hesabına bağlı e-posta adresine sıfırlama bağlantısı gönderdik."
      >
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">E-posta gönderildi</h2>
          <p className="text-sm text-muted">
            Gelen kutunu ve gereksiz klasörünü kontrol et. Bağlantıyı 30 dakika içinde
            kullanabilirsin. E-posta gelmediyse adresi doğru yazdığından emin olup
            tekrar deneyebilirsin.
          </p>
          <Link
            to="/giris"
            className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] underline"
          >
            Girişe dön
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Şifremi unuttum"
      description="E-posta adresini gir; sıfırlama bağlantısını gönderelim."
      footer={
        <p>
          Şifreni hatırladın mı?{' '}
          <Link to="/giris" className="font-semibold text-[var(--accent)] underline">
            Giriş yap
          </Link>
        </p>
      }
    >
      <form noValidate className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <Field label="E-posta" htmlFor="sifremi-unuttum-eposta" error={fieldError ?? undefined}>
          <input
            id="sifremi-unuttum-eposta"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'sifremi-unuttum-eposta-error' : undefined}
            className={authInputClass}
          />
        </Field>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Gönderiliyor…' : 'Sıfırlama bağlantısı gönder'}
        </Button>
      </form>
    </AuthLayout>
  );
}
