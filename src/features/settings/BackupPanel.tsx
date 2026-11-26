import { useState } from 'react';
import { AlertTriangle, Archive, Download, Trash2, Upload } from 'lucide-react';
import { useAppSettings } from '@/app/SettingsProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Toast } from '@/components/ui/Toast';
import {
  clearAllData,
  exportBackup,
  importBackup,
  readBackupSummary,
  type BackupProgress,
  type BackupSummary,
} from '@/db/backup';
import { backupFileName, saveBlob } from '@/lib/zip';

const dateTimeFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const pluralCounts = [
  { key: 'exams', singular: 'deneme' },
  { key: 'photos', singular: 'fotoğraf' },
  { key: 'notes', singular: 'not' },
  { key: 'practiceSessions', singular: 'test oturumu' },
  { key: 'catalogBooks', singular: 'katalog kitabı' },
  { key: 'userBooks', singular: 'raf kitabı' },
  { key: 'activityLogs', singular: 'ilerleme kaydı' },
  { key: 'scheduleWeeks', singular: 'plan haftası' },
  { key: 'scheduleRows', singular: 'plan satırı' },
  { key: 'scheduleTasks', singular: 'plan görevi' },
  { key: 'schedulePageChains', singular: 'sayfa zinciri' },
  { key: 'topicProgress', singular: 'konu durumu' },
  { key: 'scheduleEntries', singular: 'eski çizelge kaydı' },
  { key: 'scheduleFiles', singular: 'eski çizelge dosyası' },
  { key: 'scheduleTables', singular: 'çizelge tablosu' },
] as const;

type BusyState = 'download' | 'preview' | 'import' | 'reset' | null;

interface BackupPreview {
  file: File;
  summary: BackupSummary;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'İşlem tamamlanamadı. Lütfen tekrar dene.';
}

export interface BackupPanelProps {
  /** Lets the storage panel re-read its estimate after import/reset. */
  onDataChanged?: () => void;
}

