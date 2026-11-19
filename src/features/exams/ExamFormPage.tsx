import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppSettings } from '@/app/SettingsProvider';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { getExam, listExamResults, listSubjects, saveExam } from '@/db/repositories';
import { calculateNet } from '@/domain/calculations';
import type { AytAlan, ExamType, Subject } from '@/domain/types';
import { formatNet } from '@/lib/format';
import { AYT_ALAN_LABELS } from './examFormat';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

const countInputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-1 text-center text-sm tabular-nums text-fg placeholder:text-muted focus:border-[var(--accent)]';

interface Counts {
  correct: string;
  wrong: string;
  blank: string;
}

const EMPTY_COUNTS: Counts = { correct: '', wrong: '', blank: '' };

interface ParsedCounts {
  correct: number;
  wrong: number;
  blank: number;
  entered: boolean;
  invalid: boolean;
  net: number;
}

interface StoredResult {
  subjectId: string;
  correct: number;
  wrong: number;
  blank: number;
}

function parseCount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return 0;
  }
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseCounts(counts: Counts): ParsedCounts {
  const correct = parseCount(counts.correct);
  const wrong = parseCount(counts.wrong);
  const blank = parseCount(counts.blank);
  const entered = [counts.correct, counts.wrong, counts.blank].some(
    (value) => value.trim() !== '',
  );
  const invalid = entered && (correct === null || wrong === null || blank === null);

  return {
    correct: correct ?? 0,
    wrong: wrong ?? 0,
    blank: blank ?? 0,
    entered,
    invalid,
    net: invalid ? 0 : calculateNet(correct ?? 0, wrong ?? 0),
  };
}

function todayIsoDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const ALAN_OPTIONS: ReadonlyArray<AytAlan> = ['sayisal', 'ea', 'sozel', 'tumu'];

