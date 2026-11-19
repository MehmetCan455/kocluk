import { useEffect, useState } from 'react';

/**
 * Delays propagating a value until it has been stable for `delayMs`.
 * A new value restarts the timer, so rapid typing produces one settled value
 * instead of one expensive query per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [value, delayMs]);

  return debounced;
}
