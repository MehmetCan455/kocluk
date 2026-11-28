import { useId, useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { listShelfBooks } from '@/db/bookRepositories';
import { createPageChain } from '@/db/pageChainRepository';
import {
  balancedChunkSizes,
  chunksFromSizes,
  type PageChainChunk,
} from '@/domain/pageChain';
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

/** A daily page count is a positive integer, never a blank or a decimal. */
function parseDailySize(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
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
  const occupiedHintId = useId();
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
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A manual daily split survives only while the range and days stay the
  // same; any change to the distribution key falls back to the balanced draft.
  const [distributionDraft, setDistributionDraft] = useState<{
    key: string;
    values: string[];
  } | null>(null);

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
  let balancedSizes: string[] | null = null;
  if (pageError === null && from !== undefined && to !== undefined) {
    if (days.length >= 2) {
      try {
        balancedSizes = balancedChunkSizes(from, to, days.length).map(String);
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

  const distributionKey = `${fromPage.trim()}:${toPage.trim()}:${days.join(',')}`;
  const draft =
    distributionDraft?.key === distributionKey ? distributionDraft : null;
  const sizeValues = balancedSizes === null ? null : (draft?.values ?? balancedSizes);
  const lastDay =
    days.length >= 2
      ? SCHEDULE_DAYS.find((day) => day.day === days[days.length - 1])
      : undefined;

  let distributionSizes: number[] | null = null;
  let lastSize: number | null = null;
  let distributionError: string | null = null;
  if (
    sizeValues !== null &&
    from !== undefined &&
    to !== undefined &&
    pageError === null &&
    rangeError === null
  ) {
    const nonLastSizes: number[] = [];
    let invalidEntry = false;
    for (let index = 0; index < days.length - 1; index += 1) {
      const size = parseDailySize(sizeValues[index] ?? '');
      if (size === null) {
        invalidEntry = true;
        break;
      }
      nonLastSizes.push(size);
    }
    if (invalidEntry) {
      distributionError = 'Her gün için en az 1 sayfa gir.';
    } else {
      const last =
        to - from + 1 - nonLastSizes.reduce((sum, size) => sum + size, 0);
      if (last < 1) {
        distributionError = 'Günlük sayfa adetleri toplam sayfayı aşamaz.';
      } else {
        lastSize = last;
        distributionSizes = [...nonLastSizes, last];
        chunks = chunksFromSizes(from, distributionSizes);
      }
    }
  }

  const validationError = pagesTouched
    ? (pageError ?? rangeError ?? distributionError)
    : null;
  const canCreate =
    !saving &&
    !created &&
    !loading &&
    selectedRowId !== '' &&
    days.length >= 2 &&
    selectedBook !== undefined &&
    pageError === null &&
    rangeError === null &&
    distributionSizes !== null;

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

  /** Editing any day switches the whole preview to a manual split. */
  function changeDailySize(index: number, value: string): void {
    if (sizeValues === null) {
      return;
    }
    const next = [...sizeValues];
    next[index] = value;
    setDistributionDraft({ key: distributionKey, values: next });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !canCreate ||
      from === undefined ||
      to === undefined ||
      distributionSizes === null
    ) {
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
        chunkSizes: distributionSizes,
      });
    } catch (caught: unknown) {
      console.error('Sayfa zinciri oluşturulamadı', caught);
      setError(
        messageFor(caught, 'Sayfa zinciri oluşturulamadı. Lütfen tekrar dene.'),
      );
      setSaving(false);
      return;
    }

    // The chain is committed. Wait for the plan refresh before closing so a
    // failed refresh is surfaced instead of leaving a silent stale plan; the
    // created state keeps the form from submitting the same chain twice.
    setCreated(true);
    try {
      await onCreated();
      onClose();
    } catch (caught: unknown) {
      setError(
        messageFor(
          caught,
          'Zincir oluşturuldu ancak plan yenilenemedi. Sayfayı yenile.',
        ),
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
        created ? (
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Kapat
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Vazgeç
            </Button>
            <Button type="submit" form={formId} disabled={!canCreate}>
              {saving ? 'Oluşturuluyor…' : 'Zinciri oluştur'}
            </Button>
          </>
        )
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
                    aria-describedby={occupied ? occupiedHintId : undefined}
                    checked={checked}
                    onChange={() => toggleDay(day.day)}
                    disabled={saving || selectedRowId === '' || occupied}
                    className="sr-only"
                  />
                  {day.short}
                  {occupied ? (
                    <span className="text-[10px] font-normal">dolu</span>
                  ) : null}
                </label>
              );
            })}
          </div>
          {occupiedDays.size > 0 ? (
            <p id={occupiedHintId} className="text-xs text-muted">
              Dolu günler seçilemez: bu güne zaten bir görev eklenmiş.
            </p>
          ) : null}
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
            emptyMessage={
              <>
                Önce{' '}
                <Link
                  to="/kitaplar"
                  className="font-semibold text-[var(--accent)] underline"
                >
                  Kitaplar
                </Link>{' '}
                sayfasından rafına kitap ekle.
              </>
            }
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

        {sizeValues !== null ? (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-fg">Günlük dağılım</p>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setDistributionDraft(null)}
                disabled={saving}
              >
                Dengeli dağıt
              </Button>
            </div>
            <p className="sr-only">
              {`${weekStart} haftasında ${days.length} güne dağıtılıyor.`}
            </p>
            <ul className="divide-y divide-line rounded-xl border border-line bg-canvas">
              {days.map((dayIndex, index) => {
                const day = SCHEDULE_DAYS.find(
                  (item) => item.day === dayIndex,
                );
                const chunk = chunks?.[index];
                const editable = index < days.length - 1;
                return (
                  <li
                    key={dayIndex}
                    title={
                      day ? dayLabel(weekStart, day.day) : undefined
                    }
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="text-muted">{day?.label}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      {editable ? (
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          aria-label={`${day?.label} sayfa sayısı`}
                          value={sizeValues[index] ?? ''}
                          onChange={(event) =>
                            changeDailySize(index, event.target.value)
                          }
                          disabled={saving}
                          className="min-h-11 w-16 rounded-xl border border-line bg-canvas px-2 py-1 text-right text-sm text-fg focus:border-[var(--accent)]"
                        />
                      ) : null}
                      {chunk ? (
                        <>
                          <span className="font-medium">
                            {`${day?.short} ${chunk.fromPage}–${chunk.toPage}`}
                          </span>
                          <span className="text-xs text-muted">
                            {`${chunk.toPage - chunk.fromPage + 1} sayfa`}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {chunks ? (
              <p className="text-xs text-muted tabular-nums">
                {`Toplam ${chunks.reduce(
                  (sum, chunk) => sum + (chunk.toPage - chunk.fromPage + 1),
                  0,
                )} sayfa · ${days.length} gün`}
              </p>
            ) : null}
            {lastDay && lastSize !== null ? (
              <p className="text-xs text-muted tabular-nums">
                {`${lastDay.label} sayfa sayısı: ${lastSize}`}
              </p>
            ) : null}
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
