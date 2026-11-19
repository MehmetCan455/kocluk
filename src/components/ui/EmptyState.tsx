import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon: Icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-surface/60 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? <Icon className="h-8 w-8 text-muted" aria-hidden="true" /> : null}
      <p className="text-base font-semibold">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
