import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive,
  CalendarDays,
  Camera,
  ClipboardList,
  Library,
  Plus,
  X,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { RingProgress } from '@/components/ui/RingProgress';
import { db } from '@/db/db';
import {
  listBookReadRanges,
  listShelfBooks,
  type BookPageRange,
  type ShelfBook,
} from '@/db/bookRepositories';
import {
  listAllExamResults,
  listAllTopics,
  listFullExams,
  listSubjects,
} from '@/db/repositories';
import { listAllTopicProgress } from '@/db/topicProgressRepository';
import {
  calculateSubjectProgress,
  countsForSubject,
  effectiveTopicPercent,
  subjectBookEstimate,
} from '@/domain/subjectEstimate';
import type {
  Exam,
  ExamResult,
  ExamType,
  Progress,
  Subject,
  Topic,
  TopicProgress,
} from '@/domain/types';
import { daysUntil } from '@/lib/date';
import { formatNet, formatPercent } from '@/lib/format';
import {
  formatAlan,
  formatExamDate,
  sumNet,
} from '@/features/exams/examFormat';
import { resolveAytAlan } from '@/features/exams/examConfig';
import {
  buildNetSeries,
  DASHBOARD_CHART_POINTS,
  tailSeries,
  type NetSeries,
} from './chartData';
import { NetTrendChart } from './NetTrendChart';
import { TodayPlanCard } from './TodayPlanCard';

const todayFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const CHART_TYPES: ReadonlyArray<ExamType> = ['TYT', 'AYT'];

function countdownDays(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  const days = daysUntil(value);
  return Number.isFinite(days) ? days : null;
}

interface DashboardData {
  subjects: Subject[];
  topics: Topic[];
  topicProgress: TopicProgress[];
  shelfBooks: ShelfBook[];
  readRanges: Map<string, BookPageRange[]>;
  exams: Exam[];
  results: ExamResult[];
  photosSinceBackup: number;
}

interface NetStats {
  count: number;
  highest: number;
  average: number;
}

/**
 * Highest and average total net for one exam type. Only exams with at least
 * one result row count; an exam created without results is not a 0-net exam.
 */
function netStatsFor(
  exams: ReadonlyArray<Exam>,
  resultsByExam: ReadonlyMap<string, ExamResult[]>,
  type: ExamType,
): NetStats | null {
  const totals = exams
    .filter((exam) => exam.type === type)
    .map((exam) => resultsByExam.get(exam.id) ?? [])
    .filter((results) => results.length > 0)
    .map((results) => sumNet(results));

  if (totals.length === 0) {
    return null;
  }
  const highest = totals.reduce((best, net) => Math.max(best, net), totals[0]);
  const average = totals.reduce((sum, net) => sum + net, 0) / totals.length;
  return { count: totals.length, highest, average };
}

const quickAddLinkClass =
  'flex min-h-11 items-center gap-3 rounded-xl border border-line bg-raised/60 px-3 py-2 text-sm font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]';

