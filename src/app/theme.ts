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
 * Applies the accent palette to the document root. The whole app reads
 * `--accent*` variables, so a single call retints every accent surface.
 */
export function applyAccent(hex: string): void {
  const normalized = normalizeHex(hex);
  const rgb = hexToRgb(hex);
  if (!normalized || !rgb) {
    return;
  }

  const root = document.documentElement;
  const contrast = relativeLuminance(normalized) > 0.55 ? '#0A0A0C' : '#FFFFFF';
  root.style.setProperty('--accent', normalized);
  root.style.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`);
  root.style.setProperty('--accent-strong', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
  root.style.setProperty('--accent-contrast', contrast);
}
