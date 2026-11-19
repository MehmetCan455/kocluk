import { ACCENT_DARK_TEXT_THRESHOLD, applyAccent, relativeLuminance } from './theme';

afterEach(() => {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-soft');
  document.documentElement.style.removeProperty('--accent-strong');
  document.documentElement.style.removeProperty('--accent-contrast');
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
    { name: 'Amber', hex: '#F59E0B', expected: '#0A0A0C' },
    { name: 'Turuncu', hex: '#F97316', expected: '#0A0A0C' },
    { name: 'Turkuaz', hex: '#14B8A6', expected: '#0A0A0C' },
    { name: 'Yeşil', hex: '#22C55E', expected: '#0A0A0C' },
    { name: 'Mor', hex: '#A855F7', expected: '#FFFFFF' },
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
