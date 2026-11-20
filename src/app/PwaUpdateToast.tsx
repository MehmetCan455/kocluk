import { X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Shows the prompt-registered service worker update. The new version is only
 * activated after the user chooses "Yenile", so an in-progress form or note is
 * never discarded by a background reload.
 */
export function PwaUpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Service worker kaydedilemedi', error);
    },
  });

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--accent)]/50 bg-surface px-4 py-3 text-sm shadow-xl lg:bottom-6"
    >
      <p className="min-w-0">
        <span className="font-semibold">Yeni sürüm hazır.</span>{' '}
        <span className="text-muted">Yenilemek için hazır olduğunda devam et.</span>
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-contrast)]"
        >
          Yenile
        </button>
        <button
          type="button"
          aria-label="Güncelleme bildirimini kapat"
          onClick={() => setNeedRefresh(false)}
          className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
