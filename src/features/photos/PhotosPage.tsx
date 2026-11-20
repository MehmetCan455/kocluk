import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, Check, FlaskConical, Plus, Tags, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { db } from '@/db/db';
import {
  deletePhotos,
  listExams,
  listOpenPracticeSessions,
  listPhotos,
  listSubjects,
  listTopics,
} from '@/db/repositories';
import type { Photo, PhotoFilters as PhotoFiltersValue, Subject } from '@/domain/types';
import {
  describePracticeFilters,
  formatPracticeDate,
  scorePracticeSession,
} from '@/features/practice/practiceSummary';
import { PhotoBulkTagModal } from './PhotoBulkTagModal';
import { PhotoFilters } from './PhotoFilters';
import { PhotoThumb, photoLabel } from './PhotoThumb';
import { PhotoUpload } from './PhotoUpload';

const DAY_MS = 24 * 60 * 60 * 1000;

function weekStartIso(): string {
  const now = new Date();
  const start = new Date(now.getTime() - 6 * DAY_MS);
  return start.toISOString();
}

function hasActiveFilters(filters: PhotoFiltersValue): boolean {
  return (
    filters.examType !== undefined ||
    filters.subjectId !== undefined ||
    filters.topicId !== undefined ||
    filters.examId !== undefined ||
    filters.mastered !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined ||
    Boolean(filters.query)
  );
}

