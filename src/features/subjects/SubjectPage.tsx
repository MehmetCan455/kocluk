import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { RingProgress } from '@/components/ui/RingProgress';
import { getSubjectIcon } from '@/data/subjectIcons';
import {
  addCustomTopic,
  deleteCustomTopicCascade,
  listSubjects,
  renameTopic,
} from '@/db/repositories';
import type { ExamType } from '@/domain/types';
import { formatPercent } from '@/lib/format';
import { useSubjectOverview, type TopicProgressRow } from '@/lib/progress';
import { DeleteTopicModal } from './DeleteTopicModal';
import { examBasePath, examTitle } from './exam';
import { TopicFormModal } from './TopicFormModal';
import { TopicRow } from './TopicRow';

type TopicFilter = 'all' | 'ongoing' | 'done';

const FILTERS: ReadonlyArray<{ id: TopicFilter; label: string }> = [
  { id: 'all', label: 'Tümü' },
  { id: 'ongoing', label: 'Devam edenler' },
  { id: 'done', label: 'Bitenler' },
];

export interface SubjectPageProps {
  exam: ExamType;
}

function filterTopics(rows: TopicProgressRow[], filter: TopicFilter): TopicProgressRow[] {
  if (filter === 'ongoing') {
    return rows.filter((row) => row.progress.started && !row.progress.done);
  }
  if (filter === 'done') {
    return rows.filter((row) => row.progress.done);
  }
  return rows;
}

export function SubjectPage({ exam }: SubjectPageProps) {
  const { subjectId = '' } = useParams();
  const subjects = useLiveQuery(() => listSubjects(exam), [exam]);
  const overview = useSubjectOverview(subjectId);
  const [filter, setFilter] = useState<TopicFilter>('all');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<TopicProgressRow | null>(null);
  const [deleting, setDeleting] = useState<TopicProgressRow | null>(null);

  if (!subjects) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Ders yükleniyor…
      </p>
    );
  }

  const subject = subjects.find((item) => item.id === subjectId);

  if (!subject) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Ders bulunamadı"
        description="Bu ders silinmiş ya da taşınmış olabilir."
        action={
          <Link
            to={examBasePath(exam)}
            className="inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]"
          >
            Derslere dön
          </Link>
        }
      />
    );
  }

  if (!overview) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Konular yükleniyor…
      </p>
    );
  }

  const { progress } = overview;
  const visibleTopics = filterTopics(overview.topics, filter);
  const SubjectIcon = getSubjectIcon(subject.icon);

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: examTitle(exam), to: examBasePath(exam) },
          { label: subject.name },
        ]}
      />

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <SubjectIcon className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{subject.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {progress.total === 0
                ? 'Henüz test eklenmedi'
                : `${progress.solved}/${progress.total} test · ${progress.remaining} test kaldı`}
            </p>
          </div>
        </div>
        <RingProgress
          value={progress.percent}
          size={84}
          label={`${subject.name} genel ilerlemesi`}
        >
          {formatPercent(progress.percent)}
        </RingProgress>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Konu filtresi"
          className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1"
        >
          {FILTERS.map((option) => {
            const active = option.id === filter;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(option.id)}
                className={
                  active
                    ? 'min-h-11 rounded-lg bg-[var(--accent-soft)] px-3 text-sm font-medium text-[var(--accent)]'
                    : 'min-h-11 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-fg'
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Konu ekle
        </Button>
      </div>

      {overview.topics.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Henüz konu yok"
          description="İlk konunu ekleyerek başla."
          action={<Button onClick={() => setAdding(true)}>Konu ekle</Button>}
        />
      ) : visibleTopics.length === 0 ? (
        <EmptyState
          title="Bu filtreye uygun konu yok"
          description="Farklı bir filtre seçebilirsin."
        />
      ) : (
        <ul className="space-y-3">
          {visibleTopics.map((row) => (
            <TopicRow
              key={row.topic.id}
              exam={exam}
              subjectId={subject.id}
              row={row}
              onRename={() => setRenaming(row)}
              onDelete={() => setDeleting(row)}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <TopicFormModal
          title="Konu ekle"
          submitLabel="Ekle"
          onClose={() => setAdding(false)}
          onSubmit={async (name) => {
            await addCustomTopic(subject.id, name);
          }}
        />
      ) : null}

      {renaming ? (
        <TopicFormModal
          title="Konuyu yeniden adlandır"
          submitLabel="Kaydet"
          initialName={renaming.topic.name}
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            await renameTopic(renaming.topic.id, name);
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteTopicModal
          topic={deleting.topic}
          testRecordCount={deleting.testRecordCount}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteCustomTopicCascade(deleting.topic.id);
          }}
        />
      ) : null}
    </div>
  );
}
