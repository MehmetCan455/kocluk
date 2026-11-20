import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { Exam, ExamResult } from '@/domain/types';
import {
  buildNetSeries,
  tailSeries,
  type NetSeries,
  type NetSeriesPoint,
} from './chartData';
import {
  POINT_RADIUS,
  POINT_STYLE,
  RECORD_POINT_COLOR,
  RECORD_POINT_RADIUS,
  RECORD_POINT_STYLE,
  netTooltipLabel,
  netTooltipTitle,
  NetTrendChart,
  seriesPointColors,
  seriesPointRadii,
  seriesPointStyles,
} from './NetTrendChart';

const ACCENT = '#3B82F6';

const captured = vi.hoisted(() => ({
  lineProps: null as null | { data: unknown; options: unknown },
}));

vi.mock('react-chartjs-2', () => ({
  Line: (props: { data: unknown; options: unknown }) => {
    captured.lineProps = props;
    return null;
  },
}));

vi.mock('@/app/SettingsProvider', () => ({
  useAppSettings: () => ({ settings: { accent: ACCENT } }),
}));

function point(overrides: Partial<NetSeriesPoint> = {}): NetSeriesPoint {
  return {
    examId: 'exam-1',
    examName: '3D TYT 5',
    date: '2026-11-17',
    label: '17 Kas',
    net: 45.5,
    record: false,
    ...overrides,
  };
}

function chartExam(id: string, date: string): Exam {
  return {
    id,
    type: 'TYT',
    name: id,
    date,
    note: '',
    createdAt: `${date}T10:00:00.000Z`,
  };
}

function chartResult(id: string, examId: string, net: number): ExamResult {
  return {
    id,
    examId,
    subjectId: `subject-${id}`,
    correct: net,
    wrong: 0,
    blank: 0,
    net,
  };
}

interface CapturedLineProps {
  data: {
    labels: string[];
    datasets: Array<{
      borderColor: string;
      data: number[];
      pointBackgroundColor: string[];
      pointBorderColor: string[];
      pointStyle: string[];
      pointRadius: number[];
      pointHoverRadius: number[];
    }>;
  };
  options: {
    plugins: {
      tooltip: {
        callbacks: {
          title: (items: Array<{ dataIndex: number }>) => string;
          label: (context: { dataIndex: number; parsed: { y: number } }) => string;
        };
      };
    };
  };
}

test('rekor nokta altın, diğerleri accent renginde', () => {
  expect(
    seriesPointColors(
      [
        point({ net: 20, record: false }),
        point({ net: 30, record: true }),
        point({ net: 25, record: false }),
      ],
      ACCENT,
    ),
  ).toEqual([ACCENT, RECORD_POINT_COLOR, ACCENT]);
  expect(RECORD_POINT_COLOR).toBe('#FACC15');
});

test('ilk nokta rekor işaretliyse altın yıldız kalır', () => {
  expect(seriesPointColors([point({ record: true })], ACCENT)).toEqual([
    RECORD_POINT_COLOR,
  ]);
  expect(seriesPointColors([], ACCENT)).toEqual([]);
  expect(seriesPointStyles([point({ record: true })])).toEqual([RECORD_POINT_STYLE]);
  expect(seriesPointRadii([point({ record: true })])).toEqual([RECORD_POINT_RADIUS]);
});

test('rekor noktalar yıldız, diğerleri daire; yıldız biraz daha büyük', () => {
  const points = [
    point({ net: 20, record: false }),
    point({ net: 30, record: true }),
    point({ net: 25, record: false }),
  ];
  expect(seriesPointStyles(points)).toEqual([
    POINT_STYLE,
    RECORD_POINT_STYLE,
    POINT_STYLE,
  ]);
  expect(POINT_STYLE).toBe('circle');
  expect(RECORD_POINT_STYLE).toBe('star');
  expect(seriesPointRadii(points)).toEqual([
    POINT_RADIUS,
    RECORD_POINT_RADIUS,
    POINT_RADIUS,
  ]);
  expect(RECORD_POINT_RADIUS).toBeGreaterThan(POINT_RADIUS);
});

