import { Link, NavLink } from 'react-router-dom';
import { GraduationCap, Library, Settings } from 'lucide-react';
import { cn } from '@/components/ui/cn';

function iconLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'grid h-11 w-11 place-items-center rounded-xl transition-colors duration-150',
    isActive
      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
      : 'text-muted hover:bg-raised hover:text-fg',
  );
}

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur">
      <Link to="/" className="flex items-center gap-2 rounded-xl">
        <GraduationCap className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
        <span className="text-lg font-semibold tracking-tight">Koçluk</span>
      </Link>

      <div className="flex items-center gap-1">
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
