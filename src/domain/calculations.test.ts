import { calculateNet, calculateProgress } from './calculations';
import { formatNet, formatPercent } from '@/lib/format';
import { daysUntil } from '@/lib/date';

test('net hesaplar', () => {
  expect(calculateNet(30, 8)).toBe(28);
  expect(calculateNet(0, 4)).toBe(-1);
});

test('ilerleme hesaplar', () => {
  expect(calculateProgress([])).toEqual({ solved: 0, total: 0, percent: 0, remaining: 0, started: false, done: false });
  expect(calculateProgress([{ solvedTests: 5, totalTests: 6 }])).toMatchObject({ percent: 83, remaining: 1, started: true, done: false });
  expect(calculateProgress([{ solvedTests: 3, totalTests: 3 }])).toMatchObject({ percent: 100, remaining: 0, done: true });
});

test('tr-TR biçimlendirir', () => {
  expect(formatNet(28)).toBe('28,00');
  expect(formatPercent(83)).toBe('%83');
});

test('gün farkını hesaplar', () => {
  expect(daysUntil('2027-06-19', new Date('2027-06-19T00:00:00'))).toBe(0);
});
