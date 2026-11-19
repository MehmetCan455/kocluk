import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--accent)] text-[var(--accent-contrast)] hover:brightness-110',
  secondary: 'border border-line bg-raised text-fg hover:bg-surface',
  ghost: 'text-muted hover:bg-raised hover:text-fg',
  danger: 'bg-danger text-white hover:brightness-110',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-12 px-4 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[filter,background-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
