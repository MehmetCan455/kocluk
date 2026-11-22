import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { RingProgress } from '@/components/ui/RingProgress';
import {
  addBookPageRange,
  deleteActivityLog,
  deleteShelfBook,
  getShelfBook,
  listBookActivity,
  updateUserBook,
  type ShelfBook,
} from '@/db/bookRepositories';
import { listSubjects } from '@/db/repositories';
import { listBookTasks } from '@/db/scheduleRepository';
import { dayLabel, weekLabel } from '@/domain/schedule';
import type {
  ActivityLog,
  CatalogBook,
  ScheduleTask,
  Subject,
} from '@/domain/types';
import { formatPercent } from '@/lib/format';
import { BookEditModal } from './BookEditModal';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

const historyDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
});

const longDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : historyDateFormatter.format(date);
}

function formatLongDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : longDateFormatter.format(date);
}

function subjectNameFor(catalogBook: CatalogBook, subjects: Subject[]): string {
  const match =
    subjects.find(
      (subject) =>
        subject.slug === catalogBook.subjectSlug &&
        (catalogBook.exam === undefined || subject.exam === catalogBook.exam),
    ) ?? subjects.find((subject) => subject.slug === catalogBook.subjectSlug);
  return match?.name ?? 'Genel';
}

/**
 * History labels derive from the log type and source. `book_pages` entries are
 * manual or plan-task ranges; `page_set` rows are legacy position markers kept
 * for display only.
 */
function activityRangeLabel(log: ActivityLog): string {
  if (log.type === 'page_set') {
    return 'Konum (eski)';
  }
  if (log.type === 'book_pages' && log.fromPage !== undefined && log.toPage !== undefined) {
    return `s. ${log.fromPage}–${log.toPage}`;
  }
  if (log.toPage !== undefined) {
    return `s. ${log.toPage}`;
  }
  return 'Kayıt';
}

function activitySourceLabel(log: ActivityLog): string {
  if (log.type === 'page_set' || log.type === 'book_pages') {
    return log.source === 'task' ? 'Plan görevi' : 'Manuel';
  }
  return 'Konu tekrarı';
}

function bookTaskLabel(task: ScheduleTask): string {
  if (task.fromPage !== undefined && task.toPage !== undefined) {
    return `s. ${task.fromPage}–${task.toPage}`;
  }
  if (task.fromPage !== undefined) {
    return `s. ${task.fromPage}`;
  }
  return 'Sayfa aralığı belirtilmedi';
}

interface BookPlanTasksProps {
  tasks: Array<ScheduleTask & { weekStart: string }>;
}

