import type { Book } from '@/domain/types';

/**
 * Builds a display label for every book. Unique names are returned unchanged.
 * Duplicate names get their publisher when every duplicate has a distinct one;
 * otherwise they get a stable ordinal suffix ordered by book id. The result is
 * safe for accessible names, links and select options.
 */
export function buildBookLabels(books: Book[]): Map<string, string> {
  const groups = new Map<string, Book[]>();
  for (const book of books) {
    const key = book.name.trim().toLocaleLowerCase('tr-TR');
    const group = groups.get(key);
    if (group) {
      group.push(book);
    } else {
      groups.set(key, [book]);
    }
  }

  const labels = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      labels.set(group[0].id, group[0].name);
      continue;
    }

    const ordered = [...group].sort((left, right) => left.id.localeCompare(right.id));
    const publishers = ordered.map((book) => book.publisher?.trim() ?? '');
    const publisherKeys = publishers.map((publisher) => publisher.toLocaleLowerCase('tr-TR'));
    const usePublishers =
      publishers.every(Boolean) && new Set(publisherKeys).size === ordered.length;

    ordered.forEach((book, index) => {
      const suffix = usePublishers ? publishers[index] : `#${index + 1}`;
      labels.set(book.id, `${book.name} (${suffix})`);
    });
  }

  return labels;
}
