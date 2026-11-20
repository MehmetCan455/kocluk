import {
  BookOpen,
  CalendarDays,
  Camera,
  ClipboardList,
  GraduationCap,
  Home,
  Library,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV_ITEMS: readonly NavigationItem[] = [
  { to: '/', label: 'Ana Sayfa', icon: Home, end: true },
  { to: '/tyt', label: 'TYT', icon: BookOpen },
  { to: '/ayt', label: 'AYT', icon: GraduationCap },
  { to: '/denemeler', label: 'Denemeler', icon: ClipboardList },
  { to: '/yanlislar', label: 'Yanlışlar', icon: Camera },
];

export const SECONDARY_NAV_ITEMS: readonly NavigationItem[] = [
  { to: '/program', label: 'Ders Çalışma Çizelgesi', icon: CalendarDays },
  { to: '/kitaplar', label: 'Kitaplar', icon: Library },
  { to: '/ayarlar', label: 'Ayarlar', icon: Settings },
];
