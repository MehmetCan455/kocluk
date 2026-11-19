import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

export interface TopicFormModalProps {
  title: string;
  submitLabel: string;
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

export function TopicFormModal({
  title,
  submitLabel,
  initialName = '',
  onClose,
  onSubmit,
}: TopicFormModalProps) {
  const formId = useId();
  const inputId = useId();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmedName);
      onClose();
    } catch (caught: unknown) {
      console.error('Konu kaydedilemedi', caught);
      setError('Konu kaydedilemedi. Lütfen tekrar dene.');
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={!trimmedName || saving}>
            {saving ? 'Kaydediliyor…' : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4"
      >
        <Field label="Konu adı" htmlFor={inputId}>
          <input
            id={inputId}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            placeholder="Örn. Limit"
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