test('kırpılmış dashboard serisinde pencere başındaki rekor altın yıldız kalır', () => {
  const nets = [10, 20, 30, 15, 12, 11, 9, 8, 7, 6];
  const exams = nets.map((_, index) =>
    chartExam(
      `tyt-${index + 1}`,
      `2026-09-${String(index + 1).padStart(2, '0')}`,
    ),
  );
  const results = nets.map((net, index) =>
    chartResult(`r-${index + 1}`, `tyt-${index + 1}`, net),
  );
  const windowed = tailSeries(buildNetSeries(exams, results, 'TYT'), 8);

  // Rekor üçüncü denemede; son 8'e kırpılınca pencerenin ilk noktası oluyor.
  expect(windowed.points[0]).toMatchObject({
    examId: 'tyt-3',
    net: 30,
    record: true,
  });

  render(<NetTrendChart series={windowed} ariaLabel="Kırpılmış grafik" />);

  const dataset = (captured.lineProps as CapturedLineProps).data.datasets[0];
  expect(dataset.pointBackgroundColor[0]).toBe(RECORD_POINT_COLOR);
  expect(dataset.pointBorderColor[0]).toBe(RECORD_POINT_COLOR);
  expect(dataset.pointStyle[0]).toBe('star');
  expect(dataset.pointRadius[0]).toBe(RECORD_POINT_RADIUS);
  expect(dataset.pointHoverRadius[0]).toBe(7);
});

test('tooltip deneme adı, tarih ve neti gösterir', () => {
  expect(netTooltipTitle(point())).toBe('3D TYT 5');
  expect(netTooltipLabel(point())).toBe('17 Kasım 2026 · 45,50 net');
  expect(netTooltipLabel(point({ date: '2026-09-01', net: 28 }))).toBe(
    '1 Eylül 2026 · 28,00 net',
  );
});

test('grafik bileşeni nokta renklerini, şekillerini ve tooltip callbacklerini Chart.js verisine aktarır', () => {
  const series: NetSeries = {
    points: [
      point({ examId: 'sabah', examName: 'Sabah Denemesi', net: 20, record: false }),
      point({
        examId: 'aksam',
        examName: 'Akşam Denemesi',
        date: '2026-11-18',
        label: '18 Kas',
        net: 30,
        record: true,
      }),
    ],
  };

  render(<NetTrendChart series={series} ariaLabel="Test net grafiği" />);

  expect(screen.getByRole('heading', { name: 'Deneme başarı grafiği' })).toBeInTheDocument();

  const props = captured.lineProps as CapturedLineProps;
  expect(props.data.labels).toEqual(['17 Kas', '18 Kas']);
  expect(props.data.datasets[0].borderColor).toBe(ACCENT);
  expect(props.data.datasets[0].data).toEqual([20, 30]);
  expect(props.data.datasets[0].pointBackgroundColor).toEqual([
    ACCENT,
    RECORD_POINT_COLOR,
  ]);
  expect(props.data.datasets[0].pointBorderColor).toEqual([
    ACCENT,
    RECORD_POINT_COLOR,
  ]);
  expect(props.data.datasets[0].pointStyle).toEqual(['circle', 'star']);
  expect(props.data.datasets[0].pointRadius).toEqual([
    POINT_RADIUS,
    RECORD_POINT_RADIUS,
  ]);
  expect(props.data.datasets[0].pointHoverRadius).toEqual([5, 7]);

  const { title, label } = props.options.plugins.tooltip.callbacks;
  expect(title([{ dataIndex: 0 }])).toBe('Sabah Denemesi');
  expect(title([{ dataIndex: 1 }])).toBe('Akşam Denemesi');
  expect(label({ dataIndex: 0, parsed: { y: 20 } })).toBe(
    '17 Kasım 2026 · 20,00 net',
  );
  expect(label({ dataIndex: 1, parsed: { y: 30 } })).toBe(
    '18 Kasım 2026 · 30,00 net',
  );
});
