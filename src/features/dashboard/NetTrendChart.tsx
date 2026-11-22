import { useId, useMemo, type ReactNode } from 'react';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type PointStyle,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useAppSettings } from '@/app/SettingsProvider';
import { hexToRgb } from '@/app/theme';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatExamDate } from '@/features/exams/examFormat';
import { formatNet } from '@/lib/format';
import type { NetSeries, NetSeriesPoint } from './chartData';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const GRID_COLOR = '#232A36';
const TICK_COLOR = '#98A2B3';

/** An all-time net record is gold; everything else is accent. */
export const RECORD_POINT_COLOR = '#FACC15';

export const POINT_STYLE: PointStyle = 'circle';
/** Fallback when a canvas context is unavailable (for example during SSR). */
export const RECORD_POINT_STYLE: PointStyle = 'star';

/** Stars need a little more room than the plain circles. */
export const POINT_RADIUS = 3;
export const RECORD_POINT_RADIUS = 10.5;
export const POINT_HOVER_RADIUS = 5;
export const RECORD_POINT_HOVER_RADIUS = 14;

export const POINT_BORDER_WIDTH = 1;
/** Chart.js must not stroke the image bounding box, so records have no border. */
export const RECORD_POINT_BORDER_WIDTH = 0;

/** A fill-coloured stroke rounds the tips, so the canvas needs a little room. */
const STAR_POINT_STROKE_WIDTH = 1.5;
/** Logical canvas size; Chart.js draws image point styles at their intrinsic size. */
export const STAR_POINT_DISPLAY_SIZE =
  Math.ceil((RECORD_POINT_RADIUS + STAR_POINT_STROKE_WIDTH) * 2) + 2;
/** The star is supersampled and downscaled so its curves stay smooth. */
export const STAR_POINT_RENDER_SCALE = 4;

/** Draws a filled, classic five-point star with rounded tips centred on `(x, y)`. */
function drawClassicStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
): void {
  const innerRadius = radius * 0.42;
  const startAngle = -Math.PI / 2;
  ctx.beginPath();
  for (let index = 0; index < 10; index += 1) {
    const currentRadius = index % 2 === 0 ? radius : innerRadius;
    const angle = startAngle + (index * Math.PI) / 5;
    const pointX = x + Math.cos(angle) * currentRadius;
    const pointY = y + Math.sin(angle) * currentRadius;
    if (index === 0) {
      ctx.moveTo(pointX, pointY);
    } else {
      ctx.lineTo(pointX, pointY);
    }
  }
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();

  // Aynı altın renkte ince bir çizgi, yuvarlak birleşimlerle uçları yumuşatır.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = STAR_POINT_STROKE_WIDTH;
  ctx.strokeStyle = fill;
  ctx.stroke();
}

/**
 * Yüksek çözünürlüklü yıldız tuvali: 4x pikselde, mantıksal koordinatlarla çizilir.
 * Chart.js görsel nokta stilini kendi piksel boyutunda gösterdiği için asıl
 * nokta stili bunu görüntü boyutuna indirir.
 */
export function renderStarCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = STAR_POINT_DISPLAY_SIZE * STAR_POINT_RENDER_SCALE;
  canvas.height = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.scale(STAR_POINT_RENDER_SCALE, STAR_POINT_RENDER_SCALE);
  const center = STAR_POINT_DISPLAY_SIZE / 2;
  drawClassicStar(ctx, center, center, RECORD_POINT_RADIUS, RECORD_POINT_COLOR);
  return canvas;
}

let cachedStarPointStyle: PointStyle | null = null;

/**
 * A small offscreen canvas with the classic gold star. Chart.js draws image
 * point styles without a canvas-wide prototype patch, so normal circles and
 * other charts keep their own drawing path. Falls back to the built-in `star`
 * string when no 2D context exists.
 */
export function createStarPointStyle(): PointStyle {
  const renderCanvas = renderStarCanvas();
  if (!renderCanvas) {
    return RECORD_POINT_STYLE;
  }

  const canvas = document.createElement('canvas');
  canvas.width = STAR_POINT_DISPLAY_SIZE;
  canvas.height = STAR_POINT_DISPLAY_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return RECORD_POINT_STYLE;
  }

  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.drawImage(
    renderCanvas,
    0,
    0,
    renderCanvas.width,
    renderCanvas.height,
    0,
    0,
    STAR_POINT_DISPLAY_SIZE,
    STAR_POINT_DISPLAY_SIZE,
  );
  return canvas;
}

function recordPointStyle(): PointStyle {
  if (cachedStarPointStyle === null) {
    cachedStarPointStyle = createStarPointStyle();
  }
  return cachedStarPointStyle;
}

/**
 * Trust `point.record`: `toSeries` computes it over the full history, and a
 * trimmed window keeps the flag even when the record is now the first point.
 */
export function seriesPointColors(
  points: ReadonlyArray<Pick<NetSeriesPoint, 'record'>>,
  accent: string,
): string[] {
  return points.map((point) => (point.record ? RECORD_POINT_COLOR : accent));
}

