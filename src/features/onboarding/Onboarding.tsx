import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { applyAccent, normalizeHex } from '@/app/theme';
import { useAppSettings } from '@/app/SettingsProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { cn } from '@/components/ui/cn';
import { ACCENT_PALETTES, DEFAULT_ACCENT } from '@/data/accentPalettes';
import { computeHiddenSubjects } from '@/data/alanSubjects';
import { CURRICULUM } from '@/data/curriculum';
import { listSubjects, seedCurriculum } from '@/db/repositories';
import type { AytAlan } from '@/domain/types';

const TOTAL_STEPS = 4;

const STEP_TITLES = ['Seni tanıyalım', 'AYT alanın', 'Vurgu rengi', 'Hazırsın'] as const;

const ALAN_OPTIONS: ReadonlyArray<{
  value: AytAlan;
  label: string;
  description: string;
}> = [
  {
    value: 'sayisal',
    label: 'Sayısal',
    description: 'Matematik, geometri, fizik, kimya ve biyoloji',
  },
  {
    value: 'ea',
    label: 'Eşit Ağırlık',
    description: 'Matematik, geometri, edebiyat, tarih, coğrafya, felsefe grubu ve din kültürü',
  },
  {
    value: 'sozel',
    label: 'Sözel',
    description: 'Edebiyat, tarih, coğrafya, felsefe grubu ve din kültürü',
  },
  {
    value: 'tumu',
    label: 'Tümü',
    description: 'Hiçbir AYT dersi gizlenmez',
  },
];

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

export function Onboarding() {
  const { settings, updateSettings } = useAppSettings();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.profileName);
  const [alan, setAlan] = useState<AytAlan>(settings.aytAlan);
  const [accent, setAccent] = useState(
    () => normalizeHex(settings.accent) ?? DEFAULT_ACCENT,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canContinue = step !== 0 || trimmedName.length > 0;
  const selectedAlan = ALAN_OPTIONS.find((option) => option.value === alan);
  const selectedAccent = ACCENT_PALETTES.find((palette) => palette.hex === accent);

  function goBack() {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  }

  function goNext() {
    if (!canContinue) {
      return;
    }
    setError(null);
    setStep((current) => Math.min(TOTAL_STEPS - 1, current + 1));
  }

  function pickAccent(hex: string) {
    setAccent(hex);
    applyAccent(hex);
  }

  async function finish() {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await seedCurriculum(CURRICULUM);
      const subjects = await listSubjects();
      const result = await updateSettings({
        profileName: trimmedName,
        accent,
        aytAlan: alan,
        hiddenSubjects: computeHiddenSubjects(alan, subjects),
        onboardingDone: true,
      });
      if (!result.ok) {
        setError('Kurulum tamamlanamadı. Lütfen tekrar dene.');
        setSaving(false);
        return;
      }
      navigate('/', { replace: true });
    } catch (caught: unknown) {
      console.error('Kurulum tamamlanamadı', caught);
      setError('Kurulum tamamlanamadı. Lütfen tekrar dene.');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center">
      <Card className="w-full space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Adım {step + 1} / {TOTAL_STEPS}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{STEP_TITLES[step]}</h1>
          <p className="text-sm text-muted">
            {step === 0
              ? 'Sana nasıl seslenmemizi istersin?'
              : step === 1
                ? 'Hangi alanda hazırlanıyorsun? AYT derslerin buna göre düzenlenir.'
                : step === 2
                  ? 'Uygulamanın rengini seç. Dilediğin zaman değiştirebilirsin.'
                  : 'Her şey hazır. Ayarları daha sonra değiştirebilirsin.'}
          </p>
        </div>

        {step === 0 ? (
          <Field
            label="Adın"
            htmlFor="onboarding-ad"
            hint="Ana sayfada seni selamlamak için kullanılır."
          >
            <input
              id="onboarding-ad"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Adın"
              autoComplete="name"
              maxLength={60}
              aria-describedby="onboarding-ad-hint"
              className={inputClass}
            />
          </Field>
        ) : null}

        {step === 1 ? (
          <fieldset className="space-y-3">
            <legend className="sr-only">AYT alanın</legend>
            {ALAN_OPTIONS.map((option) => {
              const active = option.value === alan;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors duration-150',
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-line bg-canvas hover:border-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="ayt-alani"
                    value={option.value}
                    checked={active}
                    onChange={() => setAlan(option.value)}
                    aria-label={option.label}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">{option.label}</span>
                    <span className="block text-xs text-muted">{option.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div role="group" aria-label="Vurgu rengi" className="flex flex-wrap gap-2">
              {ACCENT_PALETTES.map((palette) => {
                const active = palette.hex === accent;
                return (
                  <button
                    key={palette.hex}
                    type="button"
                    aria-label={palette.name}
                    aria-pressed={active}
                    title={palette.name}
                    onClick={() => pickAccent(palette.hex)}
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
              Seçili renk:{' '}
              <span className="font-medium text-fg">
                {selectedAccent?.name ?? accent}
              </span>
            </p>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <dl className="space-y-3 rounded-xl border border-line bg-canvas p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">Adın</dt>
                <dd className="font-medium text-fg">{trimmedName}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">AYT alanın</dt>
                <dd className="text-right font-medium text-fg">{selectedAlan?.label ?? 'Tümü'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">Vurgu rengi</dt>
                <dd className="flex items-center gap-2 font-medium text-fg">
                  <span
                    className="h-4 w-4 rounded-full border border-line"
                    style={{ backgroundColor: accent }}
                    aria-hidden="true"
                  />
                  {selectedAccent?.name ?? accent}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted">
              Verilerin yalnızca bu cihazda saklanır; hesap, bulut ya da reklam yoktur.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          {step > 0 ? (
            <Button variant="ghost" onClick={goBack} disabled={saving}>
              Geri
            </Button>
          ) : (
            <span />
          )}

          {step < TOTAL_STEPS - 1 ? (
            <Button onClick={goNext} disabled={!canContinue}>
              İleri
            </Button>
          ) : (
            <Button onClick={() => void finish()} disabled={saving}>
              {saving ? 'Kaydediliyor…' : 'Başla'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