function StatCard({
  label,
  progress,
  extra,
}: {
  label: string;
  progress: Progress;
  extra: string;
}) {
  return (
    <Card className="flex items-center gap-4">
      <RingProgress value={progress.percent} label={label} size={64} />
      <div className="min-w-0 space-y-1">
        <h2 className="text-sm font-medium text-muted">{label}</h2>
        <p className="text-sm tabular-nums">
          {progress.solved}/{progress.total} konu
        </p>
        <p className="text-xs text-muted">{extra}</p>
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { settings } = useAppSettings();
  const [chartType, setChartType] = useState<ExamType>('TYT');
  const reminderSignature = settings.lastBackupAt ?? 'never';
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('kocluk:backup-reminder-dismissed');
    } catch {
      return null;
    }
  });
  const reminderDismissed = dismissedSignature === reminderSignature;

  const data = useLiveQuery(async (): Promise<DashboardData> => {
    // One read per table plus one grouped read for active page ranges: no
    // per-book or per-exam query on the dashboard. Percentages combine explicit
    // topic completion with the shelf-book estimate, the book cards use the
    // page-based shelf, and the backup reminder counts only photos added after
    // the last export.
    const lastBackupAt = settings.lastBackupAt;
    const [
      subjects,
      topics,
      topicProgress,
      shelfBooks,
      exams,
      results,
      photosSinceBackup,
    ] = await Promise.all([
      listSubjects(),
      listAllTopics(),
      listAllTopicProgress(),
      listShelfBooks(),
      listFullExams(),
      listAllExamResults(),
      lastBackupAt
        ? db.photos.where('createdAt').above(lastBackupAt).count()
        : db.photos.count(),
    ]);
    const readRanges = await listBookReadRanges(
      shelfBooks.map((book) => book.userBook.id),
    );
    return {
      subjects,
      topics,
      topicProgress,
      shelfBooks,
      readRanges,
      exams,
      results,
      photosSinceBackup,
    };
  }, [settings.lastBackupAt]);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Ana sayfa yükleniyor…
      </p>
    );
  }

  const hidden = new Set(settings.hiddenSubjects);
  const subjectById = new Map(data.subjects.map((subject) => [subject.id, subject]));
  const visibleSubjectIds = new Set(
    data.subjects.filter((subject) => !hidden.has(subject.id)).map((subject) => subject.id),
  );
  const visibleTopics = data.topics.filter((topic) =>
    visibleSubjectIds.has(topic.subjectId),
  );
  const doneTopicIds = new Set(
    data.topicProgress.filter((row) => row.done).map((row) => row.topicId),
  );

  // Every subject's shelf books are distributed over its topic list, so a book
  // that has not been finished by hand still moves the dashboard percentages.
  // Topics and books use the same deterministic order as the subject pages;
  // `listAllTopics` is primary-key order, not curriculum order.
  const bookPercentByTopic = new Map<string, number>();
  for (const subject of data.subjects) {
    const subjectTopics = data.topics
      .filter((topic) => topic.subjectId === subject.id)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    if (subjectTopics.length === 0) {
      continue;
    }
    const pageReads = data.shelfBooks
      .filter(
        (book) =>
          book.progress.hasTotalPages &&
          countsForSubject(
            {
              title: book.catalogBook.title,
              exam: book.catalogBook.exam,
              subjectSlug: book.catalogBook.subjectSlug,
            },
            subject,
          ),
      )
      .sort(
        (a, b) =>
          a.userBook.createdAt.localeCompare(b.userBook.createdAt) ||
          a.userBook.id.localeCompare(b.userBook.id),
      )
      .map((book) => ({
        totalPages: book.totalPages,
        ranges: data.readRanges.get(book.userBook.id) ?? [],
      }));
    const { byTopic } = subjectBookEstimate(
      subjectTopics.map((topic) => topic.id),
      pageReads,
    );
    for (const [topicId, percent] of byTopic) {
      bookPercentByTopic.set(topicId, percent);
    }
  }

  function progressForExam(exam?: ExamType): {
    progress: Progress;
    topicCount: number;
    estimated: boolean;
  } {
    const topics =
      exam === undefined
        ? visibleTopics
        : visibleTopics.filter(
            (topic) => subjectById.get(topic.subjectId)?.exam === exam,
          );
    const bookPercents = topics.map(
      (topic) => bookPercentByTopic.get(topic.id) ?? 0,
    );
    const percentages = topics.map((topic, index) =>
      effectiveTopicPercent(doneTopicIds.has(topic.id), bookPercents[index]!),
    );
    const hasBookEstimate = bookPercents.some((percent) => percent > 0);
    return {
      progress: calculateSubjectProgress(
        percentages,
        percentages.some((percent) => percent > 0),
      ),
      topicCount: topics.length,
      estimated: hasBookEstimate,
    };
  }

  const overall = progressForExam();
  const tytProgress = progressForExam('TYT');
  const aytProgress = progressForExam('AYT');

  const topBooks = data.shelfBooks.slice(0, 5);

  const resultsByExam = new Map<string, ExamResult[]>();
  for (const result of data.results) {
    const results = resultsByExam.get(result.examId);
    if (results) {
      results.push(result);
    } else {
      resultsByExam.set(result.examId, [result]);
    }
  }

  const recentExams = data.exams.slice(0, 5).map((exam) => ({
    exam,
    totalNet: sumNet(resultsByExam.get(exam.id) ?? []),
  }));

  // Only exams that actually have a result row count towards the net cards. A
  // newly created exam with no subjects entered has a total of 0, but it is not
  // a 0-net exam and must not drag the average down. TYT and AYT are never
  // mixed: each type has its own highest and average.
  const netStatsByType: ReadonlyArray<{ type: ExamType; stats: NetStats | null }> = [
    { type: 'TYT', stats: netStatsFor(data.exams, resultsByExam, 'TYT') },
    { type: 'AYT', stats: netStatsFor(data.exams, resultsByExam, 'AYT') },
  ];

  const chartSeries: NetSeries = tailSeries(
    buildNetSeries(data.exams, data.results, chartType),
    DASHBOARD_CHART_POINTS,
  );

  const name = settings.profileName.trim();
  const remainingDays = countdownDays(settings.examDate);
  const countdownText =
    remainingDays === null
      ? 'Sınav tarihi ayarlanmadı'
      : remainingDays >= 0
        ? `YKS'ye ${remainingDays} gün`
        : 'YKS tarihi geçti';
  const todayLabel = todayFormatter.format(new Date());
  const lastBackupTime = settings.lastBackupAt
    ? Date.parse(settings.lastBackupAt)
    : Number.NaN;
  const lastBackupOld =
    !Number.isFinite(lastBackupTime) ||
    Date.now() - lastBackupTime >= 30 * 24 * 60 * 60 * 1000;
  const manyNewPhotos = data.photosSinceBackup >= 100;
  const showBackupReminder =
    (lastBackupOld || manyNewPhotos) && !reminderDismissed;
  const backupReminderReason = settings.lastBackupAt
    ? manyNewPhotos
      ? `Son yedekten bu yana ${data.photosSinceBackup} fotoğraf eklendi; yedek almak için iyi bir zaman.`
      : 'Son yedeğinin üzerinden 30 günden fazla geçti.'
    : data.photosSinceBackup > 0
      ? `Henüz yedek almadın; ${data.photosSinceBackup} fotoğraf yalnızca bu cihazda.`
      : 'Henüz yedek almadın; veriler yalnızca bu cihazda.';

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-[var(--accent)]">
          {name ? `Merhaba, ${name}` : 'Merhaba'}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Genel Bakış</h1>
        <p className="text-sm text-muted">
          {todayLabel} · <span className="text-fg">{countdownText}</span>
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Genel konu ilerlemesi"
          progress={overall.progress}
          extra={`${overall.topicCount} konu${overall.estimated ? ' · kitap tahmini dahil' : ''}`}
        />
        <StatCard
          label="TYT konu ilerlemesi"
          progress={tytProgress.progress}
          extra={`${tytProgress.topicCount} konu${tytProgress.estimated ? ' · kitap tahmini dahil' : ''}`}
        />
        <StatCard
          label="AYT konu ilerlemesi"
          progress={aytProgress.progress}
          extra={`${aytProgress.topicCount} konu${aytProgress.estimated ? ' · kitap tahmini dahil' : ''}`}
        />
      </div>

      <TodayPlanCard books={data.shelfBooks} topics={data.topics} />

      <div className="grid gap-3 sm:grid-cols-2">
        {netStatsByType.map(({ type, stats }) => (
          <Card
            key={type}
            role="group"
            aria-label={`${type} netleri`}
            className="space-y-2"
          >
            <h2 className="text-sm font-medium text-muted">{type}</h2>
            {stats === null ? (
              <p className="text-sm text-muted">Henüz {type} denemesi yok</p>
            ) : (
              <>
                <dl className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-sm text-muted">En yüksek</dt>
                    <dd className="text-xl font-semibold tabular-nums text-[var(--accent)]">
                      {formatNet(stats.highest)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-sm text-muted">Ortalama</dt>
                    <dd className="text-xl font-semibold tabular-nums text-[var(--accent)]">
                      {formatNet(stats.average)}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-muted">{stats.count} deneme</p>
              </>
            )}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Kitaplar</h2>
            <Link
              to="/kitaplar"
              className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-[var(--accent)]"
            >
              Tümü<span className="sr-only"> kitaplar</span>
            </Link>
          </div>

          {topBooks.length === 0 ? (
            <EmptyState
              icon={Library}
              title="Henüz kitap yok"
              description="Rafa kitap ekleyerek sayfa ilerlemesini takip edebilirsin."
            />
          ) : (
            <ul className="space-y-2">
              {topBooks.map((row) => {
                const { catalogBook, userBook, progress } = row;
                const hasTotalPages = progress.hasTotalPages;
                return (
                  <li key={userBook.id}>
                    <Link
                      to={`/kitaplar/${userBook.id}`}
                      className="block rounded-xl border border-line bg-raised/40 p-3 transition-colors hover:border-[var(--accent)]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium">
                          {catalogBook.title}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--accent)]">
                          {hasTotalPages ? formatPercent(progress.percent) : '—'}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        <ProgressBar
                          value={progress.percent}
                          label={`${catalogBook.title} ilerlemesi`}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted">
                          <span className="tabular-nums">
                            {hasTotalPages
                              ? `${progress.readPages}/${progress.totalPages} sayfa`
                              : 'Toplam sayfa belirtilmedi'}
                          </span>
                          {hasTotalPages ? (
                            <span>
                              {progress.done
                                ? 'Bitti'
                                : `${progress.remaining} sayfa kaldı`}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <NetTrendChart
            series={chartSeries}
            description={`Son ${DASHBOARD_CHART_POINTS} ${chartType} denemesi`}
            ariaLabel={`${chartType} net trend grafiği`}
            headerAction={
              <div
                role="group"
                aria-label="Grafik türü"
                className="flex w-fit gap-1 rounded-xl border border-line bg-canvas p-1"
              >
                {CHART_TYPES.map((type) => {
                  const active = type === chartType;
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setChartType(type)}
                      className={
                        active
                          ? 'min-h-11 rounded-lg bg-[var(--accent-soft)] px-3 text-sm font-medium text-[var(--accent)]'
                          : 'min-h-11 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-fg'
                      }
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            }
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Son denemeler</h2>
            <Link
              to="/denemeler"
              className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-[var(--accent)]"
            >
              Tümü<span className="sr-only"> denemeler</span>
            </Link>
          </div>

          {recentExams.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Henüz deneme kaydı yok"
              description="İlk denemeni ekleyerek netlerini takip etmeye başla."
            />
          ) : (
            <ul className="space-y-2">
              {recentExams.map(({ exam, totalNet }) => {
                const alan =
                  exam.type === 'AYT'
                    ? formatAlan(
                        resolveAytAlan(
                          exam,
                          resultsByExam.get(exam.id) ?? [],
                          data.subjects,
                        ),
                      )
                    : null;
                return (
                  <li key={exam.id}>
                    <Link
                      to={`/denemeler/${exam.id}`}
                      aria-label={`${exam.name}, ${exam.type}${alan ? ` ${alan}` : ''}, ${formatExamDate(exam.date)}, toplam ${formatNet(totalNet)} net`}
                      className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line bg-raised/40 px-3 py-2 transition-colors hover:border-[var(--accent)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{exam.name}</span>
                        <span className="block text-xs text-muted">
                          {formatExamDate(exam.date)} · {exam.type}
                          {alan ? ` · ${alan}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--accent)]">
                        {formatNet(totalNet)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Hızlı ekle</h2>
          <ul className="grid gap-2">
            <li>
              <Link to="/denemeler/yeni" className={quickAddLinkClass}>
                <Plus className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                Deneme
              </Link>
            </li>
            <li>
              <Link to="/yanlislar" className={quickAddLinkClass}>
                <Camera className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                Yanlış fotoğrafı
              </Link>
            </li>
            <li>
              <Link to="/kitaplar" className={quickAddLinkClass}>
                <Library className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                Kitaplar
              </Link>
            </li>
            <li>
              <Link to="/program" className={quickAddLinkClass}>
                <CalendarDays className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                Ders Çalışma Çizelgesi
              </Link>
            </li>
          </ul>
        </Card>
      </div>

      {showBackupReminder ? (
        <aside
          id="backup-reminder"
          aria-label="Yedek hatırlatıcısı"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised/60 px-4 py-3"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <Archive className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
            <p className="text-sm text-muted">
              <span className="font-medium text-fg">Yedeğini almayı unutma.</span>{' '}
              {backupReminderReason}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Link
              to="/ayarlar"
              className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-semibold text-[var(--accent)]"
            >
              Yedek al
            </Link>
            <button
              type="button"
              aria-label="Yedek hatırlatıcısını kapat"
              onClick={() => {
                try {
                  sessionStorage.setItem('kocluk:backup-reminder-dismissed', reminderSignature);
                } catch {
                  // Storage may be unavailable in private mode; dismissing for
                  // this render is still better than showing the reminder again.
                }
                setDismissedSignature(reminderSignature);
              }}
              className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </aside>
      ) : null}
    </section>
  );
}
