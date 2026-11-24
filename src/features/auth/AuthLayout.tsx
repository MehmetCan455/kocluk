import type { ReactNode } from 'react';
import { GraduationCap } from 'lucide-react';
import { Card } from '@/components/ui/Card';

/** Shared input styling for the auth forms. */
export const authInputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

export interface AuthLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Centered, mobile-first frame shared by login, registration, password reset
 * and e-mail verification. It never touches auth state; the screens own their
 * forms and the provider owns the session.
 */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10 text-fg">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent-soft)]">
            <GraduationCap className="h-7 w-7 text-[var(--accent)]" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Zirve Akademi</span>
        </div>

        <Card className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="text-sm text-muted">{description}</p> : null}
          </div>
          {children}
        </Card>

        {footer ? <div className="text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}
