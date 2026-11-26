import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import type { ShelfBook } from '@/db/bookRepositories';
import { matchesTokens, tokenizeTr } from '@/lib/normalize';

const MAX_RESULTS = 8;

export interface ShelfBookPickerProps {
  id: string;
  books: ReadonlyArray<ShelfBook>;
  value: string;
  onChange: (userBookId: string) => void;
  disabled?: boolean;
  /** Optional empty-shelf message, e.g. with a link to the books page. */
  emptyMessage?: ReactNode;
}

function bookMeta(book: ShelfBook): string {
  return [
    book.catalogBook.publisher,
    book.catalogBook.edition,
    `${book.totalPages} sayfa`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

function bookHaystack(book: ShelfBook): string {
  return [
    book.catalogBook.title,
    book.catalogBook.publisher ?? '',
    book.catalogBook.subjectSlug ?? '',
  ].join(' ');
}

/**
 * Searchable single-select picker over the shelf. It never mutates the
 * database; the caller owns `value` and persists the chosen `userBook.id`.
 */
export function ShelfBookPicker({
  id,
  books,
  value,
  onChange,
  disabled = false,
  emptyMessage,
}: ShelfBookPickerProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `${id}-listbox`;

  const selected = books.find((book) => book.userBook.id === value);
  const tokens = tokenizeTr(query);
  const results = (
    tokens.length > 0
      ? books.filter((book) => matchesTokens(bookHaystack(book), tokens))
      : books
  ).slice(0, MAX_RESULTS);
  const activeResult = results[Math.min(activeIndex, results.length - 1)];

  function choose(book: ShelfBook): void {
    if (disabled) {
      return;
    }
    onChange(book.userBook.id);
    setQuery('');
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      // A focused search input inside the task form must never submit it.
      event.preventDefault();
      if (activeResult) {
        choose(activeResult);
      }
      return;
    }
    if (results.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
  }

  function clearSelection(): void {
    onChange('');
    inputRef.current?.focus();
  }

  if (books.length === 0) {
    return (
      <p className="text-sm text-muted">
        {emptyMessage ?? 'Rafında kitap yok. Kitaplar sayfasından ekleyebilirsin.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {selected ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3 py-2">
          <p className="text-sm text-fg">
            {`Seçili: ${selected.catalogBook.title}`}
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={clearSelection}
          >
            Değiştir
          </Button>
        </div>
      ) : null}

      {value !== '' && !selected ? (
        <p role="status" className="text-xs text-danger">
          Seçili kitap rafında bulunamadı.
        </p>
      ) : null}

      <input
        ref={inputRef}
        id={id}
        type="search"
        role="combobox"
        aria-label="Kitap ara"
        placeholder="Kitap veya yayınevi ara"
        autoComplete="off"
        value={query}
        disabled={disabled}
        aria-expanded={results.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeResult ? `${id}-option-${activeResult.userBook.id}` : undefined
        }
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        className="min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]"
      />

      {results.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Kitap sonuçları"
          className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-canvas"
        >
          {results.map((book, index) => {
            const isActive = book === activeResult;
            return (
              <li
                key={book.userBook.id}
                id={`${id}-option-${book.userBook.id}`}
                role="option"
                aria-selected={book.userBook.id === value}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(book)}
                className={cn(
                  'cursor-pointer px-3 py-2',
                  isActive
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-fg hover:bg-raised',
                )}
              >
                <span className="block text-sm font-medium">
                  {book.catalogBook.title}
                </span>
                <span className="block text-xs text-muted">
                  {bookMeta(book)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : tokens.length > 0 ? (
        <p role="status" className="text-sm text-muted">
          Rafında eşleşen kitap yok.
        </p>
      ) : null}
    </div>
  );
}
