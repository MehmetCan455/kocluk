import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { db } from '@/db/db';
import { summarizeWeek } from '@/domain/schedule';
import type { ScheduleTask } from '@/domain/types';

export interface WeekSummaryProps {
  tasks: ScheduleTask[];
}

const STAT_ITEMS = [
  { key: 'taskCount', label: 'Planlanan görev' },
  { key: 'doneCount', label: 'Tamamlanan görev' },
  { key: 'plannedPages', label: 'Planlanan sayfa' },
  { key: 'readPages', label: 'Okunan sayfa' },
] as const;

/**
 * Reads the activity logs attached to the visible tasks so the read page
 * total follows ticks and unticks without a manual refresh.
 */
export function WeekSummary({ tasks }: WeekSummaryProps) {
  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const logs = useLiveQuery(
    async () =>
      taskIds.length === 0
        ? []
        : db.activityLogs.where('taskId').anyOf(taskIds).toArray(),
    [taskIds],
  );

  const summary = summarizeWeek(tasks, logs ?? []);
  const percent =
    summary.plannedPages === 0
      ? 0
      : (summary.readPages / summary.plannedPages) * 100;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Hafta özeti</h2>
        <p className="text-xs text-muted">
          Yalnızca bu haftanın görevleri ve okuma kayıtları sayılır.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STAT_ITEMS.map((item) => (
          <div
            key={item.key}
            className="rounded-xl border border-line bg-raised px-3 py-2"
          >
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {item.label}
            </dt>
            <dd className="text-xl font-semibold tabular-nums">
              {summary[item.key]}
            </dd>
          </div>
        ))}
      </dl>

      <ProgressBar value={percent} label="Okunan sayfa ilerlemesi" />
    </Card>
  );
}
