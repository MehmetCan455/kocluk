import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Search } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { listBooks, listBookTopicBooks } from '@/db/repositories';
import { calculateProgress } from '@/domain/calculations';
import type { Book, ExamType, Progress, Subject, Topic, TopicBook } from '@/domain/types';
import { formatPercent } from '@/lib/format';
import { buildBookLabels } from './bookLabels';

type BookUsageRecord = TopicBook & { topic: Topic; subject: Subject };

interface BookRow {
  book: Book;
  records: BookUsageRecord[];
  progress: Progress;
  subjects: Subject[];
}

const EXAM_ORDER: Record<ExamType, number> = { TYT: 0, AYT: 1 };

function compareSubjects(left: Subject, right: Subject): number {
  return (
    EXAM_ORDER[left.exam] - EXAM_ORDER[right.exam] ||
    left.order - right.order ||
    left.name.localeCompare(right.name, 'tr-TR') ||
    left.id.localeCompare(right.id)
  );
}

function uniqueSubjects(records: BookUsageRecord[]): Subject[] {
  const byId = new Map<string, Subject>();
  for (const record of records) {
    byId.set(record.subject.id, record.subject);
  }
  return [...byId.values()].sort(compareSubjects);
}

function subjectSummary(subjects: Subject[]): string {
  if (subjects.length === 0) {
    return 'Henüz kullanılmadı';
  }

  const nameCounts = new Map<string, number>();
  for (const subject of subjects) {
    const key = subject.name.trim().toLocaleLowerCase('tr-TR');
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return subjects
    .map((subject) => {
      const key = subject.name.trim().toLocaleLowerCase('tr-TR');
      return (nameCounts.get(key) ?? 0) > 1 ? `${subject.exam} ${subject.name}` : subject.name;
    })
    .join(' · ');
}

function matchesQuery(row: BookRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('tr-TR');
  if (!needle) {
    return true;
  }
  const haystack = [
    row.book.name,
    row.book.publisher ?? '',
    ...row.subjects.map((subject) => subject.name),
  ]
    .join(' ')
    .toLocaleLowerCase('tr-TR');
  return haystack.includes(needle);
}

export function BooksPage() {
  const searchId = useId();
  const [query, setQuery] = useState('');

  const rows = useLiveQuery(async () => {
    const books = await listBooks();
    return Promise.all(
      books.map(async (book): Promise<BookRow> => {
        const records = await listBookTopicBooks(book.id);
        return {
          book,
          records,
          progress: calculateProgress(records),
          subjects: uniqueSubjects(records),
        };
      }),
    );
  }, []);

  if (!rows) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Kitaplar yükleniyor…
      </p>
    );
  }

  const labels = buildBookLabels(rows.map((row) => row.book));
  const visibleRows = rows.filter((row) => matchesQuery(row, query));

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Kitaplar</h1>
        <p className="text-sm text-muted">
          Kitaplarını, kullanıldıkları dersleri ve toplam test ilerlemeni buradan inceleyebilirsin.
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Henüz kitap yok"
          description="Konu sayfalarından kitap ve test ekleyerek kitaplığını oluşturabilirsin."
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
        <>
          <Field label="Kitap ara" htmlFor={searchId}>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Kitap adı, yayınevi veya ders"
                maxLength={120}
                className="min-h-11 w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]"
              />
            </div>
          </Field>

          {visibleRows.length === 0 ? (
            <EmptyState
              title="Aramanla eşleşen kitap yok"
              description="Farklı bir kitap adı, yayınevi veya ders dene."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visibleRows.map((row) => {
                const label = labels.get(row.book.id) ?? row.book.name;
                return (
                  <li key={row.book.id}>
                    <Link
                      to={`/kitaplar/${row.book.id}`}
                      aria-label={label}
                      className="block rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-base font-semibold">{row.book.name}</p>
                          {row.book.publisher ? (
                            <p className="truncate text-xs text-muted">{row.book.publisher}</p>
                          ) : null}
                          <p className="text-xs text-muted">{subjectSummary(row.subjects)}</p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--accent)]">
                          {formatPercent(row.progress.percent)}
                        </span>
                      </div>

                      <div className="mt-3 space-y-2">
                        <ProgressBar
                          value={row.progress.percent}
                          label={`${label} ilerlemesi`}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
                          <span className="tabular-nums">
                            {row.progress.total === 0
                              ? 'Henüz test kaydı yok'
                              : `${row.progress.solved}/${row.progress.total} test`}
                          </span>
                          {row.progress.total > 0 ? (
                            <span className="text-muted">
                              {row.progress.remaining > 0
                                ? `${row.progress.remaining} test kaldı`
                                : 'Bitti'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
