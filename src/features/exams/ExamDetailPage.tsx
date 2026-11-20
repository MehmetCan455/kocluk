import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Camera, ClipboardList, Pencil, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import {
  deleteExamUnlinkPhotos,
  getExam,
  listAllExamResults,
  listExamResults,
  listExams,
  listPhotos,
  listSubjects,
} from '@/db/repositories';
import type { Exam, ExamResult, Photo, Subject } from '@/domain/types';
import { buildExamComparison, type ExamComparison } from '@/features/dashboard/chartData';
import { formatNet } from '@/lib/format';
import { PhotoStrip } from '@/features/photos/PhotoThumb';
import { PhotoUpload } from '@/features/photos/PhotoUpload';
import { formatAlan, formatExamDate, sumNet } from './examFormat';

interface DetailRow {
  result: ExamResult;
  subject?: Subject;
}

function compareRows(left: DetailRow, right: DetailRow): number {
  const leftSubject = left.subject;
  const rightSubject = right.subject;

  if (leftSubject && rightSubject) {
    return (
      leftSubject.order - rightSubject.order ||
      leftSubject.name.localeCompare(rightSubject.name, 'tr-TR') ||
      left.result.id.localeCompare(right.result.id)
    );
  }
  if (leftSubject) {
    return -1;
  }
  if (rightSubject) {
    return 1;
  }
  return left.result.subjectId.localeCompare(right.result.subjectId);
}

interface DeleteExamModalProps {
  exam: Exam;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function DeleteExamModal({ exam, onClose, onConfirm }: DeleteExamModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (deleting) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught: unknown) {
      console.error('Deneme silinemedi', caught);
      setError('Deneme silinemedi. Lütfen tekrar dene.');
      setDeleting(false);
    }
  }

  return (
    <Modal
      open
      title="Denemeyi sil"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            Vazgeç
          </Button>
          <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? 'Siliniyor…' : 'Sil'}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        <span className="font-semibold">{exam.name}</span> denemesi ve ders sonuçları silinecek.
        Bu işlem geri alınamaz.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>Denemeye bağlı fotoğraflar silinmez; yalnızca deneme bağlantıları kaldırılır.</li>
        <li>Fotoğraflar Yanlışlar bölümünde kalmaya devam eder.</li>
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

export function ExamDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  const data = useLiveQuery(async () => {
    const exam = await getExam(id);
    if (!exam) {
      return {
        exam: undefined,
        rows: [] as DetailRow[],
        photos: [] as Photo[],
        comparison: undefined as ExamComparison | undefined,
      };
    }

    const [results, subjects, photos, exams, allResults] = await Promise.all([
      listExamResults(id),
      listSubjects(exam.type),
      listPhotos({ examId: id }),
      listExams(exam.type),
      listAllExamResults(),
    ]);
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
    const rows = results
      .map((result) => ({ result, subject: subjectById.get(result.subjectId) }))
      .sort(compareRows);

    return {
      exam,
      rows,
      photos,
      comparison: buildExamComparison(exams, allResults, exam),
    };
  }, [id]);

  if (!data) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Deneme yükleniyor…
      </p>
    );
  }

  const { exam, rows, photos, comparison } = data;

  if (!exam) {
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

  const totalNet = sumNet(rows.map((row) => row.result));
  const alan = formatAlan(exam.alan);

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: 'Denemeler', to: '/denemeler' }, { label: exam.name }]} />

      <Card className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {exam.type}
            {alan ? ` · ${alan}` : ''}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{exam.name}</h1>
          <p className="text-sm text-muted">{formatExamDate(exam.date)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Toplam net</p>
          <p className="text-3xl font-semibold tabular-nums text-[var(--accent)]">
            {formatNet(totalNet)}
          </p>
          {comparison?.previous && comparison.delta !== undefined ? (
            <p
              className={cn(
                'mt-1 text-sm font-medium tabular-nums',
                comparison.delta > 0
                  ? 'text-success'
                  : comparison.delta < 0
                    ? 'text-danger'
                    : 'text-muted',
              )}
            >
              {`Önceki denemeye göre ${
                comparison.delta > 0 ? '+' : ''
              }${formatNet(comparison.delta)} net`}
              <span className="block text-xs font-normal text-muted">
                {comparison.previous.name} · {formatExamDate(comparison.previous.date)}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">
              Karşılaştırılacak önceki {exam.type} denemesi yok.
            </p>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => navigate(`/denemeler/${exam.id}/duzenle`)}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Düzenle
        </Button>
        <Button
          variant="secondary"
          className="text-danger hover:text-danger"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Sil
        </Button>
      </div>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Ders sonuçları</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Bu denemede girilmiş ders sonucu yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Ders sonuçları</caption>
              <thead>
                <tr className="text-muted">
                  <th
                    scope="col"
                    className="pb-2 pr-2 text-left text-xs font-medium uppercase tracking-wide"
                  >
                    Ders
                  </th>
                  <th
                    scope="col"
                    className="w-10 pb-2 text-center text-xs font-medium uppercase tracking-wide"
                  >
                    D
                  </th>
                  <th
                    scope="col"
                    className="w-10 pb-2 text-center text-xs font-medium uppercase tracking-wide"
                  >
                    Y
                  </th>
                  <th
                    scope="col"
                    className="w-10 pb-2 text-center text-xs font-medium uppercase tracking-wide"
                  >
                    B
                  </th>
                  <th
                    scope="col"
                    className="w-20 pb-2 text-right text-xs font-medium uppercase tracking-wide"
                  >
                    Net
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ result, subject }) => (
                  <tr key={result.id}>
                    <th scope="row" className="py-3 pr-2 text-left font-medium">
                      {subject?.name ?? 'Bilinmeyen ders'}
                    </th>
                    <td className="py-3 text-center tabular-nums">{result.correct}</td>
                    <td className="py-3 text-center tabular-nums">{result.wrong}</td>
                    <td className="py-3 text-center tabular-nums">{result.blank}</td>
                    <td className="py-3 text-right font-semibold tabular-nums">
                      {formatNet(result.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {exam.note ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold">Not</h2>
          <p className="whitespace-pre-wrap text-sm text-muted">{exam.note}</p>
        </Card>
      ) : null}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Yanlış fotoğrafları</h2>
          <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
            <Camera className="h-4 w-4" aria-hidden="true" />
            Fotoğraf ekle
          </Button>
        </div>
        {photos.length === 0 ? (
          <EmptyState
            icon={Camera}
            title="Henüz fotoğraf yok"
            description="Bu denemeye bağlı yanlış fotoğraflarını buradan ekleyebilirsin."
          />
        ) : (
          <PhotoStrip photos={photos} />
        )}
      </Card>

      {uploadOpen ? (
        <Modal
          open
          title="Fotoğraf yükle"
          onClose={() => {
            if (!uploadBusy) {
              setUploadOpen(false);
            }
          }}
        >
          <PhotoUpload
            examId={exam.id}
            examType={exam.type}
            onBusyChange={setUploadBusy}
            onClose={() => setUploadOpen(false)}
          />
        </Modal>
      ) : null}

      {confirmingDelete ? (
        <DeleteExamModal
          exam={exam}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await deleteExamUnlinkPhotos(exam.id);
            navigate('/denemeler');
          }}
        />
      ) : null}
    </div>
  );
}
