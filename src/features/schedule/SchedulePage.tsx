import { lazy, Suspense, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { cn } from '@/components/ui/cn';
import { listScheduleFiles } from '@/db/repositories';
import type { ScheduleMode } from '@/domain/types';
import { LegacyScheduleTable } from './LegacyScheduleTable';
import { ScheduleFileList } from './ScheduleFileList';

// The weekly plan pulls in the schedule repository and date helpers. Loading
// it only in manual mode keeps the route heading on screen immediately.
const WeeklyPlan = lazy(() =>
  import('./WeeklyPlan').then((module) => ({ default: module.WeeklyPlan })),
);

const MODE_OPTIONS: ReadonlyArray<{ value: ScheduleMode; label: string }> = [
  { value: 'upload', label: 'Fotoğraf/PDF' },
  { value: 'manual', label: 'Elle tablo' },
];

export function SchedulePage() {
  const { settings, updateSettings } = useAppSettings();
  const [modeError, setModeError] = useState<string | null>(null);
  const mode = settings.scheduleMode;

  // Files (and their blobs) are only read in upload mode.
  const files = useLiveQuery(
    async () => (mode === 'upload' ? listScheduleFiles() : []),
    [mode],
  );

  async function changeMode(next: ScheduleMode): Promise<void> {
    if (next === settings.scheduleMode) {
      return;
    }

    setModeError(null);
    const result = await updateSettings({ scheduleMode: next });
    if (!result.ok) {
      setModeError('Çizelge modu kaydedilemedi. Lütfen tekrar dene.');
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Ders Çalışma Çizelgesi
          </h1>
          <p className="text-sm text-muted">
            Haftalık planını gün gün oluştur ya da fotoğraf/PDF olarak sakla.
          </p>
        </div>

        <div
          role="group"
          aria-label="Çizelge modu"
          className="inline-flex shrink-0 rounded-xl border border-line bg-surface p-1"
        >
          {MODE_OPTIONS.map((option) => {
            const selected = option.value === mode;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => void changeMode(option.value)}
                className={cn(
                  'min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
                  selected
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-muted hover:text-fg',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </header>

      {modeError ? (
        <p role="alert" className="text-sm text-danger">
          {modeError}
        </p>
      ) : null}

      {mode === 'manual' ? (
        <>
          <Suspense
            fallback={
              <p role="status" className="py-8 text-center text-sm text-muted">
                Haftalık plan yükleniyor…
              </p>
            }
          >
            <WeeklyPlan />
          </Suspense>
          <LegacyScheduleTable />
        </>
      ) : null}

      {mode === 'upload' ? (
        files ? (
          <ScheduleFileList files={files} />
        ) : (
          <p role="status" className="py-8 text-center text-sm text-muted">
            Dosyalar yükleniyor…
          </p>
        )
      ) : null}
    </section>
  );
}
