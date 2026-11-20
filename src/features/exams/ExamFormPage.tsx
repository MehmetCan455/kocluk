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
import {
  getExamSubjectConfig,
  geometrySeedKey,
  isAytBranch,
  mathSeedKey,
  resolveAytAlan,
} from './examConfig';
import { AYT_ALAN_LABELS } from './examFormat';

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

const countInputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-1 text-center text-sm tabular-nums text-fg placeholder:text-muted focus:border-[var(--accent)] aria-invalid:border-danger';

const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_2.5rem_3.5rem] items-center gap-1.5';

interface Counts {
  correct: string;
  wrong: string;
}

const EMPTY_COUNTS: Counts = { correct: '', wrong: '' };

interface ParsedCounts {
  correct: number;
  wrong: number;
  blank: number | null;
  net: number | null;
  entered: boolean;
  error: string | null;
}

interface StoredResult {
  subjectId: string;
  correct: number;
  wrong: number;
  blank: number;
}

interface EntryRow {
  subject: Subject;
  questionCount: number;
  counts: Counts;
  parsed: ParsedCounts;
}

interface PreservedRow {
  subject: Subject;
  result: StoredResult;
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

function parseCounts(counts: Counts, questionCount: number): ParsedCounts {
  const correct = parseCount(counts.correct);
  const wrong = parseCount(counts.wrong);
  const entered = counts.correct.trim() !== '' || counts.wrong.trim() !== '';
  const invalid = entered && (correct === null || wrong === null);
  const safeCorrect = correct ?? 0;
  const safeWrong = wrong ?? 0;
  const overflow = entered && !invalid && safeCorrect + safeWrong > questionCount;

  let error: string | null = null;
  if (invalid) {
    error = 'D ve Y 0 veya daha büyük tam sayı olmalı.';
  } else if (overflow) {
    error = `Doğru ve yanlış toplamı ${questionCount} soruyu aşıyor.`;
  }

  const blank = entered && !invalid && !overflow ? questionCount - safeCorrect - safeWrong : null;
  return {
    correct: safeCorrect,
    wrong: safeWrong,
    blank,
    net: blank === null ? null : calculateNet(safeCorrect, safeWrong),
    entered,
    error,
  };
}

function todayIsoDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const ALAN_OPTIONS = ['sayisal', 'ea', 'sozel'] as const;

function mergeGeometryCounts(
  results: StoredResult[],
  examType: ExamType,
  allSubjects: Subject[],
): Record<string, Counts> {
  const merged: Record<string, Counts> = {};
  const mathSubject = allSubjects.find(
    (subject) => subject.seedKey === mathSeedKey(examType),
  );
  const geometrySubject = allSubjects.find(
    (subject) => subject.seedKey === geometrySeedKey(examType),
  );
  if (!mathSubject || !geometrySubject) {
    return merged;
  }

  const mathResult = results.find((result) => result.subjectId === mathSubject.id);
  const geometryResult = results.find(
    (result) => result.subjectId === geometrySubject.id,
  );
  if (!geometryResult) {
    return merged;
  }

  merged[mathSubject.id] = {
    correct: String((mathResult?.correct ?? 0) + geometryResult.correct),
    wrong: String((mathResult?.wrong ?? 0) + geometryResult.wrong),
  };
  return merged;
}

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

        const [results, allSubjects] = await Promise.all([
          listExamResults(id),
          listSubjects(),
        ]);
        if (cancelled) {
          return;
        }

        const loadedValues: Record<string, Counts> = {};
        for (const result of results) {
          loadedValues[result.subjectId] = {
            correct: String(result.correct),
            wrong: String(result.wrong),
          };
        }

        // In combined mode an old separate geometry result is folded into the
        // maths row, so editing does not count the 10 geometry questions twice.
        if (settings.geometryMode === 'combined') {
          Object.assign(
            loadedValues,
            mergeGeometryCounts(results, exam.type, allSubjects),
          );
        }

        setExamType(exam.type);
        setName(exam.name);
        setDate(exam.date);
        setAlan(exam.type === 'AYT' ? resolveAytAlan(exam, results, allSubjects) : '');
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
    // Settings are loaded before the route renders, so the geometry mode at
    // mount is final for this edit session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const subjectBySeed = new Map(subjects.map((subject) => [subject.seedKey, subject]));
  const storedById = new Map(initialResults.map((result) => [result.subjectId, result]));

