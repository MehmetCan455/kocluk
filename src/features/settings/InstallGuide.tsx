import { useState } from 'react';
import { Download, Share2, Smartphone } from 'lucide-react';
import { useInstallPrompt } from '@/app/useInstallPrompt';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

type ShareFeedback = { tone: 'success' | 'error'; message: string } | null;

const SHARE_TITLE = 'Zirve Akademi — YKS Takip';

function appUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return new URL(base, window.location.href).toString();
}

function platformSteps(): ReadonlyArray<{
  title: string;
  steps: readonly string[];
}> {
  return [
    {
      title: 'iPhone / iPad (Safari)',
      steps: [
        'Uygulamayı Safari’de aç.',
        'Alt araç çubuğundaki Paylaş simgesine dokun.',
        '“Ana Ekrana Ekle”yi seç, ardından “Ekle”ye dokun.',
      ],
    },
    {
      title: 'Android (Chrome)',
      steps: [
        'Uygulamayı Chrome’da aç.',
        'Sağ üstteki üç nokta menüsünü aç.',
        '“Uygulamayı yükle” veya “Ana ekrana ekle”yi seç.',
      ],
    },
    {
      title: 'Bilgisayar (Chrome / Edge)',
      steps: [
        'Uygulamayı tarayıcıda aç.',
        'Adres çubuğunun sağındaki kurulum simgesine tıkla.',
        'Edge’de “Uygulamalar → Bu siteyi uygulama olarak yükle”yi kullanabilirsin.',
      ],
    },
  ];
}

export function InstallGuide() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const [feedback, setFeedback] = useState<ShareFeedback>(null);
  const [sharing, setSharing] = useState(false);

  async function shareLink() {
    if (sharing) {
      return;
    }
    setSharing(true);
    setFeedback(null);
    const url = appUrl();
    const shareData = {
      title: SHARE_TITLE,
      text: 'YKS takibi için Zirve Akademi uygulaması',
      url,
    };

    try {
      if (typeof navigator.share === 'function') {
        await navigator.share(shareData);
        setFeedback({ tone: 'success', message: 'Bağlantı paylaşıldı.' });
        return;
      }
      if (typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(url);
        setFeedback({ tone: 'success', message: 'Bağlantı panoya kopyalandı.' });
        return;
      }
      setFeedback({
        tone: 'error',
        message: 'Bağlantı kopyalanamadı. Adres çubuğundaki adresi paylaşabilirsin.',
      });
    } catch (error: unknown) {
      // Cancelling the native share sheet is not an error worth shouting about.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('Bağlantı paylaşılamadı', error);
      setFeedback({
        tone: 'error',
        message: 'Bağlantı paylaşılamadı. Adres çubuğundaki adresi kopyalayabilirsin.',
      });
    } finally {
      setSharing(false);
    }
  }

  async function install() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      setFeedback({ tone: 'success', message: 'Zirve Akademi cihazına kuruluyor.' });
    } else if (outcome === 'unavailable') {
      setFeedback({
        tone: 'error',
        message: 'Kurulum istemi bu tarayıcıda kullanılamıyor; aşağıdaki adımları izle.',
      });
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Uygulamayı kur</h2>
          <p className="text-sm text-muted">
            Zirve Akademi’yi ana ekranına ekle; tam ekran açılır ve ilk yüklemeden
            sonra çevrimdışı çalışır. Verilerin yalnızca bu cihazda kalır.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {canInstall ? (
          <Button onClick={() => void install()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Uygulamayı yükle
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => void shareLink()} disabled={sharing}>
          <Share2 className="h-4 w-4" aria-hidden="true" />
          {sharing ? 'Paylaşılıyor…' : 'Uygulama linkini paylaş'}
        </Button>
      </div>

      {feedback ? (
        <p
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          className={feedback.tone === 'error' ? 'text-sm text-danger' : 'text-sm text-success'}
        >
          {feedback.message}
        </p>
      ) : null}

      <div className="space-y-3">
        {platformSteps().map((platform) => (
          <details
            key={platform.title}
            className="rounded-xl border border-line bg-canvas/60 px-3 py-2"
          >
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
              {platform.title}
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
              {platform.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>
        ))}
      </div>

      <p className="text-xs text-muted">
        Kurulum ve çevrimdışı kullanım için uygulamayı bir kez çevrimiçi açman gerekir.
      </p>
    </Card>
  );
}
