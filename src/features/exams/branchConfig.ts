import type { AytAlan, BranchExamKey, Exam, ExamType } from '@/domain/types';

/** One selectable branch exam: a single net row with a fixed question count. */
export interface BranchExamConfig {
  key: BranchExamKey;
  type: ExamType;
  alan?: Exclude<AytAlan, 'tumu'>;
  label: string;
  questionCount: number;
}

/**
 * The fixed branch catalog from the design spec. Question counts are the ÖSYM
 * totals for that branch; the order is the order the pickers show.
 */
export const BRANCH_EXAMS: readonly BranchExamConfig[] = [
  { key: 'tyt-turkce', type: 'TYT', label: 'Türkçe', questionCount: 40 },
  { key: 'tyt-sosyal', type: 'TYT', label: 'Sosyal', questionCount: 20 },
  { key: 'tyt-matematik', type: 'TYT', label: 'Matematik', questionCount: 40 },
  { key: 'tyt-fen', type: 'TYT', label: 'Fen', questionCount: 20 },
  {
    key: 'ayt-sayisal-matematik',
    type: 'AYT',
    alan: 'sayisal',
    label: 'Matematik',
    questionCount: 40,
  },
  {
    key: 'ayt-sayisal-fen',
    type: 'AYT',
    alan: 'sayisal',
    label: 'Fen',
    questionCount: 40,
  },
  {
    key: 'ayt-ea-matematik',
    type: 'AYT',
    alan: 'ea',
    label: 'Matematik',
    questionCount: 40,
  },
  {
    key: 'ayt-ea-edebiyat-sosyal-1',
    type: 'AYT',
    alan: 'ea',
    label: 'Edebiyat-Sosyal 1',
    questionCount: 40,
  },
  {
    key: 'ayt-sozel-edebiyat-sosyal-1',
    type: 'AYT',
    alan: 'sozel',
    label: 'Edebiyat-Sosyal 1',
    questionCount: 40,
  },
  {
    key: 'ayt-sozel-sosyal-2',
    type: 'AYT',
    alan: 'sozel',
    label: 'Sosyal 2',
    questionCount: 40,
  },
];

const BRANCH_BY_KEY: ReadonlyMap<string, BranchExamConfig> = new Map(
  BRANCH_EXAMS.map((branch) => [branch.key, branch]),
);

const ALAN_LABELS: Readonly<Record<Exclude<AytAlan, 'tumu'>, string>> = {
  sayisal: 'Sayısal',
  ea: 'Eşit Ağırlık',
  sozel: 'Sözel',
};

/** The catalog row for a stored branch key, or `undefined` for unknown keys. */
export function getBranchExam(key: string): BranchExamConfig | undefined {
  return BRANCH_BY_KEY.get(key);
}

/**
 * The branches for one exam type. AYT needs a concrete `alan`; TYT ignores it
 * because TYT branches have no field.
 */
export function branchesFor(
  type: ExamType,
  alan?: Exclude<AytAlan, 'tumu'>,
): BranchExamConfig[] {
  return BRANCH_EXAMS.filter(
    (branch) => branch.type === type && (type === 'TYT' || branch.alan === alan),
  );
}

/** Old records without `kind` are full exams. */
export function isBranchExam(exam: Pick<Exam, 'kind'>): boolean {
  return exam.kind === 'branch';
}

/** `TYT · Sosyal` or `AYT Sayısal · Fen`. */
export function branchDisplayLabel(config: BranchExamConfig): string {
  if (config.type === 'TYT' || !config.alan) {
    return `${config.type} · ${config.label}`;
  }
  return `${config.type} ${ALAN_LABELS[config.alan]} · ${config.label}`;
}
