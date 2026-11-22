import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, Search } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { listShelfBooks, type ShelfBook } from '@/db/bookRepositories';
import { listSubjects } from '@/db/repositories';
import type { CatalogBook, Subject } from '@/domain/types';
import { formatPercent } from '@/lib/format';
import { BookCatalogModal } from './BookCatalogModal';

type ShelfFilter = 'active' | 'done' | 'archived';

const FILTERS: ReadonlyArray<{ id: ShelfFilter; label: string }> = [
  { id: 'active', label: 'Aktif' },
  { id: 'done', label: 'Bitenler' },
  { id: 'archived', label: 'Arşiv' },
];

function isArchived(row: ShelfBook): boolean {
  return row.userBook.status === 'archived';
}

/**
 * `progress.done` is the source of truth for the Bitenler filter: a re-added
 * 100% book can still carry `active` until the next page write.
 */
function matchesFilter(row: ShelfBook, filter: ShelfFilter): boolean {
  if (filter === 'archived') {
    return isArchived(row);
  }
  if (isArchived(row)) {
    return false;
  }
  return filter === 'done' ? row.progress.done : !row.progress.done;
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

function matchesQuery(row: ShelfBook, subjectLabel: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('tr-TR');
  if (!needle) {
    return true;
  }
  const haystack = [row.catalogBook.title, row.catalogBook.publisher ?? '', subjectLabel]
    .join(' ')
    .toLocaleLowerCase('tr-TR');
  return haystack.includes(needle);
}

function ShelfBookCard({ row, subjectLabel }: { row: ShelfBook; subjectLabel: string }) {
  const { catalogBook, progress, totalPages, userBook } = row;
  const hasTotalPages = totalPages > 0;
  const ariaLabel = `${catalogBook.title}${
    catalogBook.publisher ? ` (${catalogBook.publisher})` : ''
  } kitabı`;

  return (
    <li>
      <Link
        to={`/kitaplar/${userBook.id}`}
        aria-label={ariaLabel}
        className="block rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-base font-semibold">{catalogBook.title}</p>
            {catalogBook.publisher ? (
              <p className="truncate text-xs text-muted">{catalogBook.publisher}</p>
            ) : null}
            <p className="text-xs text-muted">{subjectLabel}</p>
          </div>
          {hasTotalPages ? (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--accent)]">
              {formatPercent(progress.percent)}
            </span>
          ) : (
            <span className="shrink-0 text-xs font-medium text-muted">Sayfa sayısını gir</span>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {hasTotalPages ? (
            <ProgressBar
              value={progress.percent}
              label={`${catalogBook.title} ilerlemesi`}
            />
          ) : (
            <div className="h-2 w-full rounded-full bg-raised" aria-hidden="true" />
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
            <span className="tabular-nums">
              {hasTotalPages
                ? `${progress.currentPage}/${totalPages} sayfa`
                : 'Toplam sayfa belirtilmedi'}
            </span>
            {hasTotalPages ? (
              <span className="text-muted">
                {progress.remaining > 0 ? `${progress.remaining} sayfa kaldı` : 'Bitti'}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function BooksPage() {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ShelfFilter>('active');
  const [adding, setAdding] = useState(false);

  const data = useLiveQuery(async () => {
    const [shelf, subjects] = await Promise.all([listShelfBooks(true), listSubjects()]);
    return { shelf, subjects };
  }, []);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Kitaplar yükleniyor…
      </p>
    );
  }

  const { shelf, subjects } = data;
  const subjectLabels = new Map(
    shelf.map((row) => [row.userBook.id, subjectNameFor(row.catalogBook, subjects)]),
  );
  const visibleRows = shelf.filter(
    (row) =>
      matchesFilter(row, filter) &&
      matchesQuery(row, subjectLabels.get(row.userBook.id) ?? 'Genel', query),
  );

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Kitaplar</h1>
          <p className="text-sm text-muted">
            Kitaplarını sayfa sayfa takip et; kalan sayfalarını ve yüzdesini buradan gör.
          </p>
        </div>
        {shelf.length > 0 ? (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Kitap ekle
          </Button>
        ) : null}
      </header>

      {shelf.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Rafın boş."
          description="Katalogdan ilk kitabını ekle."
          action={<Button onClick={() => setAdding(true)}>Kitap ekle</Button>}
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
                placeholder="Kitap, yayınevi veya ders"
                maxLength={120}
                className="min-h-11 w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]"
              />
            </div>
          </Field>

          <div
            role="group"
            aria-label="Kitap filtresi"
            className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1"
          >
            {FILTERS.map((option) => {
              const active = option.id === filter;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(option.id)}
                  className={
                    active
                      ? 'min-h-11 rounded-lg bg-[var(--accent-soft)] px-3 text-sm font-medium text-[var(--accent)]'
                      : 'min-h-11 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-fg'
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {visibleRows.length === 0 ? (
            <EmptyState
              title={
                query.trim() ? 'Aramanla eşleşen kitap yok' : 'Bu filtreye uygun kitap yok'
              }
              description={
                query.trim()
                  ? 'Farklı bir kitap adı, yayınevi veya ders dene.'
                  : 'Farklı bir filtre seçebilirsin.'
              }
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visibleRows.map((row) => (
                <ShelfBookCard
                  key={row.userBook.id}
                  row={row}
                  subjectLabel={subjectLabels.get(row.userBook.id) ?? 'Genel'}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {adding ? <BookCatalogModal onClose={() => setAdding(false)} /> : null}
    </section>
  );
}
