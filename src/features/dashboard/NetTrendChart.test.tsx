import { render, screen } from '@testing-library/react';
import type { PointStyle } from 'chart.js';
import { expect, test, vi } from 'vitest';
import type { Exam, ExamResult } from '@/domain/types';
import chartSource from './NetTrendChart.tsx?raw';
import {
  buildNetSeries,
  tailSeries,
  type NetSeries,
  type NetSeriesPoint,
} from './chartData';
import {
  POINT_BORDER_WIDTH,
  POINT_HOVER_RADIUS,
  POINT_RADIUS,
  POINT_STYLE,
  RECORD_POINT_BORDER_WIDTH,
  RECORD_POINT_COLOR,
  RECORD_POINT_HOVER_RADIUS,
  RECORD_POINT_RADIUS,
  RECORD_POINT_STYLE,
  createRecordStarPlugin,
  netTooltipLabel,
  netTooltipTitle,
  NetTrendChart,
  seriesPointBorderColors,
  seriesPointBorderWidths,
  seriesPointColors,
  seriesPointHoverRadii,
  seriesPointRadii,
  seriesPointStyles,
} from './NetTrendChart';

const ACCENT = '#3B82F6';

const captured = vi.hoisted(() => ({
  lineProps: null as null | { data: unknown; options: unknown; plugins: unknown },
}));

