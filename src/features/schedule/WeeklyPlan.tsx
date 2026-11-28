import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { listShelfBooks } from '@/db/bookRepositories';
import {
  addUnscheduledChunk,
  listWeekPageChains,
  reconcileWeekPageChains,
  skipUnscheduledChunk,
  type PageChainView,
} from '@/db/pageChainRepository';
import { listAllTopics, listSubjects } from '@/db/repositories';
import {
  addRow,
  copyWeek,
  deleteRow as deleteScheduleRow,
  deleteTask as deleteScheduleTask,
  getOrCreateWeek,
  PageChainRecomputeError,
  renameRow,
  saveWeekNote,
  setTaskStatus as setScheduleTaskStatus,
  type WeekData,
} from '@/db/scheduleRepository';
import {
  scheduleTaskContent,
  shiftWeek,
  weekLabel,
  weekStartOf,
  type ScheduleTaskStatus,
} from '@/domain/schedule';
import type { ScheduleTask } from '@/domain/types';
import { isValidDateString, todayLocalDate } from '@/lib/date';
import { newId } from '@/lib/id';
import { PageChainBanner } from './PageChainBanner';
import { PageChainModal } from './PageChainModal';
import { ScheduleTaskModal } from './ScheduleTaskModal';
import { todayScheduleDayIndex } from './scheduleDays';
import { WeeklyPlanTable, type WeeklyPlanRow } from './WeeklyPlanTable';
import { WeekSummary } from './WeekSummary';

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

interface TaskEditorTarget {
  rowId: string;
  dayIndex: number;
  task?: ScheduleTask;
}

type PlanDeleteTarget =
  | { kind: 'task'; task: ScheduleTask }
  | { kind: 'row'; key: string; label: string };

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

/** Saved labels are scoped by week so a pending save survives a week switch. */
function savedLabelKey(weekId: string, rowKey: string): string {
  return `${weekId}:${rowKey}`;
}

