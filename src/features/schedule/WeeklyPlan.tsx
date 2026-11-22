import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/cn';
import {
  addRow,
  deleteRow as deleteScheduleRow,
  getOrCreateWeek,
  renameRow,
  saveWeekNote,
  type WeekData,
} from '@/db/scheduleRepository';
import { shiftWeek, weekLabel, weekStartOf } from '@/domain/schedule';
import { isValidDateString } from '@/lib/date';
import { newId } from '@/lib/id';
import { WeeklyPlanTable, type WeeklyPlanRow } from './WeeklyPlanTable';

/** Short enough to feel automatic, long enough not to save every keystroke. */
const ROW_SAVE_DELAY_MS = 600;
const NOTE_SAVE_DELAY_MS = 800;
const WEEK_NOTE_MAX_LENGTH = 2000;

interface SavedRow {
  key: string;
  label: string;
}

interface PendingRowsSave {
  rows: WeeklyPlanRow[];
  weekId: string;
  signature: string;
}

interface PendingNoteSave {
  note: string;
  weekId: string;
}

function requestedWeekStart(value: string | null): string {
  if (value !== null && isValidDateString(value)) {
    return weekStartOf(parseISO(value));
  }
  return weekStartOf(new Date());
}

/** Saved and draft rows are compared by their stable key and trimmed label. */
function rowsSignature(rows: readonly { key: string; label: string }[]): string {
  return JSON.stringify(rows.map((row) => [row.key, row.label.trim()]));
}

function savedView(rows: readonly WeeklyPlanRow[]): SavedRow[] {
  return rows.map((row) => ({ key: row.key, label: row.label.trim() }));
}

