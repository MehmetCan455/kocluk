import { NavLink } from 'react-router-dom';
import { cn } from '@/components/ui/cn';
import { NAV_ITEMS, type NavigationItem } from './navItems';

function bottomLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors duration-150',
    isActive ? 'text-[var(--accent)]' : 'text-muted hover:text-fg',
  );
}

function BottomNavLink({ item }: { item: NavigationItem }) {
  const Icon = item.icon;
  return (
    <li>
      <NavLink to={item.to} end={item.end} className={bottomLinkClass}>
        <Icon className="h-5 w-5" aria-hidden="true" />
        <span>{item.label}</span>
      </NavLink>
    </li>
  );
}

export function BottomNav() {
  return (
    <nav
      aria-label="Alt menü"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="grid grid-cols-5">
        {NAV_ITEMS.map((item) => (
          <BottomNavLink key={item.to} item={item} />
        ))}
      </ul>
    </nav>
  );
}
