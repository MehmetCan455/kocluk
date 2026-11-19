import { useAppSettings } from '@/app/SettingsProvider';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import type { AytAlan } from '@/domain/types';
import { AccentPicker } from './AccentPicker';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

const AYT_ALAN_OPTIONS: ReadonlyArray<{ value: AytAlan; label: string }> = [
  { value: 'tumu', label: 'Tümü' },
  { value: 'sayisal', label: 'Sayısal' },
  { value: 'ea', label: 'Eşit Ağırlık' },
  { value: 'sozel', label: 'Sözel' },
];

function formatExamDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) {
    return '';
  }
  return dateFormatter.format(new Date(year, month - 1, day));
}

export function SettingsPage() {
  const { settings, updateSettings } = useAppSettings();
  const examDateLabel = formatExamDate(settings.examDate);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ayarlar</h1>
        <p className="text-sm text-muted">
          Profilini, sınav bilgilerini ve uygulama görünümünü yönet.
        </p>
      </header>

      <Card className="space-y-5">
        <h2 className="text-base font-semibold">Profil</h2>
        <Field
          label="Ad soyad"
          htmlFor="profil-ad"
          hint="Ana sayfada seni selamlamak için kullanılır."
        >
          <input
            id="profil-ad"
            type="text"
            autoComplete="name"
            value={settings.profileName}
            onChange={(event) => void updateSettings({ profileName: event.target.value })}
            placeholder="Adın"
            aria-describedby="profil-ad-hint"
            className={inputClass}
          />
        </Field>
      </Card>

      <Card className="space-y-5">
        <h2 className="text-base font-semibold">Sınav</h2>

        <Field label="Sınav adı" htmlFor="sinav-adi">
          <input
            id="sinav-adi"
            type="text"
            value={settings.examName}
            onChange={(event) => void updateSettings({ examName: event.target.value })}
            placeholder="YKS 2027"
            className={inputClass}
          />
        </Field>

        <Field
          label="Sınav tarihi"
          htmlFor="sinav-tarihi"
          hint={examDateLabel ? `Gösterim: ${examDateLabel}` : undefined}
        >
          <input
            id="sinav-tarihi"
            type="date"
            value={settings.examDate.slice(0, 10)}
            onChange={(event) => void updateSettings({ examDate: event.target.value })}
            aria-describedby="sinav-tarihi-hint"
            className={inputClass}
          />
        </Field>

        <Field
          label="AYT alanı"
          htmlFor="ayt-alani"
          hint="AYT derslerinden hangilerinin görüneceğini belirler."
        >
          <select
            id="ayt-alani"
            value={settings.aytAlan}
            onChange={(event) => void updateSettings({ aytAlan: event.target.value as AytAlan })}
            aria-describedby="ayt-alani-hint"
            className={inputClass}
          >
            {AYT_ALAN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Görünüm</h2>
          <p className="text-sm text-muted">
            Vurgu rengi butonlarda, menüde ve grafiklerde kullanılır.
          </p>
        </div>
        <AccentPicker />
      </Card>
    </div>
  );
}
