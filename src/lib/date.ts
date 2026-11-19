const DAY_MS = 24 * 60 * 60 * 1000;

export function daysUntil(date: string, today: Date = new Date()): number {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return Math.round((target.getTime() - start.getTime()) / DAY_MS);
}
