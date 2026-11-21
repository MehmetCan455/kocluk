import { useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from '@/components/ui/cn';

export interface AutoGrowTextareaProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  maxLength: number;
  placeholder?: string;
  className?: string;
}

const baseClass =
  'block min-h-11 w-full min-w-0 resize-none overflow-hidden rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm leading-5 text-fg placeholder:text-muted transition-colors hover:border-line focus:border-[var(--accent)] focus:bg-canvas [overflow-wrap:anywhere]';

/**
 * Fits the field to its content. A hidden cell reports a zero scrollHeight,
 * so it is left untouched until it becomes visible again.
 */
function resize(el: HTMLTextAreaElement): void {
  if (el.scrollHeight === 0) return; // hidden cell
  el.style.height = 'auto';
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + border}px`;
}

export function AutoGrowTextarea({
  value,
  onChange,
  label,
  maxLength,
  placeholder,
  className,
}: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (ref.current) {
      resize(ref.current);
    }
  }, [value]);

  // A width change (window resize, day switch, responsive column) reflows the
  // text, so the height has to be measured again. Height-only changes come
  // from resize() itself and must not feed back into another calculation.
  useEffect(() => {
    const field = ref.current;
    if (!field) {
      return;
    }
    let lastWidth: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const width = entry.contentRect.width;
      if (width === lastWidth) {
        return;
      }
      lastWidth = width;
      resize(field);
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, []);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      aria-label={label}
      maxLength={maxLength}
      placeholder={placeholder}
      className={cn(baseClass, className)}
    />
  );
}
