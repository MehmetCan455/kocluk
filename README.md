# Zirve Akademi — YKS Takip

YKS hazırlığı için hesap tabanlı, çevrimdışı öncelikli (offline-first) bir
takip uygulaması. Kitaplarını sayfa bazında katalogdan rafına ekler, okuduğun
sayfaları ve kitap yüzdesini takip eder; haftalık planına ders satırları ve
kitap/konu/serbest görevler koyar. TYT/AYT denemelerini, yanlış soru
fotoğraflarını, konu notlarını ve konu tamamlama durumunu tek yerde tutar.

Veriler önce cihazdaki IndexedDB'ye yazılır; hesabınla giriş yaptığında yapısal
veriler Türkiye'deki Natro MariaDB'sine senkronlanır ve kendi cihazların
arasında görünür. Fotoğraflar ve ekler bu sürümde yalnızca cihazda kalır.
Analitik, reklam ve üçüncü taraf izleme yoktur.

## Gereksinimler

- **Node.js `>=22.22.2`** (22 LTS önerilir) ve npm.
- Yerel önizleme için Node yeterlidir; gerçek API için sunucuda PHP 8.4 ve
  MariaDB 10.6 gerekir.

## Kurulum ve geliştirme

```bash
npm install
npm run dev
```

Geliştirme sunucusu uygulamayı kök adreste (`/`) açar. Varsayılan port
`5173`'tür; port doluysa Vite bir sonraki boş portu (ör. `5174`) seçer. Adresi
terminal çıktısından al. Üretim derlemesinin varsayılan taban yolu da `/`'dir;
GitHub Pages için `VITE_BASE=/kocluk/` ayarlanır.

## Komutlar

```bash
npm run dev           # geliştirme sunucusu
npm run mock:api      # yerel mock API (http://127.0.0.1:8787)
npm run typecheck     # TypeScript tip kontrolü
npm test              # Vitest izleme modu
npm run test:run      # Vitest tek seferlik
npm run build         # tip kontrolü + üretim derlemesi (dist/)
npm run preview       # üretim derlemesini kök adreste önizle
npm run test:e2e      # hesap/senkron E2E (mock API + Vite başlatır)
npm run test:e2e:auth # aynı auth/sync E2E spec'i
npm run test:e2e:legacy # hesap öncesi eski spec'ler (bilerek kırmızı)
npm run live:preview  # eski canlı sürümü yerelde aç (docs/ROLLBACK.md)
```

CI (GitHub Actions) şunları çalıştırır: `typecheck`, `test:run`, `build`,
`npm audit --audit-level=high`, yalnızca auth/sync Playwright E2E
(`npm run test:e2e`), PHP lint ve PHPUnit (MariaDB 10.6 servisi).
`.github/workflows/ci.yml` bu işlerin kaynağıdır. CI legacy spec'leri
çalıştırmaz; `test:e2e:legacy` bilerek kırmızıdır ve merge gate değildir.

`auth-sync.spec.ts` hesap, senkron, profil/şifre, export ve hesap silme
akışlarını kapsar. `backup`, `branch-exams`, `exams`, `onboarding`, `photos`,
`program`, `pwa`, `responsive` ve `tracking` spec'leri hesap öncesi dönemden
kaldı; ortak auth fixture'ı eklenene kadar `npm run test:e2e:legacy`
**bilerek kırmızıdır** ve merge gate değildir. Günlük doğrulama
`npm run test:e2e` ile yapılır.

## Yerel önizleme (mock API)

Hesap ve senkron akışlarını canlı PHP/MySQL sunucusuna ihtiyaç duymadan görmek
için iki terminal kullan:

1. Terminal 1: `npm run mock:api` → `http://127.0.0.1:8787`
2. Terminal 2: `npm run dev` → terminalde yazan adres (genellikle
   `http://localhost:5173`, doluysa `5174`)

