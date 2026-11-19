import { useState } from 'react';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { deleteTopicBook } from '@/db/repositories';
import { calculateProgress } from '@/domain/calculations';
import type { Book, TopicBook } from '@/domain/types';
import { formatPercent } from '@/lib/format';
import { TopicBookForm } from './TopicBookForm';

export interface TestsTabProps {
  topicId: string;
  records: TopicBook[];
  books: Book[];
}

interface TestRow {
  record: TopicBook;
  book: Book | undefined;
}

function sortRows(records: TopicBook[]): TopicBook[] {
  return [...records].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function TestsTab({ topicId, records, books }: TestsTabProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TestRow | null>(null);
  const [deleting, setDeleting] = useState<TestRow | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const progress = calculateProgress(records);
  const rows: TestRow[] = sortRows(records).map((record) => ({
    record,
    book: books.find((book) => book.id === record.bookId),
  }));

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  function openDelete(row: TestRow) {
    setDeleteError(null);
    setDeleting(row);
  }

  async function confirmDelete() {
    if (!deleting || deletingBusy) {
      return;
    }

    setDeletingBusy(true);
    setDeleteError(null);
    try {
      await deleteTopicBook(deleting.record.id);
      setDeleting(null);
    } catch (caught: unknown) {
      console.error('Test kaydı silinemedi', caught);
      setDeleteError('Test kaydı silinemedi. Lütfen tekrar dene.');
    } finally {
      setDeletingBusy(false);
    }
  }

  const deletingName = deleting ? (deleting.book?.name ?? 'Silinmiş kitap') : '';

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Henüz test eklenmedi"
          description="Bu konuya ait kitap ve test kayıtlarını buradan ekleyebilirsin."
          action={<Button onClick={() => setFormOpen(true)}>Kitap / test ekle</Button>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">Toplam ilerleme</p>
              <ProgressBar value={progress.percent} label="Toplam test ilerlemesi" />
            </div>
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Kitap / test ekle
            </Button>
          </div>

          <ul className="space-y-3">
            {rows.map((row) => {
              const rowProgress = calculateProgress([row.record]);
              const bookName = row.book?.name ?? 'Silinmiş kitap';
              return (
                <li
                  key={row.record.id}
                  className="rounded-2xl border border-line bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-base font-medium">{bookName}</p>
                      {row.book?.publisher ? (
                        <p className="text-xs text-muted">{row.book.publisher}</p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="tabular-nums">
                          {row.record.solvedTests}/{row.record.totalTests} test
                        </span>
                        <span className="text-muted" aria-hidden="true">
                          ·
                        </span>
                        <span className="tabular-nums text-muted">
                          {formatPercent(rowProgress.percent)}
                        </span>
                        {rowProgress.remaining > 0 ? (
                          <>
                            <span className="text-muted" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-muted">
                              {rowProgress.remaining} test kaldı
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${bookName} kaydını düzenle`}
                        onClick={() => setEditing(row)}
                        className="h-11 w-11 px-0"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${bookName} kaydını sil`}
                        onClick={() => openDelete(row)}
                        className="h-11 w-11 px-0 text-danger hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {formOpen || editing ? (
        <TopicBookForm
          topicId={topicId}
          books={books}
          initial={editing ? { record: editing.record, bookName: editing.book?.name ?? 'Silinmiş kitap' } : undefined}
          onClose={closeForm}
        />
      ) : null}

      {deleting ? (
        <Modal
          open
          title="Test kaydını sil"
          onClose={() => {
            if (!deletingBusy) {
              setDeleting(null);
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setDeleting(null)}
                disabled={deletingBusy}
              >
                Vazgeç
              </Button>
              <Button
                variant="danger"
                onClick={() => void confirmDelete()}
                disabled={deletingBusy}
              >
                {deletingBusy ? 'Siliniyor…' : 'Sil'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            <span className="font-semibold">{deletingName}</span> için{' '}
            {deleting.record.totalTests} testlik kayıt silinecek. Kitap, diğer konularda
            kullanılmaya devam eder.
          </p>
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
