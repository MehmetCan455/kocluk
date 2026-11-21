import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/cn';
import { saveScheduleTable } from '@/db/repositories';
import {
  SCHEDULE_TABLE_CELL_MAX_LENGTH,
  SCHEDULE_TABLE_MAX_ROWS,
  SCHEDULE_TABLE_NOTE_MAX_LENGTH,
  SCHEDULE_TABLE_SUBJECT_MAX_LENGTH,
  SCHEDULE_TABLE_TOTAL_LABEL,
  SCHEDULE_TABLE_TOTAL_MAX_LENGTH,
  createEmptyScheduleRow,
  createEmptyScheduleTable,
} from '@/domain/scheduleTable';
import type {
  ScheduleTable,
  ScheduleTableDayCells,
  ScheduleTableDoneCells,
  ScheduleTableRow,
  ScheduleTableTotals,
} from '@/domain/types';
import { SCHEDULE_DAYS } from './scheduleDays';
import { AutoGrowTextarea } from './AutoGrowTextarea';

interface Draft {
  rows: ScheduleTableRow[];
  totals: ScheduleTableTotals;
  note: string;
}

function cloneDays(days: ScheduleTableDayCells): ScheduleTableDayCells {
  return [...days] as ScheduleTableDayCells;
}

function cloneDone(done: ScheduleTableDoneCells): ScheduleTableDoneCells {
  return [...done] as ScheduleTableDoneCells;
}

function draftFrom(table?: ScheduleTable): Draft {
  const source = table ?? createEmptyScheduleTable();
  return {
    rows: source.rows.map((row) => ({
      ...row,
      days: cloneDays(row.days),
      done: cloneDone(row.done),
    })),
    totals: { ...source.totals, days: cloneDays(source.totals.days) },
    note: source.note,
  };
}

function replaceDay(
  days: ScheduleTableDayCells,
  index: number,
  value: string,
): ScheduleTableDayCells {
  const next = cloneDays(days);
  next[index] = value;
  return next;
}

export interface ScheduleTableEditorProps {
  /** The saved `main` row, if one exists; otherwise the five empty defaults. */
  initialTable?: ScheduleTable;
}

const headCellClass =
  'border-b border-r border-line bg-raised px-2 py-2 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted';

const bodyCellClass = 'border-b border-r border-line p-0.5 align-top';

/** Short enough to feel automatic, long enough not to save every keystroke. */
const AUTOSAVE_DELAY_MS = 800;

