import { applyAccent, relativeLuminance } from './theme';

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

test('parlak renklerde koyu metin kontrastı seçer', () => {
  applyAccent('#FDE68A');
  expect(relativeLuminance('#FDE68A')).toBeGreaterThan(0.55);
  expect(document.documentElement.style.getPropertyValue('--accent-contrast')).toBe('#0A0A0C');
});

test('geçersiz rengi yok sayar', () => {
  applyAccent('#22C55E');
  applyAccent('mavi');
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#22C55E');
});
