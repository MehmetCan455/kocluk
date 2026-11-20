import {
  ACCENT_DARK_TEXT_THRESHOLD,
  applyAccent,
  mixHex,
  relativeLuminance,
  TINTED_SURFACES,
  tintedSurface,
} from './theme';

afterEach(() => {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-soft');
  document.documentElement.style.removeProperty('--accent-strong');
  document.documentElement.style.removeProperty('--accent-contrast');
  for (const surface of Object.keys(TINTED_SURFACES)) {
    document.documentElement.style.removeProperty(`--color-${surface}`);
  }
});

test('vurgu rengini CSS değişkenlerine uygular', () => {
  applyAccent('#22C55E');
  const root = document.documentElement;
  expect(root.style.getPropertyValue('--accent')).toBe('#22C55E');
  expect(root.style.getPropertyValue('--accent-contrast')).toBeTruthy();
});

test('yumuşak ve güçlü tonları yarı saydam üretir', () => {
  applyAccent('#3B82F6');
  const root = document.documentElement;
  expect(root.style.getPropertyValue('--accent-soft')).toBe('rgba(59, 130, 246, 0.16)');
  expect(root.style.getPropertyValue('--accent-strong')).toBe('rgba(59, 130, 246, 0.28)');
  expect(root.style.getPropertyValue('--accent-contrast')).toBe('#FFFFFF');
});

test('hazır paletlerde okunabilir metin kontrastı seçer', () => {
  const cases = [
    { name: 'Mavi', hex: '#3B82F6', expected: '#FFFFFF' },
    { name: 'İndigo', hex: '#6366F1', expected: '#FFFFFF' },
    { name: 'Mor', hex: '#A855F7', expected: '#FFFFFF' },
    { name: 'Turkuaz', hex: '#14B8A6', expected: '#0A0A0C' },
    { name: 'Yeşil', hex: '#22C55E', expected: '#0A0A0C' },
    { name: 'Amber', hex: '#F59E0B', expected: '#0A0A0C' },
    { name: 'Turuncu', hex: '#F97316', expected: '#0A0A0C' },
    { name: 'Pembe', hex: '#EC4899', expected: '#FFFFFF' },
    { name: 'Kırmızı', hex: '#EF4444', expected: '#FFFFFF' },
  ] as const;

  for (const { name, hex, expected } of cases) {
    applyAccent(hex);
    expect(
      document.documentElement.style.getPropertyValue('--accent-contrast'),
      `${name} (${hex})`,
    ).toBe(expected);
  }
});

test('kontrast eşiği 0.30 ve üzerinde koyu metin seçer', () => {
  expect(ACCENT_DARK_TEXT_THRESHOLD).toBe(0.3);
  applyAccent('#FDE68A');
  expect(relativeLuminance('#FDE68A')).toBeGreaterThan(ACCENT_DARK_TEXT_THRESHOLD);
  expect(document.documentElement.style.getPropertyValue('--accent-contrast')).toBe('#0A0A0C');
});

test('geçersiz rengi yok sayar', () => {
  applyAccent('#22C55E');
  applyAccent('mavi');
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#22C55E');
});

test('zemin ve yüzeyleri vurgu rengiyle hafifçe tonlar', () => {
  applyAccent('#3B82F6');
  const root = document.documentElement;

  expect(root.style.getPropertyValue('--color-canvas')).toBe(
    tintedSurface('#3B82F6', 'canvas'),
  );
  expect(root.style.getPropertyValue('--color-surface')).toBe(
    tintedSurface('#3B82F6', 'surface'),
  );
  expect(root.style.getPropertyValue('--color-raised')).toBe(
    tintedSurface('#3B82F6', 'raised'),
  );
  expect(root.style.getPropertyValue('--color-line')).toBe(
    tintedSurface('#3B82F6', 'line'),
  );

  // The canvas must stay almost black: the accent is only a trace.
  expect(relativeLuminance(root.style.getPropertyValue('--color-canvas'))).toBeLessThan(0.01);
  expect(root.style.getPropertyValue('--color-canvas')).not.toBe(TINTED_SURFACES.canvas.base);
  expect(root.style.getPropertyValue('--accent')).toBe('#3B82F6');
});

test('farklı vurgular farklı ton üretir', () => {
  applyAccent('#3B82F6');
  const blueCanvas = document.documentElement.style.getPropertyValue('--color-canvas');

  applyAccent('#EF4444');
  const redCanvas = document.documentElement.style.getPropertyValue('--color-canvas');

  expect(blueCanvas).not.toBe(redCanvas);
  expect(redCanvas).toBe(tintedSurface('#EF4444', 'canvas'));
  expect(mixHex('#07080A', '#EF4444', 0.05)).toBe(redCanvas);
});

test('meta theme-color varsa tonlanmış zeminle güncellenir', () => {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#07080A';
  document.head.append(meta);

  applyAccent('#22C55E');
  expect(meta.content).toBe(tintedSurface('#22C55E', 'canvas'));

  meta.remove();
});
