import {
  Atom,
  BookOpen,
  Brain,
  Calculator,
  Dna,
  FlaskConical,
  Globe2,
  Landmark,
  Languages,
  Leaf,
  Moon,
  ScrollText,
  Shapes,
  Sigma,
  type LucideIcon,
} from 'lucide-react';

/**
 * Curriculum seeds store an icon key (for example `calculator`).
 * Unknown or missing keys fall back to the neutral book icon.
 */
export const SUBJECT_ICONS: Record<string, LucideIcon> = {
  calculator: Calculator,
  mathematics: Calculator,
  sigma: Sigma,
  shapes: Shapes,
  geometry: Shapes,
  'book-open': BookOpen,
  literature: BookOpen,
  languages: Languages,
  turkish: Languages,
  atom: Atom,
  physics: Atom,
  'flask-conical': FlaskConical,
  chemistry: FlaskConical,
  dna: Dna,
  biology: Dna,
  landmark: Landmark,
  history: Landmark,
  globe: Globe2,
  geography: Globe2,
  brain: Brain,
  philosophy: Brain,
  moon: Moon,
  religion: Moon,
  'scroll-text': ScrollText,
  leaf: Leaf,
};

export const DEFAULT_SUBJECT_ICON: LucideIcon = BookOpen;

export function getSubjectIcon(icon?: string): LucideIcon {
  if (!icon) {
    return DEFAULT_SUBJECT_ICON;
  }
  return SUBJECT_ICONS[icon] ?? DEFAULT_SUBJECT_ICON;
}
