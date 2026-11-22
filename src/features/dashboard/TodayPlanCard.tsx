import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/components/ui/cn';
import type { ShelfBook } from '@/db/bookRepositories';
import { listTasksForDay, toggleTask } from '@/db/scheduleRepository';
import { weekStartOf } from '@/domain/schedule';
import type { ScheduleTask, Topic } from '@/domain/types';

export interface TodayPlanCardProps {
  books: ReadonlyArray<ShelfBook>;
  topics: ReadonlyArray<Topic>;
}

/** The same 1 = Monday … 7 = Sunday convention as the weekly plan. */
function todayIndex(): number {
  return ((new Date().getDay() + 6) % 7) + 1;
}

function taskLabel(
  task: ScheduleTask,
  books: ReadonlyArray<ShelfBook>,
  topics: ReadonlyArray<Topic>,
): string {
  if (task.type === 'book') {
    const title =
      books.find((row) => row.userBook.id === task.userBookId)?.catalogBook.title ??
      'Kitap';
    if (task.fromPage !== undefined && task.toPage !== undefined) {
      return `${title} Syf. ${task.fromPage}–${task.toPage}`;
    }
    return title;
  }
  if (task.type === 'topic') {
    return topics.find((topic) => topic.id === task.topicId)?.name ?? 'Konu tekrarı';
  }
  return task.title ?? 'Serbest görev';
}

/** Today's planned tasks with a one-tap tick. */
export function TodayPlanCard({ books, topics }: TodayPlanCardProps) {
  const weekStart = weekStartOf(new Date());
  const dayIndex = todayIndex();
  const tasks = useLiveQuery(
    () => listTasksForDay(weekStart, dayIndex),
    [weekStart, dayIndex],
  );
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(task: ScheduleTask, done: boolean): Promise<void> {
    setError(null);
    setPendingTaskId(task.id);
    try {
      await toggleTask(task.id, done);
    } catch {
      setError('Görev güncellenemedi. Lütfen tekrar dene.');
    } finally {
      setPendingTaskId(null);
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Bugünün planı</h2>
        <Link
          to="/program"
          className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-[var(--accent)]"
        >
          Tümü<span className="sr-only"> plan</span>
        </Link>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {tasks === undefined ? (
        <p role="status" className="py-4 text-center text-sm text-muted">
          Bugünün planı yükleniyor…
        </p>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Bugün için görev yok."
          description="Haftalık planından bugüne görev ekleyebilirsin."
        />
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const label = taskLabel(task, books, topics);
            const done = Boolean(task.completedAt);
            return (
              <li key={task.id}>
                <label
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors',
                    done
                      ? 'border-success/40 bg-success/10'
                      : 'border-line bg-raised/40 hover:border-[var(--accent)]',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={done}
                    disabled={pendingTaskId === task.id}
                    onChange={(event) => void handleToggle(task, event.target.checked)}
                    aria-label={`${label} görevini tamamla`}
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 break-words text-sm',
                      done && 'text-muted line-through',
                    )}
                  >
                    {label}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
