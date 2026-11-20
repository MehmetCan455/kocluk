import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/components/ui/cn';
import { manualHiddenSubjects } from '@/data/alanSubjects';
import { listAllExamResults, listExams, listSubjects } from '@/db/repositories';
import type { AytAlan, Exam, ExamResult, ExamType, Subject } from '@/domain/types';
import {
  buildExamComparison,
  buildNetSeries,
  buildSubjectNetSeries,
  MAX_CHART_POINTS,
} from '@/features/dashboard/chartData';
import { NetTrendChart } from '@/features/dashboard/NetTrendChart';
import { formatNet } from '@/lib/format';
import { resolveAytAlan } from './examConfig';
import { formatAlan, formatExamDate, sumNet } from './examFormat';

type AlanFilter = 'all' | AytAlan;

const FILTERS: ReadonlyArray<{ id: ExamType; label: string }> = [
  { id: 'TYT', label: 'TYT' },
  { id: 'AYT', label: 'AYT' },
];

// "Tüm alanlar" is deliberately distinct from the type filter's TYT/AYT so the
// two filter groups never share an accessible name. Genel/tumu is gone: every
// new AYT exam has a concrete branch and old exams are inferred from results.
const ALAN_FILTERS: ReadonlyArray<{ id: AlanFilter; label: string }> = [
  { id: 'all', label: 'Tüm alanlar' },
  { id: 'sayisal', label: 'Sayısal' },
  { id: 'ea', label: 'Eşit Ağırlık' },
  { id: 'sozel', label: 'Sözel' },
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
  const { settings } = useAppSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  // The URL is the source of truth so saving an AYT exam can open the list on
  // the AYT tab; a plain `/denemeler` visit still defaults to TYT.
  const filter: ExamType = searchParams.get('tur') === 'AYT' ? 'AYT' : 'TYT';
  const [alanFilter, setAlanFilter] = useState<AlanFilter>('all');
  const [chartSubjectId, setChartSubjectId] = useState('');

  function changeFilter(next: ExamType) {
    setSearchParams(next === 'AYT' ? { tur: 'AYT' } : {}, { replace: true });
  }

  const data = useLiveQuery(async () => {
    // Results and every exam are fetched once and grouped, instead of one query
    // per exam. The type filter is applied in memory so the previous-exam delta
    // can still see the whole history.
    const [exams, subjects, allResults] = await Promise.all([
      listExams(),
      listSubjects(),
      listAllExamResults(),
    ]);

    const resultsByExam = new Map<string, ExamResult[]>();
    for (const result of allResults) {
      const results = resultsByExam.get(result.examId);
      if (results) {
        results.push(result);
      } else {
        resultsByExam.set(result.examId, [result]);
      }
    }

    const rows = exams.map((exam): ExamRow => {
      const results = resultsByExam.get(exam.id) ?? [];
      return { exam, results, totalNet: sumNet(results) };
    });

    return { rows, subjects, results: allResults };
  }, []);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Denemeler yükleniyor…
      </p>
    );
  }

  const subjectById = new Map(data.subjects.map((subject) => [subject.id, subject]));
  const resultsByExam = new Map(data.rows.map((row) => [row.exam.id, row.results]));

  // Old AYT exams keep their branch in storage only when it was concrete.
  // Legacy Genel/tumu rows are inferred from their results for labels and
  // comparisons; their results are never rewritten here.
  const resolveAlan = (exam: Exam): AytAlan =>
    exam.type === 'AYT'
      ? resolveAytAlan(exam, resultsByExam.get(exam.id) ?? [], data.subjects)
      : 'tumu';

  const visibleRows = data.rows.filter((row) => row.exam.type === filter);
  const chartType: ExamType = filter;
  // Same visibility as the exam form: manual hides only, so subjects hidden
  // automatically by the study alan stay selectable for an AYT branch that
  // includes them.
  const hiddenIds = manualHiddenSubjects(
    settings.hiddenSubjects,
    settings.aytAlan,
    chartType,
    data.subjects,
  );
  const chartSubjects = data.subjects.filter(
    (subject) => subject.exam === chartType && !hiddenIds.has(subject.id),
  );
  const selectedSubject = chartSubjects.find((subject) => subject.id === chartSubjectId);
  const chartSeries = selectedSubject
    ? buildSubjectNetSeries(
        data.rows.map((row) => row.exam),
        data.results,
        chartType,
        selectedSubject.id,
        filter === 'AYT' && alanFilter !== 'all' ? alanFilter : undefined,
        resolveAlan,
      )
    : buildNetSeries(
        data.rows.map((row) => row.exam),
        data.results,
        chartType,
        filter === 'AYT' && alanFilter !== 'all' ? alanFilter : undefined,
        resolveAlan,
      );
  const chartTitle = selectedSubject ? `${selectedSubject.name} net trendi` : 'Net trendi';
  const chartAriaLabel = selectedSubject
    ? `${chartType} ${selectedSubject.name} net trend grafiği`
    : `${chartType} net trend grafiği`;

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
              onClick={() => changeFilter(option.id)}
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

      {visibleRows.length > 0 ? (
        <Card>
          <NetTrendChart
            series={chartSeries}
            title={chartTitle}
            description={`Son ${MAX_CHART_POINTS} ${chartType} denemesi`}
            ariaLabel={chartAriaLabel}
            headerAction={
              <div className="flex flex-wrap items-start gap-2">
                <select
                  aria-label="Grafik dersi"
                  value={selectedSubject?.id ?? ''}
                  onChange={(event) => setChartSubjectId(event.target.value)}
                  className="min-h-11 rounded-xl border border-line bg-canvas px-3 text-sm text-fg"
                >
                  <option value="">Toplam net</option>
                  {chartSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
                {filter === 'AYT' ? (
                  <div
                    role="group"
                    aria-label="AYT alan filtresi"
                    className="flex flex-wrap gap-1 rounded-xl border border-line bg-canvas p-1"
                  >
                    {ALAN_FILTERS.map((option) => {
                      const active = option.id === alanFilter;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setAlanFilter(option.id)}
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
                ) : null}
              </div>
            }
          />
        </Card>
      ) : null}

      {data.rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Henüz deneme yok"
          description="İlk denemeni ekleyerek ders bazında netlerini kaydetmeye başla."
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={`Henüz ${filter} denemesi yok`}
          description="Farklı bir tür seçebilir veya yeni bir deneme ekleyebilirsin."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visibleRows.map(({ exam, results, totalNet }) => {
            const isAyt = exam.type === 'AYT';
            const alan = isAyt ? formatAlan(resolveAlan(exam)) : null;
            const sortedResults = sortBySubjectOrder(results, subjectById);
            const comparison = buildExamComparison(
              data.rows.map((row) => row.exam),
              data.results,
              exam,
              resolveAlan,
            );
            const delta = comparison.delta;
            const deltaText =
              delta === undefined
                ? 'İlk deneme'
                : `${delta > 0 ? '+' : ''}${formatNet(delta)}`;
            const deltaAria =
              delta === undefined
                ? 'ilk deneme'
                : `önceki denemeye göre ${deltaText} net`;
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
                  }, ${formatExamDate(exam.date)}, toplam ${formatNet(totalNet)} net, ${deltaAria}`}
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
                      <p
                        className={cn(
                          'text-xs font-medium tabular-nums',
                          delta === undefined
                            ? 'text-muted'
                            : delta > 0
                              ? 'text-success'
                              : delta < 0
                                ? 'text-danger'
                                : 'text-muted',
                        )}
                      >
                        <span className="sr-only">Önceki denemeye göre net farkı: </span>
                        {deltaText}
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
