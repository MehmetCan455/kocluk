import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Pencil, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { RingProgress } from '@/components/ui/RingProgress';
import {
  deleteBookCascade,
  getBook,
  listBookTopicBooks,
  updateBook,
  type BookTopicBookRow,
} from '@/db/repositories';
import { calculateProgress } from '@/domain/calculations';
import type { Book } from '@/domain/types';
import { formatPercent } from '@/lib/format';
import { examBasePath } from '@/features/subjects/exam';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

function EditBookModal({ book, onClose }: { book: Book; onClose: () => void }) {
  const formId = useId();
  const nameId = useId();
  const publisherId = useId();
  const [name, setName] = useState(book.name);
  const [publisher, setPublisher] = useState(book.publisher ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameError = name !== '' && trimmedName === '' ? 'Kitap adı boş olamaz' : null;
  const canSave = !saving && trimmedName !== '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateBook(book.id, {
        name: trimmedName,
        publisher: publisher.trim() || undefined,
      });
      onClose();
    } catch (caught: unknown) {
      console.error('Kitap güncellenemedi', caught);
      setError(
        caught instanceof Error ? caught.message : 'Kitap güncellenemedi. Lütfen tekrar dene.',
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Kitabı düzenle"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={!canSave}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        <Field label="Kitap adı" htmlFor={nameId} error={nameError ?? undefined}>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            aria-required="true"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            className={inputClass}
          />
        </Field>
        <Field label="Yayınevi" htmlFor={publisherId} hint="İsteğe bağlı">
          <input
            id={publisherId}
            type="text"
            value={publisher}
            onChange={(event) => setPublisher(event.target.value)}
            maxLength={80}
            placeholder="Örn. Palme"
            className={inputClass}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

interface DeleteBookModalProps {
  book: Book;
  recordCount: number;
  totalTests: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function DeleteBookModal({
  book,
  recordCount,
  totalTests,
  onClose,
  onConfirm,
}: DeleteBookModalProps) {
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
        <span className="font-semibold">{book.name}</span> kitabı silinecek. Bu işlem geri
        alınamaz.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>
          {recordCount === 0
            ? 'Bu kitap hiçbir konuda kullanılmıyor.'
            : `${recordCount} konu kaydı silinecek.`}
        </li>
        <li>
          {totalTests === 0
            ? 'Bu kayıtlarda test sayısı yok.'
            : `Bu kayıtlarda toplam ${totalTests} test var.`}
        </li>
        <li>Konular, notlar, fotoğraflar ve denemeler silinmez.</li>
      </ul>
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
  const [deleting, setDeleting] = useState(false);

  const data = useLiveQuery(async () => {
    const book = await getBook(id);
    if (!book) {
      return { book: undefined, records: [] as BookTopicBookRow[] };
    }
    const records = await listBookTopicBooks(id);
    return { book, records };
  }, [id]);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Kitap yükleniyor…
      </p>
    );
  }

  const { book, records } = data;

  if (!book) {
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

  const progress = calculateProgress(records);
  const subjectNames = [...new Set(records.map((record) => record.subject.name))].join(', ');

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: 'Kitaplar', to: '/kitaplar' }, { label: book.name }]} />

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {book.publisher ?? 'Yayınevi belirtilmedi'}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{book.name}</h1>
          <p className="text-sm text-muted">
            {progress.total === 0
              ? 'Henüz test kaydı yok'
              : `${progress.solved}/${progress.total} test · ${progress.remaining} test kaldı`}
          </p>
          <p className="text-xs text-muted">
            {records.length === 0
              ? 'Henüz bir konuda kullanılmıyor'
              : `${subjectNames} · ${records.length} konu kaydı`}
          </p>
        </div>
        <RingProgress
          value={progress.percent}
          size={84}
          label={`${book.name} genel ilerlemesi`}
        >
          {formatPercent(progress.percent)}
        </RingProgress>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          aria-label={`${book.name} kitabını düzenle`}
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Düzenle
        </Button>
        <Button
          variant="secondary"
          className="text-danger hover:text-danger"
          aria-label={`${book.name} kitabını sil`}
          onClick={() => setDeleting(true)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Sil
        </Button>
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Henüz konu kaydı yok"
          description="Bu kitap henüz bir konuya eklenmedi. Konu sayfalarından test kaydı ekleyebilirsin."
          action={
            <Link
              to="/tyt"
              className="inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]"
            >
              Derslere git
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Konu kayıtları</h2>
          <ul className="space-y-3">
            {records.map((record) => {
              const rowProgress = calculateProgress([record]);
              const href = `${examBasePath(record.subject.exam)}/${record.subject.id}/${record.topic.id}`;

              return (
                <li
                  key={record.id}
                  className="rounded-2xl border border-line bg-surface p-4"
                >
                  <div className="min-w-0 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      {record.subject.exam} · {record.subject.name}
                    </p>
                    <Link
                      to={href}
                      className="inline-flex min-h-11 items-center text-base font-medium transition-colors hover:text-[var(--accent)]"
                    >
                      {record.topic.name}
                    </Link>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="tabular-nums">
                        {record.solvedTests}/{record.totalTests} test
                      </span>
                      <span className="text-muted" aria-hidden="true">
                        ·
                      </span>
                      <span className="tabular-nums text-muted">
                        {formatPercent(rowProgress.percent)}
                      </span>
                      <span className="text-muted" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-muted">
                        {rowProgress.remaining > 0
                          ? `${rowProgress.remaining} test kaldı`
                          : 'Bitti'}
                      </span>
                    </div>

                    <ProgressBar
                      value={rowProgress.percent}
                      label={`${record.topic.name} ilerlemesi`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {editing ? <EditBookModal book={book} onClose={() => setEditing(false)} /> : null}

      {deleting ? (
        <DeleteBookModal
          book={book}
          recordCount={records.length}
          totalTests={records.reduce((sum, record) => sum + record.totalTests, 0)}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await deleteBookCascade(book.id);
            navigate('/kitaplar');
          }}
        />
      ) : null}
    </div>
  );
}
