import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/components/ui/cn';
import { ALAN_SUBJECT_SEED_KEYS, manualHiddenSubjects } from '@/data/alanSubjects';
import { listAllExamResults, listExams, listSubjects } from '@/db/repositories';
import type {
  AytAlan,
  BranchExamKey,
  Exam,
  ExamResult,
  ExamType,
  Subject,
} from '@/domain/types';
import {
  buildExamComparison,
  buildNetSeries,
  buildSubjectNetSeries,
  type ExamComparison,
} from '@/features/dashboard/chartData';
import { NetTrendChart } from '@/features/dashboard/NetTrendChart';
import { formatNet } from '@/lib/format';
import { branchesFor, getBranchExam, isBranchExam } from './branchConfig';
import { isAytBranch, resolveAytAlan, type AytBranch } from './examConfig';
import { AYT_ALAN_LABELS, formatAlan, formatExamDate, sumNet } from './examFormat';

type AlanFilter = 'all' | AytAlan;
type ExamTab = ExamType | 'BRANS';

const FILTERS: ReadonlyArray<{ id: ExamTab; label: string }> = [
  { id: 'TYT', label: 'TYT' },
  { id: 'AYT', label: 'AYT' },
  { id: 'BRANS', label: 'Branş' },
];

const BRANCH_TYPES: ReadonlyArray<ExamType> = ['TYT', 'AYT'];

// "Tüm alanlar" is deliberately distinct from the type filter's TYT/AYT so the
// two filter groups never share an accessible name. Genel/tumu is gone: every
// new AYT exam has a concrete branch and old exams are inferred from results.
const ALAN_FILTERS: ReadonlyArray<{ id: AlanFilter; label: string }> = [
  { id: 'all', label: 'Tüm alanlar' },
  { id: 'sayisal', label: 'Sayısal' },
  { id: 'ea', label: 'Eşit Ağırlık' },
  { id: 'sozel', label: 'Sözel' },
];

// The branch tab has no "all" alan option: a branch always belongs to one
// concrete AYT alan, so every branch exam is either in or out of the selection.
const BRANCH_ALAN_FILTERS: ReadonlyArray<{ id: AytBranch; label: string }> = [
  { id: 'sayisal', label: 'Sayısal' },
  { id: 'ea', label: 'Eşit Ağırlık' },
  { id: 'sozel', label: 'Sözel' },
];

const newExamLinkClass =
  'inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]';

// Branch exams have exactly one result row, so the card shows a compact
// D/Y/B/Net table instead of the per-subject proportional bars used by full
// exams.
const branchCountsGrid =
  'grid grid-cols-[minmax(0,1fr)_1.75rem_1.75rem_1.75rem_3.5rem] items-center gap-2';

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

interface ExamCardProps {
  exam: Exam;
  results: ExamResult[];
  totalNet: number;
  comparison: ExamComparison;
  subjectById: Map<string, Subject>;
  alan: string | null;
  branchLabel?: string;
}

/**
 * The list card shared by the full and branch tabs. A branch exam is a single
 * branch row, so its subject line shows the branch label instead of a subject
 * lookup, and its header carries "Branş · etiket".
 */
function ExamCard({
  exam,
  results,
  totalNet,
  comparison,
  subjectById,
  alan,
  branchLabel,
}: ExamCardProps) {
  const branch = isBranchExam(exam) ? branchLabel || 'Branş' : null;
  const sortedResults = sortBySubjectOrder(results, subjectById);
  const delta = comparison.delta;
  const deltaText =
    delta === undefined ? 'İlk deneme' : `${delta > 0 ? '+' : ''}${formatNet(delta)}`;
  const deltaAria =
    delta === undefined ? 'ilk deneme' : `önceki denemeye göre ${deltaText} net`;
  const maxNet = Math.max(
    1,
    ...sortedResults.map((result) => Math.max(result.net, 0)),
  );
  const meta = [
    formatExamDate(exam.date),
    exam.type,
    alan,
    branch ? 'Branş' : null,
    branch,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <Link
      to={`/denemeler/${exam.id}`}
      aria-label={`${exam.name}, ${exam.type}${alan ? ` ${alan}` : ''}${
        branch ? `, Branş ${branch}` : ''
      }, ${formatExamDate(exam.date)}, toplam ${formatNet(totalNet)} net, ${deltaAria}`}
      className="block rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{meta}</p>
          <p className="truncate text-base font-semibold">{exam.name}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Toplam net</p>
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
      ) : branch ? (
        <div className="mt-3 space-y-1">
          <div
            className={`${branchCountsGrid} text-xs font-medium uppercase tracking-wide text-muted`}
          >
            <span />
            <span className="text-center">D</span>
            <span className="text-center">Y</span>
            <span className="text-center">B</span>
            <span className="text-right">Net</span>
          </div>
          {sortedResults.map((result) => (
            <div key={result.id} className={branchCountsGrid}>
              <span className="truncate text-xs text-muted">{branch}</span>
              <span className="text-center text-xs tabular-nums">{result.correct}</span>
              <span className="text-center text-xs tabular-nums">{result.wrong}</span>
              <span className="text-center text-xs tabular-nums">{result.blank}</span>
              <span className="text-right text-xs font-semibold tabular-nums">
                {formatNet(result.net)}
              </span>
            </div>
          ))}
        </div>
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
                <span className="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
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
  );
}

