import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { cn } from '@/components/ui/cn';
import { getScheduleTable, listScheduleFiles } from '@/db/repositories';
import type { ScheduleMode } from '@/domain/types';
import { ScheduleFileList } from './ScheduleFileList';
import { ScheduleTableEditor } from './ScheduleTableEditor';

const MODE_OPTIONS: ReadonlyArray<{ value: ScheduleMode; label: string }> = [
  { value: 'upload', label: 'Fotoğraf/PDF' },
  { value: 'manual', label: 'Elle tablo' },
];

export function SchedulePage() {
  const { settings, updateSettings } = useAppSettings();
  const [modeError, setModeError] = useState<string | null>(null);
  const mode = settings.scheduleMode;

  // Separate queries: saving the table must not re-read the file blobs, and
  // the wrapper object distinguishes "still loading" from "no saved table".
  // Files (and their blobs) are only read in upload mode.
  const tableQuery = useLiveQuery(
    async () => ({ table: await getScheduleTable() }),
    [],
  );
  const files = useLiveQuery(
    async () => (mode === 'upload' ? listScheduleFiles() : []),
    [mode],
  );

  if (!tableQuery) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Çizelge yükleniyor…
      </p>
    );
  }

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
            Haftalık ders programını elle tablo olarak tut ya da fotoğraf/PDF
            olarak sakla.
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

      {/*
       * Keep the editor mounted while the upload archive is visible so an
       * unsaved draft survives mode switches. It is hidden from layout and the
       * accessibility tree in upload mode; autosave also runs while hidden.
       */}
      <div hidden={mode !== 'manual'}>
        <ScheduleTableEditor initialTable={tableQuery.table} />
      </div>

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
