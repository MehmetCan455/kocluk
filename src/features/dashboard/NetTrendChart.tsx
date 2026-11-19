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
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useAppSettings } from '@/app/SettingsProvider';
import { hexToRgb } from '@/app/theme';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatNet } from '@/lib/format';
import type { NetSeries } from './chartData';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const GRID_COLOR = '#232A36';
const TICK_COLOR = '#98A2B3';

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
  title = 'Net trendi',
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

  const data = useMemo(
    () => ({
      labels: series.labels,
      datasets: [
        {
          label: title,
          data: series.values,
          borderColor: accent,
          backgroundColor: fillColor,
          pointBackgroundColor: accent,
          pointBorderColor: accent,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.25,
        },
      ],
    }),
    [accent, fillColor, series.labels, series.values, title],
  );

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
            label: (context) => `Net ${formatNet(context.parsed.y ?? 0)}`,
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
    [],
  );

  const summary = series.labels
    .map((label, index) => `${label}: ${formatNet(series.values[index] ?? 0)} net`)
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

      {series.values.length === 0 ? (
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
