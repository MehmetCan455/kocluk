import { expect, test } from 'vitest';
import { sanitizeHtml } from './sanitize';

test('script etiketini ve olay işleyicilerini temizler', () => {
  const clean = sanitizeHtml(
    '<p>a</p><script>alert(1)</script><img src="x" onerror="alert(2)">',
  );

  expect(clean).toContain('<p>a</p>');
  expect(clean).not.toContain('<script');
  expect(clean).not.toContain('alert(1)');
  expect(clean).not.toContain('onerror');
});

test('javascript: bağlantısını kaldırır', () => {
  const clean = sanitizeHtml('<a href="javascript:alert(1)">tıkla</a>');

  expect(clean).not.toContain('javascript:');
  expect(clean).toContain('tıkla');
});

test('editörün ürettiği biçimlendirmeyi korur', () => {
  const clean = sanitizeHtml(
    '<h2>Başlık</h2>' +
      '<p><strong>kalın</strong> <em>italik</em> <u>altı çizili</u> <mark>vurgu</mark> ' +
      '<code>kod</code> <a href="https://ornek.com">bağlantı</a></p>' +
      '<blockquote><p>alıntı</p></blockquote>' +
      '<ul><li>madde</li></ul><ol><li>sıralı</li></ol>',
  );

  for (const fragment of [
    '<h2>Başlık</h2>',
    '<strong>kalın</strong>',
    '<em>italik</em>',
    '<u>altı çizili</u>',
    '<mark>vurgu</mark>',
    '<code>kod</code>',
    '<a href="https://ornek.com">bağlantı</a>',
    '<blockquote>',
    '<ul><li>madde</li></ul>',
    '<ol><li>sıralı</li></ol>',
  ]) {
    expect(clean).toContain(fragment);
  }
});
