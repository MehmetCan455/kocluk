import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { getSubjectIcon } from '@/data/subjectIcons';
import type { ExamType, Subject } from '@/domain/types';
import { formatPercent } from '@/lib/format';
import { useSubjectOverview } from '@/lib/progress';
import { examBasePath } from './exam';

export interface SubjectCardProps {
  subject: Subject;
  exam: ExamType;
}

export function SubjectCard({ subject, exam }: SubjectCardProps) {
  const overview = useSubjectOverview(subject.id);
  const progress = overview?.progress;
  const continuingTopic = overview?.continuingTopic;
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
                ? `${progress.solved}/${progress.total} test`
                : 'Henüz test yok'
              : '—'}
          </span>
          <span className="min-w-0 truncate">
            {!progress
              ? 'Yükleniyor…'
              : continuingTopic
                ? `Devam eden: ${continuingTopic.name}`
                : progress.done && progress.total > 0
                  ? 'Tüm konular tamam'
                  : 'Henüz başlanmadı'}
          </span>
        </div>
      </Card>
    </Link>
  );
}
