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
  ScheduleTableRow,
  ScheduleTableTotals,
} from '@/domain/types';
import { SCHEDULE_DAYS } from './scheduleDays';

interface Draft {
  rows: ScheduleTableRow[];
  totals: ScheduleTableTotals;
  note: string;
}

function cloneDays(days: ScheduleTableDayCells): ScheduleTableDayCells {
  return [...days] as ScheduleTableDayCells;
}

function draftFrom(table?: ScheduleTable): Draft {
  const source = table ?? createEmptyScheduleTable();
  return {
    rows: source.rows.map((row) => ({ ...row, days: cloneDays(row.days) })),
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

const cellInputClass =
  'h-11 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-sm text-fg placeholder:text-muted transition-colors hover:border-line focus:border-[var(--accent)] focus:bg-canvas';

const headCellClass =
  'border-b border-r border-line bg-raised px-2 py-2 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted';

const bodyCellClass = 'border-b border-r border-line p-1 align-middle';

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

      <div className="max-w-full overflow-x-auto rounded-xl border border-line">
        <table
          aria-label="Haftalık ders çalışma tablosu"
          className="w-full min-w-[920px] table-fixed border-collapse text-sm"
        >
          <colgroup>
            <col className="w-[200px]" />
            {SCHEDULE_DAYS.map((day) => (
              <col key={day.day} className="w-[88px]" />
            ))}
            <col className="w-[104px]" />
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className={cn(headCellClass, 'sticky left-0 z-20 w-[200px]')}
              >
                DERSLER / TARİH
              </th>
              {SCHEDULE_DAYS.map((day) => (
                <th key={day.day} scope="col" className={headCellClass}>
                  {day.label}
                </th>
              ))}
              <th scope="col" className={headCellClass}>
                TOPLAM SÜRE/SORU
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, index) => (
              <tr key={row.id}>
                <td
                  className={cn(
                    bodyCellClass,
                    'sticky left-0 z-10 bg-surface',
                  )}
                >
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={row.subject}
                      onChange={(event) =>
                        updateSubject(row.id, event.target.value)
                      }
                      aria-label={`${index + 1}. satır ders`}
                      placeholder="Ders / etkinlik"
                      maxLength={SCHEDULE_TABLE_SUBJECT_MAX_LENGTH}
                      className={cn(cellInputClass, 'flex-1')}
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
                  <td key={`${row.id}-${dayIndex}`} className={bodyCellClass}>
                    <input
                      type="text"
                      value={value}
                      onChange={(event) =>
                        updateRowDay(row.id, dayIndex, event.target.value)
                      }
                      aria-label={`${index + 1}. satır ${SCHEDULE_DAYS[dayIndex].label}`}
                      maxLength={SCHEDULE_TABLE_CELL_MAX_LENGTH}
                      className={cellInputClass}
                    />
                  </td>
                ))}
                <td className={bodyCellClass}>
                  <input
                    type="text"
                    value={row.total}
                    onChange={(event) =>
                      updateRowTotal(row.id, event.target.value)
                    }
                    aria-label={`${index + 1}. satır toplam`}
                    maxLength={SCHEDULE_TABLE_TOTAL_MAX_LENGTH}
                    className={cellInputClass}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                className={cn(
                  headCellClass,
                  'sticky left-0 z-10 border-b-0 bg-raised',
                )}
              >
                {draft.totals.label || SCHEDULE_TABLE_TOTAL_LABEL}
              </th>
              {draft.totals.days.map((value, dayIndex) => (
                <td
                  key={`toplam-${dayIndex}`}
                  className={cn(bodyCellClass, 'border-b-0')}
                >
                  <input
                    type="text"
                    value={value}
                    onChange={(event) =>
                      updateTotalDay(dayIndex, event.target.value)
                    }
                    aria-label={`Toplam satırı ${SCHEDULE_DAYS[dayIndex].label}`}
                    maxLength={SCHEDULE_TABLE_CELL_MAX_LENGTH}
                    className={cn(cellInputClass, 'font-medium')}
                  />
                </td>
              ))}
              <td className={cn(bodyCellClass, 'border-b-0')}>
                <input
                  type="text"
                  value={draft.totals.total}
                  onChange={(event) => updateTotal(event.target.value)}
                  aria-label="Genel toplam"
                  maxLength={SCHEDULE_TABLE_TOTAL_MAX_LENGTH}
                  className={cn(cellInputClass, 'font-medium')}
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
