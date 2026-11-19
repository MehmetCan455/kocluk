import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav aria-label="Sayfa yolu">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            ) : null}
            {item.to ? (
              <Link
                to={item.to}
                className="inline-flex min-h-11 min-w-0 items-center truncate text-muted transition-colors hover:text-fg"
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="inline-flex min-h-11 min-w-0 items-center truncate font-medium text-fg">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
