import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Images, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { addPhotos, listExams, listSubjects, listTopics } from '@/db/repositories';
import type { ExamType, Photo } from '@/domain/types';
import { IMAGE_TYPE_ERROR } from '@/lib/image';
import { STORAGE_QUOTA_MESSAGE, isStorageQuotaError } from '@/lib/storageError';
import { formatExamDate } from '@/features/exams/examFormat';

export interface PhotoUploadProps {
  examId?: string;
  examType?: ExamType;
  subjectId?: string;
  topicId?: string;
  onClose?: () => void;
  onUploaded?: (photos: Photo[]) => void;
  /** Lets the parent guard Modal dismissal while a write is in flight. */
  onBusyChange?: (busy: boolean) => void;
}

const UPLOAD_ERROR = 'Fotoğraflar yüklenemedi. Lütfen tekrar dene.';
const KNOWN_ERRORS = new Set([
  STORAGE_QUOTA_MESSAGE,
  IMAGE_TYPE_ERROR,
  'Ders seçilmedi',
  'Deneme bulunamadı',
  'Deneme türü fotoğraf türüyle uyuşmuyor',
]);

function uploadErrorMessage(caught: unknown): string {
  if (isStorageQuotaError(caught)) {
    return STORAGE_QUOTA_MESSAGE;
  }
  if (caught instanceof Error && KNOWN_ERRORS.has(caught.message)) {
    return caught.message;
  }
  return UPLOAD_ERROR;
}

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

