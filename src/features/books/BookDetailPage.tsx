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
  deleteActivityLog,
  deleteShelfBook,
  getShelfBook,
  listBookActivity,
  setBookPage,
  updateUserBook,
  type ShelfBook,
} from '@/db/bookRepositories';
import { listSubjects } from '@/db/repositories';
import type { ActivityLog, CatalogBook, Subject } from '@/domain/types';
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
 * A `page_set` is a manual baseline. It is a correction when it is below the
 * effective page reached immediately before it, including plan-tick
 * (`book_pages`) logs after the previous baseline. Labels are derived from the
 * log stream instead of a stored flag.
 */
function pageSetLabels(logs: ActivityLog[]): Map<string, string> {
  const chronological = logs
    .filter(
      (log) =>
        !log.deletedAt && (log.type === 'page_set' || log.type === 'book_pages'),
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );

  const labels = new Map<string, string>();
  let baseline: number | undefined;
  let pagesAfterBaseline = 0;

  for (const log of chronological) {
    if (log.type === 'book_pages') {
      pagesAfterBaseline = Math.max(pagesAfterBaseline, log.toPage ?? 0);
      continue;
    }

    const page = log.toPage ?? 0;
    const effectiveBefore =
      baseline === undefined ? pagesAfterBaseline : Math.max(baseline, pagesAfterBaseline);
    labels.set(log.id, page < effectiveBefore ? 'Düzeltme' : 'Manuel');
    baseline = page;
    pagesAfterBaseline = 0;
  }

  return labels;
}

function activityRangeLabel(log: ActivityLog): string {
  if (log.type === 'book_pages' && log.fromPage !== undefined && log.toPage !== undefined) {
    return `s. ${log.fromPage}–${log.toPage}`;
  }
  if (log.toPage !== undefined) {
    return `s. ${log.toPage}`;
  }
  return 'Kayıt';
}

function activitySourceLabel(log: ActivityLog, labels: Map<string, string>): string {
  if (log.type === 'page_set') {
    return labels.get(log.id) ?? 'Manuel';
  }
  if (log.type === 'book_pages') {
    return 'Plan görevi';
  }
  return 'Konu tekrarı';
}

interface PageUpdateFormProps {
  row: ShelfBook;
}

function PageUpdateForm({ row }: PageUpdateFormProps) {
  const inputId = useId();
  const noPagesId = useId();
  const { progress, totalPages, userBook } = row;
  const [page, setPage] = useState(String(progress.currentPage));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTotalPages = totalPages > 0;
  const trimmedPage = page.trim();
  const parsedPage = Number(trimmedPage);
  const pageInvalid =
    hasTotalPages &&
    trimmedPage !== '' &&
    (!Number.isInteger(parsedPage) || parsedPage < 0 || parsedPage > totalPages);
  const pageError = pageInvalid
    ? `Sayfa 0 ile ${totalPages} arasında bir tam sayı olmalı`
    : null;
  const canSubmit =
    !saving && hasTotalPages && trimmedPage !== '' && !pageInvalid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await setBookPage(userBook.id, parsedPage);
    } catch (caught: unknown) {
      console.error('Sayfa güncellenemedi', caught);
      setError(
        caught instanceof Error ? caught.message : 'Sayfa güncellenemedi. Lütfen tekrar dene.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Sayfa güncelle</h2>

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
          label="Şu anki sayfa"
          htmlFor={inputId}
          hint={hasTotalPages ? `0 ile ${totalPages} arasında` : undefined}
          error={pageError ?? undefined}
          className="w-full sm:max-w-56"
        >
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={0}
            max={hasTotalPages ? totalPages : undefined}
            step={1}
            value={page}
            onChange={(event) => setPage(event.target.value)}
            disabled={!hasTotalPages}
            aria-describedby={
              pageInvalid
                ? `${inputId}-error`
                : hasTotalPages
                  ? `${inputId}-hint`
                  : noPagesId
            }
            className={inputClass}
          />
        </Field>
        <Button type="submit" disabled={!canSubmit}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
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
  const labels = pageSetLabels(logs);
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
            const manual = log.type === 'page_set' && log.source === 'manual';
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
                    <span>{activitySourceLabel(log, labels)}</span>
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
      return { row: undefined, logs: [] as ActivityLog[], subjects: [] as Subject[] };
    }

    const [logs, subjects] = await Promise.all([listBookActivity(id), listSubjects()]);
    return { row, logs, subjects };
  }, [id]);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Kitap yükleniyor…
      </p>
    );
  }

  const { row, logs, subjects } = data;

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
              ? `${progress.currentPage}/${totalPages} sayfa`
              : 'Toplam sayfa belirtilmedi'}
          </p>
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

      {/* Scope by book and page so navigation cannot carry typed state over. */}
      <PageUpdateForm key={`${userBook.id}:${progress.currentPage}`} row={row} />

      <ProgressHistory
        logs={logs}
        onDelete={async (logId) => {
          await deleteActivityLog(logId);
        }}
      />

      {/* Placeholder until Task 12 loads related tasks with `listBookTasks`. */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Plan görevleri</h2>
        <EmptyState
          title="Henüz plan görevi yok"
          description="Bu kitapla ilişkili plan görevleri burada listelenecek."
        />
      </section>

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
          hasHistory={logs.length > 0}
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
