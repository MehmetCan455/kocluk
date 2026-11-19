import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { createBook, upsertTopicBook } from '@/db/repositories';
import type { Book, TopicBook } from '@/domain/types';
import { buildBookLabels } from '@/features/books/bookLabels';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

const NEW_BOOK = '__new_book__';

export interface TopicBookFormProps {
  topicId: string;
  books: Book[];
  initial?: { record: TopicBook; bookName: string };
  onClose: () => void;
}

function parseCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function TopicBookForm({ topicId, books, initial, onClose }: TopicBookFormProps) {
  const formId = useId();
  const bookSelectId = useId();
  const bookNameId = useId();
  const publisherId = useId();
  const totalId = useId();
  const solvedId = useId();

  const [bookChoice, setBookChoice] = useState(
    initial ? initial.record.bookId : (books[0]?.id ?? NEW_BOOK),
  );
  const [bookName, setBookName] = useState('');
  const [publisher, setPublisher] = useState('');
  const [totalTests, setTotalTests] = useState(
    initial ? String(initial.record.totalTests) : '',
  );
  const [solvedTests, setSolvedTests] = useState(
    initial ? String(initial.record.solvedTests) : '0',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creatingBook = !initial && bookChoice === NEW_BOOK;
  const bookLabels = buildBookLabels(books);
  const trimmedBookName = bookName.trim();
  const totalNumber = parseCount(totalTests);
  const solvedNumber = parseCount(solvedTests);

  const bookNameError =
    creatingBook && bookName !== '' && trimmedBookName === '' ? 'Kitap adı boş olamaz' : null;
  const totalError =
    totalTests.trim() === ''
      ? null
      : totalNumber === null
        ? 'Toplam test sayısı tam sayı olmalı'
        : totalNumber < 1
          ? 'Toplam test sayısı en az 1 olmalı'
          : null;
  const solvedError =
    solvedTests.trim() === ''
      ? null
      : solvedNumber === null
        ? 'Çözülen test sayısı tam sayı olmalı'
        : totalNumber !== null && totalNumber >= 1 && solvedNumber > totalNumber
          ? 'Çözülen test sayısı toplamdan fazla olamaz'
          : null;

  const duplicateBook =
    creatingBook &&
    trimmedBookName !== '' &&
    books.some(
      (book) =>
        book.name.trim().toLocaleLowerCase('tr-TR') ===
        trimmedBookName.toLocaleLowerCase('tr-TR'),
    );

  const hasBook = initial
    ? true
    : creatingBook
      ? trimmedBookName !== ''
      : bookChoice !== NEW_BOOK && books.some((book) => book.id === bookChoice);
  const canSave =
    !saving &&
    hasBook &&
    totalNumber !== null &&
    totalNumber >= 1 &&
    solvedNumber !== null &&
    solvedNumber >= 0 &&
    solvedNumber <= totalNumber;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || totalNumber === null || solvedNumber === null) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let bookId = bookChoice;
      if (creatingBook) {
        const book = await createBook({
          name: trimmedBookName,
          publisher: publisher.trim() || undefined,
        });
        bookId = book.id;
      }

      await upsertTopicBook({
        id: initial?.record.id,
        topicId,
        bookId,
        totalTests: totalNumber,
        solvedTests: solvedNumber,
      });
      onClose();
    } catch (caught: unknown) {
      console.error('Test kaydı kaydedilemedi', caught);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Test kaydı kaydedilemedi. Lütfen tekrar dene.',
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={initial ? 'Test kaydını düzenle' : 'Kitap / test ekle'}
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
        {initial ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-fg">Kitap</p>
            <p className="flex min-h-11 items-center rounded-xl border border-line bg-raised px-3 py-2 text-sm">
              {initial.bookName}
            </p>
          </div>
        ) : (
          <Field label="Kitap" htmlFor={bookSelectId}>
            <select
              id={bookSelectId}
              value={bookChoice}
              onChange={(event) => setBookChoice(event.target.value)}
              className={inputClass}
            >
              {books.map((book) => {
                const label = bookLabels.get(book.id) ?? book.name;
                const optionLabel =
                  label === book.name && book.publisher
                    ? `${book.name} — ${book.publisher}`
                    : label;
                return (
                  <option key={book.id} value={book.id}>
                    {optionLabel}
                  </option>
                );
              })}
              <option value={NEW_BOOK}>Yeni kitap…</option>
            </select>
          </Field>
        )}

        {creatingBook ? (
          <>
            <Field label="Yeni kitap adı" htmlFor={bookNameId} error={bookNameError ?? undefined}>
              <input
                id={bookNameId}
                type="text"
                value={bookName}
                onChange={(event) => setBookName(event.target.value)}
                maxLength={120}
                placeholder="Örn. 3D TYT Soru Bankası"
                aria-required="true"
                aria-invalid={bookNameError ? true : undefined}
                aria-describedby={bookNameError ? `${bookNameId}-error` : undefined}
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
            {duplicateBook ? (
              <p role="status" className="text-sm text-warning">
                Bu adda bir kitap zaten var. Yine de yeni bir kitap olarak eklenecek.
              </p>
            ) : null}
          </>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Toplam test" htmlFor={totalId} error={totalError ?? undefined}>
            <input
              id={totalId}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={totalTests}
              onChange={(event) => setTotalTests(event.target.value)}
              placeholder="0"
              aria-required="true"
              aria-invalid={totalError ? true : undefined}
              aria-describedby={totalError ? `${totalId}-error` : undefined}
              className={inputClass}
            />
          </Field>
          <Field label="Çözülen test" htmlFor={solvedId} error={solvedError ?? undefined}>
            <input
              id={solvedId}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={solvedTests}
              onChange={(event) => setSolvedTests(event.target.value)}
              placeholder="0"
              aria-required="true"
              aria-invalid={solvedError ? true : undefined}
              aria-describedby={solvedError ? `${solvedId}-error` : undefined}
              className={inputClass}
            />
          </Field>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
