const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * True only for a zero-padded 24-hour time. Date inputs in the UI already
 * produce this form; the guard keeps imported or programmatic values honest.
 */
export function isHHmm(value: string): boolean {
  return HHMM_PATTERN.test(value);
}

/** Chronological comparison for two valid HH:mm strings. */
export function compareHHmm(left: string, right: string): number {
  return left.localeCompare(right);
}