  const mathSubject = subjectBySeed.get(mathSeedKey(examType));
  const geometrySubject = subjectBySeed.get(geometrySeedKey(examType));
  const config = getExamSubjectConfig(examType, alan, settings.geometryMode);
  const mathConfigured = config.some((row) => row.seedKey === mathSeedKey(examType));
  const geometryConsumed =
    settings.geometryMode === 'combined' &&
    mathConfigured &&
    mathSubject !== undefined &&
    !hiddenIds.has(mathSubject.id) &&
    geometrySubject !== undefined &&
    storedById.has(geometrySubject.id);
  const geometryConsumedId = geometryConsumed ? geometrySubject?.id : undefined;

  const entryRows: EntryRow[] = config.flatMap((entry) => {
    const subject = subjectBySeed.get(entry.seedKey);
    if (!subject || hiddenIds.has(subject.id)) {
      return [];
    }
    const counts = values[subject.id] ?? EMPTY_COUNTS;
    return [
      {
        subject,
        questionCount: entry.questionCount,
        counts,
        parsed: parseCounts(counts, entry.questionCount),
      },
    ];
  });
  const entryIds = new Set(entryRows.map((row) => row.subject.id));

  // Subjects outside the selected branch, or without a configured question
  // count, keep their stored result untouched. This is what makes switching
  // geometry mode or AYT branch non-destructive.
  const preservedRows: PreservedRow[] = subjects.flatMap((subject) => {
    if (
      hiddenIds.has(subject.id) ||
      entryIds.has(subject.id) ||
      subject.id === geometryConsumedId
    ) {
      return [];
    }
    const result = storedById.get(subject.id);
    return result ? [{ subject, result }] : [];
  });

  const hiddenResults = initialResults.filter((result) => {
    const subject = subjects.find((item) => item.id === result.subjectId);
    return (
      subject !== undefined &&
      hiddenIds.has(subject.id) &&
      subject.id !== geometryConsumedId
    );
  });

  // Results whose subject row no longer exists are still carried through on
  // save instead of being silently dropped.
  const knownSubjectIds = new Set(subjects.map((subject) => subject.id));
  const orphanResults = initialResults.filter(
    (result) => !knownSubjectIds.has(result.subjectId),
  );

  const hasRowErrors = entryRows.some((row) => row.parsed.error !== null);
  const entryNet = entryRows.reduce(
    (sum, row) => sum + (row.parsed.entered && !row.parsed.error ? (row.parsed.net ?? 0) : 0),
    0,
  );
  const preservedNet = preservedRows.reduce(
    (sum, row) => sum + calculateNet(row.result.correct, row.result.wrong),
    0,
  );
  const hiddenNet = hiddenResults.reduce(
    (sum, result) => sum + calculateNet(result.correct, result.wrong),
    0,
  );
  const totalPreview = entryNet + preservedNet + hiddenNet;