export function WeeklyPlan() {
  const noteId = useId();
  const [searchParams] = useSearchParams();
  const weekParam = searchParams.get('week');

  const [weekStart, setWeekStart] = useState(() => requestedWeekStart(weekParam));
  // Zero-based visual index, not the stored ISO day. Lives above the table so
  // switching weeks keeps the selected mobile day; first open shows today.
  const [selectedDay, setSelectedDay] = useState(() => todayScheduleDayIndex());
  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rows, setRows] = useState<WeeklyPlanRow[]>([]);
  const [savedRows, setSavedRows] = useState<SavedRow[]>([]);
  const [rowsSaving, setRowsSaving] = useState(false);

  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [chains, setChains] = useState<PageChainView[]>([]);
  const [chainTaskIds, setChainTaskIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [taskEditor, setTaskEditor] = useState<TaskEditorTarget | null>(null);
  const [pageChainOpen, setPageChainOpen] = useState(false);
  const [chainNotice, setChainNotice] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [tickMode, setTickMode] = useState(false);
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlanDeleteTarget | null>(null);
  const [deletingTarget, setDeletingTarget] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
  const tasksRef = useRef<ScheduleTask[]>([]);
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
  /** Local day of the last chain reconcile; a new day means past days shift. */
  const lastChainDayRef = useRef(todayLocalDate());

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

  const updateTasks = useCallback((next: ScheduleTask[]): void => {
    tasksRef.current = next;
    setTasks(next);
  }, []);

  // Labels only; the task modal reads its own form options.
  const taskLookups = useLiveQuery(async () => {
    const [books, topics, subjects] = await Promise.all([
      listShelfBooks(true),
      listAllTopics(),
      listSubjects(),
    ]);
    return { books, topics, subjects };
  }, []);

  const contentFor = useCallback(
    (task: ScheduleTask, rowLabel?: string) => {
      const topic = taskLookups?.topics.find(
        (item) => item.id === task.topicId,
      );
      const subject = taskLookups?.subjects.find(
        (item) => item.id === topic?.subjectId,
      );
      const shelfBook = taskLookups?.books.find(
        (item) => item.userBook.id === task.userBookId,
      );
      return scheduleTaskContent(task, {
        rowLabel,
        bookTitle: shelfBook?.catalogBook.title,
        bookPublisher: shelfBook?.catalogBook.publisher,
        topicName: topic?.name,
        subjectName: subject?.name,
      });
    },
    [taskLookups],
  );

  const taskContent = useCallback(
    (task: ScheduleTask, rowLabel: string) => contentFor(task, rowLabel),
    [contentFor],
  );

  const taskLabel = useCallback(
    (task: ScheduleTask): string => {
      const row = rowsRef.current.find((item) => item.id === task.rowId);
      const content = contentFor(task, row?.label);
      return content.detail
        ? `${content.title} ${content.detail}`
        : content.title;
    },
    [contentFor],
  );

  /**
   * Chains drive the badges, the warnings and the unscheduled banner, so a
   * failed read must never hide the plan itself.
   */
  const refreshChains = useCallback(
    async (forWeekId: string): Promise<void> => {
      try {
        const views = await listWeekPageChains(forWeekId);
        if (!mountedRef.current || weekIdRef.current !== forWeekId) {
          return;
        }
        const ids = new Set<string>();
        for (const view of views) {
          for (const task of view.tasks) {
            if (!task.deletedAt) {
              ids.add(task.id);
            }
          }
        }
        setChains(views);
        setChainTaskIds(ids);
      } catch {
        // Keep the previous views; the next refresh retries the read.
      }
    },
    [],
  );

  const refreshTasks = useCallback(async (): Promise<void> => {
    const forWeekId = weekIdRef.current;
    if (!forWeekId) {
      return;
    }
    const data = await getOrCreateWeek(weekStartRef.current);
    if (weekIdRef.current === forWeekId) {
      updateTasks(data.tasks);
    }
    await refreshChains(forWeekId);
  }, [updateTasks, refreshChains]);

  const refreshAfterCopy = useCallback(async (): Promise<void> => {
    const forWeekId = weekIdRef.current;
    if (!forWeekId) {
      return;
    }
    const data = await getOrCreateWeek(weekStartRef.current);
    if (weekIdRef.current !== forWeekId) {
      return;
    }
    updateTasks(data.tasks);

    // Copied rows arrive with database ids; append the missing ones without
    // disturbing local drafts that are still waiting for their first save.
    const known = new Set(rowsRef.current.map((row) => row.key));
    const added = data.rows
      .filter((row) => !known.has(row.id))
      .map<WeeklyPlanRow>((row) => ({
        key: row.id,
        id: row.id,
        label: row.label,
      }));
    if (added.length === 0) {
      return;
    }

    updateRows([...rowsRef.current, ...added]);
    updateSavedRows([...savedRowsRef.current, ...savedView(added)]);
    for (const row of added) {
      lastSavedLabelsRef.current.set(
        savedLabelKey(forWeekId, row.key),
        row.label,
      );
    }
  }, [updateRows, updateSavedRows, updateTasks]);

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
        // A cleared existing label is a normal edit, but the repository rejects
        // blank labels. Surface the problem instead of silently claiming the
        // old label was saved.
        if (
          targetRows.some(
            (row) => row.id !== undefined && row.label.trim() === '',
          )
        ) {
          throw new Error(
            'Satır adı boş olamaz. Satırı silmek için çöp kutusunu kullan.',
          );
        }

        for (const row of targetRows) {
          const label = row.label.trim();
          if (!label) {
            continue;
          }

          if (row.id === undefined) {
            if (addingKeysRef.current.has(row.key)) {
              continue;
            }
            // A queued flush may still carry the pre-insert snapshot. The
            // label map proves this key was already inserted, so never add it
            // a second time.
            if (
              lastSavedLabelsRef.current.has(
                savedLabelKey(forWeekId, row.key),
              )
            ) {
              continue;
            }
            addingKeysRef.current.add(row.key);
            try {
              const created = await addRow(forWeekId, label);
              wrote = true;
              lastSavedLabelsRef.current.set(
                savedLabelKey(forWeekId, row.key),
                created.label,
              );

              // The row may have been deleted while the insert was in flight.
              // The live rows only belong to this week; after a week switch
              // they say nothing about the inserted row.
              const stillPresent =
                weekIdRef.current !== forWeekId ||
                rowsRef.current.some((item) => item.key === row.key);
              if (!stillPresent) {
                lastSavedLabelsRef.current.delete(
                  savedLabelKey(forWeekId, row.key),
                );
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
          } else if (
            lastSavedLabelsRef.current.get(
              savedLabelKey(forWeekId, row.key),
            ) !== label
          ) {
            await renameRow(row.id, label);
            wrote = true;
            lastSavedLabelsRef.current.set(
              savedLabelKey(forWeekId, row.key),
              label,
            );
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
          // When the pending snapshot belongs to the visible week, refresh it
          // from the live rows so ids assigned by the insert are visible to the
          // replay. The label guard in persistRows covers the other week.
          const rowsToSave =
            weekIdRef.current === pending.weekId
              ? rowsRef.current
              : pending.rows;
          void persistRows(
            rowsToSave,
            pending.weekId,
            rowsSignature(rowsToSave),
          );
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
          updateSavedNote(value.trim());
          setHasSaved(true);
        }
      } catch (caught: unknown) {
        failedNoteRef.current = value.trim();
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
    const trimmed = noteRef.current.trim();
    if (trimmed !== savedNoteRef.current && trimmed !== failedNoteRef.current) {
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
    setTaskError(null);
    setChains([]);
    setChainTaskIds(new Set());
    failedRowsSignatureRef.current = null;
    failedNoteRef.current = null;

    getOrCreateWeek(weekStart)
      .then(async (initial) => {
        if (!active) {
          return;
        }
        // Days pass while the app is closed; repair the chains before showing
        // the plan so the visible ranges match the current calendar.
        try {
          await reconcileWeekPageChains(initial.week.id);
          lastChainDayRef.current = todayLocalDate();
        } catch {
          // A failed repair must not hide the plan; reads still render.
        }
        if (!active) {
          return;
        }
        const data = await getOrCreateWeek(weekStart);
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
        for (const row of nextRows) {
          if (row.id !== undefined) {
            lastSavedLabelsRef.current.set(
              savedLabelKey(data.week.id, row.key),
              row.label,
            );
          }
        }

        updateNote(data.week.note);
        updateSavedNote(data.week.note.trim());
        updateTasks(data.tasks);
        // Load the badges before the table becomes visible so a chain task
        // never flashes without its badge.
        await refreshChains(data.week.id);
        if (!active) {
          return;
        }
        setHasSaved(data.week.note.trim().length > 0 || nextRows.length > 0);
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
  }, [
    weekStart,
    updateRows,
    updateSavedRows,
    updateTasks,
    updateNote,
    updateSavedNote,
    refreshChains,
  ]);

  const changeWeek = useCallback(
    (next: string): void => {
      if (next === weekStartRef.current) {
        return;
      }
      flushNote();
      flushRows();
      weekStartRef.current = next;
      setTaskEditor(null);
      setPageChainOpen(false);
      setChainNotice(null);
      setCopyConfirmOpen(false);
      setDeleteTarget(null);
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

  // A tab left open across midnight must re-derive chain pages when it comes
  // back. No interval: the local day key decides whether a reconcile is due.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const dayKey = todayLocalDate();
      if (dayKey === lastChainDayRef.current) {
        return;
      }
      lastChainDayRef.current = dayKey;

      const forWeekId = weekIdRef.current;
      if (!forWeekId) {
        return;
      }
      void (async () => {
        try {
          await reconcileWeekPageChains(forWeekId);
        } catch {
          return;
        }
        if (weekIdRef.current === forWeekId) {
          await refreshTasks();
        }
      })();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshTasks]);

  const rowsSignatureValue = rowsSignature(rows);
  const rowsDirty = rowsSignatureValue !== rowsSignature(savedRows);
  const noteDirty = note.trim() !== savedNote;
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
      note.trim() === failedNoteRef.current
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
      await deleteScheduleRow(row.id);
    }

    const forWeekId = weekIdRef.current;
    if (forWeekId) {
      lastSavedLabelsRef.current.delete(savedLabelKey(forWeekId, key));
    }
    updateRows(rowsRef.current.filter((item) => item.key !== key));
    updateSavedRows(savedRowsRef.current.filter((item) => item.key !== key));
    if (row.id !== undefined) {
      // Deleting a row also tombstones its tasks; refresh so the summary stops
      // counting them.
      await refreshTasks();
    }
  }

  async function handleSetTaskStatus(
    task: ScheduleTask,
    status: ScheduleTaskStatus,
  ): Promise<void> {
    setTaskError(null);
    try {
      await setScheduleTaskStatus(task.id, status);
      await refreshTasks();
    } catch (caught: unknown) {
      if (caught instanceof PageChainRecomputeError) {
        // The tick/miss committed; only the follow-up chain shift failed.
        setTaskError(caught.message);
        try {
          await refreshTasks();
        } catch {
          // Keep the chain message; the next plan load retries the reconcile.
        }
        return;
      }
      setTaskError(
        messageFor(caught, 'Görev güncellenemedi. Lütfen tekrar dene.'),
      );
    }
  }

  async function addNextChainChunk(chainId: string): Promise<void> {
    setTaskError(null);
    try {
      await addUnscheduledChunk(chainId);
      await refreshTasks();
    } catch (caught: unknown) {
      setTaskError(
        messageFor(caught, 'Sonraki gün eklenemedi. Lütfen tekrar dene.'),
      );
    }
  }

  async function skipChainChunk(chainId: string): Promise<void> {
    setTaskError(null);
    try {
      await skipUnscheduledChunk(chainId);
      await refreshTasks();
    } catch (caught: unknown) {
      setTaskError(
        messageFor(caught, 'Aralık silinemedi. Lütfen tekrar dene.'),
      );
    }
  }

  function requestDeleteTask(task: ScheduleTask): void {
    setTaskError(null);
    setDeleteError(null);
    setDeleteTarget({ kind: 'task', task });
  }

  function requestDeleteRow(key: string): void {
    const row = rowsRef.current.find((item) => item.key === key);
    setSaveError(null);
    setDeleteError(null);
    setDeleteTarget({
      kind: 'row',
      key,
      label: row?.label.trim() || 'Bu',
    });
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || deletingTarget) {
      return;
    }

    setDeletingTarget(true);
    setDeleteError(null);
    try {
      if (deleteTarget.kind === 'task') {
        await deleteScheduleTask(deleteTarget.task.id);
        await refreshTasks();
      } else {
        await removeRow(deleteTarget.key);
      }
      setDeleteTarget(null);
    } catch (caught: unknown) {
      setDeleteError(
        messageFor(
          caught,
          deleteTarget.kind === 'task'
            ? 'Görev silinemedi. Lütfen tekrar dene.'
            : 'Satır silinemedi. Lütfen tekrar dene.',
        ),
      );
    } finally {
      setDeletingTarget(false);
    }
  }

  async function copyPreviousWeek(): Promise<void> {
    setCopying(true);
    setTaskError(null);
    try {
      await copyWeek(shiftWeek(weekStartRef.current, -1), weekStartRef.current);
      await refreshAfterCopy();
    } catch (caught: unknown) {
      setTaskError(
        messageFor(caught, 'Görevler kopyalanamadı. Lütfen tekrar dene.'),
      );
    } finally {
      setCopying(false);
      setCopyConfirmOpen(false);
    }
  }

  function requestCopy(): void {
    if (rowsRef.current.length > 0 || tasksRef.current.length > 0) {
      setCopyConfirmOpen(true);
      return;
    }
    void copyPreviousWeek();
  }

  const currentWeekStart = weekStartOf(new Date());
  // A const keeps the optional task narrowed inside the delete callback.
  const editedTask = taskEditor?.task;
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
          <Button
            variant="secondary"
            size="sm"
            onClick={requestCopy}
            disabled={copying || loading || !weekData}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            {copying ? 'Kopyalanıyor…' : 'Geçen haftadan kopyala'}
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
        <>
          <WeeklyPlanTable
            weekStart={weekStart}
            rows={rows}
            tasks={tasks}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onAddRow={addDraftRow}
            onRenameRow={renameDraftRow}
            onDeleteRow={requestDeleteRow}
            taskContent={taskContent}
            onAddTask={(row, dayIndex) => {
              if (!weekData || row.id === undefined) {
                return;
              }
              setTaskEditor({ rowId: row.id, dayIndex });
            }}
            onSetTaskStatus={(task, status) =>
              void handleSetTaskStatus(task, status)
            }
            onEditTask={(task) =>
              setTaskEditor({
                rowId: task.rowId,
                dayIndex: task.dayIndex,
                task,
              })
            }
            tickMode={tickMode}
            onToggleTickMode={() => setTickMode((current) => !current)}
            chainTaskIds={chainTaskIds}
            onOpenPageChain={() => setPageChainOpen(true)}
          />

          <PageChainBanner
            chains={chains}
            rows={rows}
            onAddNext={addNextChainChunk}
            onSkip={skipChainChunk}
          />

          <p
            role="status"
            aria-live="polite"
            className={cn(
              'text-sm',
              chainNotice ? 'text-success' : 'sr-only',
            )}
          >
            {chainNotice ?? ''}
          </p>

          {taskError ? (
            <p role="alert" className="text-sm text-danger">
              {taskError}
            </p>
          ) : null}

          <WeekSummary tasks={tasks} />
        </>
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

      {taskEditor && weekData ? (
        <ScheduleTaskModal
          weekId={weekData.week.id}
          rowId={taskEditor.rowId}
          dayIndex={taskEditor.dayIndex}
          task={taskEditor.task}
          chain={
            taskEditor.task !== undefined &&
            chainTaskIds.has(taskEditor.task.id)
          }
          onDelete={
            editedTask
              ? () => {
                  setTaskEditor(null);
                  requestDeleteTask(editedTask);
                }
              : undefined
          }
          onClose={() => setTaskEditor(null)}
          onSaved={async () => {
            setTaskEditor(null);
            await refreshTasks();
          }}
        />
      ) : null}

      {pageChainOpen && weekData ? (
        <PageChainModal
          weekId={weekData.week.id}
          weekStart={weekStart}
          rows={rows}
          tasks={tasks}
          onClose={() => setPageChainOpen(false)}
          onCreated={async () => {
            await refreshTasks();
            setChainNotice('Zincir oluşturuldu.');
          }}
        />
      ) : null}

      {copyConfirmOpen ? (
        <Modal
          open
          title="Geçen haftadan kopyala"
          onClose={() => {
            if (!copying) {
              setCopyConfirmOpen(false);
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setCopyConfirmOpen(false)}
                disabled={copying}
              >
                Vazgeç
              </Button>
              <Button onClick={() => void copyPreviousWeek()} disabled={copying}>
                {copying ? 'Kopyalanıyor…' : 'Kopyala'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            Bu haftada zaten satır veya görev var. Kopyalama yalnızca eksik satır
            ve görevleri ekler; var olan görevler çoğaltılmaz.
          </p>
          <p className="text-sm text-muted">
            Kopyalanan görevler tamamlanmamış olarak gelir.
          </p>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          open
          title={deleteTarget.kind === 'task' ? 'Görevi sil' : 'Satırı sil'}
          onClose={() => {
            if (!deletingTarget) {
              setDeleteTarget(null);
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingTarget}
              >
                Vazgeç
              </Button>
              <Button
                variant="danger"
                onClick={() => void confirmDelete()}
                disabled={deletingTarget}
              >
                {deletingTarget ? 'Siliniyor…' : 'Sil'}
              </Button>
            </>
          }
        >
          {deleteTarget.kind === 'task' ? (
            <>
              <p className="text-sm">
                <span className="font-semibold">
                  {taskLabel(deleteTarget.task)}
                </span>{' '}
                plan görevinden kaldırılacak.
              </p>
              {chainTaskIds.has(deleteTarget.task.id) ? (
                <p className="text-sm text-warning">
                  Bu görev bir sayfa zincirinin parçası; silmek zinciri çözer.
                </p>
              ) : null}
              <p className="text-sm text-muted">
                Kitap veya konu ilerlemesi silinmez. İlerlemeyi geri almak için
                görevi silmeden önce tiki kaldır.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm">
                <span className="font-semibold">{deleteTarget.label}</span>{' '}
                satırı ve içindeki tüm görevler plandan kaldırılacak.
              </p>
              <p className="text-sm text-muted">
                Kitap ve konu ilerlemesi korunur.
              </p>
            </>
          )}
          {deleteError ? (
            <p role="alert" className="text-sm text-danger">
              {deleteError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
