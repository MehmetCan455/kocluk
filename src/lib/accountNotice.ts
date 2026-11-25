/**
 * A one-shot notice stored in localStorage so it survives the sign-out that
 * follows account deletion. The login screen shows it until the user
 * acknowledges it; it never contains tokens, passwords or row contents.
 */

export const ACCOUNT_NOTICE_KEY = 'kocluk.accountNotice';

export function setAccountNotice(message: string): void {
  try {
    localStorage.setItem(ACCOUNT_NOTICE_KEY, message);
  } catch {
    // Private mode/no storage: the local copy is still kept, only the notice
    // is lost.
  }
}

export function readAccountNotice(): string | null {
  try {
    const value = localStorage.getItem(ACCOUNT_NOTICE_KEY);
    return value && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}

export function clearAccountNotice(): void {
  try {
    localStorage.removeItem(ACCOUNT_NOTICE_KEY);
  } catch {
    // Nothing to clear.
  }
}
