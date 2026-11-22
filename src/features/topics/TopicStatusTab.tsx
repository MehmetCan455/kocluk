import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getTopicDone, listTopicReviews, setTopicDone } from '@/db/topicProgressRepository';
import type { ActivityLog } from '@/domain/types';

const historyDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : historyDateFormatter.format(date);
}

function sourceLabel(log: ActivityLog): string {
  return log.source === 'task' ? 'Plan görevi' : 'Manuel';
}

export interface TopicStatusTabProps {
  topicId: string;
}

/** Explicit completion flag plus the read-only review history for one topic. */
export function TopicStatusTab({ topicId }: TopicStatusTabProps) {
  const checkboxId = useId();
  const hintId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const [done, reviews] = await Promise.all([getTopicDone(topicId), listTopicReviews(topicId)]);
    return { done, reviews };
  }, [topicId]);

  async function handleToggle(done: boolean) {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await setTopicDone(topicId, done);
    } catch (caught: unknown) {
      console.error('Konu durumu güncellenemedi', caught);
      setError('Konu durumu güncellenemedi. Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <p role="status" className="py-8 text-center text-sm text-muted">
        Durum yükleniyor…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              id={checkboxId}
              type="checkbox"
              checked={data.done}
              disabled={saving}
              onChange={(event) => void handleToggle(event.target.checked)}
              aria-describedby={hintId}
              className="h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            <span className="block text-sm font-medium">Bu konuyu bitirdim</span>
          </label>
          <p id={hintId} className="mt-2 pl-8 text-xs text-muted">
            {data.done
              ? 'Bu konu bitti olarak işaretli.'
              : 'Konuyu tamamladığında işaretle; ders ilerlemesi bu duruma göre hesaplanır.'}
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tekrar geçmişi</h2>

        {data.reviews.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
            Henüz tekrar kaydı yok.
          </p>
        ) : (
          <ul aria-label="Tekrar geçmişi" className="space-y-2">
            {data.reviews.map((log) => (
              <li
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3"
              >
                <p className="text-sm font-medium">Konu tekrarı</p>
                <p className="flex flex-wrap items-center gap-1 text-xs text-muted">
                  <time dateTime={log.createdAt}>{formatHistoryDate(log.createdAt)}</time>
                  <span aria-hidden="true">·</span>
                  <span>{sourceLabel(log)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
