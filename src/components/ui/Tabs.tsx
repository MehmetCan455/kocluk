import { useId, type ReactNode } from 'react';
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

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Sekmeler"
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
