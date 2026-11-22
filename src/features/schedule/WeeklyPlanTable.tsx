import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/components/ui/cn';
import { dayLabel } from '@/domain/schedule';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { SCHEDULE_DAYS } from './scheduleDays';

export interface WeeklyPlanRow {
  /** Stable local key; survives the first save when the database id arrives. */
  key: string;
  id?: string;
  label: string;
}

export interface WeeklyPlanTableProps {
  weekStart: string;
  rows: WeeklyPlanRow[];
  onAddRow: () => void;
  onRenameRow: (key: string, label: string) => void;
  onDeleteRow: (key: string) => void;
  disabled?: boolean;
}

const ROW_LABEL_MAX_LENGTH = 80;

const headCellClass =
  'border-b border-r border-line bg-raised px-2 py-2 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted';

const bodyCellClass = 'border-b border-r border-line p-0.5 align-top';

const rowCellClass =
  'border-b border-r border-line p-0.5 align-middle last:border-r-0';

export function WeeklyPlanTable({
  weekStart,
  rows,
  onAddRow,
  onRenameRow,
  onDeleteRow,
  disabled = false,
}: WeeklyPlanTableProps) {
  // Zero-based index into SCHEDULE_DAYS: narrow screens show a single day.
  const [selectedDay, setSelectedDay] = useState(0);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold">Haftalık plan</h2>
          <p className="text-xs text-muted">
            Satırlara ders veya serbest bir etiket yaz.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={onAddRow}
          disabled={disabled}
          aria-label="Satır ekle"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Satır ekle
        </Button>
      </div>

      <div
        role="group"
        aria-label="Çizelge günü"
        className="grid grid-cols-7 gap-1 min-[768px]:hidden"
      >
        {SCHEDULE_DAYS.map((day, dayIndex) => (
          <button
            key={day.day}
            type="button"
            aria-label={`${day.short} ${day.label}`}
            aria-pressed={dayIndex === selectedDay}
            onClick={() => setSelectedDay(dayIndex)}
            className={cn(
              'min-h-11 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
              dayIndex === selectedDay
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-line bg-surface text-muted hover:text-fg',
            )}
          >
            {day.short}
          </button>
        ))}
      </div>

      <p className="text-sm font-medium min-[768px]:hidden">
        {dayLabel(weekStart, SCHEDULE_DAYS[selectedDay].day)}
      </p>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table
          aria-label="Haftalık ders çalışma tablosu"
          className="w-full table-fixed border-collapse text-sm min-[768px]:min-w-[960px]"
        >
          <thead>
            <tr>
              <th
                scope="col"
                className={cn(headCellClass, 'w-[45%] min-[768px]:w-[24%]')}
              >
                DERS / ETKİNLİK
              </th>
              {SCHEDULE_DAYS.map((day, dayIndex) => (
                <th
                  key={day.day}
                  scope="col"
                  aria-label={day.label}
                  title={dayLabel(weekStart, day.day)}
                  className={cn(
                    headCellClass,
                    'w-[33%] min-[768px]:w-[10.85%]',
                    dayIndex !== selectedDay && 'hidden min-[768px]:table-cell',
                  )}
                >
                  {day.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-3">
                  <EmptyState
                    title="Bu hafta için henüz satır yok"
                    description="Ders veya serbest etiket eklemek için Satır ekle düğmesini kullan."
                  />
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={row.key}>
                  <td
                    className={cn(
                      rowCellClass,
                      'sticky left-0 z-10 bg-surface',
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <AutoGrowTextarea
                        value={row.label}
                        onChange={(value) => onRenameRow(row.key, value)}
                        label={`${rowIndex + 1}. satır`}
                        placeholder="Ders / etkinlik"
                        maxLength={ROW_LABEL_MAX_LENGTH}
                        variant="subject"
                        className="flex-1"
                      />
                      <button
                        type="button"
                        aria-label={`${rowIndex + 1}. satırı sil`}
                        onClick={() => onDeleteRow(row.key)}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  {SCHEDULE_DAYS.map((day, dayIndex) => (
                    <td
                      key={`${row.key}-${day.day}`}
                      className={cn(
                        bodyCellClass,
                        dayIndex !== selectedDay && 'hidden min-[768px]:table-cell',
                      )}
                    >
                      {/* Task chips are added in the next task. */}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