export function ExamFormPage() {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  const formTitle = editing ? 'Denemeyi düzenle' : 'Yeni deneme';

  const nameId = useId();
  const dateId = useId();
  const typeId = useId();
  const alanId = useId();
  const noteId = useId();

  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>(
    editing ? 'loading' : 'ready',
  );
  const [examType, setExamType] = useState<ExamType>('TYT');
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayIsoDate);
  const [alan, setAlan] = useState<AytAlan | ''>('');
  const [note, setNote] = useState('');
  const [values, setValues] = useState<Record<string, Counts>>({});
  const [initialResults, setInitialResults] = useState<StoredResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const exam = await getExam(id);
        if (cancelled) {
          return;
        }
        if (!exam) {
          setStatus('missing');
          return;
        }

        const results = await listExamResults(id);
        if (cancelled) {
          return;
        }

        const loadedValues: Record<string, Counts> = {};
        for (const result of results) {
          loadedValues[result.subjectId] = {
            correct: String(result.correct),
            wrong: String(result.wrong),
            blank: String(result.blank),
          };
        }

        setExamType(exam.type);
        setName(exam.name);
        setDate(exam.date);
        setAlan(exam.alan ?? '');
        setNote(exam.note);
        setValues(loadedValues);
        setInitialResults(
          results.map((result) => ({
            subjectId: result.subjectId,
            correct: result.correct,
            wrong: result.wrong,
            blank: result.blank,
          })),
        );
        setStatus('ready');
      } catch (caught: unknown) {
        console.error('Deneme yüklenemedi', caught);
        if (!cancelled) {
          setStatus('missing');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const subjects = useLiveQuery(() => listSubjects(examType), [examType]);

  if (status === 'missing') {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Deneme bulunamadı"
        description="Bu deneme silinmiş ya da taşınmış olabilir."
        action={
          <Link
            to="/denemeler"
            className="inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]"
          >
            Denemelere dön
          </Link>
        }
      />
    );
  }

  if (status === 'loading' || !subjects) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Deneme yükleniyor…
      </p>
    );
  }

  const hiddenIds = new Set(settings.hiddenSubjects);
  const visibleSubjects: Subject[] = subjects.filter((subject) => !hiddenIds.has(subject.id));
  const hiddenResults = initialResults.filter((result) => {
    const subject = subjects.find((item) => item.id === result.subjectId);
    return subject !== undefined && hiddenIds.has(subject.id);
  });

  const rows = visibleSubjects.map((subject) => ({
    subject,
    counts: values[subject.id] ?? EMPTY_COUNTS,
    parsed: parseCounts(values[subject.id] ?? EMPTY_COUNTS),
  }));
  const hasInvalidCounts = rows.some((row) => row.parsed.invalid);
  const hiddenNet = hiddenResults.reduce(
    (sum, result) => sum + calculateNet(result.correct, result.wrong),
    0,
  );
  const totalPreview =
    rows.reduce((sum, row) => (row.parsed.entered ? sum + row.parsed.net : sum), 0) + hiddenNet;

  const trimmedName = name.trim();
  const nameError = name !== '' && trimmedName === '' ? 'Deneme adı boş olamaz' : null;
  const dateError = date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'Geçerli bir tarih seç' : null;
  const canSave =
    !saving &&
    trimmedName !== '' &&
    date !== '' &&
    dateError === null &&
    !hasInvalidCounts;

  function updateCount(subjectId: string, field: keyof Counts, value: string) {
    setValues((current) => ({
      ...current,
      [subjectId]: {
        ...(current[subjectId] ?? EMPTY_COUNTS),
        [field]: value,
      },
    }));
  }

  function handleCancel() {
    navigate(editing && id ? `/denemeler/${id}` : '/denemeler');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const visibleResults = rows.flatMap((row) =>
        row.parsed.entered && !row.parsed.invalid
          ? [
              {
                subjectId: row.subject.id,
                correct: row.parsed.correct,
                wrong: row.parsed.wrong,
                blank: row.parsed.blank,
              },
            ]
          : [],
      );

      const saved = await saveExam({
        id: editing && id ? id : undefined,
        type: examType,
        name: trimmedName,
        date,
        alan: examType === 'AYT' && alan !== '' ? alan : undefined,
        note,
        results: [...visibleResults, ...hiddenResults],
      });

      navigate(editing ? `/denemeler/${saved.id}` : '/denemeler');
    } catch (caught: unknown) {
      console.error('Deneme kaydedilemedi', caught);
      setError(
        caught instanceof Error ? caught.message : 'Deneme kaydedilemedi. Lütfen tekrar dene.',
      );
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[{ label: 'Denemeler', to: '/denemeler' }, { label: formTitle }]}
      />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{formTitle}</h1>
        <p className="text-sm text-muted">
          Ders bazında doğru, yanlış ve boş sayılarını gir; netler otomatik hesaplanır.
        </p>
      </header>

      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        <Card className="space-y-4">
          <Field label="Deneme adı" htmlFor={nameId} error={nameError ?? undefined}>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder="Örn. 3D TYT 5"
              aria-required="true"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${nameId}-error` : undefined}
              className={inputClass}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Deneme türü"
              htmlFor={typeId}
              hint={
                editing
                  ? 'Deneme türü sonradan değiştirilemez; farklı tür için yeni deneme oluşturun.'
                  : undefined
              }
            >
              <select
                id={typeId}
                value={examType}
                onChange={(event) => setExamType(event.target.value as ExamType)}
                disabled={editing}
                aria-describedby={editing ? `${typeId}-hint` : undefined}
                className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <option value="TYT">TYT</option>
                <option value="AYT">AYT</option>
              </select>
            </Field>

            <Field label="Tarih" htmlFor={dateId} error={dateError ?? undefined}>
              <input
                id={dateId}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-required="true"
                aria-invalid={dateError ? true : undefined}
                aria-describedby={dateError ? `${dateId}-error` : undefined}
                className={inputClass}
              />
            </Field>
          </div>

          {examType === 'AYT' ? (
            <Field label="AYT alanı" htmlFor={alanId} hint="İsteğe bağlı">
              <select
                id={alanId}
                value={alan}
                onChange={(event) => setAlan(event.target.value as AytAlan | '')}
                className={inputClass}
              >
                <option value="">Belirtilmedi</option>
                {ALAN_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {AYT_ALAN_LABELS[option]}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </Card>

        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Ders sonuçları</h2>
              <p className="text-xs text-muted">
                Boş bırakılan satırlar toplama katılmaz. Boş alanlar 0 sayılır.
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Toplam net
              </p>
              <p className="text-2xl font-semibold tabular-nums text-[var(--accent)]">
                {formatNet(totalPreview)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_2.75rem] items-end gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Ders</span>
            <span className="text-center text-xs font-medium uppercase tracking-wide text-muted">
              D
            </span>
            <span className="text-center text-xs font-medium uppercase tracking-wide text-muted">
              Y
            </span>
            <span className="text-center text-xs font-medium uppercase tracking-wide text-muted">
              B
            </span>
          </div>

          <ul className="divide-y divide-line">
            {rows.map(({ subject, counts, parsed }) => (
              <li
                key={subject.id}
                className="grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_2.75rem] items-center gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{subject.name}</p>
                  <p className="text-xs tabular-nums text-muted">
                    Net {parsed.entered && !parsed.invalid ? formatNet(parsed.net) : '—'}
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={counts.correct}
                  onChange={(event) => updateCount(subject.id, 'correct', event.target.value)}
                  aria-label={`${subject.name} doğru`}
                  aria-invalid={parsed.invalid ? true : undefined}
                  placeholder="0"
                  className={countInputClass}
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={counts.wrong}
                  onChange={(event) => updateCount(subject.id, 'wrong', event.target.value)}
                  aria-label={`${subject.name} yanlış`}
                  aria-invalid={parsed.invalid ? true : undefined}
                  placeholder="0"
                  className={countInputClass}
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={counts.blank}
                  onChange={(event) => updateCount(subject.id, 'blank', event.target.value)}
                  aria-label={`${subject.name} boş`}
                  aria-invalid={parsed.invalid ? true : undefined}
                  placeholder="0"
                  className={countInputClass}
                />
              </li>
            ))}
          </ul>

          {visibleSubjects.length === 0 ? (
            <p className="text-sm text-muted">
              Görünür ders yok. Ayarlar bölümünden ders görünürlüğünü değiştirebilirsin.
            </p>
          ) : null}

          {hasInvalidCounts ? (
            <p role="alert" className="text-sm text-danger">
              D/Y/B alanları 0 veya daha büyük tam sayı olmalı.
            </p>
          ) : null}

          {hiddenResults.length > 0 ? (
            <p className="text-xs text-muted">
              Gizlenen {hiddenResults.length} dersin mevcut sonucu korunacak.
            </p>
          ) : null}
        </Card>

        <Card>
          <Field label="Not" htmlFor={noteId} hint="İsteğe bağlı">
            <textarea
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Deneme hakkında kısa bir not"
              className={inputClass}
            />
          </Field>
        </Card>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={handleCancel} disabled={saving}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={!canSave}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      </form>
    </div>
  );
}
