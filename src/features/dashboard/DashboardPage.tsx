import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, BookOpen, Camera, ClipboardList, Library, Plus, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { RingProgress } from '@/components/ui/RingProgress';
import { db } from '@/db/db';
import {
  listAllExamResults,
  listAllTopicBooks,
  listAllTopics,
  listBooks,
  listExams,
  listSubjects,
} from '@/db/repositories';
import { calculateProgress } from '@/domain/calculations';
import type {
  Book,
  Exam,
  ExamResult,
  ExamType,
  Subject,
  Topic,
  TopicBook,
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
  topicBooks: TopicBook[];
  books: Book[];
  exams: Exam[];
  results: ExamResult[];
  photosSinceBackup: number;
}

interface BookCardRow {
  id: string;
  name: string;
  progress: ReturnType<typeof calculateProgress>;
}

const quickAddLinkClass =
  'flex min-h-11 items-center gap-3 rounded-xl border border-line bg-raised/60 px-3 py-2 text-sm font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]';

function StatCard({
  label,
  progress,
  extra,
}: {
  label: string;
  progress: ReturnType<typeof calculateProgress>;
  extra: string;
}) {
  return (
    <Card className="flex items-center gap-4">
      <RingProgress value={progress.percent} label={label} size={64} />
      <div className="min-w-0 space-y-1">
        <h2 className="text-sm font-medium text-muted">{label}</h2>
        <p className="text-sm tabular-nums">
          {progress.solved}/{progress.total} test
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
    // One read per table: no per-book or per-exam query on the dashboard. The
    // backup reminder counts only photos added after the last export.
    const lastBackupAt = settings.lastBackupAt;
    const [subjects, topics, topicBooks, books, exams, results, photosSinceBackup] =
      await Promise.all([
        listSubjects(),
        listAllTopics(),
        listAllTopicBooks(),
        listBooks(),
        listExams(),
        listAllExamResults(),
        lastBackupAt
          ? db.photos.where('createdAt').above(lastBackupAt).count()
          : db.photos.count(),
      ]);
    return { subjects, topics, topicBooks, books, exams, results, photosSinceBackup };
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
  const topicById = new Map(data.topics.map((topic) => [topic.id, topic]));
  const visibleSubjectIds = new Set(
    data.subjects.filter((subject) => !hidden.has(subject.id)).map((subject) => subject.id),
  );
  const visibleTopicIds = new Set(
    data.topics
      .filter((topic) => visibleSubjectIds.has(topic.subjectId))
      .map((topic) => topic.id),
  );
  const visibleRecords = data.topicBooks.filter((record) =>
    visibleTopicIds.has(record.topicId),
  );

  function progressForExam(exam: ExamType): ReturnType<typeof calculateProgress> {
    return calculateProgress(
      visibleRecords.filter((record) => {
        const topic = topicById.get(record.topicId);
        const subject = topic ? subjectById.get(topic.subjectId) : undefined;
        return subject?.exam === exam;
      }),
    );
  }

  const overall = calculateProgress(visibleRecords);
  const tytProgress = progressForExam('TYT');
  const aytProgress = progressForExam('AYT');

  const recordsByBook = new Map<string, TopicBook[]>();
  for (const record of data.topicBooks) {
    const records = recordsByBook.get(record.bookId);
    if (records) {
      records.push(record);
    } else {
      recordsByBook.set(record.bookId, [record]);
    }
  }

  const topBooks: BookCardRow[] = data.books.slice(0, 5).map((book) => ({
    id: book.id,
    name: book.name,
    progress: calculateProgress(recordsByBook.get(book.id) ?? []),
  }));

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
          label="Genel ilerleme"
          progress={overall}
          extra={`${data.exams.length} deneme`}
        />
        <StatCard label="TYT ilerlemesi" progress={tytProgress} extra="TYT dersleri" />
        <StatCard label="AYT ilerlemesi" progress={aytProgress} extra="AYT dersleri" />
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
              description="Konu sayfalarından kitap ve test ekleyerek kitaplığını oluşturabilirsin."
            />
          ) : (
            <ul className="space-y-2">
              {topBooks.map((book) => (
                <li key={book.id}>
                  <Link
                    to={`/kitaplar/${book.id}`}
                    className="block rounded-xl border border-line bg-raised/40 p-3 transition-colors hover:border-[var(--accent)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium">{book.name}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--accent)]">
                        {formatPercent(book.progress.percent)}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <ProgressBar
                        value={book.progress.percent}
                        label={`${book.name} ilerlemesi`}
                      />
                      <p className="text-xs text-muted">
                        {book.progress.total === 0
                          ? 'Henüz test kaydı yok'
                          : book.progress.done
                            ? 'Bitti'
                            : `${book.progress.remaining} test kaldı`}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <NetTrendChart
            series={chartSeries}
            title="Net trendi"
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
              <Link to="/tyt" className={quickAddLinkClass}>
                <BookOpen className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                Test kaydı
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
