import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { saveScheduleEntry } from '@/db/repositories';
import type { ScheduleEntry, Subject } from '@/domain/types';
import { isHHmm } from '@/lib/time';
import { SCHEDULE_DAYS, scheduleDayLabel } from './scheduleDays';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

interface FormErrors {
  day?: string;
  startTime?: string;
  endTime?: string;
  title?: string;
}

export interface ScheduleEntryModalProps {
  entry: ScheduleEntry | null;
  initialDay: number;
  subjects: Subject[];
  onClose: () => void;
}

export function ScheduleEntryModal({
  entry,
  initialDay,
  subjects,
  onClose,
}: ScheduleEntryModalProps) {
  const formId = useId();
  const dayId = useId();
  const startId = useId();
  const endId = useId();
  const titleId = useId();
  const subjectId = useId();
  const noteId = useId();

  const [day, setDay] = useState(entry?.day ?? initialDay);
  const [startTime, setStartTime] = useState(entry?.startTime ?? '08:00');
  const [endTime, setEndTime] = useState(entry?.endTime ?? '09:00');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [subject, setSubject] = useState(entry?.subjectId ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }

    const nextErrors: FormErrors = {};
    if (!title.trim()) {
      nextErrors.title = 'Başlık boş olamaz';
    }
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      nextErrors.day = 'Gün seçilmeli';
    }
    if (!isHHmm(startTime)) {
      nextErrors.startTime = 'Başlangıç saati SS:DD biçiminde olmalı';
    }
    if (!isHHmm(endTime)) {
      nextErrors.endTime = 'Bitiş saati SS:DD biçiminde olmalı';
    } else if (isHHmm(startTime) && endTime <= startTime) {
      nextErrors.endTime = 'Bitiş saati başlangıçtan sonra olmalı';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await saveScheduleEntry({
        id: entry?.id,
        day,
        startTime,
        endTime,
        title,
        subjectId: subject || undefined,
        note,
      });
      onClose();
    } catch (caught: unknown) {
      console.error('Program kaydı kaydedilemedi', caught);
      setFormError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Program kaydı kaydedilemedi. Lütfen tekrar dene.',
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={entry ? 'Program kaydını düzenle' : 'Yeni program kaydı'}
      onClose={() => {
        if (!saving) {
          onClose();
        }
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4"
        noValidate
      >
        <Field label="Gün" htmlFor={dayId} error={errors.day} required>
          <select
            id={dayId}
            value={day}
            onChange={(event) => setDay(Number(event.target.value))}
            aria-describedby={errors.day ? `${dayId}-error` : undefined}
            className={inputClass}
          >
            {SCHEDULE_DAYS.map((item) => (
              <option key={item.day} value={item.day}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Başlangıç saati" htmlFor={startId} error={errors.startTime} required>
            <input
              id={startId}
              type="time"
              step={60}
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              aria-describedby={errors.startTime ? `${startId}-error` : undefined}
              className={inputClass}
            />
          </Field>
          <Field label="Bitiş saati" htmlFor={endId} error={errors.endTime} required>
            <input
              id={endId}
              type="time"
              step={60}
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              aria-describedby={errors.endTime ? `${endId}-error` : undefined}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Başlık" htmlFor={titleId} error={errors.title} required>
          <input
            id={titleId}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder={`Örn. ${scheduleDayLabel(day)} matematik tekrarı`}
            aria-describedby={errors.title ? `${titleId}-error` : undefined}
            className={inputClass}
          />
        </Field>

        <Field label="Ders (isteğe bağlı)" htmlFor={subjectId}>
          <select
            id={subjectId}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className={inputClass}
          >
            <option value="">Ders seçme</option>
            {subjects.map((item) => (
              <option key={item.id} value={item.id}>
                {`${item.name} (${item.exam})`}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Not (isteğe bağlı)" htmlFor={noteId}>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Örn. Konu tekrarı + 20 soru"
            className={inputClass}
          />
        </Field>

        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
