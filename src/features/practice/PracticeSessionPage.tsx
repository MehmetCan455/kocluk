import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  StickyNote,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn } from '@/components/ui/cn';
import { db } from '@/db/db';
import {
  cancelPracticeSession,
  completePracticeSession,
  getPracticeSession,
  recordPracticeAnswer,
} from '@/db/repositories';
import type {
  CorrectOption,
  Photo,
  PhotoSearch,
  PracticeSession,
} from '@/domain/types';
import { usePhotoObjectUrl } from '@/features/photos/PhotoThumb';
import {
  formatPracticeDate,
  formatPracticeDuration,
  scorePracticeSession,
} from './practiceSummary';

/** Same fallback as `photoLabel`, without requiring a full photo row. */
function photoNoteLabel(note: string | undefined): string {
  return note?.trim() || 'Yanlış fotoğrafı';
}

const OPTIONS: readonly CorrectOption[] = ['A', 'B', 'C', 'D', 'E'];

const linkButtonClass =
  'inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]';
const secondaryLinkClass =
  'inline-flex min-h-11 items-center rounded-xl border border-line bg-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface';

function CompletedPractice({ session }: { session: PracticeSession }) {
  const score = scorePracticeSession(session);
  const completedAt = session.completedAt ?? session.updatedAt;
  const duration = formatPracticeDuration(session.createdAt, completedAt);

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {formatPracticeDate(completedAt)}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Test tamamlandı</h1>
        <p className="text-sm text-muted">
          Cevaplar kaydedildi; bu test geçmiş listesinde de görünür.
        </p>
      </header>

      <Card>
        <dl aria-label="Test sonucu" className="grid grid-cols-3 divide-x divide-line text-center">
          <div className="px-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Doğru</dt>
            <dd
              aria-label={`Doğru sayısı: ${score.correct}`}
              className="text-2xl font-semibold tabular-nums text-success"
            >
              {score.correct}
            </dd>
          </div>
          <div className="px-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Yanlış</dt>
            <dd
              aria-label={`Yanlış sayısı: ${score.wrong}`}
              className="text-2xl font-semibold tabular-nums text-danger"
            >
              {score.wrong}
            </dd>
          </div>
          <div className="px-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Boş</dt>
            <dd
              aria-label={`Boş sayısı: ${score.blank}`}
              className="text-2xl font-semibold tabular-nums"
            >
              {score.blank}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">
              Toplam soru
            </dt>
            <dd aria-label={`Toplam soru: ${score.total}`} className="font-semibold">
              {score.total}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Süre</dt>
            <dd aria-label={`Süre: ${duration}`} className="font-semibold">
              {duration}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Skor</dt>
            <dd className="font-semibold tabular-nums">{`${score.correct}/${score.total} doğru`}</dd>
          </div>
        </dl>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link to="/yanlislar/test" className={linkButtonClass}>
          Rastgele teste dön
        </Link>
        <Link to="/yanlislar" className={secondaryLinkClass}>
          Yanlışlara dön
        </Link>
      </div>
    </section>
  );
}

