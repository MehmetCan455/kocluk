import { useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  StickyNote,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn } from '@/components/ui/cn';
import { db } from '@/db/db';
import {
  completePracticeSession,
  getPracticeSession,
  recordPracticeAnswer,
} from '@/db/repositories';
import type { Photo, PracticeOutcome, PracticeSession } from '@/domain/types';
import { photoLabel, usePhotoObjectUrl } from '@/features/photos/PhotoThumb';
import {
  formatPracticeDate,
  formatPracticeDuration,
  scorePracticeSession,
} from './practiceSummary';

const OUTCOMES: ReadonlyArray<{
  value: PracticeOutcome;
  label: string;
  selectedClass: string;
}> = [
  {
    value: 'correct',
    label: 'Doğru',
    selectedClass: 'border-success bg-success/15 text-success',
  },
  {
    value: 'wrong',
    label: 'Yanlış',
    selectedClass: 'border-danger bg-danger/15 text-danger',
  },
  {
    value: 'blank',
    label: 'Boş',
    selectedClass: 'border-fg/40 bg-raised text-fg',
  },
];

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

export function PracticeSessionPage() {
  const { sessionId = '' } = useParams();
  const noteId = useId();
  const [index, setIndex] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedFor = useRef<string | null>(null);

  const data = useLiveQuery(async () => {
    const session = await getPracticeSession(sessionId);
    if (!session) {
      return { session: undefined, photos: [] as Photo[] };
    }
    const rows = await db.photos.bulkGet(session.photoIds);
    return {
      session,
      photos: rows.filter((photo): photo is Photo => photo !== undefined),
    };
  }, [sessionId]);

  const session = data?.session;
  const photos = data?.photos ?? [];
  const safeIndex = Math.min(index, Math.max(0, photos.length - 1));
  const current = photos[safeIndex];
  const imageUrl = usePhotoObjectUrl(current?.id, current?.blob, 'full');

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
      </div>
    );
  }

  const answeredVisible = photos.filter((photo) => session.results[photo.id]).length;
  const answered = current ? session.results[current.id] : undefined;
  const currentLabel = current ? photoLabel(current) : 'Yanlış fotoğrafı';

  async function answer(outcome: PracticeOutcome) {
    if (!session || !current || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordPracticeAnswer(session.id, current.id, outcome);
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
          disabled={!current?.note.trim()}
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
        {noteOpen && current?.note.trim() ? (
          <Card className="space-y-2">
            <h2 className="text-base font-semibold">Not</h2>
            <p className="whitespace-pre-wrap text-sm">{current.note}</p>
          </Card>
        ) : null}
      </div>

      <div role="group" aria-label="Cevap" className="grid grid-cols-3 gap-2">
        {OUTCOMES.map((outcome) => (
          <Button
            key={outcome.value}
            variant="secondary"
            aria-pressed={answered === outcome.value}
            disabled={saving}
            onClick={() => void answer(outcome.value)}
            className={cn(
              'min-h-12',
              answered === outcome.value ? outcome.selectedClass : 'border-line',
            )}
          >
            {outcome.label}
          </Button>
        ))}
      </div>

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

      {answeredVisible === photos.length ? (
        <Button onClick={() => void finish()} disabled={finishing || saving}>
          {finishing ? 'Bitiriliyor…' : 'Testi bitir'}
        </Button>
      ) : (
        <p className="text-sm text-muted">Bitirmek için tüm soruları cevapla.</p>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