function messageFor(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

export function WeeklyPlan() {
  const noteId = useId();
  const [searchParams] = useSearchParams();
  const weekParam = searchParams.get('week');

  const [weekStart, setWeekStart] = useState(() => requestedWeekStart(weekParam));
  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rows, setRows] = useState<WeeklyPlanRow[]>([]);
  const [savedRows, setSavedRows] = useState<SavedRow[]>([]);
  const [rowsSaving, setRowsSaving] = useState(false);

  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const [hasSaved, setHasSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const weekStartRef = useRef(weekStart);
  const weekIdRef = useRef<string | null>(null);
  const weekDataRef = useRef<WeekData | null>(null);
  const rowsRef = useRef<WeeklyPlanRow[]>([]);
  const savedRowsRef = useRef<SavedRow[]>([]);
  const noteRef = useRef('');
  const savedNoteRef = useRef('');

  const rowsSavingRef = useRef(false);
  const noteSavingRef = useRef(false);
  const pendingRowsRef = useRef<PendingRowsSave | null>(null);
  const pendingNoteRef = useRef<PendingNoteSave | null>(null);
  const addingKeysRef = useRef<Set<string>>(new Set());
  const lastSavedLabelsRef = useRef<Map<string, string>>(new Map());
  const failedRowsSignatureRef = useRef<string | null>(null);
  const failedNoteRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateRows = useCallback((next: WeeklyPlanRow[]): void => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const updateSavedRows = useCallback((next: SavedRow[]): void => {
    savedRowsRef.current = next;
    setSavedRows(next);
  }, []);

  const updateNote = useCallback((next: string): void => {
    noteRef.current = next;
    setNote(next);
  }, []);

  const updateSavedNote = useCallback((next: string): void => {
    savedNoteRef.current = next;
    setSavedNote(next);
  }, []);

  const persistRows = useCallback(
    async (
      targetRows: WeeklyPlanRow[],
      forWeekId: string,
      signature: string,
    ): Promise<void> => {
      if (rowsSavingRef.current) {
        pendingRowsRef.current = {
          rows: targetRows,
          weekId: forWeekId,
          signature,
        };
        return;
      }

      rowsSavingRef.current = true;
      if (mountedRef.current) {
        setRowsSaving(true);
        setSaveError(null);
      }

      let wrote = false;
      try {
        for (const row of targetRows) {
          const label = row.label.trim();
          if (!label) {
            continue;
          }

          if (row.id === undefined) {
            if (addingKeysRef.current.has(row.key)) {
              continue;
            }
            addingKeysRef.current.add(row.key);
            try {
              const created = await addRow(forWeekId, label);
              wrote = true;
              lastSavedLabelsRef.current.set(row.key, created.label);

              // The row may have been deleted while the insert was in flight.
              if (!rowsRef.current.some((item) => item.key === row.key)) {
                lastSavedLabelsRef.current.delete(row.key);
                await deleteScheduleRow(created.id);
                continue;
              }

              if (mountedRef.current && weekIdRef.current === forWeekId) {
                updateRows(
                  rowsRef.current.map((item) =>
                    item.key === row.key && item.id === undefined
                      ? { ...item, id: created.id }
                      : item,
                  ),
                );
              }
            } finally {
              addingKeysRef.current.delete(row.key);
            }
          } else if (lastSavedLabelsRef.current.get(row.key) !== label) {
            await renameRow(row.id, label);
            wrote = true;
            lastSavedLabelsRef.current.set(row.key, label);
          }
        }

        failedRowsSignatureRef.current = null;
        if (mountedRef.current && weekIdRef.current === forWeekId) {
          updateSavedRows(savedView(targetRows));
          if (wrote) {
            setHasSaved(true);
          }
        }
      } catch (caught: unknown) {
        failedRowsSignatureRef.current = signature;
        if (mountedRef.current && weekIdRef.current === forWeekId) {
          setSaveError(
            messageFor(
              caught,
              'Plan satırları kaydedilemedi. Lütfen tekrar dene.',
            ),
          );
        }
      } finally {
        rowsSavingRef.current = false;
        if (mountedRef.current) {
          setRowsSaving(false);
        }
        const pending = pendingRowsRef.current;
        pendingRowsRef.current = null;
        if (pending) {
          void persistRows(pending.rows, pending.weekId, pending.signature);
        }
      }
    },
    [updateRows, updateSavedRows],
  );

  const persistNote = useCallback(
    async (value: string, forWeekId: string): Promise<void> => {
      if (noteSavingRef.current) {
        pendingNoteRef.current = { note: value, weekId: forWeekId };
        return;
      }

      noteSavingRef.current = true;
      if (mountedRef.current) {
        setNoteSaving(true);
        setSaveError(null);
      }

      try {
        await saveWeekNote(forWeekId, value);
        failedNoteRef.current = null;
        if (mountedRef.current && weekIdRef.current === forWeekId) {
          updateSavedNote(value);
          setHasSaved(true);
        }
      } catch (caught: unknown) {
        failedNoteRef.current = value;
        if (mountedRef.current && weekIdRef.current === forWeekId) {
          setSaveError(
            messageFor(caught, 'Not kaydedilemedi. Lütfen tekrar dene.'),
          );
        }
      } finally {
        noteSavingRef.current = false;
        if (mountedRef.current) {
          setNoteSaving(false);
        }
        const pending = pendingNoteRef.current;
        pendingNoteRef.current = null;
        if (pending) {
          void persistNote(pending.note, pending.weekId);
        }
      }
    },
    [updateSavedNote],
  );

  const flushRows = useCallback((): void => {
    const data = weekDataRef.current;
    if (!data) {
      return;
    }
    const signature = rowsSignature(rowsRef.current);
    if (
      signature !== rowsSignature(savedRowsRef.current) &&
      signature !== failedRowsSignatureRef.current
    ) {
      void persistRows(rowsRef.current, data.week.id, signature);
    }
  }, [persistRows]);

  const flushNote = useCallback((): void => {
    const forWeekId = weekIdRef.current;
    if (!forWeekId) {
      return;
    }
    if (
      noteRef.current !== savedNoteRef.current &&
      noteRef.current !== failedNoteRef.current
    ) {
      void persistNote(noteRef.current, forWeekId);
    }
  }, [persistNote]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setWeekData(null);
    weekDataRef.current = null;
    setSaveError(null);
    failedRowsSignatureRef.current = null;
    failedNoteRef.current = null;

    getOrCreateWeek(weekStart)
      .then((data) => {
        if (!active) {
          return;
        }
        weekIdRef.current = data.week.id;
        weekDataRef.current = data;

        const nextRows: WeeklyPlanRow[] = data.rows.map((row) => ({
          key: row.id,
          id: row.id,
          label: row.label,
        }));
        updateRows(nextRows);
        updateSavedRows(savedView(nextRows));
        lastSavedLabelsRef.current = new Map(
          nextRows.flatMap((row) =>
            row.id === undefined ? [] : [[row.key, row.label] as const],
          ),
        );

        updateNote(data.week.note);
        updateSavedNote(data.week.note);
        setHasSaved(data.week.note.length > 0 || nextRows.length > 0);
        setWeekData(data);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) {
          return;
        }
        setLoadError(
          messageFor(caught, 'Haftalık plan yüklenemedi. Lütfen tekrar dene.'),
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [weekStart, updateRows, updateSavedRows, updateNote, updateSavedNote]);

  const changeWeek = useCallback(
    (next: string): void => {
      if (next === weekStartRef.current) {
        return;
      }
      flushNote();
      flushRows();
      weekStartRef.current = next;
      setWeekStart(next);
    },
    [flushNote, flushRows],
  );

  // Follow a `?week=` change without making the query parameter the owner of
  // the navigation state; the buttons below keep working on their own.
  useEffect(() => {
    if (weekParam === null || !isValidDateString(weekParam)) {
      return;
    }
    changeWeek(weekStartOf(parseISO(weekParam)));
  }, [weekParam, changeWeek]);

  // Best effort flush for route changes, tab close and backgrounding.
  useEffect(() => {
    const flush = () => {
      flushNote();
      flushRows();
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
  }, [flushNote, flushRows]);

  const rowsSignatureValue = rowsSignature(rows);
  const rowsDirty = rowsSignatureValue !== rowsSignature(savedRows);
  const noteDirty = note !== savedNote;
  const dirty = rowsDirty || noteDirty;

  useEffect(() => {
    if (
      !weekData ||
      !rowsDirty ||
      rowsSaving ||
      rowsSignatureValue === failedRowsSignatureRef.current
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void persistRows(
        rowsRef.current,
        weekData.week.id,
        rowsSignature(rowsRef.current),
      );
    }, ROW_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [weekData, rowsDirty, rowsSignatureValue, rowsSaving, persistRows]);

  useEffect(() => {
    if (
      !weekData ||
      !noteDirty ||
      noteSaving ||
      note === failedNoteRef.current
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void persistNote(noteRef.current, weekData.week.id);
    }, NOTE_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [weekData, noteDirty, note, noteSaving, persistNote]);

  function addDraftRow(): void {
    const row: WeeklyPlanRow = { key: newId(), label: '' };
    updateRows([...rowsRef.current, row]);
    // A blank draft is kept out of the save comparison until it gets a label.
    updateSavedRows([...savedRowsRef.current, { key: row.key, label: '' }]);
  }

  function renameDraftRow(key: string, label: string): void {
    updateRows(
      rowsRef.current.map((row) => (row.key === key ? { ...row, label } : row)),
    );
  }

  async function removeRow(key: string): Promise<void> {
    const row = rowsRef.current.find((item) => item.key === key);
    if (!row) {
      return;
    }

    if (row.id !== undefined) {
      try {
        await deleteScheduleRow(row.id);
      } catch (caught: unknown) {
        setSaveError(
          messageFor(caught, 'Satır silinemedi. Lütfen tekrar dene.'),
        );
        return;
      }
    }

    lastSavedLabelsRef.current.delete(key);
    updateRows(rowsRef.current.filter((item) => item.key !== key));
    updateSavedRows(savedRowsRef.current.filter((item) => item.key !== key));
  }

  const currentWeekStart = weekStartOf(new Date());
  const saving = rowsSaving || noteSaving;
  const statusText = saving
    ? 'Kaydediliyor…'
    : saveError
      ? 'Kaydedilmedi'
      : dirty
        ? 'Kaydedilmemiş değişiklikler'
        : hasSaved
          ? 'Kaydedildi'
          : 'Henüz kaydedilmedi';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => changeWeek(shiftWeek(weekStartRef.current, -1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Önceki hafta
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => changeWeek(shiftWeek(weekStartRef.current, 1))}
          >
            Sonraki hafta
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => changeWeek(currentWeekStart)}
          >
            Bu hafta
          </Button>
        </div>
        <p
          aria-live="polite"
          className="text-lg font-semibold tracking-tight"
        >
          {weekLabel(weekStart)}
        </p>
      </div>

      {loadError ? (
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
      ) : loading || !weekData ? (
        <p role="status" className="py-8 text-center text-sm text-muted">
          Haftalık plan yükleniyor…
        </p>
      ) : (
        <WeeklyPlanTable
          weekStart={weekStart}
          rows={rows}
          onAddRow={addDraftRow}
          onRenameRow={renameDraftRow}
          onDeleteRow={(key) => void removeRow(key)}
        />
      )}

      {weekData ? (
        <Card className="space-y-2">
          <label
            htmlFor={noteId}
            className="block text-[11px] font-semibold uppercase tracking-wide text-muted"
          >
            HAFTANIN NOTU
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => updateNote(event.target.value)}
            onBlur={flushNote}
            aria-label="Haftanın notu"
            rows={3}
            maxLength={WEEK_NOTE_MAX_LENGTH}
            placeholder="Bu haftanın değerlendirmesi, hedefler, eksik kalan konular…"
            className="min-h-24 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]"
          />
          {saveError ? (
            <p role="alert" className="text-sm text-danger">
              {saveError}
            </p>
          ) : null}
          <p
            role="status"
            aria-live="polite"
            className={cn(
              'text-sm',
              saveError
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
        </Card>
      ) : null}
    </div>
  );
}
