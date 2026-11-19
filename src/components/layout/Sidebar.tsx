import { NavLink } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useAppSettings } from '@/app/SettingsProvider';
import { cn } from '@/components/ui/cn';
import { NAV_ITEMS, SECONDARY_NAV_ITEMS, type NavigationItem } from './navItems';

function sidebarLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150',
    isActive
      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
      : 'text-muted hover:bg-raised hover:text-fg',
  );
}

function SidebarLink({ item }: { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <li>
      <NavLink to={item.to} end={item.end} className={sidebarLinkClass}>
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{item.label}</span>
      </NavLink>
    </li>
  );
}

export function Sidebar() {
  const { settings } = useAppSettings();
  const profileName = settings.profileName.trim();
  const initial = profileName ? profileName.charAt(0).toLocaleUpperCase('tr-TR') : 'K';

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-line bg-surface">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-5">
        <GraduationCap className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
        <span className="text-lg font-semibold tracking-tight">Koçluk</span>
      </div>

      <nav aria-label="Ana menü" className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </ul>

        <div className="my-4 border-t border-line" />

        <ul className="space-y-1">
          {SECONDARY_NAV_ITEMS.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-line p-4">
        <div className="flex items-center gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent)]"
            aria-hidden="true"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{profileName || 'Profil'}</p>
            <p className="truncate text-xs text-muted">{settings.examName || 'YKS Takip'}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
