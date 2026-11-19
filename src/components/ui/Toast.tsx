import { X } from 'lucide-react';
import { cn } from './cn';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  onClose?: () => void;
  className?: string;
}

const toneClasses: Record<ToastTone, string> = {
  info: 'border-line bg-raised text-fg',
  success: 'border-success/40 bg-success/10 text-success',
  error: 'border-danger/40 bg-danger/10 text-danger',
};

export function Toast({ message, tone = 'info', onClose, className }: ToastProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg',
        toneClasses[tone],
        className,
      )}
    >
      <span>{message}</span>
      {onClose ? (
        <button
          type="button"
          aria-label="Bildirimi kapat"
          onClick={onClose}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-current hover:bg-black/10"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
