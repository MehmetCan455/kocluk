import { useRef, useState, type ChangeEvent } from 'react';
import { ExternalLink, FileText, Maximize2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { Modal } from '@/components/ui/Modal';
import {
  SCHEDULE_FILE_SIZE_ERROR,
  SCHEDULE_FILE_TYPE_ERROR,
  addScheduleFile,
  deleteScheduleFile,
} from '@/db/repositories';
import type { ScheduleFile } from '@/domain/types';
import { IMAGE_TYPE_ERROR } from '@/lib/image';
import { useStableObjectUrl } from '@/lib/useObjectUrl';

const sizeFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${sizeFormatter.format(bytes / 1024)} KB`;
  }
  return `${sizeFormatter.format(bytes / (1024 * 1024))} MB`;
}

interface ScheduleFileRowProps {
  file: ScheduleFile;
  onDelete: (file: ScheduleFile) => void;
}

function ScheduleFileRow({ file, onDelete }: ScheduleFileRowProps) {
  const url = useStableObjectUrl(`${file.id}:${file.blob?.size ?? 0}`, file.blob);
  const isImage = file.mime.startsWith('image/');
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <>
      <li className="rounded-2xl border border-line bg-canvas/40 p-3">
        {isImage ? (
          url ? (
            <button
              type="button"
              onClick={() => setViewerOpen(true)}
              aria-label={`${file.name} görselini büyüt`}
              className="group relative mb-3 block w-full overflow-hidden rounded-xl border border-line bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <img
                src={url}
                alt={file.name}
                loading="lazy"
                className="max-h-48 w-full object-contain"
              />
              <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[11px] font-medium text-white">
                <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                Büyüt
              </span>
            </button>
          ) : (
            <div
              className="mb-3 h-24 animate-pulse rounded-xl border border-line bg-raised"
              aria-hidden="true"
            />
          )
        ) : null}

        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isImage ? null : (
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-raised text-muted">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted">
                {isImage ? 'Görsel' : 'PDF'} · {formatBytes(file.size)}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center">
            {!isImage && url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${file.name} dosyasını aç`}
                className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : null}
            <button
              type="button"
              aria-label={`${file.name} dosyasını sil`}
              onClick={() => onDelete(file)}
              className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-danger"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </li>

      {isImage && url ? (
        <ImageLightbox
          open={viewerOpen}
          src={url}
          alt={file.name}
          title={file.name}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </>
  );
}

export interface ScheduleFileListProps {
  files: ScheduleFile[];
}

/** Upload, preview and delete the weekly schedule photo/PDF archive. */
export function ScheduleFileList({ files }: ScheduleFileListProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ScheduleFile | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await addScheduleFile(file);
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : '';
      const known =
        message === SCHEDULE_FILE_SIZE_ERROR ||
        message === SCHEDULE_FILE_TYPE_ERROR ||
        message === IMAGE_TYPE_ERROR;
      setError(known ? message : 'Dosya yüklenemedi. Lütfen tekrar dene.');
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    if (!deleting || deletingBusy) {
      return;
    }

    setDeletingBusy(true);
    setDeleteError(null);
    try {
      await deleteScheduleFile(deleting.id);
      setDeleting(null);
    } catch (caught: unknown) {
      console.error('Çizelge dosyası silinemedi', caught);
      setDeleteError('Dosya silinemedi. Lütfen tekrar dene.');
    } finally {
      setDeletingBusy(false);
    }
  }

  return (
    <Card className="space-y-4" role="region" aria-labelledby="program-dosyalari">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="program-dosyalari" className="text-lg font-semibold">
            Çizelge görseli / PDF
          </h2>
          <p className="text-xs text-muted">Görsel veya PDF · en fazla 20 MB</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          aria-label="Çizelge dosyası seç"
          className="sr-only"
          onChange={(event) => void handleFileChange(event)}
        />
        <Button
          variant="secondary"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          {uploading ? 'Yükleniyor…' : 'Dosya yükle'}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {files.length === 0 ? (
        <EmptyState
          icon={Upload}
          title="Henüz çizelge dosyası yok"
          description="Ders çalışma çizelgenin fotoğrafını veya PDF'ini yükleyerek burada saklayabilirsin."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {files.map((file) => (
            <ScheduleFileRow
              key={file.id}
              file={file}
              onDelete={(next) => {
                setDeleteError(null);
                setDeleting(next);
              }}
            />
          ))}
        </ul>
      )}

      {deleting ? (
        <Modal
          open
          title="Çizelge dosyasını sil"
          onClose={() => {
            if (!deletingBusy) {
              setDeleting(null);
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setDeleting(null)}
                disabled={deletingBusy}
              >
                Vazgeç
              </Button>
              <Button
                variant="danger"
                onClick={() => void confirmDelete()}
                disabled={deletingBusy}
              >
                {deletingBusy ? 'Siliniyor…' : 'Sil'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            <span className="font-semibold">{deleting.name}</span> dosyası çizelgeden
            kaldırılacak. Bu işlem geri alınamaz.
          </p>
          {deleteError ? (
            <p role="alert" className="text-sm text-danger">
              {deleteError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </Card>
  );
}
