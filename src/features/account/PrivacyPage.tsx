import { Link } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { Card } from '@/components/ui/Card';

/**
 * Public privacy notice (design §11, KVKK aydınlatma metni).
 *
 * It is reachable without a session from the registration screen and from
 * Settings → Hesap when signed in, so it never assumes an authenticated user.
 */

const SECTIONS: ReadonlyArray<{ title: string; body: readonly string[] }> = [
  {
    title: 'Veri sorumlusu ve iletişim',
    body: [
      'Veri sorumlusu Zirve Akademi’dir. Kişisel verilerinle ilgili sorular, başvurular ve silme talepleri için destek@zirveacademy.com adresine yazabilirsin.',
    ],
  },
  {
    title: 'İşlenen veri kategorileri',
    body: [
      'Hesap verileri: e-posta adresi, görünen ad, şifrenin geri döndürülemez özeti, hesap oluşturma ve son güncelleme zamanı, aydınlatma metni sürümü ve onay zamanı.',
      'Çalışma verileri: dersler, konular, denemeler ve netler, raf kitapları ve okuma aralıkları, haftalık planlar, görevler ve notlar.',
      'Teknik veriler: oturum kaydı, oturumun son görülme zamanı ve güvenlik için tutulan sınırlı bağlantı bilgileri.',
      'Fotoğraflar ve ekler yalnızca bu cihazda kalır; sunucuya yüklenmez ve diğer cihazlara gönderilmez.',
    ],
  },
  {
    title: 'İşleme amaçları ve hukuki sebepler',
    body: [
      'Veriler hesabını oluşturmak, oturumunu güvenli biçimde sürdürmek, çalışmalarını cihazların arasında eşitlemek, yedekleme ve geri yükleme yapmak, güvenlik olaylarını önlemek ve destek taleplerini yanıtlamak için işlenir.',
      'İşleme; sözleşmenin kurulması ve ifası, açık rızan (aydınlatma metnini onaylaman) ve güvenli hizmet sunumuna ilişkin meşru menfaat hukuki sebeplerine dayanır. Onayını dilediğin zaman geri çekebilirsin; bu durumda hesabını kapatman gerekebilir.',
    ],
  },
  {
    title: 'Saklama süresi',
    body: [
      'Hesap ve çalışma verilerin hesabın açık olduğu sürece saklanır. Hesabını sildiğinde kullanıcı satırların, oturumların ve sana bağlı doğrulama kayıtların silinir. Sunucu yedeklerindeki kopyalar en fazla 14 gün içinde döner; yasal saklama yükümlülüğü bulunan kayıtlar bu sürenin dışında tutulabilir.',
      'Fotoğraflar ve ekler hesabını silsen bile bu cihazda kalır; onları cihaz ayarlarından veya uygulama içindeki ilgili ekrandan kendin silersin.',
    ],
  },
  {
    title: 'Alıcılar ve yurt dışı aktarım',
    body: [
      'Veriler Türkiye’deki Natro sunucularında (İstanbul) barındırılır. Barındırma dışında verilerin paylaşıldığı bir alıcı, reklam ağı, analitik hizmeti veya üçüncü taraf izleme aracı yoktur.',
      'Kişisel verilerin yurt dışına aktarılmaz; sınır ötesi aktarım ve buna bağlı standart sözleşme süreci uygulanmaz.',
    ],
  },
  {
    title: 'Hakların',
    body: [
      'KVKK kapsamında verilerine erişme, düzeltme, silinmesini isteme, işlenmesine itiraz etme ve verilerini taşınabilir biçimde alma hakların vardır.',
      'Hesabındaki verileri JSON dosyası olarak Ayarlar → Hesap bölümünden indirebilirsin. Hesabını yine aynı bölümden şifrenle kalıcı olarak silebilirsin.',
      'Başvurunu destek@zirveacademy.com adresine iletebilirsin. Talebin en geç 30 gün içinde yanıtlanır.',
    ],
  },
  {
    title: 'Güvenlik ve ihlal bildirimi',
    body: [
      'Şifreler geri döndürülemez biçimde saklanır; oturum çerezi HttpOnly’dir ve yazma istekleri CSRF korumasıyla doğrulanır. Erişim yalnızca oturumdaki kullanıcının satırlarıyla sınırlıdır.',
      'Bir veri ihlali yaşanırsa KVKK’nın öngördüğü şekilde en kısa sürede ve en geç 72 saat içinde Kişisel Verileri Koruma Kurulu’na bildirim yapılır; etkilenen kullanıcılar makul olan en kısa sürede bilgilendirilir.',
    ],
  },
  {
    title: 'Değişiklikler',
    body: [
      'Bu metin önemli bir değişiklikte güncellenir ve yeni sürüm kayıt sırasında yeniden onayına sunulur. Son güncelleme: 28 Kasım 2026.',
    ],
  },
];

export function PrivacyPage() {
  const { status } = useAuth();
  const signedIn = status === 'signedIn' || status === 'offline';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Gizlilik ve KVKK Aydınlatma Metni
        </h1>
        <p className="text-sm text-muted">
          Bu metin, hesabınla birlikte hangi kişisel verileri neden işlediğimizi ve
          haklarını açıklar.
        </p>
      </header>

      {SECTIONS.map((section) => (
        <Card key={section.title} className="space-y-3">
          <h2 className="text-base font-semibold">{section.title}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="text-sm text-muted">
              {paragraph}
            </p>
          ))}
        </Card>
      ))}

      <p className="text-sm text-muted">
        <Link
          to={signedIn ? '/' : '/giris'}
          className="font-semibold text-[var(--accent)] underline"
        >
          {signedIn ? 'Uygulamaya dön' : 'Girişe dön'}
        </Link>
      </p>
    </div>
  );
}
