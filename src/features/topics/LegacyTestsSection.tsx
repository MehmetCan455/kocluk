import { useLiveQuery } from 'dexie-react-hooks';
import { EmptyState } from '@/components/ui/EmptyState';
import { listBooks, listTopicBooks } from '@/db/repositories';
import type { Book, TopicBook } from '@/domain/types';
import { buildBookLabels } from '@/features/books/bookLabels';

export interface LegacyTestsSectionProps {
  topicId: string;
}

interface LegacyRow {
  record: TopicBook;
  book: Book | undefined;
}

function sortRecords(records: TopicBook[]): TopicBook[] {
  return [...records].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

/**
 * Read-only archive of the old per-book test counts. These rows are kept for
 * history only: they no longer feed any progress calculation and cannot be
 * edited or deleted from the topic page.
 */
export function LegacyTestsSection({ topicId }: LegacyTestsSectionProps) {
  const data = useLiveQuery(async () => {
    const [records, books] = await Promise.all([listTopicBooks(topicId), listBooks()]);
    return { records: sortRecords(records), books };
  }, [topicId]);

  const bookLabels = data ? buildBookLabels(data.books) : new Map<string, string>();
  const rows: LegacyRow[] = data
    ? data.records.map((record) => ({
        record,
        book: data.books.find((book) => book.id === record.bookId),
      }))
    : [];

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Eski test kayıtları</h2>
        <p className="text-sm text-muted">
          Salt okunur arşiv. Bu kayıtlar konu durumunu ve ilerlemeyi etkilemez.
        </p>
      </div>

      {!data ? (
        <p role="status" className="py-8 text-center text-sm text-muted">
          Eski test kayıtları yükleniyor…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Eski test kaydı yok"
          description="Daha önce eklenen kitap ve test kayıtları burada salt okunur olarak görünür."
        />
      ) : (
        <ul aria-label="Eski test kayıtları" className="space-y-2">
          {rows.map((row) => {
            const bookName = row.book
              ? (bookLabels.get(row.book.id) ?? row.book.name)
              : 'Silinmiş kitap';

            return (
              <li
                key={row.record.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{bookName}</p>
                  {row.book?.publisher ? (
                    <p className="text-xs text-muted">{row.book.publisher}</p>
                  ) : null}
                </div>
                <p className="text-sm tabular-nums">
                  {row.record.solvedTests}/{row.record.totalTests} test
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