interface CancelPracticeModalProps {
  cancelling: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

function CancelPracticeModal({
  cancelling,
  error,
  onClose,
  onConfirm,
}: CancelPracticeModalProps) {
  return (
    <Modal
      open
      title="Testi iptal et"
      onClose={() => {
        if (!cancelling) {
          onClose();
        }
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={cancelling}>
            Vazgeç
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={cancelling}
            aria-busy={cancelling}
          >
            {cancelling ? 'İptal ediliyor…' : 'İptal et'}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        Bu oturum kapatılacak ve “Devam eden test” listesinden kalkacak. Cevapladığın
        soruların sonuçları ve fotoğraf durumları korunur; iptal edilen cevaplar geri
        alınmaz.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

export function PracticeSessionPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const noteId = useId();
  const [index, setIndex] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const initializedFor = useRef<string | null>(null);

  // Only the blob-free projection is loaded for the whole session. Image data
  // is fetched separately for the current photo only (see `currentPhoto`).
  const data = useLiveQuery(async () => {
    const session = await getPracticeSession(sessionId);
    if (!session) {
      return { session: undefined, photos: [] as PhotoSearch[] };
    }
    const rows = await db.photoSearch.bulkGet(session.photoIds);
    const byId = new Map(
      rows
        .filter((row): row is PhotoSearch => row !== undefined)
        .map((row) => [row.id, row]),
    );
    const photos = session.photoIds
      .map((photoId) => byId.get(photoId))
      .filter((photo): photo is PhotoSearch => photo !== undefined);
    return { session, photos };
  }, [sessionId]);

  const session = data?.session;
  const photos = data?.photos ?? [];
  const safeIndex = Math.min(index, Math.max(0, photos.length - 1));
  const current = photos[safeIndex];
  const loadedPhoto = useLiveQuery(
    async () => (current ? db.photos.get(current.id) : undefined),
    [current?.id],
  );
  // Ignore the previous photo while the new blob read is in flight.
  const currentPhoto: Photo | undefined =
    loadedPhoto && current && loadedPhoto.id === current.id ? loadedPhoto : undefined;
  const imageUrl = usePhotoObjectUrl(currentPhoto?.id, currentPhoto?.blob, 'full');
  const currentNote = currentPhoto?.note ?? current?.note ?? '';
  const currentLabel = photoNoteLabel(currentNote);

  // Resume once per session at the first unanswered visible photo. Live-query
  // updates after each answer must not move the reader back.
  useEffect(() => {
    const loaded = data?.session;
    if (!loaded || loaded.completedAt || initializedFor.current === loaded.id) {
      return;
    }
    initializedFor.current = loaded.id;
    const firstUnanswered = data.photos.findIndex(
      (photo) => !loaded.results[photo.id],
    );
    setIndex(
      firstUnanswered === -1 ? Math.max(0, data.photos.length - 1) : firstUnanswered,
    );
    setZoom(1);
    setNoteOpen(false);
  }, [data]);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Test yükleniyor…
      </p>
    );
  }

  if (!session) {
    return (
      <EmptyState
        icon={StickyNote}
        title="Test bulunamadı"
        description="Bu test silinmiş ya da bağlantı eski olabilir."
        action={
          <Link to="/yanlislar/test" className={linkButtonClass}>
            Rastgele teste dön
          </Link>
        }
      />
    );
  }

  if (session.completedAt) {
    return <CompletedPractice session={session} />;
  }

  async function finish() {
    if (!session || finishing) {
      return;
    }
    setFinishing(true);
    setError(null);
    try {
      await completePracticeSession(session.id);
    } catch (caught: unknown) {
      console.error('Test bitirilemedi', caught);
      setError('Test bitirilemedi. Lütfen tekrar dene.');
      setFinishing(false);
    }
  }

  async function cancel() {
    if (!session || cancelling) {
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelPracticeSession(session.id);
      navigate('/yanlislar/test');
    } catch (caught: unknown) {
      console.error('Test iptal edilemedi', caught);
      setCancelError('Test iptal edilemedi. Lütfen tekrar dene.');
      setCancelling(false);
    }
  }

  const cancelModal = confirmingCancel ? (
    <CancelPracticeModal
      cancelling={cancelling}
      error={cancelError}
      onClose={() => {
        setConfirmingCancel(false);
        setCancelError(null);
      }}
      onConfirm={() => void cancel()}
    />
  ) : null;

  if (photos.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={StickyNote}
          title="Bu testteki fotoğraflar silinmiş"
          description="Cevaplanan sonuçlar korunur. Testi bitirerek geçmişe ekleyebilirsin."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void finish()} disabled={finishing || saving}>
                {finishing ? 'Bitiriliyor…' : 'Testi bitir'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmingCancel(true)}
                disabled={cancelling}
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                Testi iptal et
              </Button>
              <Link to="/yanlislar/test" className={secondaryLinkClass}>
                Rastgele teste dön
              </Link>
            </div>
          }
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {cancelModal}
      </div>
    );
  }

  const answeredVisible = photos.filter((photo) => session.results[photo.id]).length;
  const answered = current ? session.results[current.id] : undefined;
  const answeredChoice = current ? session.choices?.[current.id] : undefined;
  const correctOption = current?.correctOption;

  async function answerChoice(option: CorrectOption) {
    if (!session || !current || saving || answered || !correctOption) {
      return;
    }
    const outcome = option === correctOption ? 'correct' : 'wrong';
    setSaving(true);
    setError(null);
    try {
      await recordPracticeAnswer(session.id, current.id, outcome, option);
    } catch (caught: unknown) {
      console.error('Cevap kaydedilemedi', caught);
      setError('Cevap kaydedilemedi. Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  }

  async function answerBlank() {
    if (!session || !current || saving || answered) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordPracticeAnswer(session.id, current.id, 'blank', 'blank');
    } catch (caught: unknown) {
      console.error('Cevap kaydedilemedi', caught);
      setError('Cevap kaydedilemedi. Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  }

  function goTo(nextIndex: number) {
    setIndex(Math.min(Math.max(0, nextIndex), photos.length - 1));
    setZoom(1);
    setNoteOpen(false);
  }

  function changeZoom(delta: number) {
    setZoom((currentZoom) =>
      Math.min(3, Math.max(1, Number((currentZoom + delta).toFixed(1)))),
    );
  }

  return (
    <section className="space-y-4">
      <Breadcrumb
        items={[
          { label: 'Yanlışlar', to: '/yanlislar' },
          { label: 'Rastgele Test', to: '/yanlislar/test' },
          { label: 'Test oturumu' },
        ]}
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Test oturumu</h1>
          <p className="text-sm font-medium" aria-live="polite">
            {`Soru ${safeIndex + 1} / ${photos.length}`}
          </p>
        </div>
        <p className="text-sm text-muted">{`${answeredVisible} / ${photos.length} cevaplandı`}</p>
      </header>

      <ProgressBar
        value={photos.length === 0 ? 0 : (answeredVisible / photos.length) * 100}
        label="Test ilerlemesi"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Uzaklaştır"
            onClick={() => changeZoom(-0.5)}
            disabled={zoom <= 1}
            className="w-11 px-0"
          >
            <ZoomOut className="h-5 w-5" aria-hidden="true" />
          </Button>
          <span
            aria-live="polite"
            className="grid min-h-11 min-w-14 place-items-center rounded-xl border border-line bg-raised px-2 text-sm tabular-nums"
          >
            {`${Math.round(zoom * 100)}%`}
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Yakınlaştır"
            onClick={() => changeZoom(0.5)}
            disabled={zoom >= 3}
            className="w-11 px-0"
          >
            <ZoomIn className="h-5 w-5" aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Görseli sığdır"
            onClick={() => setZoom(1)}
            disabled={zoom === 1}
            className="w-11 px-0"
          >
            <Maximize2 className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>

        <Button
          variant="secondary"
          size="sm"
          aria-expanded={noteOpen}
          aria-controls={noteId}
          disabled={!currentNote.trim()}
          onClick={() => setNoteOpen((open) => !open)}
        >
          <StickyNote className="h-4 w-4" aria-hidden="true" />
          {noteOpen ? 'Notu gizle' : 'Notu göster'}
        </Button>
      </div>

      <div
        className="overflow-auto rounded-xl border border-line bg-canvas"
        style={{ height: '60dvh', maxHeight: '70vh' }}
      >
        <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={currentLabel}
              draggable={false}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="h-full w-full animate-pulse bg-raised" aria-hidden="true" />
          )}
        </div>
      </div>

      <div id={noteId}>
        {noteOpen && currentNote.trim() ? (
          <Card className="space-y-2">
            <h2 className="text-base font-semibold">Not</h2>
            <p className="whitespace-pre-wrap text-sm">{currentNote}</p>
          </Card>
        ) : null}
      </div>

      <div role="group" aria-label="Cevap" className="space-y-2">
        {!correctOption && !answered ? (
          <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            Bu sorunun doğru şıkkı girilmemiş. Fotoğraf detayından doğru şıkkı
            ekleyebilirsin; şimdilik boş bırakabilirsin.
          </p>
        ) : null}
        <div className="grid grid-cols-5 gap-2">
          {OPTIONS.map((option) => {
            const chosen = answeredChoice === option;
            const isCorrect = correctOption === option;
            return (
              <Button
                key={option}
                variant="secondary"
                aria-label={`${option} seçeneği`}
                aria-pressed={chosen}
                disabled={saving || Boolean(answered) || !correctOption}
                onClick={() => void answerChoice(option)}
                className={cn(
                  'min-h-12 text-base font-semibold',
                  answered && isCorrect && 'border-success bg-success/15 text-success',
                  answered && chosen && !isCorrect && 'border-danger bg-danger/15 text-danger',
                  !answered && chosen && 'border-[var(--accent)] bg-[var(--accent-soft)]',
                )}
              >
                {option}
              </Button>
            );
          })}
        </div>
        <Button
          variant="secondary"
          onClick={() => void answerBlank()}
          disabled={saving || Boolean(answered)}
          className="w-full"
        >
          Boş bırak
        </Button>
      </div>

      {answered ? (
        <p
          role="status"
          className={cn(
            'rounded-xl border px-3 py-2 text-sm font-medium',
            answered === 'correct'
              ? 'border-success/40 bg-success/10 text-success'
              : answered === 'wrong'
                ? 'border-danger/40 bg-danger/10 text-danger'
                : 'border-line bg-raised text-fg',
          )}
        >
          {answered === 'correct'
            ? `Doğru! Doğru cevap: ${correctOption}`
            : answered === 'wrong'
              ? `Yanlış.${answeredChoice && answeredChoice !== 'blank' ? ` Senin cevabın: ${answeredChoice}.` : ''} Doğru cevap: ${correctOption ?? '—'}`
              : `Boş bırakıldı.${correctOption ? ` Doğru cevap: ${correctOption}` : ''}`}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          onClick={() => goTo(safeIndex - 1)}
          disabled={safeIndex === 0}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Önceki
        </Button>
        <Button
          variant="secondary"
          onClick={() => goTo(safeIndex + 1)}
          disabled={safeIndex === photos.length - 1}
        >
          Sonraki
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {answeredVisible === photos.length ? (
          <Button onClick={() => void finish()} disabled={finishing || saving}>
            {finishing ? 'Bitiriliyor…' : 'Testi bitir'}
          </Button>
        ) : (
          <p className="text-sm text-muted">Bitirmek için tüm soruları cevapla.</p>
        )}
        <Button
          variant="ghost"
          className="text-danger hover:bg-danger/10 hover:text-danger"
          onClick={() => setConfirmingCancel(true)}
          disabled={cancelling}
        >
          <XCircle className="h-4 w-4" aria-hidden="true" />
          Testi iptal et
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {cancelModal}
    </section>
  );
}
