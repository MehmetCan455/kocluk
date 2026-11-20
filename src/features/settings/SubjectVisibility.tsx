import { useState } from 'react';
import { EyeOff } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { listSubjects } from '@/db/repositories';

/**
 * Per-subject visibility. It is display-only: hidden subjects keep all of their
 * tests, notes and exams, are skipped in progress calculations and are not
 * offered in new exam forms. TYT is never filtered, so only AYT subjects are
 * listed here; the AYT alan selector above stamps a starting point.
 */
export function SubjectVisibility() {
  const { settings, updateSettings } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subjects = useLiveQuery(() => listSubjects('AYT'), []);

  if (!subjects) {
    return (
      <p role="status" className="text-sm text-muted">
        Dersler yükleniyor…
      </p>
    );
  }

  if (subjects.length === 0) {
    return <p className="text-sm text-muted">Henüz AYT dersi yok.</p>;
  }

  const hidden = new Set(settings.hiddenSubjects);
  const hiddenCount = subjects.filter((subject) => hidden.has(subject.id)).length;

  async function toggle(subjectId: string, visible: boolean) {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    const next = visible
      ? settings.hiddenSubjects.filter((id) => id !== subjectId)
      : [...new Set([...settings.hiddenSubjects, subjectId])];
    try {
      await updateSettings({ hiddenSubjects: next });
    } catch (caught: unknown) {
      console.error('Ders görünürlüğü güncellenemedi', caught);
      setError('Ders görünürlüğü güncellenemedi. Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  }

  async function showAll() {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateSettings({ hiddenSubjects: [] });
    } catch (caught: unknown) {
      console.error('Ders görünürlüğü güncellenemedi', caught);
      setError('Ders görünürlüğü güncellenemedi. Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Ders görünürlüğü</h2>
          <p className="text-sm text-muted">
            Gizlediğin AYT dersleri yüzdelerden ve yeni deneme formundan çıkar. Veriler
            silinmez; istediğin zaman geri açabilirsin.
          </p>
        </div>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {subjects.map((subject) => {
          const visible = !hidden.has(subject.id);
          return (
            <li key={subject.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line bg-canvas px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={saving}
                  onChange={(event) => void toggle(subject.id, event.target.checked)}
                  className="h-5 w-5 accent-[var(--accent)]"
                />
                <span className="min-w-0 truncate">{subject.name}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">{hiddenCount} AYT dersi gizli.</p>
          <Button variant="secondary" size="sm" disabled={saving} onClick={() => void showAll()}>
            Tümünü göster
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
