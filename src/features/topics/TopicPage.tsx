import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { RingProgress } from '@/components/ui/RingProgress';
import { Tabs } from '@/components/ui/Tabs';
import { listSubjects, listTopics } from '@/db/repositories';
import { listTopicReviews } from '@/db/topicProgressRepository';
import type { ExamType } from '@/domain/types';
import { formatPercent } from '@/lib/format';
import { useTopicEstimate } from '@/lib/progress';
import { examBasePath, examTitle } from '@/features/subjects/exam';
import { NotesTab } from '@/features/notes/NotesTab';
import { TopicPhotosTab } from '@/features/photos/PhotoThumb';
import { LegacyTestsSection } from './LegacyTestsSection';
import { TopicStatusTab } from './TopicStatusTab';

type TopicTab = 'durum' | 'notlar' | 'yanlislar';

export interface TopicPageProps {
  exam: ExamType;
}

export function TopicPage({ exam }: TopicPageProps) {
  const { subjectId = '', topicId = '' } = useParams();
  const [tab, setTab] = useState<TopicTab>('durum');
  const subjects = useLiveQuery(() => listSubjects(exam), [exam]);
  const topics = useLiveQuery(() => listTopics(subjectId), [subjectId]);
  const estimate = useTopicEstimate(topicId);
  const reviewCount = useLiveQuery(async () => {
    const reviews = await listTopicReviews(topicId);
    return reviews.length;
  }, [topicId]);

  if (!subjects || !topics) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Konu yükleniyor…
      </p>
    );
  }

  const subject = subjects.find((item) => item.id === subjectId);
  const topic = topics.find((item) => item.id === topicId);

  if (!subject || !topic) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Konu bulunamadı"
        description="Bu konu silinmiş ya da taşınmış olabilir."
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

  if (!estimate || reviewCount === undefined) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Konu yükleniyor…
      </p>
    );
  }

  const progress = estimate.progress;

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: examTitle(exam), to: examBasePath(exam) },
          { label: subject.name, to: `${examBasePath(exam)}/${subject.id}` },
          { label: topic.name },
        ]}
      />

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{subject.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{topic.name}</h1>
          <p
            className={
              progress.done
                ? 'text-sm font-medium text-success'
                : progress.started
                  ? 'text-sm font-medium text-[var(--accent)]'
                  : 'text-sm font-medium text-muted'
            }
          >
            {progress.done
              ? 'Bitti'
              : progress.started
                ? 'Devam ediyor'
                : 'Başlanmadı'}
          </p>
          <p className="text-sm text-muted">
            {reviewCount === 0 ? 'Henüz tekrar yok' : `${reviewCount} tekrar`}
          </p>
        </div>
        <RingProgress value={progress.percent} size={84} label={`${topic.name} ilerlemesi`}>
          {formatPercent(progress.percent)}
        </RingProgress>
      </Card>

      <Tabs
        value={tab}
        onChange={(id) => setTab(id as TopicTab)}
        tabs={[
          {
            id: 'durum',
            label: 'Durum',
            content: (
              <div className="space-y-6">
                <TopicStatusTab topicId={topic.id} bookPercent={estimate.bookPercent} />
                <LegacyTestsSection topicId={topic.id} />
              </div>
            ),
          },
          {
            id: 'notlar',
            label: 'Notlar',
            content: <NotesTab topicId={topic.id} />,
          },
          {
            id: 'yanlislar',
            label: 'Yanlışlar',
            content: (
              <TopicPhotosTab
                topicId={topic.id}
                subjectId={subject.id}
                examType={exam}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
