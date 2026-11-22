import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import {
  updateUserBook,
  type ShelfBook,
  type UpdateUserBookInput,
} from '@/db/bookRepositories';
import type { ExamType, Subject } from '@/domain/types';
import { LOCAL_SCOPE } from '@/lib/namespaces';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

const EXAM_OPTIONS: ReadonlyArray<{ value: ExamType; label: string }> = [
  { value: 'TYT', label: 'TYT' },
  { value: 'AYT', label: 'AYT' },
];

export interface BookEditModalProps {
  row: ShelfBook;
  subjects: Subject[];
  onClose: () => void;
}

/**
 * Shared catalog rows only expose the user-specific page count and note.
 * Title, publisher, exam and subject stay read-only for those books; custom
 * (`LOCAL_SCOPE`) rows are owned by the user and expose every field.
 */
export function BookEditModal({ row, subjects, onClose }: BookEditModalProps) {
  const { catalogBook, progress, totalPages, userBook } = row;
  const custom = catalogBook.ownerId === LOCAL_SCOPE;

  const formId = useId();
  const titleId = useId();
  const publisherId = useId();
  const examId = useId();
  const subjectId = useId();
  const pagesId = useId();
  const noteId = useId();

  const [title, setTitle] = useState(catalogBook.title);
  const [publisher, setPublisher] = useState(catalogBook.publisher ?? '');
  const [exam, setExam] = useState<ExamType | ''>(catalogBook.exam ?? '');
  const [subjectSlug, setSubjectSlug] = useState(catalogBook.subjectSlug ?? '');
  const [pages, setPages] = useState(String(totalPages));
  const [note, setNote] = useState(userBook.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const trimmedPages = pages.trim();
  const parsedPages = Number(trimmedPages);
  const pagesInvalid =
    trimmedPages !== '' && (!Number.isInteger(parsedPages) || parsedPages < 0);
  const nameError =
    custom && title !== '' && trimmedTitle === '' ? 'Kitap adı boş olamaz' : null;
  const pagesError = pagesInvalid
    ? 'Toplam sayfa 0 veya daha büyük tam sayı olmalı'
    : null;
  const readPageWarning =
    !pagesInvalid && trimmedPages !== '' && parsedPages < progress.currentPage
      ? `Girdiğin toplam sayfa, son okunan ${progress.currentPage} sayfadan az. Okunan sayfa aralıkları silinmez; ilerleme okunan sayfaların yeni toplama oranından hesaplanır.`
      : null;
  const canSave =
    !saving &&
    trimmedPages !== '' &&
    !pagesInvalid &&
    (!custom || trimmedTitle !== '');

  const subjectOptions = subjects.filter(
    (subject) => exam === '' || subject.exam === exam,
  );

  function handleExamChange(value: string) {
    setExam(value === 'TYT' || value === 'AYT' ? value : '');
    // A subject from the previous exam would otherwise stay selected but vanish
    // from the filtered list.
    setSubjectSlug('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const input: UpdateUserBookInput = { note };
      // Keep the shared catalog page count untouched when it is not changed.
      if (parsedPages !== totalPages) {
        input.totalPagesOverride = parsedPages;
      }
      if (custom) {
        input.title = trimmedTitle;
        input.publisher = publisher.trim();
        if (exam !== '') {
          input.exam = exam;
        }
        input.subjectSlug = subjectSlug;
      }

      await updateUserBook(userBook.id, input);
      onClose();
    } catch (caught: unknown) {
      console.error('Kitap güncellenemedi', caught);
      setError(
        caught instanceof Error ? caught.message : 'Kitap güncellenemedi. Lütfen tekrar dene.',
      );
      setSaving(false);
    }
  }

  const pagesHint =
    totalPages > 0
      ? `Şu anki toplam ${totalPages} sayfa. Değiştirirsen yalnızca senin rafın için geçerli olur.`
      : 'Bilmiyorsan 0 gir; kitap detayından sonra düzeltebilirsin.';

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
      <form
        id={formId}
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4"
      >
        {custom ? (
          <>
            <Field label="Kitap adı" htmlFor={titleId} error={nameError ?? undefined}>
              <input
                id={titleId}
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                autoComplete="off"
                aria-required="true"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? `${titleId}-error` : undefined}
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
                autoComplete="off"
                placeholder="Örn. Palme"
                className={inputClass}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sınav" htmlFor={examId} hint="İsteğe bağlı">
                <select
                  id={examId}
                  value={exam}
                  onChange={(event) => handleExamChange(event.target.value)}
                  className={inputClass}
                >
                  {catalogBook.exam === undefined ? <option value="">Seçilmedi</option> : null}
                  {EXAM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Ders" htmlFor={subjectId} hint="İsteğe bağlı">
                <select
                  id={subjectId}
                  value={subjectSlug}
                  onChange={(event) => setSubjectSlug(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Genel</option>
                  {subjectOptions.map((subject) => (
                    <option key={subject.id} value={subject.slug}>
                      {subject.name} ({subject.exam})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">
            Ad, yayınevi, sınav ve ders ortak katalogdan gelir. Bu kitapta yalnızca
            toplam sayfayı ve notunu düzenleyebilirsin.
          </p>
        )}

        <Field
          label="Toplam sayfa"
          htmlFor={pagesId}
          hint={pagesHint}
          error={pagesError ?? undefined}
        >
          <input
            id={pagesId}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={pages}
            onChange={(event) => setPages(event.target.value)}
            aria-required="true"
            aria-invalid={pagesInvalid ? true : undefined}
            aria-describedby={pagesInvalid ? `${pagesId}-error` : undefined}
            className={inputClass}
          />
        </Field>

        {readPageWarning ? (
          <p
            role="status"
            className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            {readPageWarning}
          </p>
        ) : null}

        <Field label="Not" htmlFor={noteId} hint="İsteğe bağlı">
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Bu kitapla ilgili kısa bir not"
            className={`${inputClass} min-h-24 resize-y`}
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
