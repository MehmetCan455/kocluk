import { useRef, useState, type ChangeEvent } from 'react';
import { Download, ExternalLink, FileText, Paperclip, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  ATTACHMENT_SIZE_ERROR,
  ATTACHMENT_TYPE_ERROR,
  addAttachment,
  deleteAttachment,
} from '@/db/repositories';
import type { Attachment } from '@/domain/types';
import { IMAGE_TYPE_ERROR } from '@/lib/image';
import { useStableObjectUrl } from '@/lib/useObjectUrl';

export interface AttachmentListProps {
  topicId: string;
  attachments: Attachment[];
}

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

/** Stable blob URL: a live-query re-read of the same attachment must not flicker. */
function useAttachmentUrl(attachment: Attachment): string | null {
  const key = `${attachment.id}:${attachment.blob?.size ?? 0}`;
  return useStableObjectUrl(key, attachment.blob);
}

interface AttachmentRowProps {
  attachment: Attachment;
  onDelete: (attachment: Attachment) => void;
}

function AttachmentRow({ attachment, onDelete }: AttachmentRowProps) {
  const url = useAttachmentUrl(attachment);
  const isImage = attachment.mime.startsWith('image/');
  const isPdf = attachment.mime === 'application/pdf';

  return (
    <li className="rounded-2xl border border-line bg-surface p-3">
      {isImage ? (
        url ? (
          <div className="mb-3 overflow-hidden rounded-xl border border-line bg-canvas">
            <img
              src={url}
              alt={attachment.name}
              loading="lazy"
              className="max-h-56 w-full object-contain"
            />
          </div>
        ) : (
          <div
            className="mb-3 h-24 animate-pulse rounded-xl border border-line bg-raised"
            aria-hidden="true"
          />
        )
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isPdf ? (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-raised text-muted">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{attachment.name}</p>
            <p className="text-xs text-muted">{formatBytes(attachment.size)}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          {isPdf && url ? (
            <>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${attachment.name} dosyasını aç`}
                className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
              <a
                href={url}
                download={attachment.name}
                aria-label={`${attachment.name} dosyasını indir`}
                className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </a>
            </>
          ) : null}
          <button
            type="button"
            aria-label={`${attachment.name} dosyasını sil`}
            onClick={() => onDelete(attachment)}
            className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-danger"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}

export function AttachmentList({ topicId, attachments }: AttachmentListProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Attachment | null>(null);
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
      await addAttachment(topicId, file);
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : '';
      const known =
        message === ATTACHMENT_SIZE_ERROR ||
        message === ATTACHMENT_TYPE_ERROR ||
        message === IMAGE_TYPE_ERROR;
      setError(known ? message : 'Dosya eklenemedi. Lütfen tekrar dene.');
    } finally {
      setUploading(false);
    }
  }

  function openDelete(attachment: Attachment) {
    setDeleteError(null);
    setDeleting(attachment);
  }

  async function confirmDelete() {
    if (!deleting || deletingBusy) {
      return;
    }

    setDeletingBusy(true);
    setDeleteError(null);
    try {
      await deleteAttachment(deleting.id);
      setDeleting(null);
    } catch (caught: unknown) {
      console.error('Dosya silinemedi', caught);
      setDeleteError('Dosya silinemedi. Lütfen tekrar dene.');
    } finally {
      setDeletingBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Görsel veya PDF · en fazla 20 MB</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          aria-label="Dosya seç"
          className="sr-only"
          onChange={(event) => void handleFileChange(event)}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          {uploading ? 'Yükleniyor…' : 'Dosya ekle'}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {attachments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          Henüz dosya eklenmedi.
        </p>
      ) : (
        <ul className="space-y-3">
          {attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              onDelete={openDelete}
            />
          ))}
        </ul>
      )}

      {deleting ? (
        <Modal
          open
          title="Dosyayı sil"
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
            <span className="font-semibold">{deleting.name}</span> dosyası bu konudan
            kaldırılacak. Bu işlem geri alınamaz.
          </p>
          {deleteError ? (
            <p role="alert" className="text-sm text-danger">
              {deleteError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