/** Record points are stars so the highlight survives colour-blind viewing. */
export function seriesPointStyles(
  points: ReadonlyArray<Pick<NetSeriesPoint, 'record'>>,
): PointStyle[] {
  return points.map((point) => (point.record ? recordPointStyle() : POINT_STYLE));
}

export function seriesPointRadii(
  points: ReadonlyArray<Pick<NetSeriesPoint, 'record'>>,
): number[] {
  return points.map((point) => (point.record ? RECORD_POINT_RADIUS : POINT_RADIUS));
}

export function seriesPointHoverRadii(
  points: ReadonlyArray<Pick<NetSeriesPoint, 'record'>>,
): number[] {
  return points.map((point) =>
    point.record ? RECORD_POINT_HOVER_RADIUS : POINT_HOVER_RADIUS,
  );
}

/** Image point styles are never stroked; every point keeps the accent outline. */
export function seriesPointBorderColors(
  points: ReadonlyArray<Pick<NetSeriesPoint, 'record'>>,
  accent: string,
): string[] {
  return points.map(() => accent);
}

/** Record stars have no Chart.js border; plain circles keep the accent outline. */
export function seriesPointBorderWidths(
  points: ReadonlyArray<Pick<NetSeriesPoint, 'record'>>,
): number[] {
  return points.map((point) =>
    point.record ? RECORD_POINT_BORDER_WIDTH : POINT_BORDER_WIDTH,
  );
}

/** Tooltip title: the exam name keeps same-day exams distinguishable. */
export function netTooltipTitle(point: NetSeriesPoint): string {
  return point.examName;
}

/** Tooltip body: date and net, e.g. "17 Kasım 2026 · 45,50 net". */
export function netTooltipLabel(point: NetSeriesPoint): string {
  return `${formatExamDate(point.date)} · ${formatNet(point.net)} net`;
}

export interface NetTrendChartProps {
  series: NetSeries;
  title?: string;
  description?: string;
  emptyMessage?: string;
  ariaLabel: string;
  headerAction?: ReactNode;
}

export function NetTrendChart({
  series,
  title = 'Deneme başarı grafiği',
  description,
  emptyMessage = 'Henüz deneme yok',
  ariaLabel,
  headerAction,
}: NetTrendChartProps) {
  const titleId = useId();
  const { settings } = useAppSettings();
  const accent = settings.accent;
  const rgb = hexToRgb(accent);
  const fillColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)` : 'rgba(59, 130, 246, 0.1)';
  const points = series.points;

  const data = useMemo(() => {
    const pointColors = seriesPointColors(points, accent);
    const pointStyles = seriesPointStyles(points);
    const pointRadii = seriesPointRadii(points);
    const pointHoverRadii = seriesPointHoverRadii(points);
    const pointBorderColors = seriesPointBorderColors(points, accent);
    const pointBorderWidths = seriesPointBorderWidths(points);
    return {
      labels: points.map((point) => point.label),
      datasets: [
        {
          label: title,
          data: points.map((point) => point.net),
          borderColor: accent,
          backgroundColor: fillColor,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointBorderColors,
          pointBorderWidth: pointBorderWidths,
          pointHoverBackgroundColor: pointColors,
          pointHoverBorderColor: pointBorderColors,
          pointHoverBorderWidth: pointBorderWidths,
          pointStyle: pointStyles,
          pointRadius: pointRadii,
          pointHoverRadius: pointHoverRadii,
          borderWidth: 2,
          fill: true,
          tension: 0.25,
        },
      ],
    };
  }, [accent, fillColor, points, title]);

  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      locale: 'tr-TR',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161A22',
          borderColor: GRID_COLOR,
          borderWidth: 1,
          titleColor: '#F5F7FA',
          bodyColor: '#F5F7FA',
          displayColors: false,
          padding: 10,
          callbacks: {
            title: (items) => {
              const point = items[0] ? points[items[0].dataIndex] : undefined;
              return point ? netTooltipTitle(point) : '';
            },
            label: (context) => {
              const point = points[context.dataIndex];
              return point
                ? netTooltipLabel(point)
                : `Net ${formatNet(context.parsed.y ?? 0)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: GRID_COLOR },
          ticks: {
            color: TICK_COLOR,
            autoSkip: true,
            maxRotation: 0,
            maxTicksLimit: 6,
            font: { size: 11 },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: GRID_COLOR },
          border: { color: GRID_COLOR },
          ticks: {
            color: TICK_COLOR,
            font: { size: 11 },
            callback: (value) => formatNet(Number(value)),
          },
        },
      },
    }),
    [points],
  );

  const summary = points
    .map((point) => `${point.examName} · ${point.label}: ${formatNet(point.net)} net`)
    .join(' · ');

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
        {headerAction}
      </header>

      {points.length === 0 ? (
        <EmptyState title={emptyMessage} />
      ) : (
        <figure className="space-y-2">
          <div role="img" aria-label={ariaLabel} className="h-56 sm:h-64">
            <Line data={data} options={options} aria-hidden="true" />
          </div>
          <figcaption className="sr-only">{summary}</figcaption>
        </figure>
      )}
    </section>
  );
}
