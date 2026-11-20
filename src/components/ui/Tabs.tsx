import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  const baseId = useId().replace(/:/g, '');

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowLeft' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    if (tabs.length === 0) {
      return;
    }
    event.preventDefault();

    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const activeId = (document.activeElement as HTMLElement | null)?.id;
    const currentIndex = Math.max(
      0,
      buttons.findIndex((button) => button.id === activeId),
    );
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    onChange(tabs[nextIndex].id);
    buttons[nextIndex]?.focus();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Sekmeler"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1"
      >
        {tabs.map((tab) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                'min-h-11 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
                selected
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-muted hover:text-fg',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) =>
        tab.id === value ? (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${baseId}-panel-${tab.id}`}
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            className="pt-4"
          >
            {tab.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
