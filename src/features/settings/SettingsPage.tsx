import { lazy, Suspense, useRef, useState } from 'react';
import { useAppSettings } from '@/app/SettingsProvider';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { computeHiddenSubjects } from '@/data/alanSubjects';
import { listSubjects } from '@/db/repositories';
import type { AytAlan, GeometryMode } from '@/domain/types';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { AccentPicker } from './AccentPicker';
import { InstallGuide } from './InstallGuide';
import { StoragePanel } from './StoragePanel';
import { SubjectVisibility } from './SubjectVisibility';

// JSZip and zod are only needed when the user opens the backup panel.
const BackupPanel = lazy(() =>
  import('./BackupPanel').then((module) => ({ default: module.BackupPanel })),
);

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
  const [storageRefreshKey, setStorageRefreshKey] = useState(0);
  const [alanError, setAlanError] = useState<string | null>(null);
  const alanRequest = useRef(0);
  const examDateLabel = formatExamDate(settings.examDate);

  // Selecting an alan is the starting point; the individual toggles in
  // SubjectVisibility can refine the list afterwards. The request counter keeps
  // a slow earlier read from overwriting a newer selection.
  async function changeAlan(value: AytAlan) {
    const request = alanRequest.current + 1;
    alanRequest.current = request;
    setAlanError(null);
    const subjects = await listSubjects();
    if (request !== alanRequest.current) {
      return;
    }
    const result = await updateSettings({
      aytAlan: value,
      hiddenSubjects: computeHiddenSubjects(value, subjects),
    });
    if (!result.ok) {
      setAlanError('AYT alanı güncellenemedi. Lütfen tekrar dene.');
    }
  }

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
            aria-describedby={examDateLabel ? 'sinav-tarihi-hint' : undefined}
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
            onChange={(event) => void changeAlan(event.target.value as AytAlan)}
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

        {alanError ? (
          <p role="alert" className="text-sm text-danger">
            {alanError}
          </p>
        ) : null}
      </Card>

      <Card className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Denemeler</h2>
          <p className="text-sm text-muted">
            Yalnızca deneme girişini ve deneme netlerini etkiler. Konu ve kitap takibinde
            Geometri ayrı bir ders olarak kalır.
          </p>
        </div>

        <Field
          label="Denemelerde geometri"
          htmlFor="denemelerde-geometri"
          hint="Ayrı: matematik 30 + geometri 10 soru. Matematikle birlikte: tek matematik satırı 40 soru."
        >
          <select
            id="denemelerde-geometri"
            value={settings.geometryMode}
            onChange={(event) =>
              void updateSettings({ geometryMode: event.target.value as GeometryMode })
            }
            aria-describedby="denemelerde-geometri-hint"
            className={inputClass}
          >
            <option value="separate">Ayrı</option>
            <option value="combined">Matematikle birlikte</option>
          </select>
        </Field>
      </Card>

      <SubjectVisibility />

      <Card className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Görünüm</h2>
          <p className="text-sm text-muted">
            Vurgu rengi butonlarda, menüde ve grafiklerde kullanılır.
          </p>
        </div>
        <AccentPicker />
      </Card>

      <SyncStatus />

      <InstallGuide />
      <Suspense
        fallback={
          <p role="status" className="text-sm text-muted">
            Yedekleme paneli yükleniyor…
          </p>
        }
      >
        <BackupPanel onDataChanged={() => setStorageRefreshKey((value) => value + 1)} />
      </Suspense>
      <StoragePanel refreshKey={storageRefreshKey} />
    </div>
  );
}
