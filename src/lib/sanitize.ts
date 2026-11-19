import DOMPurify from 'dompurify';

/**
 * Cleans untrusted HTML before it is stored or handed to the editor/screen.
 * DOMPurify removes scripts, event handlers and unsafe URLs while keeping the
 * formatting tags TipTap produces (headings, lists, links, marks, code).
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/** Plain text used by global search; derived from the sanitized HTML. */
export function htmlToPlainText(html: string): string {
  if (!html) {
    return '';
  }
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}