export function ScheduleTableEditor({ initialTable }: ScheduleTableEditorProps) {
  const noteId = useId();
  // Build the starting draft once: two draftFrom calls would generate
  // different row ids and mark an untouched table as dirty immediately.
  const [initialDraft] = useState<Draft>(() => draftFrom(initialTable));
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(initialDraft),
  );
  const [hasSaved, setHasSaved] = useState(Boolean(initialTable));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Zero-based index into SCHEDULE_DAYS: narrow screens show a single day.
  const [selectedDay, setSelectedDay] = useState(0);

  const serialized = JSON.stringify(draft);
  const dirty = serialized !== savedSnapshot;

  const draftRef = useRef(draft);
  const dirtyRef = useRef(dirty);
  const savingRef = useRef(false);
  const pendingDraftRef = useRef<Draft | null>(null);
  const failedSnapshotRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const persistDraft = useCallback(async (captured: Draft): Promise<boolean> => {
    if (savingRef.current) {
      pendingDraftRef.current = captured;
      return false;
    }

    const capturedKey = JSON.stringify(captured);
    savingRef.current = true;
    if (mountedRef.current) {
      setSaving(true);
      setError(null);
    }

    try {
      const stored = await saveScheduleTable({
        rows: captured.rows,
        totals: captured.totals,
        note: captured.note,
      });
      const next = draftFrom(stored);
      failedSnapshotRef.current = null;
      if (mountedRef.current) {
        setDraft((current) =>
          JSON.stringify(current) === capturedKey ? next : current,
        );
        setSavedSnapshot(JSON.stringify(next));
        setHasSaved(true);
      }
      return true;
    } catch (caught: unknown) {
      console.error('Çizelge kaydedilemedi', caught);
      failedSnapshotRef.current = capturedKey;
      if (mountedRef.current) {
        setError(
          caught instanceof Error && caught.message
            ? caught.message
            : 'Çizelge kaydedilemedi. Lütfen tekrar dene.',
        );
      }
      return false;
    } finally {
      savingRef.current = false;
      if (mountedRef.current) {
        setSaving(false);
      }
      const pending = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (pending) {
        void persistDraft(pending);
      }
    }
  }, []);

  useEffect(() => {
    if (dirty) {
      const warn = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
      };
      window.addEventListener('beforeunload', warn);
      return () => window.removeEventListener('beforeunload', warn);
    }
  }, [dirty]);

  // Debounced autosave. A failed snapshot is not retried until the user edits
  // again, so a quota error does not create a retry loop.
  useEffect(() => {
    if (
      !dirty ||
      saving ||
      serialized === failedSnapshotRef.current
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void persistDraft(draftRef.current);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, saving, serialized, persistDraft]);

  // Best effort flush for route changes, tab close and backgrounding.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) {
        void persistDraft(draftRef.current);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flush();
    };
  }, [persistDraft]);

  function updateSubject(rowId: string, subject: string): void {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === rowId ? { ...row, subject } : row,
      ),
    }));
  }

  function updateRowDay(rowId: string, dayIndex: number, value: string): void {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === rowId
          ? { ...row, days: replaceDay(row.days, dayIndex, value) }
          : row,
      ),
    }));
  }

  function updateRowDone(rowId: string, dayIndex: number, done: boolean): void {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        const next = cloneDone(row.done);
        next[dayIndex] = done;
        return { ...row, done: next };
      }),
    }));
  }

  function updateRowTotal(rowId: string, total: string): void {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === rowId ? { ...row, total } : row,
      ),
    }));
  }

  function updateTotalDay(dayIndex: number, value: string): void {
    setDraft((current) => ({
      ...current,
      totals: {
        ...current.totals,
        days: replaceDay(current.totals.days, dayIndex, value),
      },
    }));
  }

  function updateTotal(total: string): void {
    setDraft((current) => ({
      ...current,
      totals: { ...current.totals, total },
    }));
  }

  function addRow(): void {
    setDraft((current) => {
      if (current.rows.length >= SCHEDULE_TABLE_MAX_ROWS) {
        return current;
      }
      return { ...current, rows: [...current.rows, createEmptyScheduleRow()] };
    });
  }

  function removeRow(rowId: string): void {
    setDraft((current) => ({
      ...current,
      rows: current.rows.filter((row) => row.id !== rowId),
    }));
  }

  async function save(): Promise<void> {
    if (saving || !dirty) {
      return;
    }
    await persistDraft(draftRef.current);
  }

  const atMaxRows = draft.rows.length >= SCHEDULE_TABLE_MAX_ROWS;
  const statusText = saving
    ? 'Kaydediliyor…'
    : error
      ? 'Kaydedilmedi'
      : dirty
        ? 'Kaydedilmemiş değişiklikler'
        : hasSaved
          ? 'Kaydedildi'
          : 'Henüz kaydedilmedi';

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold">Haftalık tablo</h2>
          <p className="text-xs text-muted">
            Hücrelere serbest metin yaz (ör. “2 saat”, “40 soru”). Toplamlar
            otomatik hesaplanmaz; her hücreyi kendin doldurabilirsin.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={addRow}
          disabled={atMaxRows}
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

      <div className="overflow-x-auto rounded-xl border border-line">
        <table
          aria-label="Haftalık ders çalışma tablosu"
          className="w-full table-fixed border-collapse text-sm min-[768px]:min-w-[1160px] min-[1440px]:min-w-0"
        >
          <thead>
            <tr>
              <th
                scope="col"
                className={cn(headCellClass, 'sticky left-0 z-20 w-[45%] min-[768px]:w-[18%]')}
              >
                <span className="min-[768px]:hidden">DERS</span>
                <span className="hidden min-[768px]:inline">DERSLER / TARİH</span>
              </th>
              {SCHEDULE_DAYS.map((day, dayIndex) => (
                <th
                  key={day.day}
                  scope="col"
                  aria-label={day.label}
                  className={cn(
                    headCellClass,
                    'w-[33%] min-[768px]:w-[10.4%]',
                    dayIndex !== selectedDay && 'hidden min-[768px]:table-cell',
                  )}
                >
                  <span className="min-[768px]:hidden">{day.label}</span>
                  <span className="hidden min-[768px]:inline">{day.short}</span>
                </th>
              ))}
              <th
                scope="col"
                aria-label="Toplam süre/soru"
                className={cn(headCellClass, 'w-[22%] min-[768px]:w-[9.2%]')}
              >
                <span className="min-[768px]:hidden">TOPLAM</span>
                <span className="hidden min-[768px]:inline">TOPLAM SÜRE/SORU</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, index) => (
              <tr key={row.id}>
                <td className={cn(bodyCellClass, 'sticky left-0 z-10 bg-surface')}>
                  <div className="flex items-start gap-1">
                    <AutoGrowTextarea
                      value={row.subject}
                      onChange={(value) => updateSubject(row.id, value)}
                      label={`${index + 1}. satır ders`}
                      placeholder="Ders / etkinlik"
                      maxLength={SCHEDULE_TABLE_SUBJECT_MAX_LENGTH}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      aria-label={`${index + 1}. satırı sil`}
                      onClick={() => removeRow(row.id)}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </td>
                {row.days.map((value, dayIndex) => (
                  <td
                    key={`${row.id}-${dayIndex}`}
                    className={cn(
                      bodyCellClass,
                      row.done[dayIndex] && 'bg-success/10',
                      dayIndex !== selectedDay && 'hidden min-[768px]:table-cell',
                    )}
                  >
                    <div className="flex justify-end">
                      <label className="grid h-11 w-11 place-items-center">
                        <input
                          type="checkbox"
                          checked={row.done[dayIndex]}
                          onChange={(event) =>
                            updateRowDone(row.id, dayIndex, event.target.checked)
                          }
                          aria-label={`${index + 1}. satır ${SCHEDULE_DAYS[dayIndex].label} tamamlandı`}
                          className="h-5 w-5 accent-[var(--color-success)]"
                        />
                      </label>
                    </div>
                    <AutoGrowTextarea
                      value={value}
                      onChange={(next) =>
                        updateRowDay(row.id, dayIndex, next)
                      }
                      label={`${index + 1}. satır ${SCHEDULE_DAYS[dayIndex].label}`}
                      maxLength={SCHEDULE_TABLE_CELL_MAX_LENGTH}
                      className={row.done[dayIndex] ? 'text-muted opacity-80' : undefined}
                    />
                  </td>
                ))}
                <td className={bodyCellClass}>
                  <AutoGrowTextarea
                    value={row.total}
                    onChange={(next) => updateRowTotal(row.id, next)}
                    label={`${index + 1}. satır toplam`}
                    maxLength={SCHEDULE_TABLE_TOTAL_MAX_LENGTH}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                className={cn(headCellClass, 'sticky left-0 z-10 border-b-0 bg-raised')}
              >
                <span className="min-[768px]:hidden">TOPLAM</span>
                <span className="hidden min-[768px]:inline">
                  {draft.totals.label || SCHEDULE_TABLE_TOTAL_LABEL}
                </span>
              </th>
              {draft.totals.days.map((value, dayIndex) => (
                <td
                  key={`toplam-${dayIndex}`}
                  className={cn(
                    bodyCellClass,
                    'border-b-0',
                    dayIndex !== selectedDay && 'hidden min-[768px]:table-cell',
                  )}
                >
                  <AutoGrowTextarea
                    value={value}
                    onChange={(next) => updateTotalDay(dayIndex, next)}
                    label={`Toplam satırı ${SCHEDULE_DAYS[dayIndex].label}`}
                    maxLength={SCHEDULE_TABLE_CELL_MAX_LENGTH}
                    className="font-medium"
                  />
                </td>
              ))}
              <td className={cn(bodyCellClass, 'border-b-0')}>
                <AutoGrowTextarea
                  value={draft.totals.total}
                  onChange={(next) => updateTotal(next)}
                  label="Genel toplam"
                  maxLength={SCHEDULE_TABLE_TOTAL_MAX_LENGTH}
                  className="font-medium"
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-2">
        <label
          htmlFor={noteId}
          className="block text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          HAFTANIN NOTU
        </label>
        <textarea
          id={noteId}
          value={draft.note}
          onChange={(event) =>
            setDraft((current) => ({ ...current, note: event.target.value }))
          }
          aria-label="Haftanın notu"
          rows={3}
          maxLength={SCHEDULE_TABLE_NOTE_MAX_LENGTH}
          placeholder="Bu haftanın değerlendirmesi, hedefler, eksik kalan konular…"
          className="min-h-24 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p
          role="status"
          aria-live="polite"
          className={cn(
            'text-sm',
            error
              ? 'text-danger'
              : dirty
                ? 'text-warning'
                : hasSaved
                  ? 'text-success'
                  : 'text-muted',
          )}
        >
          {statusText}
        </p>
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
      </div>
    </Card>
  );
}
