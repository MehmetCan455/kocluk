import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Camera,
  ClipboardList,
  FileText,
  GraduationCap,
  Library,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal } from '@/components/ui/Modal';
import { db } from '@/db/db';
import { listSubjects } from '@/db/repositories';
import type { Subject, Topic } from '@/domain/types';
import { examBasePath } from '@/features/subjects/exam';
import { normalizeTr } from '@/lib/normalize';
import { searchAll, type SearchKind, type SearchResult } from './searchAll';
import { useDebouncedValue } from './useDebouncedValue';

export interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

/** Input is debounced before IndexedDB is read on every keystroke. */
export const SEARCH_DEBOUNCE_MS = 200;

interface SearchState {
  query: string;
  results: SearchResult[];
}

const KIND_ORDER: readonly SearchKind[] = ['topic', 'note', 'book', 'exam', 'photo'];

const KIND_LABELS: Readonly<Record<SearchKind, string>> = {
  topic: 'Konular',
  note: 'Notlar',
  book: 'Kitaplar',
  exam: 'Denemeler',
  photo: 'Yanlış Fotoğrafları',
};

const KIND_ICONS: Readonly<Record<SearchKind, LucideIcon>> = {
  topic: BookOpen,
  note: FileText,
  book: Library,
  exam: ClipboardList,
  photo: Camera,
};

interface QuickLink {
  to: string;
  label: string;
  icon: LucideIcon;
}

const QUICK_LINKS: readonly QuickLink[] = [
  { to: '/tyt', label: 'TYT dersleri', icon: BookOpen },
  { to: '/ayt', label: 'AYT dersleri', icon: GraduationCap },
  { to: '/denemeler', label: 'Denemeler', icon: ClipboardList },
  { to: '/kitaplar', label: 'Kitaplar', icon: Library },
  { to: '/yanlislar', label: 'Yanlışlar', icon: Camera },
  { to: '/ayarlar', label: 'Ayarlar', icon: Settings },
];

const RECENT_TOPIC_LIMIT = 5;

interface RecentTopic {
  id: string;
  name: string;
  subtitle: string;
  href: string;
}

/**
 * Recent topics are derived from the newest topic rows in IndexedDB. No search
 * history is stored anywhere, so this is the only "recent" data the palette
 * shows and it keeps working after a reload.
 */
async function listRecentTopics(): Promise<RecentTopic[]> {
  const [topics, subjects] = await Promise.all([db.topics.toArray(), listSubjects()]);
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));

  return topics
    .map((topic) => ({ topic, subject: subjectById.get(topic.subjectId) }))
    .filter(
      (row): row is { topic: Topic; subject: Subject } => row.subject !== undefined,
    )
    .sort(
      (left, right) =>
        right.topic.createdAt.localeCompare(left.topic.createdAt) ||
        left.topic.name.localeCompare(right.topic.name, 'tr-TR') ||
        left.topic.id.localeCompare(right.topic.id),
    )
    .slice(0, RECENT_TOPIC_LIMIT)
    .map(({ topic, subject }) => ({
      id: topic.id,
      name: topic.name,
      subtitle: `${subject.name} · ${subject.exam}`,
      href: `${examBasePath(subject.exam)}/${subject.id}/${topic.id}`,
    }));
}

const rowLinkClass =
  'flex min-h-11 items-start gap-3 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-raised focus-visible:bg-raised';

function RecentTopics({ onClose }: { onClose: () => void }) {
  const recentTopics = useLiveQuery(() => listRecentTopics(), []);

  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Son eklenen konular
      </p>
      {recentTopics === undefined ? (
        <p role="status" className="text-sm text-muted">
          Konular yükleniyor…
        </p>
      ) : recentTopics.length === 0 ? (
        <p className="text-sm text-muted">Henüz konu yok.</p>
      ) : (
        <ul aria-label="Son eklenen konular" className="space-y-1">
          {recentTopics.map((topic) => (
            <li key={topic.id}>
              <Link to={topic.href} onClick={onClose} className={rowLinkClass}>
                <BookOpen
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{topic.name}</span>
                  <span className="block truncate text-xs text-muted">{topic.subtitle}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyQuery({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Hızlı erişim</p>
        <ul aria-label="Hızlı erişim" className="grid grid-cols-2 gap-2">
          {QUICK_LINKS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                onClick={onClose}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-raised px-3 text-sm font-medium text-fg transition-colors duration-150 hover:border-[var(--accent)]"
              >
                <Icon className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <RecentTopics onClose={onClose} />
    </div>
  );
}

interface ResultGroupsProps {
  results: SearchResult[];
  baseId: string;
  onClose: () => void;
}

function ResultGroups({ results, baseId, onClose }: ResultGroupsProps) {
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: results.filter((result) => result.kind === kind),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="space-y-4">
      {groups.map(({ kind, items }) => {
        const headingId = `${baseId}-${kind}`;
        const Icon = KIND_ICONS[kind];
        return (
          <section key={kind} className="space-y-1">
            <h3
              id={headingId}
              className="text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {KIND_LABELS[kind]}
            </h3>
            <ul aria-labelledby={headingId} className="space-y-1">
              {items.map((result) => (
                <li key={`${result.kind}-${result.id}`}>
                  <Link to={result.href} onClick={onClose} className={rowLinkClass}>
                    <Icon
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">
                        {result.title}
                      </span>
                      <span className="block truncate text-xs text-muted">{result.subtitle}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function SearchModal({ open, onClose }: SearchModalProps) {
  const inputId = useId();
  const hintId = useId();
  const baseId = useId().replace(/:/g, '');
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const queryIsEmpty = normalizeTr(query) === '';

  // The state carries the query it belongs to. Dexie keeps the previous value
  // while a new live query is pending, so comparing the label prevents stale
  // results from flashing between the debounce firing and IndexedDB answering.
  const searchState = useLiveQuery(
    async (): Promise<SearchState> => {
      if (!open || queryIsEmpty) {
        return { query: debouncedQuery, results: [] };
      }
      return { query: debouncedQuery, results: await searchAll(debouncedQuery) };
    },
    [open, queryIsEmpty, debouncedQuery],
  );

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const waitingForDebounce =
    !queryIsEmpty && normalizeTr(debouncedQuery) !== normalizeTr(query);
  const results =
    searchState !== undefined && searchState.query === debouncedQuery
      ? searchState.results
      : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ara"
      initialFocusRef={inputRef}
      className="max-w-xl"
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor={inputId} className="sr-only">
            Genel arama
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Konu, not, kitap veya deneme ara"
              maxLength={120}
              aria-describedby={hintId}
              className="min-h-11 w-full rounded-xl border border-line bg-canvas py-2 pl-10 pr-3 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]"
            />
          </div>
          <p id={hintId} className="text-xs text-muted">
            Ctrl veya ⌘ + K ile her yerden açabilirsin. Aramalar yalnızca bu cihazda kalır.
          </p>
        </div>

        {queryIsEmpty ? (
          <EmptyQuery onClose={onClose} />
        ) : waitingForDebounce || results === undefined ? (
          <p role="status" className="py-4 text-center text-sm text-muted">
            Aranıyor…
          </p>
        ) : results.length === 0 ? (
          <p role="status" className="py-4 text-center text-sm text-muted">
            Eşleşen sonuç yok.
          </p>
        ) : (
          <ResultGroups results={results} baseId={baseId} onClose={onClose} />
        )}
      </div>
    </Modal>
  );
}
