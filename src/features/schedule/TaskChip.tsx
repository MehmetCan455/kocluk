import type { KeyboardEvent, MouseEvent } from 'react';
import { Link2, Pencil, Trash2 } from 'lucide-react';
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
  /** Marks a task that belongs to a page chain; purely an extra badge. */
  chain?: boolean;
  onStatusChange: (status: ScheduleTaskStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

const STATUS_CLASSES: Record<ScheduleTaskStatus, string> = {
  done: 'border-success/40 bg-success/10 text-success',
  missed: 'border-danger/40 bg-danger/10 text-danger',
  pending: 'border-line bg-raised text-fg',
};

/** Colour is never the only signal; every state has a readable label. */
const STATUS_TEXT: Record<ScheduleTaskStatus, string> = {
  done: 'Yapıldı',
  missed: 'Yapılmadı',
  pending: 'Planlandı',
};

/**
 * Desktop actions stay hidden until the cell is hovered or focused. Touch
 * screens have no hover, so there the chip tap opens the editor instead.
 */
const HOVER_ACTIONS =
  'pointer-events-none opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/cell:pointer-events-auto group-hover/cell:opacity-100 group-focus-within/cell:pointer-events-auto group-focus-within/cell:opacity-100';

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
 * One planned task with only the three text lines and a status colour. Normal
 * mode opens the editor when the chip is tapped; tick mode turns the whole chip
 * into a left-click done / right-click missed target.
 */
export function TaskChip({
  title,
  subtitle,
  detail,
  status,
  tickMode,
  chain = false,
  onStatusChange,
  onEdit,
  onDelete,
  disabled = false,
}: TaskChipProps) {
  const label = [title, detail].filter(Boolean).join(' ');
  // The chip's aria-label replaces the sr-only badge text, so chain membership
  // must be part of the accessible name itself.
  const accessibleLabel = chain
    ? `${label}: ${STATUS_TEXT[status]}, Sayfa zinciri`
    : `${label}: ${STATUS_TEXT[status]}`;
  const actionClass =
    'grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted transition-colors disabled:pointer-events-none disabled:opacity-50';

  function markDone(): void {
    if (disabled) {
      return;
    }
    onStatusChange(status === 'done' ? 'pending' : 'done');
  }

  function markMissed(): void {
    if (disabled) {
      return;
    }
    onStatusChange(status === 'missed' ? 'pending' : 'missed');
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    markMissed();
  }

  /** Enter/Space toggles done and neutral; Shift+Enter marks it missed. */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      markMissed();
    } else {
      markDone();
    }
  }

  return (
    <div
      data-status={status}
      aria-label={accessibleLabel}
      role={tickMode ? 'button' : undefined}
      tabIndex={tickMode ? (disabled ? -1 : 0) : undefined}
      aria-disabled={tickMode && disabled ? true : undefined}
      onClick={tickMode ? markDone : disabled ? undefined : onEdit}
      onKeyDown={tickMode ? handleKeyDown : undefined}
      onContextMenu={tickMode ? handleContextMenu : undefined}
      className={cn(
        'relative flex cursor-pointer flex-col gap-1 rounded-lg border px-1.5 py-1 text-xs min-[768px]:flex-row min-[768px]:items-start',
        STATUS_CLASSES[status],
        tickMode &&
          'select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
      )}
    >
      <span className="sr-only">{STATUS_TEXT[status]}</span>
      <div className="flex min-h-11 min-w-0 flex-1 items-start gap-1 py-1">
        {chain ? (
          <span
            data-chain="true"
            title="Sayfa zinciri"
            className="mt-0.5 shrink-0 text-muted"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Sayfa zinciri</span>
          </span>
        ) : null}
        <ChipLines
          title={title}
          subtitle={subtitle}
          detail={detail}
          done={status === 'done'}
        />
      </div>
      {tickMode ? null : (
        <div
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'flex shrink-0 justify-end gap-1 max-[767px]:absolute max-[767px]:bottom-0 max-[767px]:right-0 min-[768px]:absolute min-[768px]:bottom-0 min-[768px]:right-0 min-[768px]:z-10',
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
      )}
    </div>
  );
}
