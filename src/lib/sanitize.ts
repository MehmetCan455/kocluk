import DOMPurify from 'dompurify';

/**
 * Cleans untrusted HTML before it is stored or handed to the editor/screen.
 * DOMPurify removes scripts, event handlers and unsafe URLs while keeping the
 * formatting tags TipTap produces (headings, lists, links, marks, code).
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/**
 * Plain text used by global search; derived from the sanitized HTML.
 * Block-level elements become newlines so adjacent paragraphs and list items
 * keep their word boundary (`<p>a</p><p>b</p>` -> `a\nb`), then horizontal
 * whitespace and repeated newlines are collapsed.
 */
export function htmlToPlainText(html: string): string {
  if (!html) {
    return '';
  }

  const blockTags = new Set([
    'P',
    'DIV',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'LI',
    'BLOCKQUOTE',
    'PRE',
    'UL',
    'OL',
    'TR',
    'TD',
    'TH',
  ]);
  const skippedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

  function nodeToText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const element = node as Element;
    if (skippedTags.has(element.tagName)) {
      return '';
    }
    if (element.tagName === 'BR') {
      return '\n';
    }

    const content = Array.from(element.childNodes, nodeToText).join('');
    return blockTags.has(element.tagName) ? `${content}\n` : content;
  }

  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const rawText = Array.from(body.childNodes, nodeToText).join('');

  return rawText
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
