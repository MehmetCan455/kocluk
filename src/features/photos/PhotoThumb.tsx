import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { listPhotos } from '@/db/repositories';
import type { ExamType, Photo } from '@/domain/types';
import { useStableObjectUrl } from '@/lib/useObjectUrl';
import { PhotoUpload } from './PhotoUpload';

/**
 * Stable object URL for a photo variant. The key includes the blob size so a
 * replaced image gets a fresh URL while a live-query re-read of the same photo
 * does not.
 */
export function usePhotoObjectUrl(
  photoId: string | undefined,
  blob: Blob | undefined,
  variant: 'thumb' | 'full' = 'thumb',
): string | null {
  const key = photoId ? `${photoId}:${variant}:${blob?.size ?? 0}` : undefined;
  return useStableObjectUrl(key, blob);
}

export function photoLabel(photo: Photo): string {
  return photo.note.trim() || 'Yanlış fotoğrafı';
}

export interface PhotoThumbProps {
  photo: Photo;
  className?: string;
}

/** Grid thumbnail; always reads `thumbBlob`, never the full-size image. */
export function PhotoThumb({ photo, className }: PhotoThumbProps) {
  const url = usePhotoObjectUrl(photo.id, photo.thumbBlob);

  if (!url) {
    return (
      <div
        className={cn('h-full w-full animate-pulse bg-raised', className)}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={url}
      alt={photoLabel(photo)}
      loading="lazy"
      className={cn('h-full w-full object-cover', className)}
    />
  );
}

export interface PhotoStripProps {
  photos: Photo[];
}

export function PhotoStrip({ photos }: PhotoStripProps) {
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((photo) => (
        <li key={photo.id}>
          <Link
            to={`/yanlislar/${photo.id}`}
            className="block aspect-square overflow-hidden rounded-xl border border-line bg-canvas transition-colors hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <PhotoThumb photo={photo} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface TopicPhotosTabProps {
  topicId: string;
  subjectId: string;
  examType: ExamType;
}

/** Topic-level slice of the archive with its own upload shortcut. */
export function TopicPhotosTab({ topicId, subjectId, examType }: TopicPhotosTabProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const photos = useLiveQuery(() => listPhotos({ topicId }), [topicId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Bu konuya etiketli yanlış fotoğraflar.</p>
        <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
          <Camera className="h-4 w-4" aria-hidden="true" />
          Fotoğraf ekle
        </Button>
      </div>

      {photos === undefined ? (
        <p role="status" className="py-6 text-center text-sm text-muted">
          Fotoğraflar yükleniyor…
        </p>
      ) : photos.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="Henüz yanlış fotoğrafı yok"
          description="Yanlış yaptığın soruların fotoğraflarını buradan ekleyebilirsin."
        />
      ) : (
        <PhotoStrip photos={photos} />
      )}

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
            examType={examType}
            subjectId={subjectId}
            topicId={topicId}
            onBusyChange={setUploadBusy}
            onClose={() => setUploadOpen(false)}
          />
        </Modal>
      ) : null}
    </div>
  );
}
