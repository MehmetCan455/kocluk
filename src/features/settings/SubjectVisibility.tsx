import { useState } from 'react';
import { EyeOff } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { listSubjects } from '@/db/repositories';
import type { ExamType, Subject } from '@/domain/types';

const EXAM_SECTIONS: ReadonlyArray<{ exam: ExamType; title: string }> = [
  { exam: 'TYT', title: 'TYT dersleri' },
  { exam: 'AYT', title: 'AYT dersleri' },
];

/**
 * Per-subject visibility for both exams. It is display-only: hidden subjects
 * keep all of their tests, notes and exams, are skipped in progress
 * calculations and are not offered in new exam forms. The AYT alan selector
 * stamps a starting point; individual checkboxes refine it afterwards.
 */
export function SubjectVisibility() {
  const { settings, updateSettings } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subjects = useLiveQuery(() => listSubjects(), []);

  if (!subjects) {
    return (
      <p role="status" className="text-sm text-muted">
        Dersler yükleniyor…
      </p>
    );
  }

  if (subjects.length === 0) {
    return <p className="text-sm text-muted">Henüz ders yok.</p>;
  }

  const hidden = new Set(settings.hiddenSubjects);
  const allSubjects = subjects;
  const hiddenCount = allSubjects.filter((subject) => hidden.has(subject.id)).length;

  async function toggle(subjectId: string, visible: boolean) {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    const next = visible
      ? settings.hiddenSubjects.filter((id) => id !== subjectId)
      : [...new Set([...settings.hiddenSubjects, subjectId])];
    const result = await updateSettings({ hiddenSubjects: next });
    if (!result.ok) {
      setError('Ders görünürlüğü güncellenemedi. Lütfen tekrar dene.');
    }
    setSaving(false);
  }

  async function showAll() {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    const result = await updateSettings({ hiddenSubjects: [] });
    if (!result.ok) {
      setError('Ders görünürlüğü güncellenemedi. Lütfen tekrar dene.');
    }
    setSaving(false);
  }

  function subjectsFor(exam: ExamType): Subject[] {
    return allSubjects.filter((subject) => subject.exam === exam);
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Ders görünürlüğü</h2>
          <p className="text-sm text-muted">
            Gizlediğin dersler menülerden, yüzdelerden ve yeni deneme formundan çıkar.
            Verilerin silinmez; istediğin zaman geri açabilirsin.
          </p>
        </div>
      </div>

      {EXAM_SECTIONS.map(({ exam, title }) => {
        const examSubjects = subjectsFor(exam);
        if (examSubjects.length === 0) {
          return null;
        }
        return (
          <section key={exam} aria-labelledby={`gorunurluk-${exam}`} className="space-y-2">
            <h3
              id={`gorunurluk-${exam}`}
              className="text-xs font-medium uppercase tracking-wide text-muted"
            >
              {title}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {examSubjects.map((subject) => {
                const visible = !hidden.has(subject.id);
                return (
                  <li key={subject.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line bg-canvas px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={visible}
                        disabled={saving}
                        aria-label={`${subject.exam} · ${subject.name}`}
                        onChange={(event) => void toggle(subject.id, event.target.checked)}
                        className="h-5 w-5 accent-[var(--accent)]"
                      />
                      <span className="min-w-0 truncate">{subject.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {hiddenCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">{hiddenCount} ders gizli.</p>
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
