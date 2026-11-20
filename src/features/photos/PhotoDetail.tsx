import { useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, CheckCircle2, Pencil, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { db } from '@/db/db';
import { deletePhotos, listSubjects, listTopics, updatePhoto } from '@/db/repositories';
import type { CorrectOption, Photo } from '@/domain/types';
import { formatExamDate } from '@/features/exams/examFormat';
import { isoToLocalDate, localDateToIso } from '@/lib/date';
import { photoLabel, usePhotoObjectUrl } from './PhotoThumb';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

const OPTIONS: readonly CorrectOption[] = ['A', 'B', 'C', 'D', 'E'];

interface PhotoEditModalProps {
  photo: Photo;
  onClose: () => void;
}

function PhotoEditModal({ photo, onClose }: PhotoEditModalProps) {
  const baseId = useId().replace(/:/g, '');
  const [subjectId, setSubjectId] = useState(photo.subjectId);
  const [topicId, setTopicId] = useState(photo.topicId ?? '');
  const [captureDate, setCaptureDate] = useState(isoToLocalDate(photo.createdAt));
  const [note, setNote] = useState(photo.note);
  const [correctOption, setCorrectOption] = useState<CorrectOption | ''>(
    photo.correctOption ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjects = useLiveQuery(() => listSubjects(photo.examType), [photo.examType]);
  const topics = useLiveQuery(
    async () => (subjectId ? listTopics(subjectId) : []),
    [subjectId],
  );

  async function handleSave() {
    if (saving) {
      return;
    }
    if (!subjectId) {
      setError('Ders seçilmedi');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updatePhoto(photo.id, {
        subjectId,
        topicId: topicId || undefined,
        note: note.trim(),
        correctOption: correctOption || undefined,
        createdAt: localDateToIso(captureDate) ?? photo.createdAt,
      });
      onClose();
    } catch (caught: unknown) {
      console.error('Fotoğraf güncellenemedi', caught);
      setError('Fotoğraf güncellenemedi. Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Fotoğrafı düzenle"
      onClose={onClose}
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
      <Field label="Ders" htmlFor={`${baseId}-ders`} required>
        <select
          id={`${baseId}-ders`}
          value={subjectId}
          onChange={(event) => {
            setSubjectId(event.target.value);
            setTopicId('');
          }}
          className={inputClass}
        >
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
          value={topicId}
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

      <Field
        label="Doğru şık"
        htmlFor={`${baseId}-dogru-sik`}
        hint="Rastgele testte cevabı kontrol etmek için"
      >
        <select
          id={`${baseId}-dogru-sik`}
          value={correctOption}
          onChange={(event) => setCorrectOption(event.target.value as CorrectOption | '')}
          className={inputClass}
        >
          <option value="">Belirtilmedi</option>
          {OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Not" htmlFor={`${baseId}-not`} hint="İsteğe bağlı">
        <textarea
          id={`${baseId}-not`}
          value={note}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Tarih" htmlFor={`${baseId}-tarih`} hint="Fotoğrafın çekildiği tarih">
        <input
          id={`${baseId}-tarih`}
          type="date"
          value={captureDate}
          onChange={(event) => setCaptureDate(event.target.value)}
          className={inputClass}
        />
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

export function PhotoDetail() {
  const { photoId = '' } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const photo = await db.photos.get(photoId);
    if (!photo) {
      return { photo: undefined, subject: undefined, topic: undefined, exam: undefined };
    }
    const [subject, topic, exam] = await Promise.all([
      db.subjects.get(photo.subjectId),
      photo.topicId ? db.topics.get(photo.topicId) : Promise.resolve(undefined),
      photo.examId ? db.exams.get(photo.examId) : Promise.resolve(undefined),
    ]);
    return { photo, subject, topic, exam };
  }, [photoId]);

  const photo = data?.photo;
  const imageUrl = usePhotoObjectUrl(photo?.id, photo?.blob, 'full');

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Fotoğraf yükleniyor…
      </p>
    );
  }

  if (!photo) {
    return (
      <EmptyState
        icon={Camera}
        title="Fotoğraf bulunamadı"
        description="Bu fotoğraf silinmiş ya da taşınmış olabilir."
        action={
          <Link
            to="/yanlislar"
            className="inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]"
          >
            Yanlışlara dön
          </Link>
        }
      />
    );
  }

  async function toggleMastered() {
    if (!photo || deleting) {
      return;
    }
    setActionError(null);
    try {
      await updatePhoto(photo.id, { mastered: !photo.mastered });
    } catch (caught: unknown) {
      console.error('Fotoğraf durumu değiştirilemedi', caught);
      setActionError('Durum güncellenemedi. Lütfen tekrar dene.');
    }
  }

  async function handleDelete() {
    if (!photo || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePhotos([photo.id]);
      navigate('/yanlislar');
    } catch (caught: unknown) {
      console.error('Fotoğraf silinemedi', caught);
      setDeleteError('Fotoğraf silinemedi. Lütfen tekrar dene.');
      setDeleting(false);
    }
  }

  const { subject, topic, exam } = data;

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: 'Yanlışlar', to: '/yanlislar' }, { label: 'Fotoğraf' }]} />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {photo.examType}
              {subject ? ` · ${subject.name}` : ''}
              {topic ? ` · ${topic.name}` : ''}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {photoLabel(photo)}
            </h1>
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <CheckCircle2
                className={
                  photo.mastered ? 'h-4 w-4 text-[var(--accent)]' : 'h-4 w-4'
                }
                aria-hidden="true"
              />
              Durum: {photo.mastered ? 'Çözüldü' : 'Çözülmedi'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/yanlislar')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Geri
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-canvas">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={photoLabel(photo)}
              className="max-h-[70vh] w-full object-contain"
            />
          ) : (
            <div className="h-64 animate-pulse bg-raised" aria-hidden="true" />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={photo.mastered ? 'secondary' : 'primary'}
            aria-pressed={photo.mastered}
            onClick={() => void toggleMastered()}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {photo.mastered ? 'Çözüldü işaretini kaldır' : 'Çözüldü olarak işaretle'}
          </Button>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Düzenle
          </Button>
          <Button
            variant="secondary"
            className="text-danger hover:text-danger"
            onClick={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Sil
          </Button>
        </div>

        {actionError ? (
          <p role="alert" className="text-sm text-danger">
            {actionError}
          </p>
        ) : null}
      </Card>

      {photo.note.trim() ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold">Not</h2>
          <p className="whitespace-pre-wrap text-sm">{photo.note}</p>
        </Card>
      ) : null}

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Etiketler</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Tür</dt>
            <dd>{photo.examType}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Ders</dt>
            <dd>{subject?.name ?? 'Bilinmeyen ders'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Konu</dt>
            <dd>{topic?.name ?? 'Konu seçilmedi'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">
              Doğru cevap
            </dt>
            <dd>{photo.correctOption ?? 'Girilmedi'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Tarih</dt>
            <dd>{formatExamDate(photo.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Deneme</dt>
            <dd>
              {exam ? (
                <Link
                  to={`/denemeler/${exam.id}`}
                  className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  {exam.name}
                </Link>
              ) : (
                'Denemeye bağlı değil'
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {editing ? <PhotoEditModal photo={photo} onClose={() => setEditing(false)} /> : null}

      {confirmingDelete ? (
        <Modal
          open
          title="Fotoğrafı sil"
          onClose={() => {
            if (!deleting) {
              setConfirmingDelete(false);
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Vazgeç
              </Button>
              <Button
                variant="danger"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? 'Siliniyor…' : 'Sil'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            Bu fotoğraf kalıcı olarak silinecek. Bu işlem geri alınamaz.
          </p>
          {deleteError ? (
            <p role="alert" className="text-sm text-danger">
              {deleteError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
