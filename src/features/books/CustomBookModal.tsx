import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { addCustomBook } from '@/db/bookRepositories';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

export interface CustomBookModalProps {
  onClose: () => void;
  onSaved: () => void;
}

export function CustomBookModal({ onClose, onSaved }: CustomBookModalProps) {
  const formId = useId();
  const titleId = useId();
  const publisherId = useId();
  const pagesId = useId();
  const [title, setTitle] = useState('');
  const [publisher, setPublisher] = useState('');
  const [totalPages, setTotalPages] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const trimmedPages = totalPages.trim();
  const parsedPages = Number(trimmedPages);
  const pagesInvalid =
    trimmedPages !== '' && (!Number.isInteger(parsedPages) || parsedPages < 0);
  const nameError = title !== '' && trimmedTitle === '' ? 'Kitap adı boş olamaz' : null;
  const pagesError = pagesInvalid
    ? 'Toplam sayfa 0 veya daha büyük tam sayı olmalı'
    : null;
  const canSave = !saving && trimmedTitle !== '' && trimmedPages !== '' && !pagesInvalid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await addCustomBook({
        title: trimmedTitle,
        publisher: publisher.trim() || undefined,
        totalPages: parsedPages,
      });
      onSaved();
    } catch (caught: unknown) {
      console.error('Kitap eklenemedi', caught);
      setError(
        caught instanceof Error ? caught.message : 'Kitap eklenemedi. Lütfen tekrar dene.',
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Yeni kitap"
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
            placeholder="Örn. Bilgi Sarmal TYT Matematik"
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

        <Field
          label="Toplam sayfa"
          htmlFor={pagesId}
          hint="Bilmiyorsan 0 gir; kitap detayından sonra düzeltebilirsin."
          error={pagesError ?? undefined}
        >
          <input
            id={pagesId}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={totalPages}
            onChange={(event) => setTotalPages(event.target.value)}
            aria-required="true"
            aria-invalid={pagesInvalid ? true : undefined}
            aria-describedby={pagesInvalid ? `${pagesId}-error` : undefined}
            placeholder="Örn. 480"
            className={inputClass}
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
