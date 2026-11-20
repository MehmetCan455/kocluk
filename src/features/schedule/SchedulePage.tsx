import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  deleteScheduleEntry,
  listScheduleEntries,
  listScheduleFiles,
  listSubjects,
} from '@/db/repositories';
import type { ScheduleEntry, Subject } from '@/domain/types';
import { ScheduleEntryModal } from './ScheduleEntryModal';
import { ScheduleFileList } from './ScheduleFileList';
import {
  SCHEDULE_DAYS,
  formatScheduleTime,
  scheduleDayLabel,
} from './scheduleDays';

function todayDay(): number {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function groupByDay(entries: ScheduleEntry[]): Map<number, ScheduleEntry[]> {
  const grouped = new Map<number, ScheduleEntry[]>();
  for (const entry of entries) {
    const rows = grouped.get(entry.day);
    if (rows) {
      rows.push(entry);
    } else {
      grouped.set(entry.day, [entry]);
    }
  }
  return grouped;
}

interface EntryCardProps {
  entry: ScheduleEntry;
  subject?: Subject;
  onEdit: (entry: ScheduleEntry) => void;
  onDelete: (entry: ScheduleEntry) => void;
}

function ScheduleEntryCard({ entry, subject, onEdit, onDelete }: EntryCardProps) {
  const dayLabel = scheduleDayLabel(entry.day);
  const label = `${entry.title}, ${dayLabel} ${entry.startTime}`;

  return (
    <li className="rounded-xl border border-line bg-canvas/50 p-2.5">
      <p className="text-xs font-medium tabular-nums text-[var(--accent)]">
        {formatScheduleTime(entry.startTime, entry.endTime)}
      </p>
      <p className="mt-0.5 break-words text-sm font-medium leading-snug">{entry.title}</p>
      {subject ? (
        <span className="mt-1 inline-flex max-w-full truncate rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
          {subject.name}
        </span>
      ) : null}
      {entry.note ? (
        <p className="mt-1 whitespace-pre-line break-words text-xs leading-snug text-muted">
          {entry.note}
        </p>
      ) : null}

      <div className="mt-1 flex items-center justify-end gap-1">
        <button
          type="button"
          aria-label={`${label} kaydını düzenle`}
          onClick={() => onEdit(entry)}
          className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`${label} kaydını sil`}
          onClick={() => onDelete(entry)}
          className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-danger"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

interface EntryModalState {
  entry: ScheduleEntry | null;
  day: number;
}

export function SchedulePage() {
  const [entryModal, setEntryModal] = useState<EntryModalState | null>(null);
  const [deleting, setDeleting] = useState<ScheduleEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const [entries, files, subjects] = await Promise.all([
      listScheduleEntries(),
      listScheduleFiles(),
      listSubjects(),
    ]);
    return { entries, files, subjects };
  }, []);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Program yükleniyor…
      </p>
    );
  }

  const grouped = groupByDay(data.entries);
  const subjectById = new Map(data.subjects.map((subject) => [subject.id, subject]));

  async function confirmDelete() {
    if (!deleting || deleteBusy) {
      return;
    }

    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteScheduleEntry(deleting.id);
      setDeleting(null);
    } catch (caught: unknown) {
      console.error('Program kaydı silinemedi', caught);
      setDeleteError('Kayıt silinemedi. Lütfen tekrar dene.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Haftalık Program</h1>
          <p className="text-sm text-muted">
            Derslerini haftalık planla; program fotoğrafını veya PDF'ini de burada sakla.
          </p>
        </div>
        <Button
          onClick={() => setEntryModal({ entry: null, day: todayDay() })}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Kayıt ekle
        </Button>
      </header>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Haftalık plan</h2>
          <p className="text-xs text-muted">
            {data.entries.length === 0
              ? 'Henüz kayıt yok'
              : `${data.entries.length} kayıt`}
          </p>
        </div>

        <div className="lg:overflow-x-auto lg:pb-1">
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[980px] lg:grid-cols-7">
            {SCHEDULE_DAYS.map((day) => {
              const entries = grouped.get(day.day) ?? [];
              const headingId = `program-gun-${day.day}`;
              return (
                <section
                  key={day.day}
                  aria-labelledby={headingId}
                  className="flex flex-col gap-2 rounded-2xl border border-line bg-surface/70 p-3"
                >
                  <div className="flex items-center justify-between gap-1">
                    <h3 id={headingId} className="min-w-0 truncate text-sm font-semibold">
                      <span className="lg:hidden">{day.label}</span>
                      <span className="hidden lg:inline">{day.short}</span>
                    </h3>
                    <button
                      type="button"
                      aria-label={`${day.label} gününe kayıt ekle`}
                      onClick={() => setEntryModal({ entry: null, day: day.day })}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-[var(--accent)]"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  {entries.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-2 py-4 text-center text-xs text-muted">
                      Kayıt yok
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {entries.map((entry) => (
                        <ScheduleEntryCard
                          key={entry.id}
                          entry={entry}
                          subject={
                            entry.subjectId ? subjectById.get(entry.subjectId) : undefined
                          }
                          onEdit={(next) => setEntryModal({ entry: next, day: next.day })}
                          onDelete={(next) => {
                            setDeleteError(null);
                            setDeleting(next);
                          }}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>

      <ScheduleFileList files={data.files} />

      {entryModal ? (
        <ScheduleEntryModal
          entry={entryModal.entry}
          initialDay={entryModal.day}
          subjects={data.subjects}
          onClose={() => setEntryModal(null)}
        />
      ) : null}

      {deleting ? (
        <Modal
          open
          title="Program kaydını sil"
          onClose={() => {
            if (!deleteBusy) {
              setDeleting(null);
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setDeleting(null)}
                disabled={deleteBusy}
              >
                Vazgeç
              </Button>
              <Button
                variant="danger"
                onClick={() => void confirmDelete()}
                disabled={deleteBusy}
              >
                {deleteBusy ? 'Siliniyor…' : 'Sil'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            <span className="font-semibold">{deleting.title}</span> kaydı (
            {scheduleDayLabel(deleting.day)} {formatScheduleTime(deleting.startTime, deleting.endTime)})
            silinecek. Bu işlem geri alınamaz.
          </p>
          {deleteError ? (
            <p role="alert" className="text-sm text-danger">
              {deleteError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}