vi.mock('react-chartjs-2', () => ({
  Line: (props: { data: unknown; options: unknown; plugins: unknown }) => {
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
      pointBorderWidth: number[];
      pointHoverBorderColor: string[];
      pointHoverBorderWidth: number[];
      pointStyle: PointStyle[];
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
  plugins?: Array<{ id?: string; afterDatasetsDraw?: unknown }>;
}

interface RecordedStarCalls {
  fillRects: number;
  strokeRects: number;
  rects: Array<[number, number, number, number]>;
  moveTo: Array<[number, number]>;
  lineTo: Array<[number, number]>;
  fills: string[];
  strokes: string[];
  lineJoins: string[];
  lineCaps: string[];
  lineWidths: number[];
}

/** Kaydedici 2D bağlam: yıldızın gerçekten vektör çizildiğini doğrular. */
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  calls: RecordedStarCalls;
} {
  const calls: RecordedStarCalls = {
    fillRects: 0,
    strokeRects: 0,
    rects: [],
    moveTo: [],
    lineTo: [],
    fills: [],
    strokes: [],
    lineJoins: [],
    lineCaps: [],
    lineWidths: [],
  };
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineJoin: 'miter' as CanvasLineJoin,
    lineCap: 'butt' as CanvasLineCap,
    lineWidth: 1,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    rect(x: number, y: number, width: number, height: number) {
      calls.rects.push([x, y, width, height]);
    },
    fillRect() {
      calls.fillRects += 1;
    },
    strokeRect() {
      calls.strokeRects += 1;
    },
    moveTo(x: number, y: number) {
      calls.moveTo.push([x, y]);
    },
    lineTo(x: number, y: number) {
      calls.lineTo.push([x, y]);
    },
    fill() {
      calls.fills.push(String(this.fillStyle));
    },
    stroke() {
      calls.strokes.push(String(this.strokeStyle));
      calls.lineJoins.push(String(this.lineJoin));
      calls.lineCaps.push(String(this.lineCap));
      calls.lineWidths.push(this.lineWidth);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function fakeChart(
  recordFlags: boolean[],
  positions: Array<{ x: number; y: number }>,
  ctx: CanvasRenderingContext2D,
  activeIndexes: number[] = [],
) {
  return {
    ctx,
    chartArea: { left: 10, top: 20, width: 200, height: 150 },
    data: { datasets: [{ recordFlags }] },
    getActiveElements: () =>
      activeIndexes.map((index) => ({ index, datasetIndex: 0, element: null })),
    getDatasetMeta: () => ({
      hidden: false,
      data: positions,
    }),
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
  expect(seriesPointStyles([point({ record: true })])[0]).toBe(
    RECORD_POINT_STYLE,
  );
  expect(seriesPointRadii([point({ record: true })])).toEqual([0]);
  expect(seriesPointBorderColors([point({ record: true })], ACCENT)).toEqual([
    ACCENT,
  ]);
  expect(seriesPointBorderWidths([point({ record: true })])).toEqual([
    RECORD_POINT_BORDER_WIDTH,
  ]);
});

test('rekor noktalar altın yıldız, diğerleri accent daire; kenarsız ve boyutlar', () => {
  const points = [
    point({ net: 20, record: false }),
    point({ net: 30, record: true }),
    point({ net: 25, record: false }),
  ];
  const styles = seriesPointStyles(points);
  expect(styles[0]).toBe(POINT_STYLE);
  expect(styles[1]).toBe(RECORD_POINT_STYLE);
  expect(styles[2]).toBe(POINT_STYLE);
  expect(POINT_STYLE).toBe('circle');
  expect(RECORD_POINT_STYLE).toBe('star');
  expect(seriesPointRadii(points)).toEqual([POINT_RADIUS, 0, POINT_RADIUS]);
  expect(seriesPointHoverRadii(points)).toEqual([
    POINT_HOVER_RADIUS,
    0,
    POINT_HOVER_RADIUS,
  ]);
  expect(seriesPointBorderColors(points, ACCENT)).toEqual([
    ACCENT,
    ACCENT,
    ACCENT,
  ]);
  expect(seriesPointBorderWidths(points)).toEqual([
    POINT_BORDER_WIDTH,
    RECORD_POINT_BORDER_WIDTH,
    POINT_BORDER_WIDTH,
  ]);

  // Klasik 5 köşeli yıldız: saf altın dolgu, vektör plugin, Chart.js kenarlığı yok.
  expect(RECORD_POINT_COLOR).toBe('#FACC15');
  expect(RECORD_POINT_BORDER_WIDTH).toBe(0);
  expect(RECORD_POINT_RADIUS).toBeGreaterThanOrEqual(10);
  expect(RECORD_POINT_RADIUS).toBeLessThanOrEqual(11);
  expect(RECORD_POINT_HOVER_RADIUS).toBe(14);
  expect(RECORD_POINT_RADIUS).toBeGreaterThan(POINT_RADIUS);
  expect(POINT_BORDER_WIDTH).toBe(1);
});

test('plugin rekor noktaya 10 köşeli altın vektör yıldız çizer', () => {
  const { ctx, calls } = recordingContext();
  const chart = fakeChart(
    [false, true, false],
    [
      { x: 40, y: 110 },
      { x: 100, y: 60 },
      { x: 160, y: 90 },
    ],
    ctx,
  );
  const plugin = createRecordStarPlugin([
    point({ record: false }),
    point({ record: true }),
    point({ record: false }),
  ]);
  (plugin.afterDatasetsDraw as (chart: unknown) => void)(chart);

  // Yalnızca grafik alanını (yıldız yarıçapı kadar geniş) kırpan rect var;
  // kare/çerçeve çizen çağrı yok.
  expect(calls.rects).toEqual([[-2, 8, 224, 174]]);
  expect(calls.fillRects).toBe(0);
  expect(calls.strokeRects).toBe(0);

  // Klasik 5 köşeli yıldız: 1 moveTo + 9 lineTo = 10 köşe.
  expect(calls.moveTo).toHaveLength(1);
  expect(calls.lineTo).toHaveLength(9);
  // İlk köşe yıldızın tepesi: merkez (100, 60), yarıçap 10.5.
  expect(calls.moveTo[0][0]).toBeCloseTo(100);
  expect(calls.moveTo[0][1]).toBeCloseTo(60 - RECORD_POINT_RADIUS);
  expect(calls.fills).toEqual([RECORD_POINT_COLOR]);
  expect(calls.strokes).toEqual([RECORD_POINT_COLOR]);
  expect(calls.lineJoins).toEqual(['round']);
  expect(calls.lineCaps).toEqual(['round']);
  expect(calls.lineWidths).toEqual([1.5]);
});

test('plugin güncel rekor bayraklarını grafik verisinden okur', () => {
  const { ctx, calls } = recordingContext();
  // Plugin eski seriyle kurulmuş olsa da chart verisi güncel bayrağı taşır.
  const chart = fakeChart(
    [false, true],
    [
      { x: 50, y: 100 },
      { x: 120, y: 70 },
    ],
    ctx,
  );
  const plugin = createRecordStarPlugin([
    point({ record: false }),
    point({ record: false }),
  ]);
  (plugin.afterDatasetsDraw as (chart: unknown) => void)(chart);

  expect(calls.moveTo).toHaveLength(1);
  expect(calls.moveTo[0][0]).toBeCloseTo(120);
  expect(calls.moveTo[0][1]).toBeCloseTo(70 - RECORD_POINT_RADIUS);
});

test('hover’daki rekor yıldızını plugin büyütür', () => {
  const { ctx, calls } = recordingContext();
  const chart = fakeChart(
    [false, true],
    [
      { x: 50, y: 100 },
      { x: 120, y: 70 },
    ],
    ctx,
    [1],
  );
  const plugin = createRecordStarPlugin([
    point({ record: false }),
    point({ record: true }),
  ]);
  (plugin.afterDatasetsDraw as (chart: unknown) => void)(chart);

  expect(calls.moveTo).toHaveLength(1);
  expect(calls.moveTo[0][0]).toBeCloseTo(120);
  expect(calls.moveTo[0][1]).toBeCloseTo(70 - RECORD_POINT_HOVER_RADIUS);
});

test('rekor yoksa plugin yıldız çizmez', () => {
  const { ctx, calls } = recordingContext();
  const chart = fakeChart(
    [false, false],
    [
      { x: 50, y: 100 },
      { x: 120, y: 70 },
    ],
    ctx,
  );
  const plugin = createRecordStarPlugin([
    point({ record: false }),
    point({ record: false }),
  ]);
  (plugin.afterDatasetsDraw as (chart: unknown) => void)(chart);

  expect(calls.moveTo).toHaveLength(0);
  expect(calls.fills).toEqual([]);
  expect(calls.strokes).toEqual([]);
});

test('yıldız çizimi tuval görüntüsü ve koyu kenar içermez', () => {
  expect(chartSource).not.toContain('#0A0A0C');
  expect(chartSource).not.toContain("createElement('canvas')");
  expect(chartSource).not.toContain('getContext');
  expect(chartSource).not.toContain('drawImage');
  expect(chartSource).not.toMatch(/strokeStyle\s*=\s*['"]#0/);
  expect(chartSource).toContain('afterDatasetsDraw');
});

test('PointElement prototipi yamalanmaz', () => {
  expect(chartSource).not.toContain('PointElement.prototype.draw');
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
  expect(dataset.pointBorderColor[0]).toBe(ACCENT);
  expect(dataset.pointBorderWidth[0]).toBe(RECORD_POINT_BORDER_WIDTH);
  expect(dataset.pointStyle[0]).toBe(RECORD_POINT_STYLE);
  expect(dataset.pointRadius[0]).toBe(0);
  expect(dataset.pointHoverRadius[0]).toBe(0);
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
    ACCENT,
  ]);
  expect(props.data.datasets[0].pointBorderWidth).toEqual([
    POINT_BORDER_WIDTH,
    RECORD_POINT_BORDER_WIDTH,
  ]);
  expect(props.data.datasets[0].pointHoverBorderColor).toEqual([
    ACCENT,
    ACCENT,
  ]);
  expect(props.data.datasets[0].pointHoverBorderWidth).toEqual([
    POINT_BORDER_WIDTH,
    RECORD_POINT_BORDER_WIDTH,
  ]);
  expect(props.data.datasets[0].pointStyle[0]).toBe('circle');
  expect(props.data.datasets[0].pointStyle[1]).toBe(RECORD_POINT_STYLE);
  expect(props.data.datasets[0].pointRadius).toEqual([POINT_RADIUS, 0]);
  expect(props.data.datasets[0].pointHoverRadius).toEqual([
    POINT_HOVER_RADIUS,
    0,
  ]);
  expect(props.plugins).toHaveLength(1);
  expect(props.plugins?.[0]?.id).toBe('recordStar');
  expect(props.plugins?.[0]?.afterDatasetsDraw).toBeTypeOf('function');

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
