import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let openModalCount = 0;
let previousBodyOverflow = '';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Optional element to focus on open instead of the dialog panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Fullscreen is used by the image lightbox: edge-to-edge dark panel,
   * overlay header and no scrolling. Default keeps the sheet/dialog look.
   */
  variant?: 'default' | 'fullscreen';
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  className,
  initialFocusRef,
  variant = 'default',
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const fullscreen = variant === 'fullscreen';

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement;
    const target = initialFocusRef?.current ?? panelRef.current;
    target?.focus();
    return () => {
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [open, initialFocusRef]);

  // Lock page scrolling while any modal is open. The counter keeps stacked
  // modals from restoring the scrollbar too early.
  useEffect(() => {
    if (!open) {
      return;
    }
    openModalCount += 1;
    if (openModalCount === 1) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
      }
    };
  }, [open]);

  function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        fullscreen
          ? 'items-stretch justify-center bg-black p-0'
          : 'items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6',
      )}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className={cn(
          fullscreen
            ? 'h-dvh max-h-dvh w-full max-w-none overflow-hidden rounded-none border-0 bg-black p-0 shadow-2xl outline-none'
            : 'max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 shadow-2xl outline-none sm:rounded-2xl',
          className,
        )}
      >
        <div
          className={cn(
            fullscreen
              ? 'absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 bg-gradient-to-b from-black/80 to-transparent p-3'
              : 'mb-4 flex items-start justify-between gap-4',
          )}
        >
          <h2
            id={titleId}
            className={cn('text-lg font-semibold', fullscreen && 'truncate text-white')}
          >
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Kapat"
            onClick={onClose}
            className={cn('h-11 w-11 shrink-0 px-0', fullscreen && '!text-white hover:!bg-white/15')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
        <div className={fullscreen ? 'h-full' : 'space-y-4'}>{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
