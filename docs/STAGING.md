# Staging Ortamı — Kurulum, Smoke Testi ve Canlı Kapısı

Bu belge `staging.zirveacademy.com` ortamının nasıl kurulacağını, hangi
verilerle test edileceğini ve canlıya geçişin hangi kapılardan geçeceğini
anlatır. **Bu görevde staging veya canlı ortama deploy yapılmadı.** cPanel
işlemleri kullanıcı tarafından yapılır; aşağıdaki adımlar birebir uygulanır.

## 0. Sınırlar ve ilkeler

- Staging ayrı subdomain, ayrı belge kökü, ayrı MariaDB ve ayrı config kullanır.
- Staging'e **gerçek kullanıcı/öğrenci verisi yüklenmez**. Yalnızca uydurma
  hesaplar ve uydurma çalışma verisi kullanılır.
- Canlı veritabanı staging'e kopyalanmaz; staging yedeği canlıya geri
  yüklenmez.
- Canlıya deploy yalnızca bölüm 10'daki onay kapısı açıldıktan sonra yapılır.
- Şifreler, SMTP parolası ve davet kodu repoya, README'ye, ekran görüntüsüne
  veya sohbet kaydına yazılmaz.

## 1. Ön koşullar

- cPanel hesabı: `u2964068` (Natro).
- `zirveacademy.com` DNS yönetimi ve AutoSSL.
- GitHub deposuna erişim: `https://github.com/MehmetCan455/kocluk.git`.
- cPanel **Terminal** veya SSH; yoksa cPanel cron + dosya yöneticisi.
- PHP 8.4 ve MariaDB 10.6 (cPanel → MultiPHP Manager / MySQL).
- Bir parola yöneticisi (staging DB ve SMTP parolaları için).

## 2. Subdomain ve SSL

1. cPanel → **Domains** (eski adı **Subdomains**) → **Create A New Domain**.
2. Subdomain: `staging`; domain: `zirveacademy.com`.
3. **Document Root**: `/home/u2964068/staging`
   (cPanel bunu `staging` olarak da gösterebilir; `public_html/staging`
   **değildir**).
4. Oluşturduktan sonra cPanel → **SSL/TLS Status** → `staging.zirveacademy.com`
   için **Run AutoSSL**.
5. `https://staging.zirveacademy.com/` adresinin sertifikasız açıldığını ve
   HTTP'nin HTTPS'e yönlendiğini doğrula.
6. Staging belge kökünü asla canlı `public_html` ile aynı yapma.

## 3. MariaDB veritabanı

