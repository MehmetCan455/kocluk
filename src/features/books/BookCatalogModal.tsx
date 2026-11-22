import { useId, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { addCatalogBookToShelf } from '@/db/bookRepositories';
import { listCatalogBooks, searchCatalog } from '@/db/catalogRepository';
import type { CatalogBook } from '@/domain/types';
import { CustomBookModal } from './CustomBookModal';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas py-2 pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

function catalogButtonLabel(book: CatalogBook): string {
  const publisher = book.publisher ? ` (${book.publisher})` : '';
  return `${book.title}${publisher} kitabını rafıma ekle`;
}

export interface BookCatalogModalProps {
  onClose: () => void;
}

export function BookCatalogModal({ onClose }: BookCatalogModalProps) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'catalog' | 'custom'>('catalog');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Empty query lists the whole starter catalog; the repository search only
  // runs for real input, because searching an empty string returns nothing.
  const books = useLiveQuery(async () => {
    const trimmed = query.trim();
    return trimmed ? searchCatalog(trimmed) : listCatalogBooks();
  }, [query]);

  async function handleAdd(book: CatalogBook) {
    if (addingId !== null) {
      return;
    }

    setAddingId(book.id);
    setError(null);
    try {
      await addCatalogBookToShelf(book.id);
      onClose();
    } catch (caught: unknown) {
      console.error('Kitap rafa eklenemedi', caught);
      setError('Kitap rafa eklenemedi. Lütfen tekrar dene.');
      setAddingId(null);
    }
  }

  if (view === 'custom') {
    return (
      <CustomBookModal onClose={() => setView('catalog')} onSaved={onClose} />
    );
  }

  const loading = books === undefined;
  const trimmedQuery = query.trim();
  const resultLabel = trimmedQuery
    ? `"${trimmedQuery}" için katalog sonuçları`
    : 'Katalogdaki kitaplar';

  return (
    <Modal
      open
      title="Kitap ekle"
      onClose={onClose}
      footer={
        <Button onClick={() => setView('custom')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Kendi kitabımı ekle
        </Button>
      }
    >
      <Field label="Kitap, yayınevi veya ders ara" htmlFor={searchId}>
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
            placeholder="Örn. Bilgi Sarmal"
            maxLength={120}
            className={inputClass}
          />
        </div>
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p role="status" className="py-8 text-center text-sm text-muted">
          Katalog yükleniyor…
        </p>
      ) : books.length === 0 ? (
        <EmptyState
          title={trimmedQuery ? 'Aramanla eşleşen kitap yok' : 'Katalog boş'}
          description={
            trimmedQuery
              ? 'Kendi kitabımı ekle ile aradığın kitabı rafına ekleyebilirsin.'
              : 'Kendi kitabımı ekle ile ilk kitabını rafına ekleyebilirsin.'
          }
        />
      ) : (
        <ul aria-label={resultLabel} className="space-y-2">
          {books.map((book) => (
            <li
              key={book.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas p-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-semibold">{book.title}</p>
                <p className="truncate text-xs text-muted">
                  {book.publisher ?? 'Yayınevi belirtilmedi'} ·{' '}
                  {book.totalPages > 0
                    ? `${book.totalPages} sayfa`
                    : 'Sayfa sayısı belirtilmedi'}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                aria-label={catalogButtonLabel(book)}
                onClick={() => void handleAdd(book)}
                disabled={addingId !== null}
                className="shrink-0"
              >
                {addingId === book.id ? 'Ekleniyor…' : 'Rafa ekle'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
