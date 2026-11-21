import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Download, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { BottomNav } from '@/components/layout/BottomNav';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { cn } from '@/components/ui/cn';
import { SearchModal } from '@/features/search/SearchModal';
import { PwaUpdateToast } from './PwaUpdateToast';
import { useInstallPrompt } from './useInstallPrompt';

const DESKTOP_QUERY = '(min-width: 1024px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { pathname } = useLocation();
  const isWidePage = pathname.replace(/\/+$/, '') === '/program';
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [searchOpen, setSearchOpen] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);
  const { canInstall, promptInstall } = useInstallPrompt();
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <a
        href="#icerik"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('icerik')?.focus();
        }}
        className="sr-only z-50 rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-[var(--accent-contrast)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        İçeriğe geç
      </a>

      {isDesktop ? <Sidebar onSearch={openSearch} /> : <TopBar onSearch={openSearch} />}

      <div className={isDesktop ? 'pl-64' : undefined}>
        <main
          id="icerik"
          tabIndex={-1}
          className={cn(
            'mx-auto w-full px-4 sm:px-6',
            isWidePage ? 'max-w-none' : 'max-w-5xl',
            isDesktop ? 'py-8' : 'py-5 pb-28',
          )}
        >
          {children}
        </main>
      </div>

      {isDesktop ? null : <BottomNav />}

      {/* Only shown when Chromium says the app is actually installable. */}
      {canInstall && !installDismissed ? (
        <aside
          aria-label="Uygulama kurulumu"
          className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-xl lg:bottom-4"
        >
          <p className="flex min-w-0 items-center gap-2 text-sm">
            <Download className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
            Koçluk’u ana ekranına ekle.
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void promptInstall()}
              className="inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-contrast)]"
            >
              Yükle
            </button>
            <button
              type="button"
              aria-label="Kurulum istemini kapat"
              onClick={() => setInstallDismissed(true)}
              className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </aside>
      ) : null}

      <PwaUpdateToast />
      <SearchModal open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