1. cPanel → **MySQL Databases**.
2. Veritabanı adı: `u2964068_staging`.
3. Kullanıcı adı: `u2964068_staging` (cPanel `u2964068_` önekini kendisi
   ekler; farklıysa gerçek adı config'e yaz).
4. Güçlü, yalnızca staging'e özel bir parola üret ve parola yöneticisine kaydet.
5. Kullanıcıyı **yalnızca** `u2964068_staging` veritabanına ekle; `ALL
   PRIVILEGES` bu DB ile sınırlı olsun. Başka DB'ye yetki verme.
6. Karakter kümesi: `utf8mb4`; collation: `utf8mb4_unicode_ci`. Migration
   tabloları zaten bu ayarla açar; DB varsayılanını da aynı yap.
7. Host genellikle `localhost`'tur. cPanel farklı bir host gösteriyorsa config'e
   onu yaz.

Kontrol:

```sql
SHOW VARIABLES LIKE 'character_set_database';
SHOW VARIABLES LIKE 'collation_database';
```

## 4. Staging config dosyası (public_html dışında)

Dosya: `/home/u2964068/kocluk-staging-config.php`

1. cPanel **File Manager** veya Terminal ile oluştur.
2. İzin: `600` (`chmod 600`), sahibi `u2964068`.
3. Aşağıdaki iskeleti kopyala; `<...>` alanlarını **yalnızca sunucuda**
   doldur. Bu dosya repoya girmez.

```php
<?php

declare(strict_types=1);

return [
    'app' => [
        'env' => 'staging',
        'base_url' => 'https://staging.zirveacademy.com',
        // Hata logu public_html dışında kalır.
        'log_file' => '/home/u2964068/kocluk-staging-api-error.log',
    ],
    // CSRF Origin kontrolü ve e-posta bağlantıları bu adresi kullanır.
    'app_url' => 'https://staging.zirveacademy.com',
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'database' => 'u2964068_staging',
        'username' => 'u2964068_staging',
        'password' => '<staging-db-parolasi>',
    ],
    'session' => [
        // __Host- yalnızca Secure + Path=/ ile çalışır; staging HTTPS'tir.
        'cookie_name' => '__Host-kocluk_staging_session',
        'secure' => true,
    ],
    'invite_code' => '<staging-davet-kodu>',
    'mail' => [
        'host' => '<natro-smtp-host>',
        'port' => 587,
        'username' => 'staging-no-reply@zirveacademy.com',
        'password' => '<staging-smtp-parolasi>',
        'encryption' => 'tls',
        'from_address' => 'staging-no-reply@zirveacademy.com',
        'from_name' => 'Zirve Akademi Staging',
    ],
    'privacy_version' => '2026-11-24',
    'backup' => [
        'dir' => '/home/u2964068/kocluk-staging-backups',
        'offsite_dir' => '',
        'keep_days' => 14,
    ],
    'sync' => [
        'full_max_bytes' => 20 * 1024 * 1024,
    ],
];
```

Notlar:

- `app_url` staging adresi olmazsa oturum açmamış yazma istekleri (kayıt,
  giriş, şifre sıfırlama) `Origin` kontrolünde reddedilir.
- `__Host-` çerezi için `Domain` verilmez, `Path=/` ve `Secure` gerekir.
  Canlı çerez adı `__Host-kocluk_session` olduğu için staging ile karışmaz.
- SMTP için gerçek bir staging mailbox kullan; gerçek kullanıcılara toplu
  e-posta gönderme. Kutu yoksa staging'de şifre sıfırlama testini erteleme;
  akışı test etmeden canlıya geçilmez.
- İlk istekten sonra `/home/u2964068/kocluk-staging-api-error.log` dosyasının
  iznini `600` yap ve içinde şifre/token olmadığını kontrol et.

### Staging config izolasyonu (kritik)

Staging web istekleri production config'e **asla** düşmemelidir. Bu iki
mekanizmayla garanti edilir:

1. `.cpanel.yml`, `DEPLOYPATH=/home/u2964068/staging/` olduğunda staging belge
   kökünde `.kocluk-staging` işaret dosyasını oluşturur. `ConfigFile` bu
   işareti görürse yalnızca `/home/u2964068/kocluk-staging-config.php`
   adayını kullanır; production config ve `api/config.php` fallback'i devre
   dışıdır.
2. `ConfigGuard`, `app.env` `staging` değilse veya DB adı `_staging`
   içermiyorsa isteği 500 ile reddeder. Bu kontrol web, migration ve backup
   CLI'lerinde çalışır.

İşaret dosyası yoksa staging API bilinçli olarak çalışmaz (fail-closed). Bu
durumda `.cpanel.yml` içindeki `DEPLOYPATH` satırının tam olarak
`/home/u2964068/staging/` olduğunu kontrol et ve yeniden deploy et. Canlı
`public_html` deploy'unda bu işaret oluşmaz.

## 5. `staging` dalı

Staging, ayrı bir Git dalından yayınlanır. Tek fark `.cpanel.yml` içindeki
`DEPLOYPATH` satırıdır.

```bash
git switch feat/accounts-sync
git switch -c staging

# .cpanel.yml içinde yalnızca bu satırı değiştir:
#   - export DEPLOYPATH=/home/u2964068/staging/

git add .cpanel.yml
git commit -m "chore(staging): point deploy at staging docroot"
git push -u origin staging
```

Kurallar:

- `staging` dalı **yalnızca deploy içindir**; `main`'e merge edilmez.
- Güncelleme: kaynak dalda (`feat/accounts-sync` veya `main`) `npm run build`
  çalıştır, `dist/` değişikliklerini commit et, sonra `staging` dalına merge et.
- `.cpanel.yml` çakışırsa staging tarafında `/home/u2964068/staging/` yolu
  korunur; canlı yolu asla staging'e taşınmaz.
- `dist/` depoda commit edilir; cPanel sunucusunda Node.js gerekmez.

## 6. cPanel Git deposu ve ilk deploy

1. cPanel → **Git Version Control** → **Create**.
2. Clone URL: `https://github.com/MehmetCan455/kocluk.git`
3. Repository Path: `/home/u2964068/repositories/kocluk-staging`
4. Branch: `staging`
5. **Create** → **Update from Remote** → **Deploy HEAD Commit**.
6. Deploy sonrası kontrol:

```bash
ls -la /home/u2964068/staging
ls -la /home/u2964068/staging/api
test -f /home/u2964068/staging/.kocluk-staging && echo "staging marker OK"
```

Beklenen:

- `/home/u2964068/staging/index.html` ve `assets/` var.
- `/home/u2964068/staging/api/index.php` var.
- `/home/u2964068/staging/api/config.php` **yok** (config dışarıda).
- `/home/u2964068/staging/.kocluk-staging` **var**; yoksa staging API
  fail-closed çalışmaz, deploy durdurulur.
- `dist/` klasörü belge kökünün içine iç içe kopyalanmamış.

Deploy yolu yanlışsa `.cpanel.yml` düzeltilir, `staging` dalına commit edilir
ve yeniden deploy edilir. Canlı cPanel deposuna dokunulmaz.

## 7. Migration

Terminal:

```bash
KOCLUK_CONFIG=/home/u2964068/kocluk-staging-config.php \
  /usr/local/bin/php /home/u2964068/staging/api/bin/migrate.php
```

- `php` başka yerdeyse cPanel → **Select PHP Version** ekranındaki yolu kullan
  (ör. `/opt/cpanel/ea-php84/root/usr/bin/php`).
- İlk çalıştırmada `Uygulandı: 001_auth.sql`, `Uygulandı: 002_sync.sql`
  görülür. İkinci çalıştırmada `Uygulanacak migration yok.` döner.
- Hata olursa config yolu, DB adı/kullanıcısı ve `utf8mb4` kontrol edilir.
  **Canlı DB'de migration çalıştırılmaz.**

Tabloları doğrula:

```sql
USE u2964068_staging;
SHOW TABLES;
-- 20 tablo: users, sessions, subjects, topics, exams, exam_results, notes,
-- catalog_books, user_books, activity_logs, schedule_weeks, schedule_rows,
-- schedule_tasks, topic_progress, user_settings, sync_changes,
-- password_resets, email_verifications, rate_limits, schema_migrations
```

Sağlık kontrolü:

```bash
curl -i https://staging.zirveacademy.com/api/health
```

Beklenen: `HTTP/2 200`, JSON içinde `"environment":"staging"` ve
`"database":"u2964068_staging"`, ayrıca `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin` başlıkları.

Bu iki alan görünmüyorsa **dur**: web isteği staging config'i yüklememiştir;
production config/DB'ye bağlanma riski vardır. Marker ve config'i düzeltmeden
smoke testine devam etme.

## 8. Staging yedeği (cron)

1. Dizini oluştur:

```bash
mkdir -p /home/u2964068/kocluk-staging-backups
chmod 700 /home/u2964068/kocluk-staging-backups
```

2. Önce elle çalıştır ve çıktıyı gör:

```bash
KOCLUK_CONFIG=/home/u2964068/kocluk-staging-config.php \
  /usr/local/bin/php /home/u2964068/staging/api/bin/backup.php \
  --dir=/home/u2964068/kocluk-staging-backups
```

3. cPanel → **Cron Jobs** → günlük `03:15`:

```bash
KOCLUK_CONFIG=/home/u2964068/kocluk-staging-config.php /usr/local/bin/php /home/u2964068/staging/api/bin/backup.php --dir=/home/u2964068/kocluk-staging-backups >> /home/u2964068/kocluk-staging-backups/cron.log 2>&1
```

`cron.log` dosyasını `chmod 600` yap.

4. Kontrol:

```bash
ls -lh /home/u2964068/kocluk-staging-backups
gzip -t /home/u2964068/kocluk-staging-backups/kocluk-*.sql.gz
```

Staging yedeği canlı yedeğinden ayrıdır. Rutin geri yükleme tatbikatı
**staging'in kendi yedeğiyle** `u2964068_staging` DB'sinde yapılır (önce
mevcut staging yedeği alınır); canlı yedek staging'e yüklenmez. Canlı restore
yalnızca açık yazılı onay + izole `u2964068_restore_YYYYMMDD` DB'si + derhal
imha istisnasıdır. Adımlar README'deki **Geri yükleme tatbikatı**
bölümündedir. Staging işi bitince staging yedeği silinir; içinde kişisel veri
tutulmaz.

## 9. Smoke testi (uydurma veri)

Test hesapları:

- `staging-a@example.com` — ana test hesabı.
- `staging-b@example.com` — ikinci kullanıcı / izolasyon testi.
- Parolalar yalnızca test sırasında kullanılır; gerçek kullanıcı parolasıyla
  aynı olmaz.
- E-posta doğrulama/şifre sıfırlama testi için kendi kontrolündeki bir test
  mailbox'ını kullan.

Sıra:

1. **Kayıt:** `https://staging.zirveacademy.com/#/kayit` → davet koduyla A
   hesabını aç. Aydınlatma metnini onayla.
2. **Çerez:** DevTools → Application → Cookies:
   `__Host-kocluk_staging_session`; `HttpOnly`, `Secure`, `SameSite=Lax`,
   `Path=/`, `Domain` boş.
3. **Veri oluştur:** bir kitap ekle, bir haftalık plan görevi oluştur, bir konu
   notu yaz, bir deneme kaydet.
4. **Push/pull:** Ayarlar → Senkron → **Şimdi senkronize et**. Network
   panelinde `/api/sync/push` ve `/api/sync/pull` 200 dönmeli. Sayfayı yenile;
   veri durmalı.
5. **İki cihaz:** Gizli pencerede veya telefonda A hesabıyla gir. İlk açılışta
   veri çekilmeli. 1. cihazda bir görevi tikle; 2. cihazda 5 dakika içinde
   (veya elle senkronla) görünmeli.
6. **Çevrimdışı:** DevTools → Network → Offline; bir görevi tikle; tekrar
   online ol; kuyruk gönderilmeli. Sayfa yenilense de yerel veri korunmalı.
7. **İzolasyon:** B hesabıyla gir; A'nın kitabı, notu ve denemesi
   görünmemeli. B'nin `/api/sync/full` yanıtında A'nın satırları olmamalı.
8. **Dışa aktarma:** Ayarlar → Hesap → **Verilerimi indir**; JSON in; içinde
   şifre özeti/token olmamalı.
9. **Hesap silme:** B hesabında şifreyi girip hesabı sil; oturum kapanmalı,
   aynı hesapla giriş `401` dönmeli. A hesabını smoke bitene kadar silme.
10. **Hız sınırı:** B veya ayrı bir test hesabında 11 hatalı giriş dene;
    11.'de `429` ve `Retry-After` görülmeli. Test sonrası bekle; gerekirse
    yalnızca staging DB'sinde `rate_limits` temizlenir.
11. **CSRF:** Oturum çereziyle ama `X-CSRF-Token` olmadan bir yazma isteği
    gönder; `403 csrf_failed` dönmeli.
12. **Şifre sıfırlama:** Bilinmeyen e-posta ile istekte bulun; yanıt bilinen
    e-postayla aynı `202` olmalı. Kendi test mailbox'ına gelen bağlantıyla
    parolayı sıfırla; eski oturumlar kapanmalı.
13. **Hata/Log:** API'de kasıtlı hata üretme; log dosyasında şifre, token veya
    istek gövdesi olmadığını kontrol et. Hata yanıtı yığın izi (stack trace)
    içermemeli.
14. **Veri kuralı:** Staging DB'sinde gerçek ad/e-posta/telefon yok. Test
    sonunda hesapları sil veya staging DB'sini sıfırla.

## 10. Canlıya geçiş kapısı

Aşağıdakilerin **hepsi** tamamlanmadan canlı deploy yapılmaz:

- [ ] `npm run typecheck`, `npm run test:run`, `npm run build`,
      `npm run test:e2e` yeşil.
- [ ] CI'da `web`, `e2e` ve `api` (PHP lint + PHPUnit) işleri yeşil.
- [ ] `npm audit --audit-level=high` yeşil; kalan moderate bulgular yalnızca
      geliştirme/build zincirinde ve kayıtlı.
- [ ] Staging smoke testi (bölüm 9) kullanıcı tarafından imzalandı.
- [ ] Canlı DB'nin güncel yedeği alındı ve `gzip -t` ile doğrulandı.
- [ ] Canlı config ve log izinleri `600`; yedek dizini `700`.
- [ ] Kullanıcı canlı deploy için **açıkça yazılı onay** verdi.
- [ ] `main` dalına merge edildi; `dist/` güncel; canlı cPanel deposu
      `main`'i çekti.
- [ ] Migration canlıda çalıştırıldı; `/api/health` 200.
- [ ] Canlıda kayıt/giriş/senkron için kontrollü bir test hesabı açıldı ve
      silindi; loglar kontrol edildi.

Onay yoksa: canlı deploy yok, `main`'e merge yok, cPanel canlı deploy yok.
Bu görev bölüm 10'u **uygulamaz**; yalnızca belgeler.

## 11. Geri dönüş ve temizlik

- Staging deploy bozulursa cPanel → Git Version Control → önceki commit'i
  deploy et; gerekirse staging yedeğini geri yükle.
- Staging subdomain/DB'sini silmek kullanıcı onayı ister. Silmeden önce
  staging yedeğini güvenli biçimde yok et.
- Canlı geri dönüş: `docs/ROLLBACK.md`.
- Staging'de bulunan gerçek veri varsa derhal silinir ve olay kaydı açılır.

## 12. Sorun giderme

| Belirti | Kontrol |
|---|---|
| `/api/health` 500 | Config yolu, dosya izni, PHP 8.4, `kocluk-staging-api-error.log` |
| `/api/*` 403 | `.htaccess` / `AllowOverride`, LiteSpeed rewrite, `api/index.php` var mı |
| Çerez yazılmıyor | HTTPS, `__Host-` + `Secure` + `Path=/`, `Domain` verilmemiş mi |
| Girişte 401 döngüsü | `app_url` staging mi, oturum tablosu, sunucu saati |
| `config.php bulunamadı` | `KOCLUK_CONFIG` tam yolu; dosya `600` |
| Migration hatası | DB adı/kullanıcısı, `utf8mb4`, kullanıcı yetkisi |
| Yedek yok | `exec` kapalıysa PDO fallback çalışır; dizin izni `700`; `gzip -t` |
| E-posta gelmiyor | SMTP host/port/şifre, SPF/DKIM, spam klasörü; `forgot-password` 202 dönüyor mu |
| Senkron çalışmıyor | `/api/sync/status`, `sync_changes`, 429, tarayıcı saati |
