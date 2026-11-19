import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { Topic } from '@/domain/types';

export interface DeleteTopicModalProps {
  topic: Topic;
  testRecordCount: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteTopicModal({
  topic,
  testRecordCount,
  onClose,
  onConfirm,
}: DeleteTopicModalProps) {
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
      console.error('Konu silinemedi', caught);
      setError('Konu silinemedi. Lütfen tekrar dene.');
      setDeleting(false);
    }
  }

  return (
    <Modal
      open
      title="Konuyu sil"
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
        <span className="font-semibold">{topic.name}</span> konusu ve ona bağlı veriler
        silinecek. Bu işlem geri alınamaz.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>{testRecordCount} test kaydı silinecek.</li>
        <li>Konu notları ve ekleri silinecek.</li>
        <li>Yanlış fotoğrafları silinmez; yalnızca konu bağlantısı kaldırılır.</li>
      </ul>
    </Modal>
  );
}
