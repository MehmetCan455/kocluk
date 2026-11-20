import { useId, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, History, Play } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { cn } from '@/components/ui/cn';
import {
  createPracticeSession,
  listExams,
  listPhotoSearch,
  listPracticeSessions,
  listSubjects,
  listTopics,
} from '@/db/repositories';
import type { ExamType, PhotoSearch, PracticeFilters } from '@/domain/types';
import { formatExamDate } from '@/features/exams/examFormat';
import { selectPracticePhotos } from './practiceSelection';
import {
  describePracticeFilters,
  formatPracticeDate,
  scorePracticeSession,
} from './practiceSummary';

const HISTORY_LIMIT = 10;
const COUNT_OPTIONS = [5, 10, 20] as const;
const DEFAULT_COUNT = 10;

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

/** Stable shuffle for the live preview; the real start uses Math.random. */
const previewShuffle = () => 0.999;

export function PracticeWizard() {
  const navigate = useNavigate();
  const baseId = useId().replace(/:/g, '');
  const [searchParams] = useSearchParams();
  const [examType, setExamType] = useState<ExamType | undefined>();
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [examId, setExamId] = useState('');
  const [onlyUnmastered, setOnlyUnmastered] = useState(true);
  const [count, setCount] = useState<number | undefined>(DEFAULT_COUNT);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjects = useLiveQuery(() => listSubjects(), []);
  const exams = useLiveQuery(() => listExams(examType), [examType]);
  // Only the blob-free projection is needed to build a session; image data is
  // read one photo at a time on the session screen.
  const photos = useLiveQuery(() => listPhotoSearch(), []);
  const history = useLiveQuery(() => listPracticeSessions(HISTORY_LIMIT), []);

  const subjectKey = subjectIds.join(',');
  const topics = useLiveQuery(async () => {
    if (subjectIds.length === 0) {
      return [];
    }
    const lists = await Promise.all(subjectIds.map((subjectId) => listTopics(subjectId)));
    return lists.flat();
  }, [subjectKey]);

  const preselectedIds = useMemo(() => {
    const raw = searchParams.get('photoIds');
    if (!raw) {
      return [];
    }
    return [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))];
  }, [searchParams]);

  const subjectById = useMemo(
    () => new Map((subjects ?? []).map((subject) => [subject.id, subject])),
    [subjects],
  );
  const photoById = useMemo(
    () => new Map((photos ?? []).map((photo) => [photo.id, photo])),
    [photos],
  );

  const preselectedPhotos = preselectedIds
    .map((photoId) => photoById.get(photoId))
    .filter((photo): photo is PhotoSearch => photo !== undefined);
  const preselectedTestable = preselectedPhotos.filter((photo) => photo.correctOption);
  const missingSelected = preselectedPhotos.length - preselectedTestable.length;
  const missingCorrectCount = (photos ?? []).filter((photo) => !photo.correctOption).length;
  const selectionMode = preselectedIds.length > 0;

  const filters: PracticeFilters = {
    examType,
    subjectIds: subjectIds.length > 0 ? subjectIds : undefined,
    topicIds: topicIds.length > 0 ? topicIds : undefined,
    examId: examId || undefined,
    onlyUnmastered,
    count,
  };

  const available = useMemo(
    () => selectPracticePhotos(photos ?? [], filters, previewShuffle),
    // The primitive fields fully describe `filters`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [photos, examType, subjectIds, topicIds, examId, onlyUnmastered, count],
  );
  const plannedCount = count === undefined ? available.length : Math.min(count, available.length);
  const lostPhotos = preselectedIds.length - preselectedPhotos.length;
  const canStart = selectionMode ? preselectedTestable.length > 0 : available.length > 0;
  const subjectOptions = (subjects ?? []).filter(
    (subject) => examType === undefined || subject.exam === examType,
  );

  function changeExamType(value: string) {
    const next = value ? (value as ExamType) : undefined;
    setExamType(next);
    setExamId('');
    setTopicIds([]);
    setSubjectIds((current) =>
      next === undefined
        ? current
        : current.filter((subjectId) => subjectById.get(subjectId)?.exam === next),
    );
  }

  function toggleSubject(subjectId: string) {
    setTopicIds([]);
    setSubjectIds((current) =>
      current.includes(subjectId)
        ? current.filter((currentId) => currentId !== subjectId)
        : [...current, subjectId],
    );
  }

  function toggleTopic(topicId: string) {
    setTopicIds((current) =>
      current.includes(topicId)
        ? current.filter((currentId) => currentId !== topicId)
        : [...current, topicId],
    );
  }

  async function startTest() {
    if (starting || !canStart) {
      return;
    }

    const chosen = selectionMode
      ? preselectedTestable
      : selectPracticePhotos(photos ?? [], filters);
    if (chosen.length === 0) {
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const session = await createPracticeSession({
        // Manual selection is independent of mastery, so the stored snapshot
        // must not claim the "only unmastered" filter was applied.
        filters: selectionMode ? { onlyUnmastered: false } : filters,
        photoIds: chosen.map((photo) => photo.id),
      });
      navigate(`/yanlislar/test/${session.id}`);
    } catch (caught: unknown) {
      console.error('Test başlatılamadı', caught);
      setError('Test başlatılamadı. Lütfen tekrar dene.');
      setStarting(false);
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Rastgele Test</h1>
          <p className="text-sm text-muted">
            Yanlış fotoğraflarından filtreleyerek rastgele bir test oluştur.
          </p>
        </div>
        <Link
          to="/yanlislar"
          className="inline-flex min-h-11 items-center rounded-xl border border-line bg-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface"
        >
          Yanlışlara dön
        </Link>
      </header>

      {!subjects || !photos ? (
        <p role="status" className="py-10 text-center text-sm text-muted">
          Test seçenekleri yükleniyor…
        </p>
      ) : selectionMode ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Seçilen fotoğraflar</h2>
              <p className="text-sm text-muted">
                {preselectedTestable.length} fotoğraf testte kullanılacak.
              </p>
            </div>
            <Link
              to="/yanlislar/test"
              className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Seçimi temizle
            </Link>
          </div>
          {lostPhotos > 0 ? (
            <p role="status" className="text-sm text-warning">
              Seçilen {lostPhotos} fotoğraf silinmiş; testte atlanacak.
            </p>
          ) : null}
          {missingSelected > 0 ? (
            <p role="status" className="text-sm text-warning">
              Seçilen {missingSelected} fotoğrafın doğru şıkkı girilmemiş; testte
              kullanılmaz. Fotoğraf detayından doğru şıkkı ekleyebilirsin.
            </p>
          ) : null}
        </Card>
      ) : (
        <Card className="space-y-5">
          <h2 className="text-base font-semibold">Test filtreleri</h2>

          <Field label="Sınav türü" htmlFor={`${baseId}-tur`}>
            <select
              id={`${baseId}-tur`}
              value={examType ?? ''}
              onChange={(event) => changeExamType(event.target.value)}
              className={inputClass}
            >
              <option value="">Karışık (TYT + AYT)</option>
              <option value="TYT">TYT</option>
              <option value="AYT">AYT</option>
            </select>
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">Dersler</legend>
            <p className="text-xs text-muted">Seçmezsen tüm dersler dahil olur.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {subjectOptions.map((subject) => {
                const selected = subjectIds.includes(subject.id);
                return (
                  <label
                    key={subject.id}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition-colors',
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-line bg-canvas hover:border-[var(--accent)]',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSubject(subject.id)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    <span>
                      {subject.exam} · {subject.name}
                    </span>
                  </label>
                );
              })}
            </div>
            {subjectOptions.length === 0 ? (
              <p className="text-sm text-muted">Bu türde ders bulunamadı.</p>
            ) : null}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">Konular</legend>
            {subjectIds.length === 0 ? (
              <p className="text-xs text-muted">Konu seçmek için önce ders seç.</p>
            ) : topics === undefined ? (
              <p role="status" className="text-xs text-muted">
                Konular yükleniyor…
              </p>
            ) : topics.length === 0 ? (
              <p className="text-xs text-muted">Seçilen derslerde konu yok.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {topics.map((topic) => {
                  const selected = topicIds.includes(topic.id);
                  return (
                    <label
                      key={topic.id}
                      className={cn(
                        'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition-colors',
                        selected
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                          : 'border-line bg-canvas hover:border-[var(--accent)]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleTopic(topic.id)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span>{topic.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <Field label="Deneme (isteğe bağlı)" htmlFor={`${baseId}-deneme`}>
            <select
              id={`${baseId}-deneme`}
              value={examId}
              onChange={(event) => setExamId(event.target.value)}
              className={inputClass}
            >
              <option value="">Tüm denemeler</option>
              {(exams ?? []).map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.type} · {exam.name} · {formatExamDate(exam.date)}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-start gap-3 rounded-xl border border-line bg-canvas p-3">
            <input
              id={`${baseId}-sadece`}
              type="checkbox"
              checked={onlyUnmastered}
              aria-describedby={`${baseId}-sadece-hint`}
              onChange={(event) => setOnlyUnmastered(event.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            <div className="space-y-1">
              <label
                htmlFor={`${baseId}-sadece`}
                className="block text-sm font-medium text-fg"
              >
                Sadece çözülmemişler
              </label>
              <p id={`${baseId}-sadece-hint`} className="text-xs text-muted">
                Çözüldü olarak işaretlenen fotoğraflar testte yer almaz.
              </p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">Soru sayısı</legend>
            <div role="group" aria-label="Soru sayısı" className="flex flex-wrap gap-2">
              {COUNT_OPTIONS.map((value) => {
                const selected = count === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value} soru`}
                    aria-pressed={selected}
                    onClick={() => setCount(value)}
                    className={cn(
                      'min-h-11 rounded-xl border px-4 text-sm font-medium transition-colors',
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-line bg-canvas text-muted hover:text-fg',
                    )}
                  >
                    {value}
                  </button>
                );
              })}
              <button
                type="button"
                aria-label="Tümü sorular"
                aria-pressed={count === undefined}
                onClick={() => setCount(undefined)}
                className={cn(
                  'min-h-11 rounded-xl border px-4 text-sm font-medium transition-colors',
                  count === undefined
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-line bg-canvas text-muted hover:text-fg',
                )}
              >
                Tümü
              </button>
            </div>
            {count === undefined ? (
              <p role="status" className="text-sm text-warning">
                Tümü seçildi: filtreye uyan bütün fotoğraflar teste girer. Büyük arşivlerde
                test uzun sürebilir; 10 soruluk varsayılanı öneririz.
              </p>
            ) : null}
          </fieldset>
        </Card>
      )}

      <Card className="space-y-3" aria-label="Test özeti">
        <h2 className="text-base font-semibold">Test özeti</h2>

        {selectionMode ? (
          <p className="text-sm" aria-live="polite">
            {`Seçilen ${preselectedTestable.length} fotoğraftan test oluşturulacak.`}
          </p>
        ) : (
          <>
            <p className="text-sm" aria-live="polite">
              {`Test ${plannedCount} fotoğraftan oluşacak.`}
            </p>
            <p className="text-xs text-muted">{describePracticeFilters(filters)}</p>
            {missingCorrectCount > 0 ? (
              <p className="text-sm text-warning">
                {missingCorrectCount} fotoğrafın doğru şıkkı girilmemiş; bunlar testte
                kullanılmaz. Fotoğraf detayından şık ekleyebilirsin.
              </p>
            ) : null}
            {count !== undefined && available.length < count ? (
              <p className="text-sm text-warning">
                Yalnızca {available.length} fotoğraf var; test {available.length} sorudan
                oluşacak.
              </p>
            ) : null}
            {available.length === 0 ? (
              <p role="alert" className="text-sm text-warning">
                Filtreye uyan fotoğraf yok. Filtreleri gevşetip tekrar dene.
              </p>
            ) : null}
          </>
        )}

        <Button onClick={() => void startTest()} disabled={starting || !canStart}>
          <Play className="h-4 w-4" aria-hidden="true" />
          {starting ? 'Başlatılıyor…' : 'Testi başlat'}
        </Button>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Geçmiş testler</h2>
          <History className="h-4 w-4 text-muted" aria-hidden="true" />
        </div>

        {history === undefined ? (
          <p role="status" className="text-sm text-muted">
            Geçmiş yükleniyor…
          </p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">Henüz tamamlanmış test yok.</p>
        ) : (
          <ul aria-label="Geçmiş testler" className="divide-y divide-line">
            {history.map((session) => {
              const score = scorePracticeSession(session);
              return (
                <li key={session.id}>
                  <Link
                    to={`/yanlislar/test/${session.id}`}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 transition-colors hover:text-[var(--accent)]"
                  >
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-sm font-medium">
                        {formatPracticeDate(session.completedAt ?? session.createdAt)}
                      </span>
                      <span className="block text-xs text-muted">
                        {describePracticeFilters(session.filters)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                      {`${score.correct}/${score.total} doğru`}
                      <ChevronRight className="h-4 w-4 text-muted" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