export function BackupPanel({ onDataChanged }: BackupPanelProps = {}) {
  const { settings, refreshSettings } = useAppSettings();
  const [busy, setBusy] = useState<BusyState>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );

  async function download() {
    if (busy !== null) {
      return;
    }
    setBusy('download');
    setProgress(null);
    setToast(null);
    try {
      const blob = await exportBackup(setProgress);
      saveBlob(blob, backupFileName());
      await refreshSettings();
      setToast({ tone: 'success', message: 'Yedek indirildi.' });
    } catch (error: unknown) {
      console.error('Yedek indirilemedi', error);
      setToast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setProgress(null);
      setBusy(null);
    }
  }

  async function selectFile(file: File | undefined) {
    if (!file || busy !== null) {
      return;
    }
    setPreview(null);
    setBusy('preview');
    setToast(null);
    try {
      const summary = await readBackupSummary(file);
      setPreview({ file, summary });
    } catch (error: unknown) {
      console.error('Yedek okunamadı', error);
      setToast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function confirmImport() {
    if (!preview || busy !== null) {
      return;
    }
    setBusy('import');
    setToast(null);
    try {
      await importBackup(preview.file);
      await refreshSettings();
      onDataChanged?.();
      setPreview(null);
      setToast({ tone: 'success', message: 'Yedek geri yüklendi.' });
    } catch (error: unknown) {
      console.error('Yedek geri yüklenemedi', error);
      setToast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function resetEverything() {
    if (busy !== null) {
      return;
    }
    setBusy('reset');
    setToast(null);
    try {
      await clearAllData();
      setResetStep(0);
      await refreshSettings();
      onDataChanged?.();
    } catch (error: unknown) {
      console.error('Veriler silinemedi', error);
      setToast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  const lastBackupText = settings.lastBackupAt
    ? `Son yedek: ${formatDateTime(settings.lastBackupAt)}`
    : 'Son yedek: Henüz yedek alınmadı';

  return (
    <>
      <Card className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Yedekleme</h2>
          <p className="text-sm text-muted">
            Tüm verilerini ve fotoğraflarını tek bir zip dosyasında indir. Yedeği başka bir
            cihazda geri yükleyebilirsin.
          </p>
        </div>

        <p className="text-sm text-muted" aria-live="polite">
          {lastBackupText}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void download()}
            disabled={busy !== null}
            aria-busy={busy === 'download'}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {busy === 'download' ? 'Yedek hazırlanıyor…' : 'Yedek indir'}
          </Button>

          <label
            className={`inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface ${
              busy !== null ? 'cursor-not-allowed opacity-50' : ''
            }`}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {busy === 'preview' ? 'Yedek okunuyor…' : 'Yedek dosyası seç'}
            <input
              type="file"
              accept=".zip,application/zip"
              aria-label="Yedek dosyası seç"
              disabled={busy !== null}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void selectFile(file);
              }}
              className="sr-only"
            />
          </label>
        </div>

        {busy === 'download' ? (
          <div className="space-y-2">
            <ProgressBar
              value={progress?.percent ?? 0}
              label="Yedek hazırlama ilerlemesi"
            />
            <p role="status" className="text-sm text-muted" aria-live="polite">
              {progress
                ? `Yedek hazırlanıyor: %${Math.round(progress.percent)}${
                    progress.total
                      ? ` · ${progress.current ?? 0}/${progress.total} dosya`
                      : ''
                  }`
                : 'Yedek hazırlanıyor…'}
            </p>
            <p className="text-xs text-muted">
              Fotoğraf arşivi büyükse zip hazırlanması birkaç dakika sürebilir. Zip
              bellekte oluşturulduğu için işlem sırasında yüksek bellek kullanılabilir;
              uygulamayı kapatma.
            </p>
          </div>
        ) : busy === 'preview' || busy === 'import' ? (
          <p role="status" className="text-sm text-muted">
            {busy === 'preview'
              ? 'Yedek doğrulanıyor…'
              : 'Mevcut veriler değiştiriliyor…'}
          </p>
        ) : null}

        {preview ? (
          <section
            aria-labelledby="yedek-ozeti-basligi"
            className="space-y-3 rounded-xl border border-line bg-canvas/60 p-4"
          >
            <div className="flex items-start gap-3">
              <Archive className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <h3 id="yedek-ozeti-basligi" className="text-sm font-semibold">
                  Yedek özeti
                </h3>
                <p className="text-sm text-muted">
                  {preview.file.name} · {formatDateTime(preview.summary.exportedAt)}
                </p>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {pluralCounts.map(({ key, singular }) => (
                <li key={key} className="rounded-lg bg-raised px-3 py-2 tabular-nums">
                  {preview.summary.counts[key] ?? 0} {singular}
                </li>
              ))}
            </ul>
            {preview.summary.schemaVersion < 6 ? (
              <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                Bu yedek eski sürüm (v{preview.summary.schemaVersion}). İçe
                aktarınca eski kitaplar rafa taşınır ve tamamlanmış konular
                işaretlenir; eski test kayıtları salt okunur arşivde kalır.
              </p>
            ) : null}
            <p className="text-sm text-muted">
              Mevcut verilerin tamamı bu yedekle değiştirilecek. Bu işlem geri alınamaz.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                onClick={() => void confirmImport()}
                disabled={busy !== null}
                aria-busy={busy === 'import'}
              >
                {busy === 'import' ? 'Geri yükleniyor…' : 'Mevcut verileri değiştir'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setPreview(null)}
                disabled={busy !== null}
              >
                Vazgeç
              </Button>
            </div>
          </section>
        ) : null}

        <div className="border-t border-line pt-5">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-danger">Tüm verileri sil</h3>
            <p className="text-sm text-muted">
              Bu cihazdaki ders, kitap, deneme, not, fotoğraf, ders çalışma çizelgesi
              ve test geçmişini siler.
            </p>
          </div>

          {resetStep === 0 ? (
            <Button
              variant="ghost"
              className="mt-3 text-danger hover:bg-danger/10"
              onClick={() => setResetStep(1)}
              disabled={busy !== null}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Tüm verileri sil
            </Button>
          ) : (
            <div className="mt-3 space-y-3 rounded-xl border border-danger/40 bg-danger/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                <p className="text-sm">
                  {resetStep === 1
                    ? 'Önce yedek almanı öneririz. Yedek almadan devam edersen verilerini geri getiremezsin.'
                    : 'Bu işlem geri alınamaz. Tüm veriler kalıcı olarak silinecek.'}
                </p>
              </div>

              {resetStep === 1 ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void download()}
                    disabled={busy !== null}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Yedek indir
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setResetStep(2)}
                    disabled={busy !== null}
                  >
                    Devam et
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setResetStep(0)}
                    disabled={busy !== null}
                  >
                    Vazgeç
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void resetEverything()}
                    disabled={busy !== null}
                    aria-busy={busy === 'reset'}
                  >
                    {busy === 'reset'
                      ? 'Veriler siliniyor…'
                      : 'Tüm verileri kalıcı olarak sil'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setResetStep(0)}
                    disabled={busy !== null}
                  >
                    Vazgeç
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {toast ? (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md">
          <Toast
            tone={toast.tone}
            message={toast.message}
            onClose={() => setToast(null)}
          />
        </div>
      ) : null}
    </>
  );
}
