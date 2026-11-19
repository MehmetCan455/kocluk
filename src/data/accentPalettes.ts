export interface AccentPalette {
  name: string;
  hex: string;
}

export const ACCENT_PALETTES: readonly AccentPalette[] = [
  { name: 'Mavi', hex: '#3B82F6' },
  { name: 'İndigo', hex: '#6366F1' },
  { name: 'Mor', hex: '#A855F7' },
  { name: 'Turkuaz', hex: '#14B8A6' },
  { name: 'Yeşil', hex: '#22C55E' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Turuncu', hex: '#F97316' },
  { name: 'Pembe', hex: '#EC4899' },
  { name: 'Kırmızı', hex: '#EF4444' },
];

export const DEFAULT_ACCENT = '#3B82F6';
