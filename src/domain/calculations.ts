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

/**
 * Count-based progress for explicit completion states (topics). The caller
 * supplies finished and total counts; `started` follows from any finished item.
 */
export function calculateCountProgress(done: number, total: number): Progress {
  return {
    solved: done,
    total,
    percent: total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100)),
    remaining: Math.max(total - done, 0),
    started: done > 0,
    done: total > 0 && done === total,
  };
}
