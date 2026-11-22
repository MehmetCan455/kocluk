import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/cn';
import { getScheduleTable } from '@/db/repositories';
import { SCHEDULE_TABLE_TOTAL_LABEL } from '@/domain/scheduleTable';
import { SCHEDULE_DAYS } from './scheduleDays';

const headCellClass =
  'border-b border-r border-line bg-raised px-2 py-2 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted';
const bodyCellClass =
  'border-b border-r border-line px-2 py-2 align-top text-sm [overflow-wrap:anywhere]';
const lastHeadCellClass = cn(headCellClass, 'border-r-0');
const lastBodyCellClass = cn(bodyCellClass, 'border-r-0');

/**
 * The free-text table from before the weekly plan. It stays readable so old
 * backups are not lost, but nothing can edit or save it any more.
 */
export function LegacyScheduleTable() {
  const table = useLiveQuery(() => getScheduleTable(), []);

  if (!table) {
    return null;
  }

  return (
    <Card>
      <details className="rounded-xl border border-line bg-canvas/60 px-3 py-2">
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
          <span>Eski çizelge</span>
          <span className="text-xs font-normal text-muted">Salt okunur</span>
        </summary>

        <div className="mt-3 space-y-4">
          <p className="text-xs text-muted">
            Bu çizelge eski serbest metin tablosundan geliyor ve artık
            düzenlenemez. Yeni haftalık planı yukarıdan kullanabilirsin.
          </p>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table
              aria-label="Eski çizelge tablosu"
              className="w-full min-w-[880px] border-collapse text-sm"
            >
              <thead>
                <tr>
                  <th scope="col" className={headCellClass}>
                    Ders
                  </th>
                  {SCHEDULE_DAYS.map((day) => (
                    <th key={day.day} scope="col" className={headCellClass}>
                      {day.label}
                    </th>
                  ))}
                  <th scope="col" className={lastHeadCellClass}>
                    {SCHEDULE_TABLE_TOTAL_LABEL}
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={SCHEDULE_DAYS.length + 2}
                      className="px-2 py-3 text-center text-sm text-muted"
                    >
                      Eski çizelgede satır yok.
                    </td>
                  </tr>
                ) : (
                  table.rows.map((row) => (
                    <tr key={row.id}>
                      <th
                        scope="row"
                        className={cn(bodyCellClass, 'text-left font-medium')}
                      >
                        {row.subject || '—'}
                      </th>
                      {row.days.map((value, dayIndex) => (
                        <td
                          key={`${row.id}-${dayIndex}`}
                          data-done={row.done[dayIndex] ? 'true' : undefined}
                          className={cn(
                            bodyCellClass,
                            'whitespace-pre-wrap',
                            row.done[dayIndex] && 'bg-success/10 text-muted',
                          )}
                        >
                          {row.done[dayIndex] ? (
                            <span className="sr-only">Tamamlandı: </span>
                          ) : null}
                          {value}
                        </td>
                      ))}
                      <td
                        className={cn(
                          lastBodyCellClass,
                          'whitespace-pre-wrap',
                        )}
                      >
                        {row.total}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th
                    scope="row"
                    className={cn(headCellClass, 'border-b-0')}
                  >
                    {table.totals.label || SCHEDULE_TABLE_TOTAL_LABEL}
                  </th>
                  {table.totals.days.map((value, dayIndex) => (
                    <td
                      key={`toplam-${dayIndex}`}
                      className={cn(
                        bodyCellClass,
                        'whitespace-pre-wrap border-b-0 font-medium',
                      )}
                    >
                      {value}
                    </td>
                  ))}
                  <td
                    className={cn(
                      lastBodyCellClass,
                      'whitespace-pre-wrap border-b-0 font-medium',
                    )}
                  >
                    {table.totals.total}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {table.note ? (
            <div className="space-y-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Eski çizelgenin notu
              </h3>
              <p className="whitespace-pre-wrap text-sm">{table.note}</p>
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}
