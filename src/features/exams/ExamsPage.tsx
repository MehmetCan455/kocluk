import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { EmptyState } from '@/components/ui/EmptyState';
import { listExamResults, listExams, listSubjects } from '@/db/repositories';
import type { Exam, ExamResult, ExamType, Subject } from '@/domain/types';
import { formatNet } from '@/lib/format';
import { formatAlan, formatExamDate, sumNet } from './examFormat';

type ExamFilter = 'all' | ExamType;

const FILTERS: ReadonlyArray<{ id: ExamFilter; label: string }> = [
  { id: 'TYT', label: 'TYT' },
  { id: 'AYT', label: 'AYT' },
  { id: 'all', label: 'Tümü' },
];

const newExamLinkClass =
  'inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]';

interface ExamRow {
  exam: Exam;
  results: ExamResult[];
  totalNet: number;
}

function resultSubjectName(result: ExamResult, subjectById: Map<string, Subject>): string {
  return subjectById.get(result.subjectId)?.name ?? 'Ders';
}

function sortBySubjectOrder(results: ExamResult[], subjectById: Map<string, Subject>): ExamResult[] {
  return [...results].sort((left, right) => {
    const leftSubject = subjectById.get(left.subjectId);
    const rightSubject = subjectById.get(right.subjectId);
    return (
      (leftSubject?.order ?? Number.MAX_SAFE_INTEGER) -
        (rightSubject?.order ?? Number.MAX_SAFE_INTEGER) ||
      left.subjectId.localeCompare(right.subjectId)
    );
  });
}

export function ExamsPage() {
  const [filter, setFilter] = useState<ExamFilter>('all');

  const data = useLiveQuery(async () => {
    const [exams, subjects] = await Promise.all([
      listExams(filter === 'all' ? undefined : filter),
      listSubjects(),
    ]);
    const rows = await Promise.all(
      exams.map(async (exam): Promise<ExamRow> => {
        const results = await listExamResults(exam.id);
        return { exam, results, totalNet: sumNet(results) };
      }),
    );
    return { rows, subjects };
  }, [filter]);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Denemeler yükleniyor…
      </p>
    );
  }

  const subjectById = new Map(data.subjects.map((subject) => [subject.id, subject]));

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Denemeler</h1>
          <p className="text-sm text-muted">
            TYT ve AYT denemelerini ders bazında kaydet, netlerini takip et.
          </p>
        </div>
        <Link to="/denemeler/yeni" className={newExamLinkClass}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Yeni deneme
        </Link>
      </header>

      <div
        role="group"
        aria-label="Deneme türü filtresi"
        className="flex w-fit flex-wrap gap-1 rounded-xl border border-line bg-surface p-1"
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

      {data.rows.length === 0 ? (
        filter === 'all' ? (
          <EmptyState
            icon={ClipboardList}
            title="Henüz deneme yok"
            description="İlk denemeni ekleyerek ders bazında netlerini kaydetmeye başla."
          />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title={`Henüz ${filter} denemesi yok`}
            description="Farklı bir tür seçebilir veya yeni bir deneme ekleyebilirsin."
          />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.rows.map(({ exam, results, totalNet }) => {
            const alan = formatAlan(exam.alan);
            const sortedResults = sortBySubjectOrder(results, subjectById);
            const maxNet = Math.max(
              1,
              ...sortedResults.map((result) => Math.max(result.net, 0)),
            );

            return (
              <li key={exam.id}>
                <Link
                  to={`/denemeler/${exam.id}`}
                  aria-label={`${exam.name}, ${exam.type}${
                    alan ? ` ${alan}` : ''
                  }, ${formatExamDate(exam.date)}, toplam ${formatNet(totalNet)} net`}
                  className="block rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted">
                        {formatExamDate(exam.date)} · {exam.type}
                        {alan ? ` · ${alan}` : ''}
                      </p>
                      <p className="truncate text-base font-semibold">{exam.name}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted">
                        Toplam net
                      </p>
                      <p className="text-xl font-semibold tabular-nums text-[var(--accent)]">
                        {formatNet(totalNet)}
                      </p>
                    </div>
                  </div>

                  {sortedResults.length === 0 ? (
                    <p className="mt-3 text-xs text-muted">Ders sonucu girilmedi.</p>
                  ) : (
                    <ul className="mt-3 space-y-1.5">
                      {sortedResults.map((result) => {
                        const width = Math.max(
                          0,
                          Math.min(100, (Math.max(result.net, 0) / maxNet) * 100),
                        );
                        return (
                          <li
                            key={result.id}
                            className="grid grid-cols-[minmax(0,5.5rem)_1fr_auto] items-center gap-2"
                          >
                            <span className="truncate text-xs text-muted">
                              {resultSubjectName(result, subjectById)}
                            </span>
                            <span
                              className="h-1.5 overflow-hidden rounded-full bg-raised"
                              aria-hidden="true"
                            >
                              <span
                                className="block h-full rounded-full bg-[var(--accent)]"
                                style={{ width: `${width}%` }}
                              />
                            </span>
                            <span className="w-14 text-right text-xs tabular-nums">
                              {formatNet(result.net)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
