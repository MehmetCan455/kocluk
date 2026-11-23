import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { getSubjectIcon } from '@/data/subjectIcons';
import type { ExamType, Subject } from '@/domain/types';
import { formatPercent } from '@/lib/format';
import { useSubjectOverview, type SubjectOverview } from '@/lib/progress';
import { examBasePath } from './exam';

export interface SubjectCardProps {
  subject: Subject;
  exam: ExamType;
}

function cardMessage(overview: SubjectOverview): string {
  const { topics } = overview;

  if (topics.length === 0) {
    return 'Henüz konu yok';
  }
  if (overview.progress.done) {
    return 'Tüm konular tamam';
  }
  if (overview.bookEstimate > 0) {
    return `Kitap tahmini: %${overview.bookEstimate}`;
  }
  if (overview.continuingTopic) {
    return `Devam eden: ${overview.continuingTopic.name}`;
  }
  if (topics.every((row) => !row.progress.started)) {
    return 'Henüz başlanmadı';
  }

  const nextTopic = topics.find((row) => !row.progress.done);
  return nextTopic ? `Sırada: ${nextTopic.topic.name}` : 'Henüz başlanmadı';
}

export function SubjectCard({ subject, exam }: SubjectCardProps) {
  const overview = useSubjectOverview(subject.id);
  const progress = overview?.progress;
  const message = overview ? cardMessage(overview) : 'Yükleniyor…';
  const Icon = getSubjectIcon(subject.icon);

  return (
    <Link to={`${examBasePath(exam)}/${subject.id}`} className="group block h-full rounded-2xl">
      <Card className="h-full space-y-4 transition-colors duration-150 group-hover:border-[var(--accent)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{subject.name}</p>
              <p className="text-xs text-muted">
                {overview ? `${overview.topics.length} konu` : 'Konular yükleniyor…'}
              </p>
            </div>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {progress ? formatPercent(progress.percent) : '—'}
          </span>
        </div>

        <ProgressBar
          value={progress?.percent ?? 0}
          label={`${subject.name} ilerlemesi`}
        />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
          <span className="tabular-nums">
            {progress
              ? progress.total > 0
                ? `${progress.solved}/${progress.total} konu`
                : 'Henüz konu yok'
              : '—'}
          </span>
          <span className="min-w-0 truncate">{message}</span>
        </div>
      </Card>
    </Link>
  );
}
