import type { ReactNode } from 'react';
import { cn } from './cn';

export interface RingProgressProps {
  value: number;
  label?: string;
  size?: number;
  strokeWidth?: number;
  children?: ReactNode;
  className?: string;
}

export function RingProgress({
  value,
  label,
  size = 72,
  strokeWidth = 6,
  children,
  className,
}: RingProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-raised)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">
        {children ?? `%${Math.round(clamped)}`}
      </span>
    </div>
  );
}
