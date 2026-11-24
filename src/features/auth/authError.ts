import { ApiError } from '@/lib/api';

/**
 * Turns an auth API failure into a Turkish, user-facing message. Server
 * messages are only surfaced for validation errors; credential, token and
 * transport failures get a stable message so the UI does not depend on the
 * server's wording. Passwords and tokens never reach the message.
 */
export function authErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) {
    return fallback;
  }

  switch (error.code) {
    case 'invalid_credentials':
      return 'E-posta veya şifre hatalı.';
    case 'email_taken':
      return 'Bu e-posta adresi zaten kayıtlı. Giriş yapmayı dene.';
    case 'invalid_token':
      return 'Bağlantı geçersiz veya süresi dolmuş. Yeni bir bağlantı iste.';
    case 'rate_limited':
      return 'Çok fazla deneme yaptın. Lütfen biraz sonra tekrar dene.';
    case 'network_error':
      return error.message;
    case 'validation_failed':
      return error.message;
    case 'csrf_failed':
      return 'İstek doğrulanamadı. Sayfayı yenileyip tekrar dene.';
    default:
      if (error.status === 429) {
        return 'Çok fazla deneme yaptın. Lütfen biraz sonra tekrar dene.';
      }
      if (error.status === 0) {
        return error.message;
      }
      if (error.status >= 500) {
        return 'Sunucuda bir sorun oluştu. Lütfen biraz sonra tekrar dene.';
      }
      return fallback;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client-side e-mail check; the server still validates authoritatively. */
export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}