function BookPlanTasks({ tasks }: BookPlanTasksProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Plan görevleri</h2>

      {tasks.length === 0 ? (
        <EmptyState
          title="Henüz plan görevi yok"
          description="Bu kitap için haftalık plana eklenen sayfa görevleri burada listelenir."
        />
      ) : (
        <ul aria-label="Plan görevleri" className="space-y-2">
          {tasks.map((task) => {
            const label = bookTaskLabel(task);
            const status = task.completedAt ? 'Tamamlandı' : 'Planlandı';
            const week = weekLabel(task.weekStart);
            const day = dayLabel(task.weekStart, task.dayIndex);
            return (
              <li key={task.id}>
                <Link
                  to={`/program?week=${task.weekStart}`}
                  // The aria-label must keep the week/day context and the
                  // status that the visible row shows.
                  aria-label={`${label} görevini plana aç, ${week}, ${day}, ${status}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm transition-colors hover:border-[var(--accent)]"
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-medium tabular-nums">{label}</span>
                    <span className="block text-xs font-normal text-muted">
                      {week} · {day}
                    </span>
                  </span>
                  <span
                    className={
                      task.completedAt
                        ? 'text-xs font-medium text-success'
                        : 'text-xs font-medium text-muted'
                    }
                  >
                    {status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface PageRangeFormProps {
  row: ShelfBook;
}

function PageRangeForm({ row }: PageRangeFormProps) {
  const fromId = useId();
  const toId = useId();
  const noPagesId = useId();
  const { progress, totalPages, userBook } = row;
  const nextPage = totalPages > 0 ? Math.min(progress.currentPage + 1, totalPages) : 1;
  const [fromPage, setFromPage] = useState(String(nextPage));
  const [toPage, setToPage] = useState(String(nextPage));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTotalPages = totalPages > 0;
  const trimmedFrom = fromPage.trim();
  const trimmedTo = toPage.trim();
  const parsedFrom = Number(trimmedFrom);
  const parsedTo = Number(trimmedTo);
  const filled = trimmedFrom !== '' && trimmedTo !== '';
  const valuesInvalid =
    hasTotalPages &&
    filled &&
    (!Number.isInteger(parsedFrom) ||
      !Number.isInteger(parsedTo) ||
      parsedFrom < 1 ||
      parsedTo > totalPages);
  const orderInvalid = hasTotalPages && filled && !valuesInvalid && parsedFrom > parsedTo;
  const rangeError = valuesInvalid
    ? `Sayfa 1 ile ${totalPages} arasında bir tam sayı olmalı`
    : orderInvalid
      ? 'Başlangıç sayfası bitiş sayfasından büyük olamaz'
      : null;
  const canSubmit = !saving && hasTotalPages && filled && !valuesInvalid && !orderInvalid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await addBookPageRange(userBook.id, parsedFrom, parsedTo);
    } catch (caught: unknown) {
      console.error('Sayfa aralığı eklenemedi', caught);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Sayfa aralığı eklenemedi. Lütfen tekrar dene.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Sayfa aralığı ekle</h2>

      {hasTotalPages ? null : (
        <p
          id={noPagesId}
          className="rounded-xl border border-line bg-surface p-4 text-sm text-muted"
        >
          İlerleme için sayfa sayısı gerekli. Düzenle.
        </p>
      )}

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-wrap items-end gap-3"
      >
        <Field
          label="Başlangıç sayfası"
          htmlFor={fromId}
          hint={hasTotalPages ? `1 ile ${totalPages} arasında` : undefined}
          error={rangeError ?? undefined}
          className="w-full sm:max-w-48"
        >
          <input
            id={fromId}
            type="number"
            inputMode="numeric"
            min={1}
            max={hasTotalPages ? totalPages : undefined}
            step={1}
            value={fromPage}
            onChange={(event) => setFromPage(event.target.value)}
            disabled={!hasTotalPages}
            aria-invalid={rangeError ? true : undefined}
            aria-describedby={
              rangeError
                ? `${fromId}-error`
                : hasTotalPages
                  ? `${fromId}-hint`
                  : noPagesId
            }
            className={inputClass}
          />
        </Field>
        <Field
          label="Bitiş sayfası"
          htmlFor={toId}
          hint={hasTotalPages ? `1 ile ${totalPages} arasında` : undefined}
          className="w-full sm:max-w-48"
        >
          <input
            id={toId}
            type="number"
            inputMode="numeric"
            min={1}
            max={hasTotalPages ? totalPages : undefined}
            step={1}
            value={toPage}
            onChange={(event) => setToPage(event.target.value)}
            disabled={!hasTotalPages}
            aria-invalid={rangeError ? true : undefined}
            aria-describedby={
              rangeError
                ? `${fromId}-error`
                : hasTotalPages
                  ? `${toId}-hint`
                  : noPagesId
            }
            className={inputClass}
          />
        </Field>
        <Button type="submit" disabled={!canSubmit}>
          {saving ? 'Ekleniyor…' : 'Sayfa aralığı ekle'}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

interface ProgressHistoryProps {
  logs: ActivityLog[];
  onDelete: (id: string) => Promise<void>;
}

function ProgressHistory({ logs, onDelete }: ProgressHistoryProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (deletingId !== null) {
      return;
    }

    setDeletingId(id);
    setError(null);
    try {
      await onDelete(id);
    } catch (caught: unknown) {
      console.error('Kayıt silinemedi', caught);
      setError('Kayıt silinemedi. Lütfen tekrar dene.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">İlerleme geçmişi</h2>

      {logs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
          Henüz ilerleme kaydı yok.
        </p>
      ) : (
        <ul aria-label="İlerleme geçmişi" className="space-y-2">
          {logs.map((log) => {
            const manual =
              log.source === 'manual' &&
              (log.type === 'book_pages' || log.type === 'page_set');
            const range = activityRangeLabel(log);

            return (
              <li
                key={log.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium tabular-nums">{range}</p>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted">
                    <time dateTime={log.createdAt}>{formatHistoryDate(log.createdAt)}</time>
                    <span aria-hidden="true">·</span>
                    <span>{activitySourceLabel(log)}</span>
                  </p>
                </div>
                {manual ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-danger hover:text-danger"
                    aria-label={`${range} kaydını sil`}
                    onClick={() => void handleDelete(log.id)}
                    disabled={deletingId !== null}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Sil
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

interface ArchiveBookModalProps {
  title: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function ArchiveBookModal({ title, onClose, onConfirm }: ArchiveBookModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught: unknown) {
      console.error('Kitap arşivlenemedi', caught);
      setError('Kitap arşivlenemedi. Lütfen tekrar dene.');
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Kitabı arşivle"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={saving}>
            {saving ? 'Arşivleniyor…' : 'Arşivle'}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        <span className="font-semibold">{title}</span> kitabı arşive taşınacak.
      </p>
      <p className="text-sm text-muted">
        Kitap aktif raftan gizlenir; ilerleme geçmişi korunur ve Arşiv filtresinden
        ulaşabilirsin.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

interface DeleteBookModalProps {
  title: string;
  hasHistory: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function DeleteBookModal({ title, hasHistory, onClose, onConfirm }: DeleteBookModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (deleting) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught: unknown) {
      console.error('Kitap silinemedi', caught);
      setError('Kitap silinemedi. Lütfen tekrar dene.');
      setDeleting(false);
    }
  }

  return (
    <Modal
      open
      title="Kitabı sil"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            Vazgeç
          </Button>
          <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? 'Siliniyor…' : 'Sil'}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        <span className="font-semibold">{title}</span> kitabı silinecek. Bu işlem geri
        alınamaz.
      </p>
      <p className="text-sm text-muted">
        İlerleme geçmişi ve bu kitaba bağlı plan görevleri de kaldırılır.
      </p>
      {hasHistory ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          Bu kitapta okuma geçmişi var. Silmeden önce arşivlemen önerilir.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

export function BookDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const row = await getShelfBook(id);
    if (!row) {
      return {
        row: undefined,
        logs: [] as ActivityLog[],
        subjects: [] as Subject[],
        tasks: [] as Array<ScheduleTask & { weekStart: string }>,
      };
    }

    const [logs, subjects, tasks] = await Promise.all([
      listBookActivity(id),
      listSubjects(),
      listBookTasks(id),
    ]);
    return { row, logs, subjects, tasks };
  }, [id]);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Kitap yükleniyor…
      </p>
    );
  }

  const { row, logs, subjects, tasks } = data;

  if (!row) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Kitap bulunamadı"
        description="Bu kitap silinmiş ya da taşınmış olabilir."
        action={
          <Link
            to="/kitaplar"
            className="inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]"
          >
            Kitaplara dön
          </Link>
        }
      />
    );
  }

  const { catalogBook, progress, totalPages, userBook } = row;
  const title = catalogBook.title;
  const subjectLabel = subjectNameFor(catalogBook, subjects);
  const latestLog = logs[0];
  const archived = userBook.status === 'archived';

  async function handleUnarchive() {
    setActionError(null);
    try {
      await updateUserBook(userBook.id, { status: 'active' });
    } catch (caught: unknown) {
      console.error('Kitap arşivden çıkarılamadı', caught);
      setActionError('Kitap arşivden çıkarılamadı. Lütfen tekrar dene.');
    }
  }

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: 'Kitaplar', to: '/kitaplar' }, { label: title }]} />

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {catalogBook.publisher ?? 'Yayınevi belirtilmedi'} · {subjectLabel}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {archived ? (
              <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-muted">
                Arşivde
              </span>
            ) : null}
          </div>
          <p className="text-sm font-medium tabular-nums">
            {progress.hasTotalPages
              ? `${progress.readPages}/${totalPages} sayfa okundu`
              : 'Toplam sayfa belirtilmedi'}
          </p>
          {progress.currentPage > 0 ? (
            <p className="text-xs tabular-nums text-muted">
              Son sayfa: {progress.currentPage}
            </p>
          ) : null}
          <p className="text-sm text-muted">
            {progress.hasTotalPages
              ? progress.done
                ? 'Bitti'
                : `${progress.remaining} sayfa kaldı`
              : 'Sayfa sayısını gir'}
          </p>
          <p className="text-xs text-muted">
            {latestLog
              ? `Son okuma: ${formatLongDate(latestLog.createdAt)}`
              : 'Henüz okuma kaydı yok'}
          </p>
          {userBook.note ? (
            <div className="max-w-prose space-y-0.5 rounded-xl border border-line bg-surface px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Kitap notu
              </p>
              <p className="whitespace-pre-wrap text-sm">{userBook.note}</p>
            </div>
          ) : null}
        </div>
        {progress.hasTotalPages ? (
          <RingProgress
            value={progress.percent}
            size={84}
            label={`${title} ilerlemesi`}
          >
            {formatPercent(progress.percent)}
          </RingProgress>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          aria-label={`${title} kitabını düzenle`}
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Düzenle
        </Button>
        {archived ? (
          <Button
            variant="secondary"
            aria-label={`${title} kitabını arşivden çıkar`}
            onClick={() => void handleUnarchive()}
          >
            <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
            Arşivden çıkar
          </Button>
        ) : (
          <Button
            variant="secondary"
            aria-label={`${title} kitabını arşivle`}
            onClick={() => setArchiving(true)}
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
            Arşivle
          </Button>
        )}
        <Button
          variant="secondary"
          className="text-danger hover:text-danger"
          aria-label={`${title} kitabını sil`}
          onClick={() => setDeleting(true)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Sil
        </Button>
      </div>

      {actionError ? (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      {/* Scope by book and read pages so navigation cannot carry typed state over. */}
      <PageRangeForm key={`${userBook.id}:${progress.readPages}`} row={row} />

      <ProgressHistory
        logs={logs}
        onDelete={async (logId) => {
          await deleteActivityLog(logId);
        }}
      />

      <BookPlanTasks tasks={tasks} />

      {editing ? (
        <BookEditModal
          row={row}
          subjects={subjects}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {archiving ? (
        <ArchiveBookModal
          title={title}
          onClose={() => setArchiving(false)}
          onConfirm={async () => {
            await updateUserBook(userBook.id, { status: 'archived' });
            navigate('/kitaplar');
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteBookModal
          title={title}
          hasHistory={logs.length > 0 || tasks.length > 0}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await deleteShelfBook(userBook.id);
            navigate('/kitaplar');
          }}
        />
      ) : null}
    </div>
  );
}
