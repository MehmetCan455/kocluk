import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { computeHiddenSubjects } from '@/data/alanSubjects';
import { listSubjects } from '@/db/repositories';
import type { AytAlan, ExamType, Subject } from '@/domain/types';
import { examTitle } from './exam';
import { SubjectCard } from './SubjectCard';

export interface SubjectsPageProps {
  exam: ExamType;
}

const ALAN_OPTIONS: ReadonlyArray<{ value: AytAlan; label: string }> = [
  { value: 'sayisal', label: 'Sayısal' },
  { value: 'ea', label: 'Eşit Ağırlık' },
  { value: 'sozel', label: 'Sözel' },
  { value: 'tumu', label: 'Tümü' },
];

function SubjectGrid({ subjects, exam }: { subjects: Subject[]; exam: ExamType }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {subjects.map((subject) => (
        <li key={subject.id}>
          <SubjectCard subject={subject} exam={exam} />
        </li>
      ))}
    </ul>
  );
}

export function SubjectsPage({ exam }: SubjectsPageProps) {
  const { settings, updateSettings } = useAppSettings();
  const [selectedAlan, setSelectedAlan] = useState<AytAlan>(settings.aytAlan);
  const subjects = useLiveQuery(() => listSubjects(exam), [exam]);

  if (!subjects) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Dersler yükleniyor…
      </p>
    );
  }

  const isAyt = exam === 'AYT';

  async function changeAlan(value: AytAlan) {
    if (value === selectedAlan) {
      return;
    }

    const previous = selectedAlan;
    setSelectedAlan(value);

    try {
      await updateSettings({
        aytAlan: value,
        hiddenSubjects: computeHiddenSubjects(value, await listSubjects()),
      });
    } catch (error: unknown) {
      console.error('AYT alanı güncellenemedi', error);
      setSelectedAlan(previous);
    }
  }

  // TYT subjects are never filtered. On AYT, the selected alan determines the
  // visible set; persisted hidden subjects are also respected on open. While a
  // selection is being persisted, the local alan result is authoritative.
  const persistedHiddenIds = new Set(isAyt ? settings.hiddenSubjects : []);
  const alanHiddenIds = new Set(
    isAyt && selectedAlan !== 'tumu' ? computeHiddenSubjects(selectedAlan, subjects) : [],
  );
  const hiddenIds =
    isAyt && selectedAlan === settings.aytAlan
      ? new Set([...persistedHiddenIds, ...alanHiddenIds])
      : alanHiddenIds;
  const visibleSubjects =
    !isAyt || selectedAlan === 'tumu'
      ? subjects
      : subjects.filter((subject) => !hiddenIds.has(subject.id));

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{examTitle(exam)}</h1>
          <p className="text-sm text-muted">
            {exam === 'TYT'
              ? 'Temel Yeterlilik Testi dersleri ve konuları.'
              : 'Alan Yeterlilik Testi dersleri ve konuları.'}
          </p>
        </div>

        {isAyt ? (
          <div
            role="group"
            aria-label="AYT alanı"
            className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1"
          >
            {ALAN_OPTIONS.map((option) => {
              const active = option.value === selectedAlan;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => void changeAlan(option.value)}
                  className={
                    active
                      ? 'min-h-11 rounded-lg bg-[var(--accent-soft)] px-3 text-sm font-medium text-[var(--accent)]'
                      : 'min-h-11 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-fg'
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </header>

      {visibleSubjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={isAyt ? 'Bu alanda ders yok' : 'Gösterilecek ders yok'}
          description={
            isAyt
              ? 'Başka bir alan seçebilir veya Tümü ile tüm dersleri görebilirsin.'
              : 'Müfredat yüklendiğinde dersler burada listelenecek.'
          }
        />
      ) : (
        <SubjectGrid subjects={visibleSubjects} exam={exam} />
      )}
    </section>
  );
}