export function PhotoUpload({
  examId,
  examType,
  subjectId,
  topicId,
  onClose,
  onUploaded,
  onBusyChange,
}: PhotoUploadProps) {
  const baseId = useId().replace(/:/g, '');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const busyChangeRef = useRef(onBusyChange);

  useEffect(() => {
    busyChangeRef.current = onBusyChange;
  }, [onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;
    busyChangeRef.current?.(false);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [type, setType] = useState<ExamType>(examType ?? 'TYT');
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjectId ?? '');
  const [selectedTopicId, setSelectedTopicId] = useState(topicId ?? '');
  const [selectedExamId, setSelectedExamId] = useState(examId ?? '');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const subjects = useLiveQuery(() => listSubjects(type), [type]);
  const topics = useLiveQuery(
    async () => (selectedSubjectId ? listTopics(selectedSubjectId) : []),
    [selectedSubjectId],
  );
  const exams = useLiveQuery(
    async () => (examId ? [] : listExams(type)),
    [type, examId],
  );

  const progress = files.length === 0 ? 0 : Math.round((uploadedCount / files.length) * 100);

  function handleTypeChange(nextType: ExamType) {
    setType(nextType);
    setSelectedSubjectId('');
    setSelectedTopicId('');
    if (!examId) {
      setSelectedExamId('');
    }
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (picked.length === 0) {
      return;
    }
    setFiles((current) => [...current, ...picked]);
    setError(null);
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  }

  async function handleUpload() {
    if (uploading) {
      return;
    }
    if (!selectedSubjectId) {
      setError('Ders seçilmedi');
      return;
    }
    if (files.length === 0) {
      return;
    }

    setUploading(true);
    busyChangeRef.current?.(true);
    setUploadedCount(0);
    setError(null);
    const uploaded: Photo[] = [];
    try {
      for (const file of files) {
        const [photo] = await addPhotos([
          {
            file,
            examId: selectedExamId || undefined,
            examType: type,
            subjectId: selectedSubjectId,
            topicId: selectedTopicId || undefined,
            note: note.trim() || undefined,
          },
        ]);
        // A route change or an externally unmounted modal must not receive
        // state updates or close a newly opened instance.
        if (!mountedRef.current) {
          return;
        }
        uploaded.push(photo);
        setUploadedCount(uploaded.length);
      }
      if (!mountedRef.current) {
        return;
      }
      setFiles([]);
      setNote('');
      setUploadedCount(0);
      onUploaded?.(uploaded);
      onClose?.();
    } catch (caught: unknown) {
      console.error('Fotoğraflar yüklenemedi', caught);
      if (!mountedRef.current) {
        return;
      }
      // Keep only the files that have not been stored yet and reset the
      // progress counters so a retry starts from zero instead of showing 2/1.
      setFiles((current) => current.slice(uploaded.length));
      setUploadedCount(0);
      setError(uploadErrorMessage(caught));
    } finally {
      if (mountedRef.current) {
        setUploading(false);
        busyChangeRef.current?.(false);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          aria-label="Kamera ile çek"
          tabIndex={-1}
          className="sr-only"
          onChange={addFiles}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          aria-label="Galeriden seç"
          tabIndex={-1}
          className="sr-only"
          onChange={addFiles}
        />
        <Button
          variant="secondary"
          onClick={() => cameraRef.current?.click()}
          disabled={uploading}
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Kamera
        </Button>
        <Button
          variant="secondary"
          onClick={() => galleryRef.current?.click()}
          disabled={uploading}
        >
          <Images className="h-4 w-4" aria-hidden="true" />
          Galeriden seç
        </Button>
      </div>

      {files.length > 0 ? (
        <ul aria-label="Seçilen fotoğraflar" className="space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-canvas px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
              <button
                type="button"
                aria-label={`${file.name} dosyasını kaldır`}
                onClick={() => removeFile(index)}
                disabled={uploading}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sınav türü" htmlFor={`${baseId}-tur`} required>
          <select
            id={`${baseId}-tur`}
            value={type}
            disabled={uploading || examType !== undefined}
            onChange={(event) => handleTypeChange(event.target.value as ExamType)}
            className={inputClass}
          >
            <option value="TYT">TYT</option>
            <option value="AYT">AYT</option>
          </select>
        </Field>

        <Field label="Ders" htmlFor={`${baseId}-ders`} required>
          <select
            id={`${baseId}-ders`}
            value={selectedSubjectId}
            disabled={uploading || topicId !== undefined}
            onChange={(event) => {
              setSelectedSubjectId(event.target.value);
              setSelectedTopicId('');
            }}
            className={inputClass}
          >
            <option value="">Ders seç</option>
            {(subjects ?? []).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Konu" htmlFor={`${baseId}-konu`} hint="İsteğe bağlı">
          <select
            id={`${baseId}-konu`}
            value={selectedTopicId}
            disabled={uploading || !selectedSubjectId || topicId !== undefined}
            onChange={(event) => setSelectedTopicId(event.target.value)}
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

        {examId ? null : (
          <Field label="Deneme" htmlFor={`${baseId}-deneme`} hint="İsteğe bağlı">
            <select
              id={`${baseId}-deneme`}
              value={selectedExamId}
              disabled={uploading}
              onChange={(event) => setSelectedExamId(event.target.value)}
              className={inputClass}
            >
              <option value="">Deneme seçme</option>
              {(exams ?? []).map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.type} · {exam.name} · {formatExamDate(exam.date)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <Field label="Not" htmlFor={`${baseId}-not`} hint="İsteğe bağlı">
        <textarea
          id={`${baseId}-not`}
          value={note}
          rows={2}
          disabled={uploading}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Örn. Türev sorusunda zincir kuralını kaçırdım"
          className={inputClass}
        />
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {uploading || uploadedCount > 0 ? (
        <div className="space-y-1">
          <ProgressBar value={progress} label="Fotoğraf yükleme ilerlemesi" />
          <p className="text-xs text-muted" aria-live="polite">
            {uploadedCount}/{files.length} fotoğraf yüklendi
          </p>
        </div>
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        {onClose ? (
          <Button variant="secondary" onClick={onClose} disabled={uploading}>
            Vazgeç
          </Button>
        ) : null}
        <Button
          onClick={() => void handleUpload()}
          disabled={uploading || files.length === 0 || !selectedSubjectId}
        >
          {uploading ? 'Yükleniyor…' : 'Yükle'}
        </Button>
      </div>
    </div>
  );
}
