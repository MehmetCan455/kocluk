import { useId, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { listShelfBooks } from '@/db/bookRepositories';
import { listAllTopics, listSubjects } from '@/db/repositories';
import {
  addTask,
  updateTask,
  type CreateScheduleTaskInput,
} from '@/db/scheduleRepository';
import type { ScheduleTask, ScheduleTaskType } from '@/domain/types';
import { ShelfBookPicker } from './ShelfBookPicker';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

const TASK_TYPES: ReadonlyArray<{ value: ScheduleTaskType; label: string }> = [
  { value: 'book', label: 'Kitap sayfası' },
  { value: 'topic', label: 'Konu tekrarı' },
  { value: 'free', label: 'Serbest görev' },
];

/**
 * Blank number inputs are `undefined`, never `NaN`. `Number` keeps decimals
 * intact so the repository can reject them explicitly instead of `parseInt`
 * silently truncating 12.5 to 12.
 */
function parsePageInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ScheduleTaskModalProps {
  weekId: string;
  rowId: string;
  dayIndex: number;
  task?: ScheduleTask;
  /** The edited task belongs to a page chain, so saving dissolves it. */
  chain?: boolean;
  /** Only edits get a delete action; the parent owns the confirmation. */
  onDelete?: () => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function ScheduleTaskModal({
  weekId,
  rowId,
  dayIndex,
  task,
  chain = false,
  onDelete,
  onClose,
  onSaved,
}: ScheduleTaskModalProps) {
  const typeGroupLabelId = useId();
  const formId = useId();
  const bookId = useId();
  const fromPageId = useId();
  const toPageId = useId();
  const topicId = useId();
  const titleId = useId();

  const books = useLiveQuery(() => listShelfBooks(), []);
  const subjects = useLiveQuery(() => listSubjects(), []);
  const topics = useLiveQuery(() => listAllTopics(), []);

  const [type, setType] = useState<ScheduleTaskType>(task?.type ?? 'book');
  const [selectedBookId, setSelectedBookId] = useState(task?.userBookId ?? '');
  const [fromPage, setFromPage] = useState(
    task?.fromPage === undefined ? '' : String(task.fromPage),
  );
  const [toPage, setToPage] = useState(
    task?.toPage === undefined ? '' : String(task.toPage),
  );
  const [selectedTopicId, setSelectedTopicId] = useState(task?.topicId ?? '');
  const [title, setTitle] = useState(task?.title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading =
    books === undefined || subjects === undefined || topics === undefined;
  const selectedBook = books?.find(
    (item) => item.userBook.id === selectedBookId,
  );
  const trimmedTitle = title.trim();
  const canSave =
    !saving &&
    !loading &&
    (type === 'book'
      ? selectedBookId !== '' && selectedBook !== undefined
      : type === 'topic'
        ? selectedTopicId !== ''
        : trimmedTitle !== '');

  function changeType(next: ScheduleTaskType): void {
    if (next === type) {
      return;
    }
    setType(next);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const base = { weekId, rowId, dayIndex };
      let input: CreateScheduleTaskInput;
      if (type === 'book') {
        input = {
          ...base,
          type: 'book',
          userBookId: selectedBookId,
          fromPage: parsePageInput(fromPage),
          toPage: parsePageInput(toPage),
          title: trimmedTitle,
        };
      } else if (type === 'topic') {
        input = { ...base, type: 'topic', topicId: selectedTopicId };
      } else {
        input = { ...base, type: 'free', title: trimmedTitle };
      }

      if (task) {
        await updateTask(task.id, input);
      } else {
        await addTask(input);
      }
      await onSaved();
    } catch (caught: unknown) {
      console.error('Görev kaydedilemedi', caught);
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Görev kaydedilemedi. Lütfen tekrar dene.',
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={task ? 'Görevi düzenle' : 'Görev ekle'}
      onClose={onClose}
      footer={
        <>
          {task && onDelete ? (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={onDelete}
              disabled={saving}
            >
              Görevi sil
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={!canSave}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      {chain ? (
        <p className="text-sm text-warning">
          Bu görev bir sayfa zincirinin parçası. Düzenlersen zincir çözülür.
        </p>
      ) : null}
      <form
        id={formId}
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4"
      >
        <div className="space-y-2">
          <p
            id={typeGroupLabelId}
            className="block text-sm font-medium text-fg"
          >
            Görev türü
          </p>
          <div
            role="group"
            aria-labelledby={typeGroupLabelId}
            className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-raised p-1"
          >
            {TASK_TYPES.map((option) => {
              const selected = option.value === type;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => changeType(option.value)}
                  className={cn(
                    'min-h-11 rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                    selected
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-muted hover:text-fg',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <p role="status" className="text-sm text-muted">
            Görev formu yükleniyor…
          </p>
        ) : null}

        {type === 'book' ? (
          <>
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
                disabled={loading}
              />
              {!loading &&
              selectedBookId !== '' &&
              selectedBook === undefined &&
              (books?.length ?? 0) === 0 ? (
                // The picker short-circuits to its empty-shelf message, so an
                // orphaned task book needs this warning here.
                <p role="status" className="text-xs text-danger">
                  Seçili kitap rafında bulunamadı.
                </p>
              ) : null}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Başlangıç sayfası" htmlFor={fromPageId}>
                <input
                  id={fromPageId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  // The repository rejects decimals with a Turkish message;
                  // `step={1}` would let the browser block submit silently.
                  step="any"
                  value={fromPage}
                  onChange={(event) => setFromPage(event.target.value)}
                  disabled={loading}
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
                  disabled={loading}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field
              label="Konu"
              htmlFor={titleId}
              hint="İsteğe bağlı; çipte ikinci satırda görünür. Boşsa satır etiketi kullanılır."
            >
              <input
                id={titleId}
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={80}
                autoComplete="off"
                disabled={loading}
                className={inputClass}
              />
            </Field>
          </>
        ) : null}

        {type === 'topic' ? (
          <Field
            label="Konu"
            htmlFor={topicId}
            hint="Görev tiklenince yalnızca tekrar kaydı oluşur."
          >
            <select
              id={topicId}
              value={selectedTopicId}
              onChange={(event) => setSelectedTopicId(event.target.value)}
              disabled={loading}
              aria-required="true"
              className={inputClass}
            >
              <option value="">Konu seç</option>
              {(subjects ?? []).map((subject) => {
                const subjectTopics = (topics ?? [])
                  .filter((topic) => topic.subjectId === subject.id)
                  .sort((left, right) => left.order - right.order);
                if (subjectTopics.length === 0) {
                  return null;
                }
                return (
                  <optgroup
                    key={subject.id}
                    label={`${subject.name} (${subject.exam})`}
                  >
                    {subjectTopics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>
        ) : null}

        {type === 'free' ? (
          <Field
            label="Görev adı"
            htmlFor={titleId}
            hint="Örn. Deneme çözümü, tekrar planı"
          >
            <input
              id={titleId}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              autoComplete="off"
              disabled={loading}
              aria-required="true"
              className={inputClass}
            />
          </Field>
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