Vite `/api` isteklerini mock API'ye yönlendirir. Hazır demo hesap:
`deneme@kocluk.local` / `deneme1234`. Kayıt ekranından yeni hesap da
açabilirsin. Veriler `scripts/mock-api-data.json` dosyasında tutulur
(gitignore'da); temiz başlangıç için mock'u durdurup dosyayı sil, sonra yeniden
başlat. Çalışırken sıfırlamak için (PowerShell):

```powershell
Invoke-RestMethod -Method Delete http://127.0.0.1:8787/api/__test__/reset
```

Mock yalnızca yerel önizleme ve E2E içindir, üretim paketine girmez; gerçek
sözleşme `api/` altındaki PHP API'dir. Playwright aynı mock'u 8788/4173
portlarında, ayrı bir veri dosyasıyla başlatır:

```bash
npm run test:e2e
```

## Hesap, senkron ve çevrimdışı çalışma

- **Kayıt/giriş:** E-posta + şifre. Kayıt sırasında aydınlatma metni onayı
  zorunludur; `privacy_version` ve onay zamanı saklanır. Kapalı betada davet
  kodu istenir.
- **Oturum:** Sunucu taraflı oturum; çerez `HttpOnly`, `Secure`,
  `SameSite=Lax`. Kayan 30 gün, mutlak 90 gün. Şifre değişince diğer cihazlar,
  şifre sıfırlamada tüm cihazlar çıkar.
- **Şifre sıfırlama:** E-posta bağlantısındaki token URL fragment'ında taşınır;
  30 dakika geçerli, tek kullanım. E-posta doğrulama isteğe bağlıdır.
- **E-posta değişikliği:** Bu sürümde yoktur; e-posta giriş kimliğidir, görünen
  ad düzenlenebilir.
- **Yerel veritabanı:** Her kullanıcı için `kocluk-u-<userId>`. Hesap
  değişince uygulama yeni veritabanına geçer; önceki hesabın fotoğrafları
  cihazda kalır.
- **Senkron:** Kitaplar, plan, konular, denemeler, notlar ve hesap ayarları
  push/pull ile eşitlenir. Değişiklikler kuyruğa girer; açılışta, internet
  gelince, sekmede ve 5 dakikada bir gönderilir. Başarısız satırlar 5 denemeye
  kadar bekler; kalıcı hatalar Ayarlar → Senkron'da "Gönderilemeyen kayıt"
  olarak görünür.
- **Çevrimdışı:** İnternet yokken okuma/yazma yerelde çalışır; bağlantı gelince
  kuyruk gönderilir. `401` gelirse giriş ekranı gösterilir, yerel veri
  silinmez.
- **Eski veri taşıma:** Hesap boşsa eski `kocluk` veritabanındaki yerel veri
  tek seferlik taşınabilir. Taşıma kopyalar; eski DB silinmez; kimlikler
  korunur. Hesap doluysa otomatik birleştirme yapılmaz.
- **Fotoğraflar/ekler:** Yalnızca cihazda; sunucuya yüklenmez.
- **Veri indirme / hesap silme:** Ayarlar → Hesap'tan JSON indir veya şifreyle
  hesabı kalıcı sil. Silme, kullanıcı satırlarını ve oturumları kaldırır;
  sunucu yedeklerindeki kopyalar en fazla 14 gün içinde döner.

## Kitaplar, konu durumu ve haftalık plan

- **Kitaplar** sayfasında katalogdan kitap seçip rafına ekleyebilirsin. Her kitap
  okunan sayfa / toplam sayfa, kalan sayfa ve yüzde ilerleme ile gösterilir;
  toplam sayfa girilmemiş kitaplarda yüzde yerine **Sayfa sayısını gir** uyarısı
  çıkar. Katalog, farklı yayınevlerinden TYT Türkçe; AYT edebiyat; TYT ve AYT
  matematik, geometri, fizik, kimya, biyoloji, tarih, coğrafya, felsefe ve din
  kültürü kitaplarından oluşan 500+ kitaplık (528 kitap) bir set içerir;
  fasikül, problemler ve paragraf kitapları da bu kapsamdadır. Listede olmayan
  kitapları kendi başlık, yayınevi ve sayfa sayısıyla rafına ekleyebilirsin.
  Baskıya göre değişen sayfa sayılarını kitap detayından düzeltebilirsin.
- Kitap detayında **Başlangıç sayfası** ve **Bitiş sayfası** alanlarıyla
  okuduğun sayfa aralığını ekleyebilir, geçmişi görebilir ve plandaki kitap
  görevlerini izleyebilirsin. İlerleme, etkin okuma aralıklarının
  birleşimindeki benzersiz sayfalardan hesaplanır: 480 sayfalık kitapta
  250–255 girmek 6 sayfa sayar. Aynı veya örtüşen aralıklar çift sayılmaz.
- **Ders Çalışma Çizelgesi** sayfasında haftalık plan tarihli olarak tutulur.
  Haftalar arasında geçiş yapabilir, satır ekleyebilir ve her hücreye kitap
  sayfası, konu tekrarı veya serbest görev ekleyebilirsin. Kitap görevinde
  rafındaki kitaplar arasında kitap veya yayınevi adıyla arama yapabilirsin.
  Değişiklikler kısa bir gecikmeyle otomatik kaydedilir; haftanın notu da aynı
  şekilde saklanır.
- Plan görevini tiklemek kitap görevinde okuma kaydını oluşturur ve kitap
  ilerlemesini otomatik günceller. Tiki geri almak kaydı geri alır, böylece
  ilerleme çift sayılmaz. Konu görevi tiklenince tekrar geçmişine kayıt
  eklenir; konunun **Bitti** durumu ayrıca konu sayfasındaki **Durum**
  sekmesinden işaretlenir.
- **Genel Bakış** sayfası bugünün planını ve kitap ilerlemesini bir arada
  gösterir. Eski test kayıtları ve eski serbest metin çizelgesi salt okunur
  olarak korunur.

**Ders ilerlemesi** elle işaretlediğin konu tamamlamaları ile kitap
ilerlemeden tahmini olarak hesaplanır. Her kitabın sayfaları dersin konularına
mümkün olduğunca eşit bölünür; her konu yalnızca kendi sayfa diliminde okunan
oran kadar, tek bir kitaptan en fazla %50 katkı alır. Böylece kısmi okumada
konular sırayla dolmaz ve son sayfada toplu sıçrama olmaz: 416 sayfalık kitabın
415 sayfası okunduğunda 21 konulu ders %49'da kalır, son sayfa okunduğunda %50
olur. İki biten kitap konuları %100 yapar. Bu tahmin ders kartında ve ders
sayfasında **Kitap tahmini** olarak görünür. Konu sayfasından elle **Bitti**
işaretlenen konu her zaman %100 kalır ve kitap tahmini bunu düşürmez.
Arşivlenen kitaplar ile toplam sayfası girilmemiş kitaplar bu tahmine
katılmaz; TYT ve AYT ayrı dersler olarak değerlendirilir.

PWA ikonlarını `public/favicon.svg` kaynağından yeniden üretmek için:

```bash
npx pwa-assets-generator
```

Playwright ilk kullanımda Chromium'u indirmen gerekir:

```bash
npx playwright install chromium
```

## Gizlilik ve KVKK

- Veri sorumlusu Zirve Akademi'dir; iletişim `destek@zirveacademy.com`.
- İşlenen veriler: e-posta, görünen ad, şifre özeti, oturum/teknik kayıtlar,
  çalışma verileri (kitaplar, plan, konular, denemeler, notlar). Fotoğraflar ve
  ekler yalnızca cihazda kalır.
- Veriler Türkiye'deki Natro sunucularında (İstanbul) tutulur; yurt dışına
  aktarım, reklam, analitik veya üçüncü taraf izleme yoktur.
- Kayıt sırasında aydınlatma metni onayı alınır; sürüm ve zaman saklanır.
- Haklar: verilere erişme, düzeltme, silme, itiraz ve taşınabilir kopya.
  Ayarlar → Hesap'tan JSON indirebilir, hesabını silebilirsin.
- Hesap silindiğinde kullanıcı satırları, oturumlar ve bağlı kayıtlar silinir;
  yedeklerdeki kopyalar en fazla 14 gün içinde döner.
- Aydınlatma metni `/#/gizlilik` adresinde; 18 yaş altı kullanıcılar ve veli
  onayı için metinde not vardır. **Nihai metin hukuki incelemeden geçmelidir.**

## Yedekleme

### Cihaz yedeği (uygulama içi)

Veriler IndexedDB'de tutulur. Tarayıcı verilerini temizlersen, cihaz
değiştirirsen veya iOS depolamayı boşaltırsa yerel kopya kaybolabilir.
**Ayarlar → Yedekleme → Yedek indir** ile zip yedeği al ve düzenli olarak
güncelle. Zip; sayfa bazlı kitapları, okuma kayıtlarını, haftalık planı ve
görevleri, konu durumlarını, denemeleri, notları, fotoğrafları ve ekleri;
ayrıca salt okunur eski test/çizelge kayıtlarını içerir. Geri yükleme mevcut
verilerin tamamını değiştirir; birleştirme yapmaz. Cihaz yedeği sunucu
yedeğinin yerine geçmez.

### Sunucu yedeği

Sunucuda günlük yedek `api/bin/backup.php` ile alınır:

- `mysqldump` varsa `--single-transaction --quick --routines --triggers
  --default-character-set=utf8mb4`; yoksa PDO fallback (`SHOW CREATE TABLE` +
  satır satır `SELECT`).
- Çıktı gzip: `/home/u2964068/kocluk-backups/kocluk-YYYYMMDD-HHMMSS.sql.gz`.
- 14 gün günlük saklama; Pazar günleri `weekly/` altında **en fazla 14 günlük**
  kopya. Haftalık kopya da 14 günden eskiyse silinir.
- Yedek dizini `public_html` dışında, izin `700`; dosyalar `600`.
- `backup.offsite_dir` tanımlıysa ayrıca oraya kopyalanır ve orada da 14 gün
  saklanır. Tanımlı değilse haftalık olarak şifreli biçimde bilgisayara indir;
  yedeği repoya, buluta veya `public_html` içine koyma.

Kurulum:

```bash
mkdir -p /home/u2964068/kocluk-backups
chmod 700 /home/u2964068/kocluk-backups

KOCLUK_CONFIG=/home/u2964068/kocluk-config.php \
  /usr/local/bin/php /home/u2964068/public_html/api/bin/backup.php \
  --dir=/home/u2964068/kocluk-backups
```

cPanel → **Cron Jobs** → günlük `03:00`:

```bash
KOCLUK_CONFIG=/home/u2964068/kocluk-config.php /usr/local/bin/php /home/u2964068/public_html/api/bin/backup.php --dir=/home/u2964068/kocluk-backups >> /home/u2964068/kocluk-backups/cron.log 2>&1
```

`cron.log` dosyasını `chmod 600` yap; içinde kişisel veri tutma.

İlk yedeği doğrula:

```bash
ls -lh /home/u2964068/kocluk-backups
gzip -t /home/u2964068/kocluk-backups/kocluk-*.sql.gz
```

### Geri yükleme tatbikatı (staging'in kendi yedeğiyle)

Rutin geri yükleme tatbikatı **canlı yedeği staging'e kopyalamaz**. Staging'in
kendi `backup.php` çıktısını kullan; böylece staging'e gerçek kullanıcı verisi
girmez. Canlı yedek yalnızca aşağıdaki kontrollü istisna ile geri yüklenir.

1. Staging'de güncel bir yedek al:

```bash
KOCLUK_CONFIG=/home/u2964068/kocluk-staging-config.php \
  /usr/local/bin/php /home/u2964068/staging/api/bin/backup.php \
  --dir=/home/u2964068/kocluk-staging-backups
```

2. Tatbikat hedefi staging'in kendi DB'sidir (`u2964068_staging`). Önce
   staging'in mevcut hâlini yedekle; böylece tatbikat geri alınabilir.
3. Parolayı komut satırına yazmamak için geçici bir `600` izinli dosya
   kullan:

```ini
# /home/u2964068/kocluk-restore.cnf  (chmod 600, iş bitince sil)
[client]
user=u2964068_staging
password="<staging-db-parolasi>"
host=localhost
```

4. **Staging yedeğini** aç ve staging DB'sine yükle:

```bash
gunzip -c /home/u2964068/kocluk-staging-backups/kocluk-YYYYMMDD-HHMMSS.sql.gz \
  > /tmp/kocluk-restore.sql

mysql --defaults-extra-file=/home/u2964068/kocluk-restore.cnf \
  u2964068_staging < /tmp/kocluk-restore.sql

rm -f /tmp/kocluk-restore.sql /home/u2964068/kocluk-restore.cnf
```

5. Doğrula:

```sql
USE u2964068_staging;
SHOW TABLES;                 -- 20 tablo
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM user_books;
SELECT COUNT(*) FROM sync_changes;
```

6. Uygulamada **staging test hesabıyla** gir: giriş, kitap/plan/not görünümü,
   push/pull ve hesap dışa aktarma çalışmalı. Hata varsa canlıya geçilmez.
7. Tatbikat sonrası geçici SQL dosyasını sil; staging'i tatbikat öncesi
   yedekten geri yükle veya test hesaplarını temizle.

#### Canlı yedeğini geri yükleme (kontrollü istisna)

Canlı yedek **staging'e yüklenmez**. Gerçek bir canlı geri yükleme gerekiyorsa:

- Kullanıcıdan açık yazılı onay ve olay/change kaydı alınır.
- Yedek, staging DB'sine değil ayrı ve izole bir
  `u2964068_restore_YYYYMMDD` DB'sine yüklenir.
- Erişim yalnızca yetkili kişiyle sınırlıdır; dump ve DB iş bitince derhal yok
  edilir.
- Restore edilen hesaplarla uygulamaya girilmez; yalnızca yetkili doğrulama
  sorguları çalıştırılır.
- Yedek şifreli kanaldan taşınır; süre, sonuç ve imha kaydı tutulur.

Canlı yedekler kişisel veri içerir: indirirken şifrele (`7z a -p...` veya
`gpg`), güvenli kanal kullan, test sonrası yerel kopyayı sil. Yedek
dosyalarını repoya veya herkese açık bir alana koyma. Staging yedeği yalnızca
uydurma test verisi içermelidir.

## Yayınlama (cPanel / zirveacademy.com)

Üretim adresi: `https://zirveacademy.com/`.

Üç ortam vardır:

| Ortam | Adres | Amaç |
|---|---|---|
| Yerel | `http://localhost:5173` (veya 5174) | Mock API ile geliştirme |
| Staging | `https://staging.zirveacademy.com/` | Gerçek API/mail/DB smoke testi |
| Canlı | `https://zirveacademy.com/` | Kullanıcı onayından sonra |

Staging kurulumu, test hesapları ve smoke adımları: **`docs/STAGING.md`**.
Güvenlik/KVKK kontrol listesi: **`docs/SECURITY-CHECKLIST.md`**.

### Canlı deploy kapısı

Aşağıdakiler tamamlanmadan canlı deploy **yapılmaz**:

1. `npm run typecheck`, `npm run test:run`, `npm run build`, `npm run test:e2e`
   ve `npm audit --audit-level=high` yeşil.
2. CI'daki `web`, `e2e` ve `api` işleri yeşil.
3. Staging smoke testi kullanıcı tarafından onaylandı.
4. Canlı DB'nin güncel yedeği alındı ve `gzip -t` ile doğrulandı.
5. Kullanıcı canlı deploy için **açıkça yazılı onay** verdi.
6. `main` dalına merge edildi; `dist/` güncel; canlı `.cpanel.yml`
   `/home/u2964068/public_html/` gösteriyor (staging yolu **değil**).
7. Migration çalıştırıldı; `/api/health` 200; loglar temiz.

Onay yoksa: canlı deploy yok, `main`'e merge yok, cPanel canlı deploy yok.
`docs/ROLLBACK.md` canlı geri dönüş adımlarını içerir.

### Depo düzeni ve `.cpanel.yml`

Depodaki `.cpanel.yml` hem derlenmiş `dist/` klasörünü hem `api/` klasörünü
belge köküne kopyalar:

```text
dist/  -> /home/u2964068/public_html/
api/   -> /home/u2964068/public_html/api/
```

Gerçek config repoda **yoktur**: canlı config
`/home/u2964068/kocluk-config.php`, staging config
`/home/u2964068/kocluk-staging-config.php` olarak `public_html` dışında durur.
`api/config.example.php` yalnızca örnektir; gerçek değerler commit edilmez.
`.cpanel.yml` deploy sonunda `public_html/api/config.php` varsa siler; böylece
yanlışlıkla repoya giren bir config dış config'i gölgeleyemez.

Staging'de `.cpanel.yml`, `DEPLOYPATH` staging kökü olduğunda
`staging/.kocluk-staging` işaretini oluşturur. `ConfigFile` bu işareti görürse
yalnızca `/home/u2964068/kocluk-staging-config.php` dosyasını seçer;
production config veya `api/config.php` fallback'i devre dışıdır. `app.env`
`staging` değilse ya da DB adı `_staging` içermiyorsa API 500 ile durur
(fail-closed). `/api/health` staging'de `environment` ve `database` alanlarını
döndürür; ikisi de doğrulanmadan staging smoke'u yapılmaz.

Sunucuda Node.js gerekmez; `dist/` depoda commit edilir. `.gitattributes`
sayesinde `dist/` dosyaları checkout sırasında satır sonu dönüşümüne uğramaz.

### İlk cPanel kurulumu

1. cPanel → **MySQL Databases**: canlı DB + kullanıcı oluştur; `utf8mb4`.
2. `/home/u2964068/kocluk-config.php` dosyasını `api/config.example.php`
   örneğine göre oluştur; `600` izin ver.
3. cPanel → **Git Version Control** → **Create** ile bu depoyu (GitHub URL'si,
   `main` dalı) ekle.
4. **Update from Remote** → **Deploy HEAD Commit**.
5. Migration:

```bash
KOCLUK_CONFIG=/home/u2964068/kocluk-config.php \
  /usr/local/bin/php /home/u2964068/public_html/api/bin/migrate.php
```

6. cPanel → **Cron Jobs** ile günlük yedeği ekle (yukarıdaki komut).
7. AutoSSL/HTTPS, SPF/DKIM ve `no-reply@zirveacademy.com` SMTP ayarlarını
   doğrula.
8. `/api/health`, kayıt/giriş, senkron ve hesap silme smoke'unu kontrollü bir
   test hesabıyla yap; hesabı sil.

### Her yayında

1. Kaynak dalda `npm run build`; `dist/` değişikliklerini commit et.
2. Testleri çalıştır; staging smoke'unu doğrula.
3. Canlı yedeğini al.
4. `main`'e merge/push et.
5. cPanel → Git Version Control → **Update from Remote** → **Deploy HEAD
   Commit**.
6. Gerekliyse migration çalıştır; `/api/health` ve logları kontrol et.
7. Sorun varsa `docs/ROLLBACK.md`.

### GitHub Pages (eski/opsiyonel)

`.github/workflows/deploy.yml` iş akışı derleme adımında `VITE_BASE=/kocluk/`
kullanır; yani Pages yayını eski `/kocluk/` taban yolunda çalışmaya devam eder.
Bu yol API'siz statik önizlemedir; canlı ürün cPanel'dedir.

Uygulama `HashRouter` kullandığı için alt sayfalar (`#/tyt`, `#/denemeler`
gibi) sunucuda 404 üretmez. Aynı statik `dist/` çıktısı Cloudflare Pages veya
Netlify'a da taşınabilir; yalnızca taban yolunu ortama göre ayarlaman gerekir.

## Güvenlik

- Şifreler bcrypt ile; oturum tokenı yalnızca sunucuda SHA-256 özetiyle.
- Oturum çerezi `HttpOnly`, `Secure`, `SameSite=Lax`; üretimde `__Host-`.
- Yazma isteklerinde CSRF token + Origin kontrolü.
- Giriş/kayıt/şifre sıfırlama ve senkron uçlarında hız sınırı; ayrıca genel
  300/saat/IP sınırı (`/api/health` muaf).
- Staging web istekleri `.kocluk-staging` işaretiyle yalnızca staging config'i
  yükler; `app.env=staging` ve `_staging` DB adı zorunludur, aksi hâlde API
  fail-closed 500 döner.
- Her sorgu oturumdaki kullanıcıyla sınırlı; PDO prepared statement ve
  tablo/kolon beyaz listesi.
- Not HTML'i DOMPurify ile temizlenir; API JSON döner.
- Config ve loglar `public_html` dışında; `display_errors=0`.
- API dizinlerinde `src/`, `bin/`, `migrations/`, `tests/` web erişimine kapalı.
- Günlük yedek + 14 gün saklama + haftalık kopya + offsite/şifreli indirme.

Ayrıntılı kontrol listesi ve açık maddeler: **`docs/SECURITY-CHECKLIST.md`**.
Canlı deploy, bu listedeki **Blocker** maddeleri kapanmadan yapılmaz.

## Kurulum (PWA)

- **iPhone / iPad (Safari):** Paylaş → **Ana Ekrana Ekle** → **Ekle**.
- **Android (Chrome):** Menü → **Uygulamayı yükle** veya **Ana ekrana ekle**.
- **Bilgisayar (Chrome / Edge):** Adres çubuğundaki kurulum simgesi → **Yükle**.
  Edge'de **Uygulamalar → Bu siteyi uygulama olarak yükle** de kullanılabilir.

Kurulumdan sonra uygulama tam ekran açılır. Yeni bir sürüm yayınlandığında
uygulama içinde **“Yeni sürüm hazır”** bildirimi çıkar; hazır olduğunda
**Yenile** ile güncelleyebilirsin. İlk açılış internet gerektirir; bir kez
yüklendikten sonra çevrimdışı açılır.

## Teknolojiler

React 19, TypeScript, Vite, Tailwind CSS, Dexie (IndexedDB), TipTap, Chart.js,
JSZip ve `vite-plugin-pwa`. Testler Vitest + React Testing Library ve
Playwright ile yazılmıştır. API: PHP 8.4, PDO, MariaDB 10.6; PHPMailer 6.9.3
vendor edilmiştir.
