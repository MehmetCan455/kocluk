import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import type {
  Exam,
  ExamType,
  PhotoFilters as PhotoFiltersValue,
  Subject,
  Topic,
} from '@/domain/types';
import { formatExamDate } from '@/features/exams/examFormat';

export interface PhotoFiltersProps {
  value: PhotoFiltersValue;
  subjects: Subject[];
  topics: Topic[];
  exams: Exam[];
  onChange: (next: PhotoFiltersValue) => void;
}

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

export function PhotoFilters({ value, subjects, topics, exams, onChange }: PhotoFiltersProps) {
  const baseId = useId().replace(/:/g, '');
  const hasActiveFilter =
    value.examType !== undefined ||
    value.subjectId !== undefined ||
    value.topicId !== undefined ||
    value.examId !== undefined ||
    value.mastered !== undefined ||
    Boolean(value.query);

  function patch(next: Partial<PhotoFiltersValue>) {
    onChange({ ...value, ...next });
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Filtreler</h2>
        {hasActiveFilter ? (
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            Filtreleri temizle
          </Button>
        ) : null}
      </div>

      <div
        role="search"
        aria-label="Fotoğraf filtreleri"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Field label="Sınav türü filtresi" htmlFor={`${baseId}-tur`}>
          <select
            id={`${baseId}-tur`}
            value={value.examType ?? ''}
            onChange={(event) =>
              patch({
                examType: event.target.value ? (event.target.value as ExamType) : undefined,
                subjectId: undefined,
                topicId: undefined,
              })
            }
            className={inputClass}
          >
            <option value="">Tüm türler</option>
            <option value="TYT">TYT</option>
            <option value="AYT">AYT</option>
          </select>
        </Field>

        <Field label="Ders filtresi" htmlFor={`${baseId}-ders`}>
          <select
            id={`${baseId}-ders`}
            value={value.subjectId ?? ''}
            onChange={(event) =>
              patch({
                subjectId: event.target.value || undefined,
                topicId: undefined,
              })
            }
            className={inputClass}
          >
            <option value="">Tüm dersler</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.exam} · {subject.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Konu filtresi" htmlFor={`${baseId}-konu`}>
          <select
            id={`${baseId}-konu`}
            value={value.topicId ?? ''}
            disabled={!value.subjectId}
            onChange={(event) => patch({ topicId: event.target.value || undefined })}
            className={inputClass}
          >
            <option value="">Tüm konular</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Deneme filtresi" htmlFor={`${baseId}-deneme`}>
          <select
            id={`${baseId}-deneme`}
            value={value.examId ?? ''}
            onChange={(event) => patch({ examId: event.target.value || undefined })}
            className={inputClass}
          >
            <option value="">Tüm denemeler</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.type} · {exam.name} · {formatExamDate(exam.date)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Durum filtresi" htmlFor={`${baseId}-durum`}>
          <select
            id={`${baseId}-durum`}
            value={value.mastered === undefined ? '' : String(value.mastered)}
            onChange={(event) =>
              patch({
                mastered:
                  event.target.value === ''
                    ? undefined
                    : event.target.value === 'true',
              })
            }
            className={inputClass}
          >
            <option value="">Tüm durumlar</option>
            <option value="false">Çözülmedi</option>
            <option value="true">Çözüldü</option>
          </select>
        </Field>

        <Field label="Notta ara" htmlFor={`${baseId}-arama`}>
          <input
            id={`${baseId}-arama`}
            type="search"
            value={value.query ?? ''}
            onChange={(event) => patch({ query: event.target.value || undefined })}
            placeholder="Notta ara…"
            className={inputClass}
          />
        </Field>
      </div>
    </Card>
  );
}
