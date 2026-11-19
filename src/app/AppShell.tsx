import { useEffect, useState, type ReactNode } from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { cn } from '@/components/ui/cn';

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
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

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

      {isDesktop ? <Sidebar /> : <TopBar />}

      <div className={isDesktop ? 'pl-64' : undefined}>
        <main
          id="icerik"
          tabIndex={-1}
          className={cn(
            'mx-auto w-full max-w-5xl px-4 sm:px-6',
            isDesktop ? 'py-8' : 'py-5 pb-28',
          )}
        >
          {children}
        </main>
      </div>

      {isDesktop ? null : <BottomNav />}
    </div>
  );
}
