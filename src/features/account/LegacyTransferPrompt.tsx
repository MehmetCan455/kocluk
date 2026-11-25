import { useEffect, useState, type ReactNode } from 'react';
import { CloudDownload, HardDriveUpload, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getActiveDbOrNull } from '@/db/db';
import {
  LocalDataTransferBlockedError,
  TRANSFER_DONE_KEY,
  TRANSFER_PROMPT_KEY,
  downloadLegacyBackup,
  fetchCloudHasUserData,
  hasLegacyData,
  localUserDataSummary,
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
 * matters: the server must still be free of user data when the transfer is
 * decided, and only then may the first sync run.
 *
 * The gate is deliberately retriable. A failed legacy read or an unavailable
 * status leaves the prompt unanswered and shows a retry; only an explicit
 * answer ("Boş başla", "Kapat" for a cloud-full account, or a successful
 * transfer) writes a marker. `TRANSFER_DONE_KEY` also suppresses the prompt if
 * the user completed the transfer from Settings instead. */

type Phase =
  | 'checking'
  | 'offer'
  | 'cloud-full'
  | 'local-full'
  | 'unavailable'
  | 'legacy-error'
  | 'transferring'
  | 'done'
  | 'ready';

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
  const [checkKey, setCheckKey] = useState(0);
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
      if (!active) {
        if (!cancelled) {
          setPhase('ready');
        }
        return;
      }

      try {
        const [promptMarker, doneMarker] = await Promise.all([
          getMeta(active, TRANSFER_PROMPT_KEY),
          getMeta(active, TRANSFER_DONE_KEY),
        ]);
        if (
          doneMarker === true ||
          promptMarker === 'done' ||
          promptMarker === 'dismissed'
        ) {
          if (!cancelled) {
            setPhase('ready');
          }
          return;
        }
      } catch {
        if (!cancelled) {
          setPhase('legacy-error');
        }
        return;
      }

      let legacy: boolean;
      try {
        legacy = await hasLegacyData();
      } catch {
        if (!cancelled) {
          setPhase('legacy-error');
        }
        return;
      }
      if (!legacy) {
        if (!cancelled) {
          setPhase('ready');
        }
        return;
      }

      let localHasUserData = false;
      try {
        localHasUserData = (await localUserDataSummary(active)).hasUserData;
      } catch {
        if (!cancelled) {
          setPhase('legacy-error');
        }
        return;
      }

      let cloudHasUserData: boolean | null = null;
      try {
        cloudHasUserData = await fetchCloudHasUserData();
      } catch {
        cloudHasUserData = null;
      }
      if (cancelled) {
        return;
      }

      const decision = transferDecision(legacy, cloudHasUserData, localHasUserData);
      if (decision === 'offer') {
        setPhase('offer');
      } else if (decision === 'cloud-full') {
        setPhase('cloud-full');
      } else if (decision === 'local-full') {
        setPhase('local-full');
      } else {
        // The status could not be read. Keep the prompt retriable and do not
        // write an "answered" marker.
        setPhase('unavailable');
      }
    }
    void decide();
    return () => {
      cancelled = true;
    };
  }, [checkKey]);

  function retryCheck() {
    setMessage(null);
    setPhase('checking');
    setCheckKey((value) => value + 1);
  }

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
    } catch (caught: unknown) {
      setMessage({
        tone: 'error',
        text:
          caught instanceof LocalDataTransferBlockedError
            ? caught.message
            : 'Aktarım tamamlanamadı. Eski veriler değiştirilmedi; tekrar deneyebilirsin.',
      });
      setPhase(caught instanceof LocalDataTransferBlockedError ? 'local-full' : 'offer');
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

  /** Lets the app start without recording an answer; the prompt returns next time. */
  function continueWithoutAnswer() {
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
            : 'Eski veriler hesabına kopyalandı.'}
          {summary && summary.skipped > 0
            ? ` ${summary.skipped} bağlı kayıt eksik üst kayıt nedeniyle atlandı.`
            : ''}{' '}
          Fotoğraflar ve ekler bu cihazda kaldı; eski veritabanı silinmedi.
        </p>
        <Button onClick={() => setPhase('ready')}>Uygulamaya devam et</Button>
      </Frame>
    );
  }

  if (phase === 'legacy-error') {
    return (
      <Frame>
        <h1 className="text-xl font-semibold">Eski veriler kontrol edilemedi</h1>
        <p className="text-sm text-muted">
          Tarayıcı depolamasına erişilemedi veya okuma yarıda kaldı. Hiçbir veri
          değiştirilmedi. Bağlantını kontrol edip tekrar deneyebilirsin.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={retryCheck}>Tekrar dene</Button>
          <Button variant="ghost" onClick={continueWithoutAnswer}>
            Daha sonra
          </Button>
        </div>
      </Frame>
    );
  }

  if (phase === 'unavailable') {
    return (
      <Frame>
        <h1 className="text-xl font-semibold">Hesap durumu kontrol edilemedi</h1>
        <p className="text-sm text-muted">
          Hesabının boş olduğunu doğrulayamadığımız için taşıma önerilmiyor. Böylece
          mevcut hesap verilerinle eski veriler karışmaz. İnternet bağlantını kontrol
          edip tekrar dene.
        </p>
        <p className="text-xs text-muted">
          Bu ekranı atlarsan taşıma sorusu bir sonraki açılışta yeniden sorulur.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={retryCheck}>Tekrar dene</Button>
          <Button variant="ghost" onClick={continueWithoutAnswer}>
            Daha sonra
          </Button>
        </div>
      </Frame>
    );
  }

  if (phase === 'local-full') {
    return (
      <Frame>
        <h1 className="text-xl font-semibold">Bu cihazda hesap verisi var</h1>
        <p className="text-sm text-muted">
          Bu hesabın yerel veritabanında zaten kullanıcı verisi var. Otomatik
          birleştirme, kimlikler ve bağlı kayıtlar karışabileceği için yapılmıyor.
          Önce Ayarlar → Yedekleme bölümünden yedek indir; yerel verileri temizledikten
          sonra taşımayı tekrar dene.
        </p>
        {message ? (
          <p role="alert" className="text-sm text-danger">
            {message.text}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void downloadBackup()} disabled={busy}>
            <CloudDownload className="h-4 w-4" aria-hidden="true" />
            {busy ? 'Hazırlanıyor…' : 'Eski verilerin yedeğini indir'}
          </Button>
          <Button variant="ghost" onClick={continueWithoutAnswer}>
            Kapat
          </Button>
        </div>
      </Frame>
    );
  }

  if (phase === 'cloud-full') {
    return (
      <Frame>
        <h1 className="text-xl font-semibold">Hesabında kayıtlı kullanıcı verisi var</h1>
        <p className="text-sm text-muted">
          Bu hesapta senin oluşturduğun veriler var (ör. deneme, not, kitap, plan veya
          özel konu). Eski cihaz verilerinle otomatik birleştirme yapılmadı; iki veri
          kümesinin karışmasını engellemek için önce yedek indirmeni öneririz. Eski
          veriler bu cihazda korunur.
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
        Aynı kimlikli kayıtlar güncellenir; üst kaydı bulunmayan bağlı kayıtlar
        atlanabilir ve atlanan sayısı aktarım sonunda gösterilir. Fotoğraflar ve
        ekler yalnızca bu cihazda kalır; sunucuya yüklenmez. Eski veritabanı hiçbir
        seçenekte silinmez.
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
