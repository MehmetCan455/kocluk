import { Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import type { ScheduleTask } from '@/domain/types';

export interface TaskChipProps {
  task: ScheduleTask;
  label: string;
  onToggle: (done: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

/** One planned task with its tick, edit and delete actions. */
export function TaskChip({
  task,
  label,
  onToggle,
  onEdit,
  onDelete,
  disabled = false,
}: TaskChipProps) {
  const done = Boolean(task.completedAt);

  return (
    <div
      className={cn(
        'flex items-start gap-1 rounded-lg border px-1.5 py-1 text-xs',
        done
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-line bg-raised text-fg',
      )}
    >
      <input
        type="checkbox"
        checked={done}
        onChange={(event) => onToggle(event.target.checked)}
        disabled={disabled}
        aria-label={`${label} görevini tamamla`}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
      />
      <span
        className={cn('min-w-0 flex-1 break-words', done && 'line-through')}
      >
        {label}
      </span>
      <button
        type="button"
        aria-label={`${label} görevini düzenle`}
        onClick={onEdit}
        disabled={disabled}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-fg disabled:pointer-events-none disabled:opacity-50"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`${label} görevini sil`}
        onClick={onDelete}
        disabled={disabled}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-danger disabled:pointer-events-none disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
