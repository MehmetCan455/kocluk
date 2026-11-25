import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { AuthLayout, authInputClass } from './AuthLayout';
import { authErrorMessage, isValidEmail } from './authError';

interface FieldErrors {
  displayName?: string;
  email?: string;
  password?: string;
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next: FieldErrors = {};
    if (displayName.trim() === '') {
      next.displayName = 'Adını gir.';
    }
    if (email.trim() === '') {
      next.email = 'E-posta adresini gir.';
    } else if (!isValidEmail(email)) {
      next.email = 'Geçerli bir e-posta adresi gir.';
    }
    if (password === '') {
      next.password = 'Bir şifre belirle.';
    } else if (password.length < 8) {
      next.password = 'Şifre en az 8 karakter olmalı.';
    }

    setFieldErrors(next);
    setError(null);
    if (next.displayName || next.email || next.password) {
      return;
    }
    if (!privacyAccepted) {
      setError('Devam etmek için aydınlatma metnini onaylaman gerekir.');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        inviteCode: inviteCode.trim() === '' ? undefined : inviteCode.trim(),
        privacyAccepted: true,
      });
      navigate('/', { replace: true });
    } catch (caught: unknown) {
      setError(authErrorMessage(caught, 'Hesap oluşturulamadı. Lütfen tekrar dene.'));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Hesap oluştur"
      description="Çalışmalarını cihazlar arasında eşitlemek için bir hesap aç."
      footer={
        <p>
          Zaten hesabın var mı?{' '}
          <Link to="/giris" className="font-semibold text-[var(--accent)] underline">
            Giriş yap
          </Link>
        </p>
      }
    >
      <form noValidate className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <Field label="Adın" htmlFor="kayit-ad" error={fieldErrors.displayName}>
          <input
            id="kayit-ad"
            type="text"
            autoComplete="name"
            maxLength={60}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            aria-invalid={fieldErrors.displayName ? true : undefined}
            aria-describedby={fieldErrors.displayName ? 'kayit-ad-error' : undefined}
            className={authInputClass}
          />
        </Field>

        <Field label="E-posta" htmlFor="kayit-eposta" error={fieldErrors.email}>
          <input
            id="kayit-eposta"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? 'kayit-eposta-error' : undefined}
            className={authInputClass}
          />
        </Field>

        <Field
          label="Şifre"
          htmlFor="kayit-sifre"
          hint="En az 8 karakter."
          error={fieldErrors.password}
        >
          <input
            id="kayit-sifre"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? 'kayit-sifre-error' : 'kayit-sifre-hint'}
            className={authInputClass}
          />
        </Field>

        <Field
          label="Davet kodu (opsiyonel)"
          htmlFor="kayit-davet"
          hint="Kapalı betada davet kodun varsa buraya gir."
        >
          <input
            id="kayit-davet"
            type="text"
            autoComplete="off"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            aria-describedby="kayit-davet-hint"
            className={authInputClass}
          />
        </Field>

        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <input
              id="kayit-gizlilik"
              type="checkbox"
              checked={privacyAccepted}
              onChange={(event) => setPrivacyAccepted(event.target.checked)}
              aria-describedby="kayit-gizlilik-hint"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <label htmlFor="kayit-gizlilik" className="text-sm text-muted">
              Aydınlatma metnini okudum ve kişisel verilerimin işlenmesine onay veriyorum.
            </label>
          </div>
          <p id="kayit-gizlilik-hint" className="text-xs text-muted">
            Kayıt olmak için bu onay gerekli. 18 yaşından küçüksem veli iznim
            olduğunu onaylıyorum.{' '}
            <Link
              to="/gizlilik"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--accent)] underline"
            >
              Aydınlatma metnini oku
            </Link>
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={!privacyAccepted || submitting}>
          {submitting ? 'Hesap oluşturuluyor…' : 'Kayıt ol'}
        </Button>
      </form>
    </AuthLayout>
  );
}