export function PhotosPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<PhotoFiltersValue>({});
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);

  const subjects = useLiveQuery(() => listSubjects(), []);
  const exams = useLiveQuery(() => listExams(), []);
  const topics = useLiveQuery(
    async () => (filters.subjectId ? listTopics(filters.subjectId) : []),
    [filters.subjectId],
  );
  const photos = useLiveQuery(() => listPhotos(filters), [filters]);
  const openSessions = useLiveQuery(() => listOpenPracticeSessions(), []);
  const summary = useLiveQuery(async () => {
    // Counts come from the blob-free projection; the gallery rows themselves
    // still read thumbnails/full metadata (see the report's residual note).
    const [total, mastered] = await Promise.all([
      db.photoSearch.count(),
      db.photoSearch.filter((photo) => photo.mastered).count(),
    ]);
    const thisWeek = await db.photoSearch
      .where('createdAt')
      .aboveOrEqual(weekStartIso())
      .count();
    return { total, mastered, thisWeek };
  }, []);

  const subjectById = new Map((subjects ?? []).map((subject) => [subject.id, subject]));
  const subjectOptions = (subjects ?? []).filter(
    (subject) => filters.examType === undefined || subject.exam === filters.examType,
  );
  const photoList = photos ?? [];
  const activeFilters = hasActiveFilters(filters);

  function handleFiltersChange(next: PhotoFiltersValue) {
    setFilters(next);
    setSelected(new Set());
  }

  function toggleSelected(photoId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }

  function handleCardClick(photo: Photo) {
    if (selecting) {
      toggleSelected(photo.id);
      return;
    }
    navigate(`/yanlislar/${photo.id}`);
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function handleBulkDelete() {
    if (selected.size === 0 || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePhotos([...selected]);
      setSelected(new Set());
      setSelecting(false);
      setConfirmingDelete(false);
    } catch (caught: unknown) {
      console.error('Fotoğraflar silinemedi', caught);
      setDeleteError('Fotoğraflar silinemedi. Lütfen tekrar dene.');
    } finally {
      setDeleting(false);
    }
  }

  if (!subjects || !exams) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Yanlışlar yükleniyor…
      </p>
    );
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Yanlışlar</h1>
          <p className="text-sm text-muted">
            Yanlış yaptığın soruların fotoğraflarını arşivle, filtrele ve tekrar çöz.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/yanlislar/test"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface"
          >
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
            Test oluştur
          </Link>
          <Button onClick={() => setUploadOpen(true)}>
            <Camera className="h-4 w-4" aria-hidden="true" />
            Fotoğraf ekle
          </Button>
        </div>
      </header>

      <Card className="grid grid-cols-3 divide-x divide-line p-0 text-center">
        <div className="px-2 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Toplam</p>
          <p className="text-xl font-semibold tabular-nums">{summary?.total ?? '—'}</p>
        </div>
        <div className="px-2 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Çözülen</p>
          <p className="text-xl font-semibold tabular-nums text-[var(--accent)]">
            {summary?.mastered ?? '—'}
          </p>
        </div>
        <div className="px-2 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Bu hafta</p>
          <p className="text-xl font-semibold tabular-nums">{summary?.thisWeek ?? '—'}</p>
        </div>
      </Card>

      {openSessions && openSessions.length > 0 ? (
        <Card className="space-y-3 border-[var(--accent)]/40">
          <h2 className="text-base font-semibold">Devam eden test</h2>
          <ul className="divide-y divide-line" aria-label="Devam eden testler">
            {openSessions.map((session) => {
              const score = scorePracticeSession(session);
              return (
                <li key={session.id}>
                  <Link
                    to={`/yanlislar/test/${session.id}`}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 transition-colors hover:text-[var(--accent)]"
                  >
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-sm font-medium">
                        {formatPracticeDate(session.createdAt)}
                      </span>
                      <span className="block text-xs text-muted">
                        {describePracticeFilters(session.filters)}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-[var(--accent)] tabular-nums">
                      {`${score.answered}/${score.total} cevaplandı · Devam et`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <PhotoFilters
        value={filters}
        subjects={subjectOptions}
        topics={topics ?? []}
        exams={exams}
        onChange={handleFiltersChange}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" aria-live="polite">
          {photoList.length} fotoğraf
          {selecting ? ` · ${selected.size} seçildi` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {selecting ? (
            <>
              <Link
                to={
                  selected.size > 0
                    ? `/yanlislar/test?photoIds=${[...selected]
                        .map((photoId) => encodeURIComponent(photoId))
                        .join(',')}`
                    : '/yanlislar/test'
                }
                aria-disabled={selected.size === 0}
                tabIndex={selected.size === 0 ? -1 : undefined}
                onClick={(event) => {
                  if (selected.size === 0) {
                    event.preventDefault();
                  }
                }}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface',
                  selected.size === 0 && 'pointer-events-none opacity-50',
                )}
              >
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                Seçilenlerden test oluştur
              </Link>
              <Button variant="secondary" size="sm" onClick={stopSelecting}>
                Seçimi bitir
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => setTagging(true)}
              >
                <Tags className="h-4 w-4" aria-hidden="true" />
                Etiket değiştir
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => {
                  setDeleteError(null);
                  setConfirmingDelete(true);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Seçilenleri sil
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={photoList.length === 0}
              onClick={() => setSelecting(true)}
            >
              Seç
            </Button>
          )}
        </div>
      </div>

      {photos === undefined ? (
        <p role="status" className="py-10 text-center text-sm text-muted">
          Fotoğraflar yükleniyor…
        </p>
      ) : photoList.length === 0 ? (
        <EmptyState
          icon={Camera}
          title={activeFilters ? 'Filtreye uyan fotoğraf yok' : 'Henüz yanlış fotoğrafı yok'}
          description={
            activeFilters
              ? 'Filtreleri temizleyip tüm arşivi görebilirsin.'
              : 'Kamera veya galeriden yanlış soru fotoğrafları ekleyerek başla.'
          }
          action={
            activeFilters ? (
              <Button variant="secondary" onClick={() => handleFiltersChange({})}>
                Filtreleri temizle
              </Button>
            ) : (
              <Button onClick={() => setUploadOpen(true)}>
                <Camera className="h-4 w-4" aria-hidden="true" />
                İlk fotoğrafı ekle
              </Button>
            )
          }
        />
      ) : (
        <ul
          aria-label="Yanlış fotoğrafları"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {photoList.map((photo) => {
            const subject: Subject | undefined = subjectById.get(photo.subjectId);
            const isSelected = selected.has(photo.id);
            return (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => handleCardClick(photo)}
                  aria-label={photoLabel(photo)}
                  aria-pressed={selecting ? isSelected : undefined}
                  className={cn(
                    'group relative block w-full overflow-hidden rounded-2xl border bg-surface text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                    selecting && isSelected
                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
                      : 'border-line hover:border-[var(--accent)]',
                  )}
                >
                  <div className="aspect-square overflow-hidden bg-canvas">
                    <PhotoThumb photo={photo} />
                  </div>
                  <div className="space-y-1 p-2">
                    <p className="line-clamp-2 text-xs font-medium">
                      {photoLabel(photo)}
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      {subject ? (
                        <span className="rounded-md bg-raised px-1.5 py-0.5 text-[11px] text-muted">
                          {subject.name}
                        </span>
                      ) : null}
                      {photo.mastered ? (
                        <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                          Çözüldü
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {selecting ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border text-white',
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent)]'
                          : 'border-white/70 bg-black/40',
                      )}
                    >
                      {isSelected ? <Check className="h-4 w-4" /> : null}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        aria-label="Yeni fotoğraf ekle"
        onClick={() => setUploadOpen(true)}
        className="fixed bottom-24 right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] lg:hidden"
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
      </button>

      {uploadOpen ? (
        <Modal
          open
          title="Fotoğraf yükle"
          onClose={() => {
            if (!uploadBusy) {
              setUploadOpen(false);
            }
          }}
        >
          <PhotoUpload
            onBusyChange={setUploadBusy}
            onClose={() => setUploadOpen(false)}
          />
        </Modal>
      ) : null}

      {tagging ? (
        <PhotoBulkTagModal
          photoIds={[...selected]}
          subjects={subjects ?? []}
          exams={exams ?? []}
          onClose={() => setTagging(false)}
          onSaved={() => {
            setTagging(false);
            setSelected(new Set());
            setSelecting(false);
          }}
        />
      ) : null}

      {confirmingDelete ? (
        <Modal
          open
          title="Fotoğrafları sil"
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
                onClick={() => void handleBulkDelete()}
                disabled={deleting}
              >
                {deleting ? 'Siliniyor…' : 'Sil'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            <span className="font-semibold">{selected.size} fotoğraf</span> kalıcı olarak
            silinecek. Bu işlem geri alınamaz.
          </p>
          {deleteError ? (
            <p role="alert" className="text-sm text-danger">
              {deleteError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}
