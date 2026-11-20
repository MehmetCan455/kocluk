import { expect, test } from 'vitest';
import type { NetSeriesPoint } from './chartData';
import {
  IMPROVED_POINT_COLOR,
  netTooltipLabel,
  netTooltipTitle,
  seriesPointColors,
} from './NetTrendChart';

const ACCENT = '#3B82F6';

function point(overrides: Partial<NetSeriesPoint> = {}): NetSeriesPoint {
  return {
    examId: 'exam-1',
    examName: '3D TYT 5',
    date: '2026-11-17',
    label: '17 Kas',
    net: 45.5,
    improved: false,
    ...overrides,
  };
}

test('gelişen nokta altın, diğerleri accent renginde', () => {
  expect(
    seriesPointColors(
      [
        point({ net: 20, improved: false }),
        point({ net: 30, improved: true }),
        point({ net: 25, improved: false }),
      ],
      ACCENT,
    ),
  ).toEqual([ACCENT, IMPROVED_POINT_COLOR, ACCENT]);
  expect(IMPROVED_POINT_COLOR).toBe('#FACC15');
});

test('ilk nokta veride gelişmiş işaretli olsa bile accent kalır', () => {
  expect(seriesPointColors([point({ improved: true })], ACCENT)).toEqual([ACCENT]);
  expect(seriesPointColors([], ACCENT)).toEqual([]);
});

test('tooltip deneme adı, tarih ve neti gösterir', () => {
  expect(netTooltipTitle(point())).toBe('3D TYT 5');
  expect(netTooltipLabel(point())).toBe('17 Kasım 2026 · 45,50 net');
  expect(netTooltipLabel(point({ date: '2026-09-01', net: 28 }))).toBe(
    '1 Eylül 2026 · 28,00 net',
  );
});
