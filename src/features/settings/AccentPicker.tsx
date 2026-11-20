import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { useAppSettings } from '@/app/SettingsProvider';
import { normalizeHex } from '@/app/theme';
import { ACCENT_PALETTES } from '@/data/accentPalettes';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

export function AccentPicker() {
  const { settings, updateSettings } = useAppSettings();
  const [custom, setCustom] = useState('');
  const customHex = normalizeHex(custom);
  const customError = custom !== '' && customHex === null;
  const selected = normalizeHex(settings.accent) ?? settings.accent;

  function handleCustomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customHex) {
      return;
    }
    void updateSettings({ accent: customHex });
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Vurgu rengi" className="flex flex-wrap gap-2">
        {ACCENT_PALETTES.map((palette) => {
          const active = palette.hex === selected;
          return (
            <button
              key={palette.hex}
              type="button"
              aria-label={palette.name}
              aria-pressed={active}
              title={palette.name}
              onClick={() => void updateSettings({ accent: palette.hex })}
              className={cn(
                'grid h-11 w-11 place-items-center rounded-full border transition-transform duration-150 hover:scale-105',
                active ? 'border-fg' : 'border-line',
              )}
            >
              <span
                className="grid h-7 w-7 place-items-center rounded-full"
                style={{ backgroundColor: palette.hex }}
              >
                {active ? (
                  <Check
                    className="h-4 w-4"
                    style={{ color: 'var(--accent-contrast)' }}
                    aria-hidden="true"
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted" aria-live="polite">
        Seçili renk: <span className="font-mono text-fg">{selected}</span>
      </p>

      <form onSubmit={handleCustomSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <label htmlFor="ozel-renk" className="block text-sm font-medium text-fg">
            Özel renk
          </label>
          <input
            id="ozel-renk"
            type="text"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="#RRGGBB"
            maxLength={7}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={customError || undefined}
            aria-describedby={customError ? 'ozel-renk-error' : undefined}
            className={inputClass}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!customHex}>
          Uygula
        </Button>
      </form>

      {customError ? (
        <p id="ozel-renk-error" role="alert" className="text-xs text-danger">
          Geçerli bir hex kodu gir (#RRGGBB).
        </p>
      ) : null}
    </div>
  );
}
