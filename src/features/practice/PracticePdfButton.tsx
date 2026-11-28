import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { PracticeSession } from '@/domain/types';
import { downloadPracticePdf } from './practicePdf';

/**
 * Downloads the session's question PDF. Keeps its own busy/error state so the
 * surrounding practice screen is not blocked while the PDF is built.
 */
export function PracticePdfButton({
  session,
  className,
}: {
  session: PracticeSession;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await downloadPracticePdf(session);
    } catch (caught: unknown) {
      console.error('PDF oluşturulamadı', caught);
      setError('PDF oluşturulamadı. Lütfen tekrar dene.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Button
        variant="secondary"
        onClick={() => void download()}
        disabled={busy}
        aria-busy={busy}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {busy ? 'PDF hazırlanıyor…' : 'PDF indir'}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
