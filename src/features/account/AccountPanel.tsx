import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, KeyRound, LogOut, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth, type AuthUser } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { getActiveDbOrNull } from '@/db/db';
import {
  LocalDataTransferBlockedError,
  TRANSFER_DONE_KEY,
  downloadLegacyBackup,
  fetchCloudHasUserData,
  hasLegacyData,
  localUserDataSummary,
  transferLegacyData,
} from '@/db/transfer';
import { getMeta } from '@/db/sync/meta';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/features/auth/authError';
import { DeleteAccountModal } from './DeleteAccountModal';

/**
 * Account settings (design §7.1, §11).
 *
 * The e-mail is the login identity and is read-only; the display name is the
 * only editable account field. Every write uses the existing API client and
 * the provider's CSRF token, and the password change refreshes the provider
 * because the server rotates the token.
 */

const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-[var(--accent)]';

interface StatusMessage {
  tone: 'success' | 'error';
  text: string;
}

function messageClass(tone: StatusMessage['tone']): string {
  return tone === 'success' ? 'text-success' : 'text-danger';
}

function exportFileName(): string {
  return `kocluk-hesap-${new Date().toISOString().slice(0, 10)}.json`;
}

export function AccountPanel() {
  const { user, csrfToken, logout, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const lastAccountName = useRef(user?.displayName ?? '');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState<StatusMessage | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<StatusMessage | null>(null);

  const [exportBusy, setExportBusy] = useState(false);
  const [dataMessage, setDataMessage] = useState<StatusMessage | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState<string | null>(null);

  useEffect(() => {
    // Follow a provider refresh (e.g. after the display name was saved on
    // another device) without resetting a value the user is typing: the ref
    // makes the mount effect a no-op and only a real change overwrites.
    const next = user?.displayName ?? '';
    if (next !== lastAccountName.current) {
      lastAccountName.current = next;
      setDisplayName(next);
    }
  }, [user?.displayName]);

  if (!user) {
    return null;
  }

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = displayName.trim();
    if (next === '') {
      setNameMessage({ tone: 'error', text: 'Görünen ad boş olamaz.' });
      return;
    }

    setNameBusy(true);
    setNameMessage(null);
    try {
      await api.post<{ user: AuthUser }>(
        '/api/auth/update-profile',
        { displayName: next },
        csrfToken ?? undefined,
      );
      setDisplayName(next);
      setNameMessage({ tone: 'success', text: 'Görünen ad kaydedildi.' });
      // Keep the offline hint and the provider in sync.
      await refresh().catch(() => undefined);
    } catch (caught: unknown) {
      setNameMessage({
        tone: 'error',
        text: authErrorMessage(caught, 'Görünen ad kaydedilemedi. Lütfen tekrar dene.'),
      });
    } finally {
      setNameBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (currentPassword === '') {
      setPasswordMessage({ tone: 'error', text: 'Mevcut şifreni gir.' });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMessage({ tone: 'error', text: 'Yeni şifre en az 8 karakter olmalı.' });
      return;
    }
    if (newPassword !== repeatPassword) {
      setPasswordMessage({ tone: 'error', text: 'Yeni şifreler birbiriyle eşleşmiyor.' });
      return;
    }

    setPasswordBusy(true);
    setPasswordMessage(null);
    try {
      await api.post<{ user: AuthUser; csrfToken: string }>(
        '/api/auth/change-password',
        { currentPassword, newPassword },
        csrfToken ?? undefined,
      );
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setPasswordMessage({ tone: 'success', text: 'Şifren güncellendi.' });
      // The server rotated the CSRF token; refresh() picks up the new one
      // before the user can trigger another write.
      await refresh().catch(() => undefined);
    } catch (caught: unknown) {
      setPasswordMessage({
        tone: 'error',
        text: authErrorMessage(caught, 'Şifre değiştirilemedi. Lütfen tekrar dene.'),
      });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function exportData() {
    setExportBusy(true);
    setDataMessage(null);
    try {
      const payload = await api.get<unknown>('/api/account/export');
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const { saveBlob } = await import('@/lib/zip');
      saveBlob(blob, exportFileName());
      setDataMessage({ tone: 'success', text: 'Verilerin indirildi.' });
    } catch (caught: unknown) {
      setDataMessage({
        tone: 'error',
        text: authErrorMessage(caught, 'Veriler indirilemedi. Lütfen tekrar dene.'),
      });
    } finally {
      setExportBusy(false);
    }
  }

  async function signOut() {
    setLogoutMessage(null);
    try {
      await logout();
    } catch (caught: unknown) {
      setLogoutMessage(authErrorMessage(caught, 'Çıkış yapılamadı. Lütfen tekrar dene.'));
    }
  }

  return (
    <>
      <Card className="space-y-5">
        <div className="flex items-center gap-2">
          <UserRound className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
          <h2 className="text-base font-semibold">Hesap</h2>
        </div>

        <form noValidate className="space-y-4" onSubmit={(event) => void saveDisplayName(event)}>
          <Field
            label="Hesap görünen adı"
            htmlFor="hesap-gorunen-ad"
            hint="Hesabında görünen ad. Uygulama selamlaması için Profil bölümündeki ad kullanılır."
          >
            <input
              id="hesap-gorunen-ad"
              type="text"
              autoComplete="name"
              maxLength={60}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-describedby="hesap-gorunen-ad-hint"
              className={inputClass}
            />
          </Field>

          <Field label="E-posta" htmlFor="hesap-eposta" hint="E-posta giriş kimliğindir, değiştirilemez.">
            <input
              id="hesap-eposta"
              type="email"
              value={user.email}
              readOnly
              disabled
              aria-describedby="hesap-eposta-hint"
              className={inputClass}
            />
          </Field>

          {nameMessage ? (
            <p role="status" className={`text-sm ${messageClass(nameMessage.tone)}`}>
              {nameMessage.text}
            </p>
          ) : null}

          <Button type="submit" disabled={nameBusy}>
            {nameBusy ? 'Kaydediliyor…' : 'Adı kaydet'}
          </Button>
        </form>
      </Card>

      <Card className="space-y-5">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
          <h2 className="text-base font-semibold">Şifre değiştir</h2>
        </div>
        <p className="text-sm text-muted">
          Diğer cihazlardaki oturumlar kapatılır; bu cihazda oturumun devam eder.
        </p>

        <form noValidate className="space-y-4" onSubmit={(event) => void changePassword(event)}>
          <Field label="Mevcut şifre" htmlFor="hesap-mevcut-sifre">
            <input
              id="hesap-mevcut-sifre"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Yeni şifre" htmlFor="hesap-yeni-sifre" hint="En az 8 karakter.">
            <input
              id="hesap-yeni-sifre"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              aria-describedby="hesap-yeni-sifre-hint"
              className={inputClass}
            />
          </Field>
          <Field label="Yeni şifre (tekrar)" htmlFor="hesap-yeni-sifre-tekrar">
            <input
              id="hesap-yeni-sifre-tekrar"
              type="password"
              autoComplete="new-password"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              className={inputClass}
            />
          </Field>

          {passwordMessage ? (
            <p role="status" className={`text-sm ${messageClass(passwordMessage.tone)}`}>
              {passwordMessage.text}
            </p>
          ) : null}

          <Button type="submit" disabled={passwordBusy}>
            {passwordBusy ? 'Değiştiriliyor…' : 'Şifreyi değiştir'}
          </Button>
        </form>
      </Card>

      <LegacyTransferSection userId={user.id} />

      <SyncStatus />

      <Card className="space-y-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
          <h2 className="text-base font-semibold">Veriler ve gizlilik</h2>
        </div>
        <p className="text-sm text-muted">
          KVKK kapsamında hesabındaki verileri JSON dosyası olarak indirebilir veya
          hesabını kalıcı olarak silebilirsin.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void exportData()} disabled={exportBusy}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {exportBusy ? 'Hazırlanıyor…' : 'Verilerimi indir'}
          </Button>
          <Link
            to="/gizlilik"
            className="inline-flex min-h-11 items-center font-semibold text-[var(--accent)] underline"
          >
            Gizlilik ve KVKK aydınlatma metnini aç
          </Link>
        </div>

        {dataMessage ? (
          <p role="status" className={`text-sm ${messageClass(dataMessage.tone)}`}>
            {dataMessage.text}
          </p>
        ) : null}

        <div className="border-t border-line pt-4">
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Hesabımı sil
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <LogOut className="h-5 w-5 text-muted" aria-hidden="true" />
          <h2 className="text-base font-semibold">Oturum</h2>
        </div>
        <p className="text-sm text-muted">
          Çıkış yaptığında bu cihazdaki veriler silinmez; tekrar giriş yapabilirsin.
        </p>
        {logoutMessage ? (
          <p role="alert" className="text-sm text-danger">
            {logoutMessage}
          </p>
        ) : null}
        <Button variant="secondary" onClick={() => void signOut()}>
          Çıkış yap
        </Button>
      </Card>

      <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </>
  );
}

interface LegacyTransferSectionProps {
  userId: string;
}

/**
 * "Eski veriler" section for Settings. It only offers the transfer after the
 * cloud status proved the account has no user data and the active local account
 * is fresh/seed-only; otherwise it explains the refusal and offers a backup.
 * Nothing is merged automatically and the old database is never deleted.
 */
function LegacyTransferSection({ userId }: LegacyTransferSectionProps) {
  const [legacy, setLegacy] = useState<boolean | null>(null);
  const [transferred, setTransferred] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const active = getActiveDbOrNull();
        const marker = active ? await getMeta(active, TRANSFER_DONE_KEY) : undefined;
        const exists = await hasLegacyData();
        if (!cancelled) {
          setTransferred(marker === true);
          setLegacy(exists);
          setLoadError(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError(true);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  if (loadError) {
    return (
      <Card className="space-y-4">
        <h2 className="text-base font-semibold">Eski veriler</h2>
        <p role="alert" className="text-sm text-danger">
          Eski veriler kontrol edilemedi. Tarayıcı depolamasına erişilemiyor olabilir.
        </p>
        <Button variant="secondary" onClick={() => setLoadKey((value) => value + 1)}>
          Tekrar dene
        </Button>
      </Card>
    );
  }

  if (legacy !== true) {
    return null;
  }

  async function startTransfer() {
    setBusy(true);
    setMessage(null);
    try {
      const active = getActiveDbOrNull();
      if (active) {
        const local = await localUserDataSummary(active);
        if (local.hasUserData) {
          setMessage({
            tone: 'error',
            text: 'Bu hesapta zaten yerel veriler var. Taşıma yalnızca boş ya da yalnızca tohum verisi olan bir hesaba yapılabilir. Önce Ayarlar → Yedekleme bölümünden yedek indirip yerel verileri temizle.',
          });
          return;
        }
      }

      const cloudHasUserData = await fetchCloudHasUserData();
      if (cloudHasUserData) {
        setMessage({
          tone: 'error',
          text: 'Hesabında kayıtlı kullanıcı verisi var. Otomatik birleştirme yapılmadı; eski veriler bu cihazda korunuyor. Önce yedek indirebilirsin.',
        });
        return;
      }
      setConfirmOpen(true);
    } catch {
      setMessage({
        tone: 'error',
        text: 'Hesap durumu kontrol edilemedi. İnternet bağlantını kontrol edip tekrar dene.',
      });
    } finally {
      setBusy(false);
    }
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
    setConfirmOpen(false);
    setBusy(true);
    setMessage(null);
    try {
      const summary = await transferLegacyData(userId);
      setTransferred(true);
      setMessage({
        tone: 'success',
        text:
          `Aktarım tamamlandı: ${summary.total} kayıt kopyalandı.` +
          (summary.skipped > 0
            ? ` ${summary.skipped} bağlı kayıt eksik üst kayıt nedeniyle atlandı.`
            : '') +
          ' Eski veriler bu cihazda korunuyor.',
      });
    } catch (caught: unknown) {
      setMessage({
        tone: 'error',
        text:
          caught instanceof LocalDataTransferBlockedError
            ? caught.message
            : 'Aktarım tamamlanamadı. Eski veriler değiştirilmedi; tekrar deneyebilirsin.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold">Eski veriler</h2>

      {transferred ? (
        <p className="text-sm text-success">
          Bu cihazdaki eski veriler hesabına aktarıldı. Eski veritabanı yedek olarak
          bu cihazda duruyor.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Bu cihazda eski Zirve Akademi verisi bulundu. Aktarım kitaplarını, konularını,
          denemelerini, notlarını ve planlarını hesabına kopyalar; kimlikler korunur ve
          eski veriler silinmez. Fotoğraflar ve ekler yalnızca bu cihazda kalır.
        </p>
      )}

      {!transferred ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void startTransfer()} disabled={busy}>
            {busy ? 'Kontrol ediliyor…' : 'Eski verileri aktar'}
          </Button>
          <Button variant="secondary" onClick={() => void downloadBackup()} disabled={busy}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Yedek indir
          </Button>
        </div>
      ) : null}

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${messageClass(message.tone)}`}
        >
          {message.text}
        </p>
      ) : null}

      <Modal
        open={confirmOpen}
        title="Eski verileri aktar"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Vazgeç
            </Button>
            <Button onClick={() => void runTransfer()}>Aktar</Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Eski veriler hesabına kopyalanacak. Aynı kimlikli kayıtlar güncellenir; üst
          kaydı bulunmayan bağlı kayıtlar atlanabilir ve atlanan sayısı aktarım sonunda
          gösterilir. Yerel hesabında kullanıcı verisi varsa taşıma reddedilir. Eski
          veritabanı silinmez; istersen yedek indirebilirsin.
        </p>
      </Modal>
    </Card>
  );
}
