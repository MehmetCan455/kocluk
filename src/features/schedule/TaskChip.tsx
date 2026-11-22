import type { MouseEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import type { ScheduleTaskStatus } from '@/domain/schedule';

export interface TaskChipProps {
  /** First chip line: book, topic or free title. */
  title: string;
  /** Second line: Konu, subject + Tekrar or the row label. */
  subtitle: string;
  /** Third line: page range for book tasks. */
  detail: string;
  status: ScheduleTaskStatus;
  tickMode: boolean;
  onStatusChange: (status: ScheduleTaskStatus) => void;
  onToggle: (done: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

const STATUS_CLASSES: Record<ScheduleTaskStatus, string> = {
  done: 'border-success/40 bg-success/10 text-success',
  missed: 'border-danger/40 bg-danger/10 text-danger',
  pending: 'border-line bg-raised text-fg',
};

/**
 * Desktop actions stay hidden until the cell is hovered or focused. Touch
 * screens have no hover, so there the row is always visible under the text.
 */
const HOVER_ACTIONS =
  'pointer-events-none opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/cell:pointer-events-auto group-hover/cell:opacity-100 group-focus-within/cell:pointer-events-auto group-focus-within/cell:opacity-100 max-[767px]:pointer-events-auto max-[767px]:opacity-100';

interface ChipLinesProps {
  title: string;
  subtitle: string;
  detail: string;
  done: boolean;
}

/** The three truncated lines. Long text never breaks letter by letter. */
function ChipLines({ title, subtitle, detail, done }: ChipLinesProps) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
      <span
        data-line="title"
        title={title}
        className={cn(
          'block truncate whitespace-nowrap font-medium',
          done && 'line-through',
        )}
      >
        {title}
      </span>
      <span
        data-line="subtitle"
        title={subtitle}
        className="block truncate whitespace-nowrap text-[11px] opacity-80"
      >
        {subtitle}
      </span>
      <span
        data-line="detail"
        title={detail}
        className="block truncate whitespace-nowrap text-[11px] opacity-80"
      >
        {detail}
      </span>
    </span>
  );
}

/**
 * One planned task. Normal mode keeps the checkbox plus hover-revealed
 * edit/delete actions; tick mode turns the whole chip into a left-click
 * done and right-click missed target.
 */
export function TaskChip({
  title,
  subtitle,
  detail,
  status,
  tickMode,
  onStatusChange,
  onToggle,
  onEdit,
  onDelete,
  disabled = false,
}: TaskChipProps) {
  const label = [title, detail].filter(Boolean).join(' ');
  const actionClass =
    'grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted transition-colors disabled:pointer-events-none disabled:opacity-50';

  function handleTickClick(): void {
    if (disabled) {
      return;
    }
    onStatusChange(status === 'done' ? 'pending' : 'done');
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (disabled) {
      return;
    }
    onStatusChange(status === 'missed' ? 'pending' : 'missed');
  }

  return (
    <div
      data-status={status}
      onClick={tickMode ? handleTickClick : undefined}
      onContextMenu={tickMode ? handleContextMenu : undefined}
      className={cn(
        'relative flex flex-col gap-1 rounded-lg border px-1.5 py-1 text-xs min-[768px]:flex-row min-[768px]:items-start',
        STATUS_CLASSES[status],
        tickMode && 'cursor-pointer select-none',
      )}
    >
      {tickMode ? (
        <div className="flex min-h-11 min-w-0 flex-1 items-start py-1">
          <ChipLines
            title={title}
            subtitle={subtitle}
            detail={detail}
            done={status === 'done'}
          />
        </div>
      ) : (
        <>
          {/* Checkbox and lines share one >=44px hit area. */}
          <label className="flex min-h-11 min-w-11 flex-1 cursor-pointer items-start gap-1.5 py-1">
            <input
              type="checkbox"
              checked={status === 'done'}
              onChange={(event) => onToggle(event.target.checked)}
              disabled={disabled}
              aria-label={`${label} görevini tamamla`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <ChipLines
              title={title}
              subtitle={subtitle}
              detail={detail}
              done={status === 'done'}
            />
          </label>
          <div
            className={cn(
              'flex shrink-0 justify-end gap-1 min-[768px]:absolute min-[768px]:bottom-0 min-[768px]:right-0 min-[768px]:z-10',
              HOVER_ACTIONS,
            )}
          >
            <button
              type="button"
              aria-label={`${label} görevini düzenle`}
              onClick={onEdit}
              disabled={disabled}
              className={cn(actionClass, 'hover:bg-surface hover:text-fg')}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`${label} görevini sil`}
              onClick={onDelete}
              disabled={disabled}
              className={cn(actionClass, 'hover:bg-surface hover:text-danger')}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
