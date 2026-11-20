import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { listTopics, updatePhotoTags } from '@/db/repositories';
import type { Exam, Subject } from '@/domain/types';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

export interface PhotoBulkTagModalProps {
  photoIds: string[];
  subjects: Subject[];
  exams: Exam[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Gallery bulk tag change: sets the same subject/topic/exam link on every
 * selected photo through `updatePhotoTags`, which keeps `photoSearch` in sync.
 */
export function PhotoBulkTagModal({
  photoIds,
  subjects,
  exams,
  onClose,
  onSaved,
}: PhotoBulkTagModalProps) {
  const baseId = useId().replace(/:/g, '');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [examId, setExamId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSubject = subjects.find((subject) => subject.id === subjectId);
  const topics = useLiveQuery(
    async () => (subjectId ? listTopics(subjectId) : []),
    [subjectId],
  );
  const examOptions = selectedSubject
    ? exams.filter((exam) => exam.type === selectedSubject.exam)
    : [];

  async function handleSave() {
    if (saving) {
      return;
    }
    if (!selectedSubject) {
      setError('Ders seçilmedi');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updatePhotoTags(photoIds, {
        examType: selectedSubject.exam,
        subjectId: selectedSubject.id,
        topicId: topicId || undefined,
        examId: examId || undefined,
      });
      onSaved();
    } catch (caught: unknown) {
      console.error('Fotoğraf etiketleri güncellenemedi', caught);
      setError('Etiketler güncellenemedi. Lütfen tekrar dene.');
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Etiket değiştir"
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
          <Button onClick={() => void handleSave()} disabled={saving || !subjectId}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Seçilen <span className="font-semibold text-fg">{photoIds.length}</span> fotoğrafın
        ders, konu ve deneme etiketleri bu değerlerle değiştirilecek. Fotoğrafların
        kendisi silinmez.
      </p>

      <Field label="Ders" htmlFor={`${baseId}-ders`} required>
        <select
          id={`${baseId}-ders`}
          value={subjectId}
          onChange={(event) => {
            setSubjectId(event.target.value);
            setTopicId('');
            setExamId('');
          }}
          className={inputClass}
        >
          <option value="">Ders seç</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.exam} · {subject.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Konu" htmlFor={`${baseId}-konu`} hint="İsteğe bağlı">
        <select
          id={`${baseId}-konu`}
          value={topicId}
          disabled={!subjectId}
          onChange={(event) => setTopicId(event.target.value)}
          className={inputClass}
        >
          <option value="">Konu seçme</option>
          {(topics ?? []).map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Deneme" htmlFor={`${baseId}-deneme`} hint="İsteğe bağlı">
        <select
          id={`${baseId}-deneme`}
          value={examId}
          disabled={!selectedSubject}
          onChange={(event) => setExamId(event.target.value)}
          className={inputClass}
        >
          <option value="">Denemeye bağlama</option>
          {examOptions.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.name}
            </option>
          ))}
        </select>
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
