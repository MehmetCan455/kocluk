import { useEffect, useState } from 'react';
import { HardDrive, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';

const numberFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

function formatMb(bytes: number): string {
  return `${numberFormatter.format(bytes / (1024 * 1024))} MB`;
}

interface StorageStatus {
  usage: number;
  quota: number;
  persisted: boolean | null;
}

export function StoragePanel() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const storage = navigator.storage;

    if (!storage || typeof storage.estimate !== 'function') {
      setSupported(false);
      return;
    }
    setSupported(true);

    async function load() {
      try {
        const estimate = await storage.estimate();
        let persisted: boolean | null = null;
        if (typeof storage.persisted === 'function') {
          try {
            persisted = await storage.persisted();
          } catch (caught: unknown) {
            console.error('Kalıcı depolama durumu okunamadı', caught);
          }
        }
        if (!cancelled) {
          setStatus({
            usage: estimate.usage ?? 0,
            quota: estimate.quota ?? 0,
            persisted,
          });
        }
      } catch (caught: unknown) {
        console.error('Depolama bilgisi okunamadı', caught);
        if (!cancelled) {
          setError('Depolama bilgisi okunamadı. Lütfen tekrar dene.');
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function requestPersistence() {
    const storage = navigator.storage;
    if (!storage || typeof storage.persist !== 'function' || requesting) {
      return;
    }
    setRequesting(true);
    setError(null);
    try {
      const persisted = await storage.persist();
      setStatus((current) => (current ? { ...current, persisted } : current));
    } catch (caught: unknown) {
      console.error('Kalıcı depolama izni istenemedi', caught);
      setError('Kalıcı depolama izni istenemedi.');
    } finally {
      setRequesting(false);
    }
  }

  const usagePercent =
    status && status.quota > 0 ? (status.usage / status.quota) * 100 : 0;
  const persistedText =
    status?.persisted === true
      ? 'Kalıcı depolama açık'
      : status?.persisted === false
        ? 'Kalıcı depolama kapalı'
        : 'Kalıcı depolama durumu bilinmiyor';

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Depolama</h2>
          <p className="text-sm text-muted">
            Veriler bu cihazın tarayıcısında saklanır. Tarayıcı depolamayı temizlerse yedekten
            geri yüklemen gerekir.
          </p>
        </div>
      </div>

      {supported === false ? (
        <p className="text-sm text-muted">Bu tarayıcı desteklemiyor</p>
      ) : supported === null ? (
        <p role="status" className="text-sm text-muted">
          Depolama bilgisi okunuyor…
        </p>
      ) : (
        <div className="space-y-3">
          {status ? (
            <>
              <div className="space-y-1.5">
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">
                    {formatMb(status.usage)} / {status.quota > 0 ? formatMb(status.quota) : '—'}
                  </span>{' '}
                  <span className="text-muted">kullanılıyor (tahmini)</span>
                </p>
                <ProgressBar value={usagePercent} label="Depolama kullanımı" />
              </div>
              <p className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-muted" aria-hidden="true" />
                <span>{persistedText}</span>
              </p>
            </>
          ) : error ? null : (
            <p role="status" className="text-sm text-muted">
              Depolama bilgisi okunuyor…
            </p>
          )}

          {typeof navigator.storage.persist === 'function' && status?.persisted !== true ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void requestPersistence()}
              disabled={requesting}
              aria-busy={requesting}
            >
              {requesting ? 'İzin isteniyor…' : 'Kalıcı depolama izni iste'}
            </Button>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