  const trimmedName = name.trim();
  const nameError = name !== '' && trimmedName === '' ? 'Deneme adı boş olamaz' : null;
  const dateError =
    date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'Geçerli bir tarih seç' : null;
  const alanError = examType === 'AYT' && alan === '' ? 'AYT alanı seç' : null;
  const awaitingAlan = examType === 'AYT' && alan === '';
  const canSave =
    !saving &&
    trimmedName !== '' &&
    date !== '' &&
    dateError === null &&
    !hasRowErrors &&
    !awaitingAlan;

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
      const entryResults = entryRows.flatMap((row) =>
        row.parsed.entered && !row.parsed.error && row.parsed.blank !== null
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
      const untouchedResults = [
        ...preservedRows.map(({ result }) => ({ ...result })),
        ...hiddenResults.map((result) => ({ ...result })),
        ...orphanResults.map((result) => ({ ...result })),
      ];

      const saved = await saveExam({
        id: editing && id ? id : undefined,
        type: examType,
        name: trimmedName,
        date,
        alan: examType === 'AYT' && isAytBranch(alan) ? alan : undefined,
        note,
        results: [...entryResults, ...untouchedResults],
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
          Ders bazında doğru ve yanlış sayılarını gir; boş sorular ve netler otomatik
          hesaplanır.
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
            <Field
              label="AYT alanı"
              htmlFor={alanId}
              error={alanError ?? undefined}
              hint="Ders listesi seçilen alana göre belirlenir."
            >
              <select
                id={alanId}
                value={alan}
                onChange={(event) => setAlan(event.target.value as AytAlan | '')}
                aria-required="true"
                aria-invalid={alanError ? true : undefined}
                aria-describedby={alanError ? `${alanId}-error` : `${alanId}-hint`}
                className={inputClass}
              >
                <option value="">Alan seç</option>
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
                Boş sorular, dersin soru sayısından doğru ve yanlış çıkarılarak bulunur.
                Boş bırakılan satırlar toplama katılmaz.
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

          {entryRows.length > 0 ? (
            <div className={ROW_GRID}>
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Ders
              </span>
              <span className="text-center text-xs font-medium uppercase tracking-wide text-muted">
                D
              </span>
              <span className="text-center text-xs font-medium uppercase tracking-wide text-muted">
                Y
              </span>
              <span className="text-center text-xs font-medium uppercase tracking-wide text-muted">
                B
              </span>
              <span className="text-right text-xs font-medium uppercase tracking-wide text-muted">
                Net
              </span>
            </div>
          ) : null}

          <ul className="divide-y divide-line">
            {entryRows.map(({ subject, questionCount, counts, parsed }) => {
              const errorId = `sonuc-${subject.id}-error`;
              return (
                <li key={subject.id} className="py-2">
                  <div className={ROW_GRID}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{subject.name}</p>
                      <p className="text-xs tabular-nums text-muted">
                        {questionCount} soru
                      </p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={questionCount}
                      step={1}
                      inputMode="numeric"
                      value={counts.correct}
                      onChange={(event) =>
                        updateCount(subject.id, 'correct', event.target.value)
                      }
                      aria-label={`${subject.name} doğru`}
                      aria-invalid={parsed.error ? true : undefined}
                      aria-describedby={parsed.error ? errorId : undefined}
                      placeholder="0"
                      className={countInputClass}
                    />
                    <input
                      type="number"
                      min={0}
                      max={questionCount}
                      step={1}
                      inputMode="numeric"
                      value={counts.wrong}
                      onChange={(event) =>
                        updateCount(subject.id, 'wrong', event.target.value)
                      }
                      aria-label={`${subject.name} yanlış`}
                      aria-invalid={parsed.error ? true : undefined}
                      aria-describedby={parsed.error ? errorId : undefined}
                      placeholder="0"
                      className={countInputClass}
                    />
                    <span
                      aria-label={`${subject.name} boş`}
                      className="text-center text-sm tabular-nums text-muted"
                    >
                      {parsed.blank ?? '—'}
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums">
                      {parsed.entered && !parsed.error && parsed.net !== null
                        ? formatNet(parsed.net)
                        : '—'}
                    </span>
                  </div>
                  {parsed.error ? (
                    <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
                      {parsed.error}
                    </p>
                  ) : null}
                </li>
              );
            })}

            {preservedRows.map(({ subject, result }) => (
              <li key={subject.id} className="py-2">
                <div className={ROW_GRID}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{subject.name}</p>
                    <p className="text-xs text-muted">
                      Soru sayısı tanımlı değil · korunuyor
                    </p>
                  </div>
                  <span className="text-center text-sm tabular-nums">{result.correct}</span>
                  <span className="text-center text-sm tabular-nums">{result.wrong}</span>
                  <span className="text-center text-sm tabular-nums text-muted">
                    {result.blank}
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums">
                    {formatNet(calculateNet(result.correct, result.wrong))}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {awaitingAlan ? (
            <p className="text-sm text-muted">
              Dersleri görmek için önce AYT alanını seç.
            </p>
          ) : null}

          {!awaitingAlan && entryRows.length === 0 && preservedRows.length === 0 ? (
            <p className="text-sm text-muted">
              Görünür ders yok. Ayarlar bölümünden ders görünürlüğünü değiştirebilirsin.
            </p>
          ) : null}

          {hasRowErrors ? (
            <p role="alert" className="text-sm text-danger">
              D ve Y alanlarını kontrol et; kaydetmek için satır hatalarını düzelt.
            </p>
          ) : null}

          {preservedRows.length > 0 ? (
            <p className="text-xs text-muted">
              Bu denemede soru sayısı tanımlı olmayan {preservedRows.length} dersin eski
              sonucu olduğu gibi korunacak.
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