export function ExamsPage() {
  const { settings } = useAppSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  // The URL is the source of truth so saving an AYT exam can open the list on
  // the AYT tab and the branch tab can be linked directly; a plain
  // `/denemeler` visit still defaults to TYT.
  const turParam = searchParams.get('tur');
  const filter: ExamTab =
    turParam === 'AYT' ? 'AYT' : turParam === 'BRANS' ? 'BRANS' : 'TYT';
  const [alanFilter, setAlanFilter] = useState<AlanFilter>('all');
  const [chartSubjectId, setChartSubjectId] = useState('');
  const [branchType, setBranchType] = useState<ExamType>('TYT');
  // Empty means "follow settings.aytAlan": settings load after the first render,
  // so the default is derived instead of frozen into the initial state.
  const [branchAlanChoice, setBranchAlanChoice] = useState<AytBranch | ''>('');
  const branchAlan: AytBranch =
    branchAlanChoice !== ''
      ? branchAlanChoice
      : isAytBranch(settings.aytAlan)
        ? settings.aytAlan
        : 'sayisal';
  // Empty means "not chosen yet": the tab then opens on the first branch that
  // has branch exams (falling back to the first catalog option), so the chart
  // and list are never empty while the student has branch data.
  const [branchSelection, setBranchSelection] = useState<BranchExamKey | ''>('');

  function changeFilter(next: ExamTab) {
    setChartSubjectId('');
    if (next === 'BRANS') {
      setSearchParams({ tur: 'BRANS' }, { replace: true });
    } else {
      setSearchParams(next === 'AYT' ? { tur: 'AYT' } : {}, { replace: true });
    }
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

  // Full tabs only ever see full exams; branch exams live in their own tab.
  const fullRows = data.rows.filter((row) => !isBranchExam(row.exam));
  const fullExams = fullRows.map((row) => row.exam);
  const chartType: ExamType = filter === 'AYT' ? 'AYT' : 'TYT';
  const visibleRows = fullRows.filter((row) => row.exam.type === chartType);
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
  // A concrete AYT branch narrows the selector to that branch's subjects; a
  // subject from another branch would otherwise produce a flat zero line.
  const branchSeedKeys =
    chartType === 'AYT' && alanFilter !== 'all' && isAytBranch(alanFilter)
      ? new Set(ALAN_SUBJECT_SEED_KEYS[alanFilter])
      : null;
  const visibleChartSubjects = branchSeedKeys
    ? chartSubjects.filter((subject) => branchSeedKeys.has(subject.seedKey))
    : chartSubjects;
  const selectedSubject = visibleChartSubjects.find(
    (subject) => subject.id === chartSubjectId,
  );
  const chartSeries = selectedSubject
    ? buildSubjectNetSeries(
        fullExams,
        data.results,
        chartType,
        selectedSubject.id,
        chartType === 'AYT' && alanFilter !== 'all' ? alanFilter : undefined,
        resolveAlan,
      )
    : buildNetSeries(
        fullExams,
        data.results,
        chartType,
        chartType === 'AYT' && alanFilter !== 'all' ? alanFilter : undefined,
        resolveAlan,
      );
  const chartTitle = selectedSubject
    ? `${selectedSubject.name} başarı grafiği`
    : 'Deneme başarı grafiği';
  const chartAriaLabel = selectedSubject
    ? `${chartType} ${selectedSubject.name} net trend grafiği`
    : `${chartType} net trend grafiği`;

  const branchOptions = branchesFor(
    branchType,
    branchType === 'AYT' ? branchAlan : undefined,
  );
  const branchOptionKeys = new Set(branchOptions.map((option) => option.key));
  const branchWithExams = branchOptions.find((option) =>
    data.rows.some(
      (row) =>
        isBranchExam(row.exam) &&
        row.exam.type === branchType &&
        row.exam.branch === option.key,
    ),
  );
  const defaultBranch: BranchExamKey | undefined =
    branchWithExams?.key ?? branchOptions[0]?.key;
  const selectedBranch: BranchExamKey | undefined =
    branchSelection !== '' && branchOptionKeys.has(branchSelection)
      ? branchSelection
      : defaultBranch;
  const selectedBranchConfig = getBranchExam(selectedBranch ?? '');
  const branchHeading = selectedBranchConfig
    ? selectedBranchConfig.type === 'AYT' && selectedBranchConfig.alan
      ? `${selectedBranchConfig.type} ${AYT_ALAN_LABELS[selectedBranchConfig.alan]} · ${selectedBranchConfig.label}`
      : `${selectedBranchConfig.type} ${selectedBranchConfig.label}`
    : branchType;
  const branchLabel = selectedBranchConfig?.label ?? '';
  const branchRows = data.rows.filter(
    (row) =>
      isBranchExam(row.exam) &&
      row.exam.type === branchType &&
      row.exam.branch === selectedBranch,
  );
  const branchExams = branchRows.map((row) => row.exam);
  // Only the selected branch's history feeds the chart, so records are
  // branch-local and never inherited from another branch.
  const branchSeries = buildNetSeries(
    branchExams,
    data.results,
    branchType,
    branchType === 'AYT' ? branchAlan : undefined,
    resolveAlan,
  );

  function changeBranchType(next: ExamType) {
    const firstBranch =
      branchesFor(next, next === 'AYT' ? branchAlan : undefined)[0]?.key ?? '';
    setBranchType(next);
    setBranchSelection(firstBranch);
  }

  function changeBranchAlan(next: AytBranch) {
    const firstBranch =
      branchesFor(branchType, branchType === 'AYT' ? next : undefined)[0]?.key ?? '';
    setBranchAlanChoice(next);
    setBranchSelection(firstBranch);
  }

  const newExamParams = new URLSearchParams({
    brans: '1',
    tur: branchType,
    alan: branchAlan,
  });
  if (selectedBranch) {
    newExamParams.set('branch', selectedBranch);
  }
  const newExamHref =
    filter === 'BRANS' ? `/denemeler/yeni?${newExamParams.toString()}` : '/denemeler/yeni';

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Denemeler</h1>
          <p className="text-sm text-muted">
            TYT/AYT tam denemelerini ve branş denemelerini kaydet; net trendlerini
            takip et.
          </p>
        </div>
        <Link to={newExamHref} className={newExamLinkClass}>
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

      {filter === 'BRANS' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Branş türü filtresi"
              className="flex w-fit flex-wrap gap-1 rounded-xl border border-line bg-surface p-1"
            >
              {BRANCH_TYPES.map((type) => {
                const active = type === branchType;
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={active}
                    aria-label={`Branş türü ${type}`}
                    onClick={() => changeBranchType(type)}
                    className={
                      active
                        ? 'min-h-11 rounded-lg bg-[var(--accent-soft)] px-3 text-sm font-medium text-[var(--accent)]'
                        : 'min-h-11 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-fg'
                    }
                  >
                    {type}
                  </button>
                );
              })}
            </div>

            {branchType === 'AYT' ? (
              <div
                role="group"
                aria-label="AYT alan filtresi"
                className="flex flex-wrap gap-1 rounded-xl border border-line bg-canvas p-1"
              >
                {BRANCH_ALAN_FILTERS.map((option) => {
                  const active = option.id === branchAlan;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => changeBranchAlan(option.id)}
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

            <select
              aria-label="Branş"
              value={selectedBranch ?? ''}
              onChange={(event) =>
                setBranchSelection(event.target.value as BranchExamKey | '')
              }
              className="min-h-11 rounded-xl border border-line bg-canvas px-3 text-sm text-fg"
            >
              {branchOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {branchRows.length > 0 ? (
            <Card>
              <NetTrendChart
                series={branchSeries}
                title={`${branchHeading} branş denemeleri`}
                description={`${branchSeries.points.length} branş denemesi`}
                ariaLabel={`${branchHeading} net trend grafiği`}
              />
            </Card>
          ) : null}

          {branchRows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={`Henüz ${branchHeading} branş denemesi yok`}
              description="Branş seçimini değiştirebilir veya yeni bir branş denemesi ekleyebilirsin."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {branchRows.map(({ exam, results, totalNet }) => (
                <li key={exam.id}>
                  <ExamCard
                    exam={exam}
                    results={results}
                    totalNet={totalNet}
                    comparison={buildExamComparison(
                      branchExams,
                      data.results,
                      exam,
                      resolveAlan,
                    )}
                    subjectById={subjectById}
                    alan={exam.type === 'AYT' ? formatAlan(resolveAlan(exam)) : null}
                    branchLabel={branchLabel}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {visibleRows.length > 0 ? (
            <Card>
              <NetTrendChart
                series={chartSeries}
                title={chartTitle}
                description={`${chartSeries.points.length} ${chartType} denemesi`}
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
                      {visibleChartSubjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                    {chartType === 'AYT' ? (
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
                              onClick={() => {
                                setChartSubjectId('');
                                setAlanFilter(option.id);
                              }}
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
              title={`Henüz ${chartType} denemesi yok`}
              description="Farklı bir tür seçebilir veya yeni bir deneme ekleyebilirsin."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visibleRows.map(({ exam, results, totalNet }) => (
                <li key={exam.id}>
                  <ExamCard
                    exam={exam}
                    results={results}
                    totalNet={totalNet}
                    comparison={buildExamComparison(
                      fullExams,
                      data.results,
                      exam,
                      resolveAlan,
                    )}
                    subjectById={subjectById}
                    alan={exam.type === 'AYT' ? formatAlan(resolveAlan(exam)) : null}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
