import { Link, NavLink } from 'react-router-dom';
import { CalendarDays, GraduationCap, Library, Search, Settings } from 'lucide-react';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { cn } from '@/components/ui/cn';

function iconLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'grid h-11 w-11 place-items-center rounded-xl transition-colors duration-150',
    isActive
      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
      : 'text-muted hover:bg-raised hover:text-fg',
  );
}

export interface TopBarProps {
  onSearch?: () => void;
}

export function TopBar({ onSearch }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur">
      <Link to="/" className="flex min-h-11 items-center gap-2 rounded-xl pr-2">
        <GraduationCap className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
        <span className="text-lg font-semibold tracking-tight">Zirve Akademi</span>
      </Link>

      <div className="flex items-center gap-1">
        <SyncStatus variant="bar" />
        <button
          type="button"
          aria-label="Ara"
          title="Ara (Ctrl/⌘+K)"
          onClick={onSearch}
          className="grid h-11 w-11 place-items-center rounded-xl text-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
        <NavLink
          to="/program"
          aria-label="Ders Çalışma Çizelgesi"
          className={iconLinkClass}
        >
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </NavLink>
        <NavLink to="/kitaplar" aria-label="Kitaplar" className={iconLinkClass}>
          <Library className="h-5 w-5" aria-hidden="true" />
        </NavLink>
        <NavLink to="/ayarlar" aria-label="Ayarlar" className={iconLinkClass}>
          <Settings className="h-5 w-5" aria-hidden="true" />
        </NavLink>
      </div>
    </header>
  );
}
