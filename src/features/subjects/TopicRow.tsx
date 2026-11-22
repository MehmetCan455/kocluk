import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { ExamType, Progress } from '@/domain/types';
import { formatPercent } from '@/lib/format';
import type { TopicProgressRow } from '@/lib/progress';
import { examBasePath } from './exam';

function statusLabel(progress: Progress): string {
  if (progress.done) {
    return 'Bitti';
  }
  if (progress.started) {
    return 'Devam ediyor';
  }
  return 'Başlanmadı';
}

function statusClass(progress: Progress): string {
  if (progress.done) {
    return 'text-success';
  }
  if (progress.started) {
    return 'text-[var(--accent)]';
  }
  return 'text-muted';
}

export interface TopicRowProps {
  exam: ExamType;
  subjectId: string;
  row: TopicProgressRow;
  onRename: () => void;
  onDelete: () => void;
}

export function TopicRow({ exam, subjectId, row, onRename, onDelete }: TopicRowProps) {
  const { topic, progress, reviewCount } = row;

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Link
            to={`${examBasePath(exam)}/${subjectId}/${topic.id}`}
            className="inline-flex min-h-11 items-center text-base font-medium transition-colors hover:text-[var(--accent)]"
          >
            {topic.name}
          </Link>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="tabular-nums">
              {progress.solved}/{progress.total} konu
            </span>
            <span className="text-muted" aria-hidden="true">
              ·
            </span>
            <span className="tabular-nums text-muted">{formatPercent(progress.percent)}</span>
            {progress.total > 0 && progress.remaining > 0 ? (
              <>
                <span className="text-muted" aria-hidden="true">
                  ·
                </span>
                <span className="text-muted">{progress.remaining} konu kaldı</span>
              </>
            ) : null}
            {reviewCount > 0 ? (
              <>
                <span className="text-muted" aria-hidden="true">
                  ·
                </span>
                <span className="text-muted">{reviewCount} tekrar</span>
              </>
            ) : null}
            <span className="text-muted" aria-hidden="true">
              ·
            </span>
            <span className={statusClass(progress)}>{statusLabel(progress)}</span>
          </div>

          <ProgressBar value={progress.percent} label={`${topic.name} ilerlemesi`} />
        </div>

        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${topic.name} konusunu yeniden adlandır`}
            onClick={onRename}
            className="h-11 w-11 px-0"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          {topic.isCustom ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${topic.name} konusunu sil`}
              onClick={onDelete}
              className="h-11 w-11 px-0 text-danger hover:text-danger"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
