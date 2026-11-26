import { useId, useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { listShelfBooks } from '@/db/bookRepositories';
import { createPageChain } from '@/db/pageChainRepository';
import { splitPageRange, type PageChainChunk } from '@/domain/pageChain';
import { dayLabel, validateTaskPages } from '@/domain/schedule';
import type { ScheduleTask } from '@/domain/types';
import { SCHEDULE_DAYS } from './scheduleDays';
import { ShelfBookPicker } from './ShelfBookPicker';
import type { WeeklyPlanRow } from './WeeklyPlanTable';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

/** Blank number inputs are `undefined`, never `NaN`, matching the task modal. */
function parsePageInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function messageFor(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

function rowName(row: WeeklyPlanRow, index: number): string {
  return row.label.trim() || `${index + 1}. satır`;
}

export interface PageChainModalProps {
  weekId: string;
  weekStart: string;
  rows: WeeklyPlanRow[];
  tasks: ScheduleTask[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}

/**
 * Spreads one book's page range over several days of a plan row. The panel is
 * a preview only until `createPageChain` writes the tasks and the chain
 * together; days already holding a task in that row cannot be selected.
 */
export function PageChainModal({
  weekId,
  weekStart,
  rows,
  tasks,
  onClose,
  onCreated,
}: PageChainModalProps) {
  const formId = useId();
  const rowFieldId = useId();
  const daysLabelId = useId();
  const bookId = useId();
  const fromPageId = useId();
  const toPageId = useId();

  const books = useLiveQuery(() => listShelfBooks(), []);

  const [selectedRowId, setSelectedRowId] = useState('');
  const [selectedDays, setSelectedDays] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [selectedBookId, setSelectedBookId] = useState('');
  const [fromPage, setFromPage] = useState('');
  const [toPage, setToPage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedRows = rows.filter(
    (row): row is WeeklyPlanRow & { id: string } => row.id !== undefined,
  );
  const loading = books === undefined;
  const selectedBook = books?.find(
    (item) => item.userBook.id === selectedBookId,
  );

  const occupiedDays = useMemo(() => {
    const occupied = new Set<number>();
    if (selectedRowId === '') {
      return occupied;
    }
    for (const task of tasks) {
      if (task.rowId === selectedRowId && !task.deletedAt) {
        occupied.add(task.dayIndex);
      }
    }
    return occupied;
  }, [tasks, selectedRowId]);

  const days = [...selectedDays].sort((left, right) => left - right);
  const from = parsePageInput(fromPage);
  const to = parsePageInput(toPage);
  const pagesTouched = fromPage.trim() !== '' || toPage.trim() !== '';
  const pageError = validateTaskPages(
    from,
    to,
    selectedBook?.totalPages ?? 0,
  );

  let chunks: PageChainChunk[] | null = null;
  let rangeError: string | null = null;
  if (pageError === null && from !== undefined && to !== undefined) {
    if (days.length >= 2) {
      try {
        chunks = splitPageRange(from, to, days.length);
      } catch (caught: unknown) {
        rangeError = messageFor(
          caught,
          'Sayfa aralığı seçilen günlere bölünemiyor.',
        );
      }
    } else if (pagesTouched) {
      rangeError = 'Zincir için en az iki gün seç.';
    }
  }

  const validationError = pagesTouched ? (pageError ?? rangeError) : null;
  const canCreate =
    !saving &&
    !loading &&
    selectedRowId !== '' &&
    days.length >= 2 &&
    selectedBook !== undefined &&
    pageError === null &&
    rangeError === null;

  function changeRow(nextRowId: string): void {
    setSelectedRowId(nextRowId);
    setError(null);
    if (nextRowId === '') {
      return;
    }
    const occupied = new Set(
      tasks
        .filter((task) => task.rowId === nextRowId && !task.deletedAt)
        .map((task) => task.dayIndex),
    );
    setSelectedDays(
      (current) => new Set([...current].filter((day) => !occupied.has(day))),
    );
  }

  function toggleDay(day: number): void {
    if (occupiedDays.has(day)) {
      return;
    }
    setError(null);
    setSelectedDays((current) => {
      const next = new Set(current);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || from === undefined || to === undefined) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createPageChain({
        weekId,
        rowId: selectedRowId,
        userBookId: selectedBookId,
        startPage: from,
        endPage: to,
        days,
      });
      onClose();
      await onCreated();
    } catch (caught: unknown) {
      console.error('Sayfa zinciri oluşturulamadı', caught);
      setError(
        messageFor(caught, 'Sayfa zinciri oluşturulamadı. Lütfen tekrar dene.'),
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Sayfa zinciri oluştur"
      onClose={() => {
        if (!saving) {
          onClose();
        }
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={!canCreate}>
            {saving ? 'Oluşturuluyor…' : 'Zinciri oluştur'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4"
      >
        <Field
          label="Satır"
          htmlFor={rowFieldId}
          hint={
            savedRows.length === 0
              ? 'Önce plana bir satır ekle.'
              : 'Zincir bu satırın günlerine dağıtılır.'
          }
        >
          <select
            id={rowFieldId}
            value={selectedRowId}
            onChange={(event) => changeRow(event.target.value)}
            disabled={saving || savedRows.length === 0}
            aria-required="true"
            className={inputClass}
          >
            <option value="">Satır seç</option>
            {savedRows.map((row, index) => (
              <option key={row.id} value={row.id}>
                {rowName(row, index)}
              </option>
            ))}
          </select>
        </Field>

        <div className="space-y-2">
          <p id={daysLabelId} className="block text-sm font-medium text-fg">
            Günler
          </p>
          <div
            role="group"
            aria-labelledby={daysLabelId}
            className="grid grid-cols-7 gap-1"
          >
            {SCHEDULE_DAYS.map((day) => {
              const occupied = occupiedDays.has(day.day);
              const checked = selectedDays.has(day.day);
              return (
                <label
                  key={day.day}
                  title={
                    occupied
                      ? `${day.label}: bu güne zaten bir görev eklenmiş.`
                      : day.label
                  }
                  className={cn(
                    'flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-lg border text-xs font-semibold transition-colors',
                    checked
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-line bg-surface text-muted hover:text-fg',
                    occupied &&
                      'cursor-not-allowed opacity-50 hover:text-muted',
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={day.label}
                    checked={checked}
                    onChange={() => toggleDay(day.day)}
                    disabled={saving || selectedRowId === '' || occupied}
                    className="sr-only"
                  />
                  {day.short}
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted">
            {days.length < 2
              ? 'En az iki gün seç.'
              : `${days.length} güne bölünecek.`}
          </p>
        </div>

        <Field
          label="Kitap ara"
          htmlFor={bookId}
          hint={
            selectedBook
              ? `Toplam ${selectedBook.totalPages} sayfa`
              : 'Rafındaki aktif kitaplardan birini ara ve seç.'
          }
        >
          <ShelfBookPicker
            id={bookId}
            books={books ?? []}
            value={selectedBookId}
            onChange={setSelectedBookId}
            disabled={loading || saving}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Başlangıç sayfası" htmlFor={fromPageId}>
            <input
              id={fromPageId}
              type="number"
              inputMode="numeric"
              min={1}
              step="any"
              value={fromPage}
              onChange={(event) => setFromPage(event.target.value)}
              disabled={loading || saving}
              className={inputClass}
            />
          </Field>
          <Field label="Bitiş sayfası" htmlFor={toPageId}>
            <input
              id={toPageId}
              type="number"
              inputMode="numeric"
              min={1}
              step="any"
              value={toPage}
              onChange={(event) => setToPage(event.target.value)}
              disabled={loading || saving}
              className={inputClass}
            />
          </Field>
        </div>

        {chunks ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-fg">Günlük dağılım</p>
            <p className="sr-only">
              {`${weekStart} haftasında ${days.length} güne dağıtılıyor.`}
            </p>
            <ul className="divide-y divide-line rounded-xl border border-line bg-canvas">
              {chunks.map((chunk, index) => {
                const day = SCHEDULE_DAYS.find(
                  (item) => item.day === days[index],
                );
                return (
                  <li
                    key={chunk.chunkIndex}
                    title={
                      day ? dayLabel(weekStart, day.day) : undefined
                    }
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span className="text-muted">{day?.label}</span>
                    <span className="font-medium tabular-nums">
                      {`${day?.short} ${chunk.fromPage}–${chunk.toPage}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {validationError ? (
          <p role="alert" className="text-sm text-danger">
            {validationError}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
