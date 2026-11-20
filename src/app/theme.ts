export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Expands #abc / abc into an uppercase #AABBCC string, or returns null. */
export function normalizeHex(hex: string): string | null {
  const raw = hex.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) {
    return null;
  }
  const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  return `#${full.toUpperCase()}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return null;
  }
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

/** WCAG relative luminance in the 0..1 range. Invalid colors are treated as black. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return 0;
  }
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Relative luminance above which accent surfaces switch to dark text.
 * White stays readable on the blue/indigo/purple presets (≈0.21–0.24),
 * while amber, orange, turquoise and green (≈0.32–0.44) need `#0A0A0C`.
 */
export const ACCENT_DARK_TEXT_THRESHOLD = 0.3;

/**
 * The canvas stays black, but carries a very light trace of the accent. Every
 * base must stay in sync with the corresponding `@theme` value in
 * `src/styles/index.css`; CSS variables cannot be imported, so the coupling is
 * kept explicit here and asserted by theme tests.
 */
export const TINTED_SURFACES = {
  canvas: { base: '#07080A', weight: 0.05 },
  surface: { base: '#0F1218', weight: 0.06 },
  raised: { base: '#161A22', weight: 0.07 },
  line: { base: '#232A36', weight: 0.08 },
} as const;

export type TintedSurface = keyof typeof TINTED_SURFACES;

/** Mixes `accent` into a base colour by `weight` (0..1) and returns `#RRGGBB`. */
export function mixHex(base: string, accent: string, weight: number): string {
  const baseRgb = hexToRgb(base);
  const accentRgb = hexToRgb(accent);
  if (!baseRgb || !accentRgb) {
    return base.toUpperCase();
  }

  const clamped = Math.min(1, Math.max(0, weight));
  const channel = (from: number, to: number) =>
    Math.round(from + (to - from) * clamped)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${channel(baseRgb.r, accentRgb.r)}${channel(baseRgb.g, accentRgb.g)}${channel(baseRgb.b, accentRgb.b)}`;
}

/** The near-black base colour tinted with the given accent. */
export function tintedSurface(accent: string, surface: TintedSurface): string {
  const definition = TINTED_SURFACES[surface];
  return mixHex(definition.base, accent, definition.weight);
}

/**
 * Keeps the browser/PWA chrome in step with the tinted canvas. The meta tag is
 * optional (tests and embedded contexts may not have one).
 */
function applyThemeColor(color: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', color);
}

/**
 * Applies the accent palette to the document root. The whole app reads
 * `--accent*` variables, so a single call retints every accent surface. The
 * near-black canvas and raised surfaces also receive a subtle accent tint.
 */
export function applyAccent(hex: string): void {
  const normalized = normalizeHex(hex);
  const rgb = hexToRgb(hex);
  if (!normalized || !rgb) {
    return;
  }

  const root = document.documentElement;
  const contrast =
    relativeLuminance(normalized) > ACCENT_DARK_TEXT_THRESHOLD ? '#0A0A0C' : '#FFFFFF';
  root.style.setProperty('--accent', normalized);
  root.style.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`);
  root.style.setProperty('--accent-strong', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
  root.style.setProperty('--accent-contrast', contrast);
  for (const surface of Object.keys(TINTED_SURFACES) as TintedSurface[]) {
    root.style.setProperty(`--color-${surface}`, tintedSurface(normalized, surface));
  }
  applyThemeColor(tintedSurface(normalized, 'canvas'));
}
