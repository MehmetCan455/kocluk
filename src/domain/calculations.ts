import type { Progress } from './types';

export function calculateNet(correct: number, wrong: number): number {
  return correct - wrong / 4;
}

export function calculateProgress(
  records: Array<{ solvedTests: number; totalTests: number }>,
): Progress {
  const solved = records.reduce((sum, record) => sum + record.solvedTests, 0);
  const total = records.reduce((sum, record) => sum + record.totalTests, 0);
  const done = total > 0 && solved >= total;

  return {
    solved,
    total,
    percent: total === 0 ? 0 : done ? 100 : Math.min(99, Math.round((solved / total) * 100)),
    remaining: Math.max(total - solved, 0),
    started: solved > 0,
    done,
  };
}
