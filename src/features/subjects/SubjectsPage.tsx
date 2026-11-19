import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { listSubjects } from '@/db/repositories';
import type { ExamType, Subject } from '@/domain/types';
import { examTitle } from './exam';
import { SubjectCard } from './SubjectCard';

export interface SubjectsPageProps {
  exam: ExamType;
}

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
  const { settings } = useAppSettings();
  const [showHidden, setShowHidden] = useState(false);
  const subjects = useLiveQuery(() => listSubjects(exam), [exam]);

  if (!subjects) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Dersler yükleniyor…
      </p>
    );
  }

  // TYT subjects are never hidden. AYT hidden subjects are matched by ID so a
  // renamed subject keeps its visibility, and the toggle never writes settings.
  const hiddenIds = new Set(exam === 'AYT' ? settings.hiddenSubjects : []);
  const visibleSubjects = subjects.filter((subject) => !hiddenIds.has(subject.id));
  const hiddenSubjects = subjects.filter((subject) => hiddenIds.has(subject.id));

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
        {hiddenSubjects.length > 0 ? (
          <Button variant="secondary" onClick={() => setShowHidden((current) => !current)}>
            {showHidden ? 'Yalnızca alanımdaki dersler' : 'Tüm dersleri göster'}
          </Button>
        ) : null}
      </header>

      {visibleSubjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Gösterilecek ders yok"
          description={
            hiddenSubjects.length > 0
              ? 'Alanına uygun ders bulunamadı. Tüm dersleri göstererek gizli dersleri inceleyebilirsin.'
              : 'Müfredat yüklendiğinde dersler burada listelenecek.'
          }
        />
      ) : (
        <SubjectGrid subjects={visibleSubjects} exam={exam} />
      )}

      {showHidden && hiddenSubjects.length > 0 ? (
        <section aria-labelledby="alan-disi-dersler" className="space-y-3 pt-2">
          <div className="space-y-1">
            <h2 id="alan-disi-dersler" className="text-lg font-semibold">
              Alan dışı dersler
            </h2>
            <p className="text-sm text-muted">
              Bu dersler ayarlarına göre gizli. Yalnızca incelemek için gösteriliyor.
            </p>
          </div>
          <SubjectGrid subjects={hiddenSubjects} exam={exam} />
        </section>
      ) : null}
    </section>
  );
}
