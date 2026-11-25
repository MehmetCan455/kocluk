import { useEffect, useState, type ReactNode } from 'react';
import { CloudDownload, HardDriveUpload, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getActiveDbOrNull } from '@/db/db';
import {
  TRANSFER_PROMPT_KEY,
  downloadLegacyBackup,
  fetchCloudHasData,
  hasLegacyData,
  transferDecision,
  transferLegacyData,
  type TransferSummary,
} from '@/db/transfer';
import { getMeta, setMeta } from '@/db/sync/meta';

/**
 * First-login transfer gate (design §9.3).
 *
 * The gate runs inside AuthGate's ready branch, after `kocluk-u-<userId>` is
 * open but before `SettingsProvider` can seed and queue defaults. That order
 * matters: the server must still be empty when the transfer is decided, and
 * only then may the first sync run.
 *
 * The app is mounted immediately when there is no legacy data, the prompt was
 * already answered, or the account status cannot be read (offline): the
 * Settings section offers the same transfer explicitly. A cloud-full account
 * is never merged automatically; the user only gets an explanation, a backup
 * download and a close button.
 */

type Phase = 'checking' | 'offer' | 'cloud-full' | 'transferring' | 'done' | 'ready';

export interface LegacyTransferPromptProps {
  userId: string;
  children: ReactNode;
}

async function markPrompt(value: 'done' | 'dismissed'): Promise<void> {
  const active = getActiveDbOrNull();
  if (!active) {
    return;
  }
  try {
    await setMeta(active, TRANSFER_PROMPT_KEY, value);
  } catch {
    // The prompt may reappear on the next start; no data is at risk.
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10 text-fg">
      <Card className="w-full max-w-lg space-y-5">{children}</Card>
    </div>
  );
}

export function LegacyTransferPrompt({ userId, children }: LegacyTransferPromptProps) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<TransferSummary | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function decide() {
      const active = getActiveDbOrNull();
      const marker = active ? await getMeta(active, TRANSFER_PROMPT_KEY) : undefined;
      if (marker === 'done' || marker === 'dismissed') {
        if (!cancelled) {
          setPhase('ready');
        }
        return;
      }

      const legacy = await hasLegacyData().catch(() => false);
      if (!legacy) {
        if (!cancelled) {
          setPhase('ready');
        }
        return;
      }

      let cloudHasData: boolean | null = null;
      try {
        cloudHasData = await fetchCloudHasData();
      } catch {
        cloudHasData = null;
      }
      if (cancelled) {
        return;
      }

      const decision = transferDecision(legacy, cloudHasData);
      if (decision === 'offer') {
        setPhase('offer');
      } else if (decision === 'cloud-full') {
        setPhase('cloud-full');
      } else {
        // Unknown cloud state must not block the app; Settings keeps the
        // explicit transfer entry point.
        setPhase('ready');
      }
    }
    void decide();
    return () => {
      cancelled = true;
    };
  }, []);

  async function downloadBackup() {
    setBusy(true);
    setMessage(null);
    try {
      await downloadLegacyBackup();
    } catch {
      setMessage({ tone: 'error', text: 'Yedek indirilemedi. Lütfen tekrar dene.' });
    } finally {
      setBusy(false);
    }
  }

  async function runTransfer() {
    setPhase('transferring');
    setMessage(null);
    setProgress({ done: 0, total: 0 });
    try {
      const result = await transferLegacyData(userId, (done, total) => {
        setProgress({ done, total });
      });
      setSummary(result);
      await markPrompt('done');
      setPhase('done');
    } catch {
      setMessage({
        tone: 'error',
        text: 'Aktarım tamamlanamadı. Eski veriler değiştirilmedi; tekrar deneyebilirsin.',
      });
      setPhase('offer');
    }
  }

  async function startEmpty() {
    setBusy(true);
    await markPrompt('dismissed');
    setBusy(false);
    setPhase('ready');
  }

  async function dismissCloudFull() {
    setBusy(true);
    await markPrompt('dismissed');
    setBusy(false);
    setPhase('ready');
  }

  if (phase === 'ready') {
    return <>{children}</>;
  }

  if (phase === 'checking') {
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center gap-3 bg-canvas px-4 text-sm text-muted"
      >
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-[var(--accent)]"
          aria-hidden="true"
        />
        <span>Veriler hazırlanıyor…</span>
      </div>
    );
  }

  if (phase === 'transferring') {
    return (
      <Frame>
        <h1 className="text-xl font-semibold">Eski veriler aktarılıyor</h1>
        <p role="status" className="text-sm text-muted">
          {progress && progress.total > 0
            ? `${progress.done} / ${progress.total} kayıt kopyalandı…`
            : 'Veriler kopyalanıyor…'}
        </p>
        <p className="text-xs text-muted">
          Bu ekranı kapatma. Taşıma yarıda kalsa bile eski veriler sağlam kalır ve
          tekrar denenebilir.
        </p>
      </Frame>
    );
  }

  if (phase === 'done') {
    return (
      <Frame>
        <h1 className="text-xl font-semibold">Aktarım tamamlandı</h1>
        <p className="text-sm text-muted">
          {summary
            ? `${summary.total} kayıt hesabına kopyalandı.`
            : 'Eski veriler hesabına kopyalandı.'}{' '}
          Fotoğraflar ve ekler bu cihazda kaldı; eski veritabanı silinmedi.
        </p>
        <Button onClick={() => setPhase('ready')}>Uygulamaya devam et</Button>
      </Frame>
    );
  }

  if (phase === 'cloud-full') {
    return (
      <Frame>
        <h1 className="text-xl font-semibold">Hesabında kayıtlı veri var</h1>
        <p className="text-sm text-muted">
          Bu hesap boş değil. Eski cihaz verilerinle otomatik birleştirme yapılmadı;
          iki veri kümesinin karışmasını engellemek için önce yedek indirmeni öneririz.
          Eski veriler bu cihazda korunur.
        </p>
        {message ? (
          <p role="alert" className="text-sm text-danger">
            {message.text}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void downloadBackup()} disabled={busy}>
            <CloudDownload className="h-4 w-4" aria-hidden="true" />
            {busy ? 'Hazırlanıyor…' : 'Yedek indir'}
          </Button>
          <Button variant="ghost" onClick={() => void dismissCloudFull()} disabled={busy}>
            Kapat
          </Button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Eski verilerini hesabına aktar</h1>
      </div>
      <p className="text-sm text-muted">
        Bu cihazda hesapsız kullanımdan kalan veriler var. Aktardığında kitapların,
        konuların, denemelerin, notların ve planların hesabında tutulur ve diğer
        cihazlarınla eşitlenir.
      </p>
      <p className="text-sm text-muted">
        Fotoğraflar ve ekler yalnızca bu cihazda kalır; sunucuya yüklenmez. Eski
        veritabanı hiçbir seçenekte silinmez.
      </p>

      {message ? (
        <p role="alert" className="text-sm text-danger">
          {message.text}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void runTransfer()} disabled={busy}>
          <HardDriveUpload className="h-4 w-4" aria-hidden="true" />
          Hesabıma aktar
        </Button>
        <Button variant="secondary" onClick={() => void downloadBackup()} disabled={busy}>
          <CloudDownload className="h-4 w-4" aria-hidden="true" />
          Yedek indir
        </Button>
        <Button variant="ghost" onClick={() => void startEmpty()} disabled={busy}>
          Boş başla
        </Button>
      </div>
    </Frame>
  );
}
