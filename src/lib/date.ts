const DAY_MS = 24 * 60 * 60 * 1000;

/** Strict `YYYY-MM-DD` validation that rejects impossible calendar days. */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/** Today in the device's local calendar as `YYYY-MM-DD` (for date inputs). */
export function todayLocalDate(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Converts a local calendar day to a stable ISO timestamp. Noon UTC is used so
 * the stored `createdAt.slice(0, 10)` matches the chosen day in every common
 * timezone and date filters keep working on the raw string.
 */
export function localDateToIso(value: string): string | undefined {
  if (!isValidDateString(value)) {
    return undefined;
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toISOString();
}

/** Local calendar day of an ISO timestamp, used to prefill a date input. */
export function isoToLocalDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function daysUntil(date: string, today: Date = new Date()): number {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return Math.round((target.getTime() - start.getTime()) / DAY_MS);
}
