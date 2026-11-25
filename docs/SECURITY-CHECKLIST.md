# Güvenlik ve KVKK Kontrol Listesi — Canlı Öncesi

- Kapsam: `feat/accounts-sync` hesap, oturum, senkron ve gizlilik çalışması.
- İnceleme tarihi: 2026-11-25.
- Durum: **Staging ve canlı deploy yapılmadı.** Kod/CI kanıtı olan maddeler
  işaretlidir; cPanel, DNS, e-posta ve canlı ortam gerektiren maddeler kullanıcı
  tarafından tamamlanacaktır.
- Kural: Bir maddede `[ ]` varsa ve etiketi **Blocker** ise canlı deploy
  yapılmaz. Blocker olmayan açıklar kayda geçirilir ve izlenir.

## Özet bulgular

| Alan | Durum | Not |
|---|---|---|
| Kullanıcı izolasyonu | ✅ Kod + test | Her sorgu oturumdaki `user_id`/`owner_id` ile sınırlı; iki hesaplı testler var |
| CSRF / Origin | ✅ Kod + test | `X-CSRF-Token`, SameSite=Lax, oturumsuz yazmalarda Origin |
| Oturum çerezi | ✅ Kod + test | `__Host-`, HttpOnly, Secure, SameSite=Lax, Path=/ |
| Hız sınırları | ✅ Auth/sync + genel | Giriş/kayıt/şifre/senkron + 300/saat/IP genel sınır; health muaf |
| SQL injection | ✅ Kod + test | PDO prepared, tablo/kolon beyaz listesi |
| XSS | ✅ Kod + test | React kaçışı, DOMPurify, API JSON |
| Secret'lar | ✅ Repo | Config public_html dışında; örnek dosyada gerçek değer yok |
| Loglar | ✅ Kod | `display_errors=0`; log public_html dışında; gövde/şifre loglanmıyor |
| Güvenlik başlıkları | ✅/⚠️ | API'de HSTS dahil; statik kök HSTS cPanel'de doğrulanacak |
| Yedekleme | ✅/⚠️ | Günlük + PDO fallback + **tüm kopyalarda 14 gün**; offsite ve restore tatbikatı açık |
| KVKK | ⚠️ | Metin ve akış var; hukuki inceleme ve canlı süreçler açık |
| Staging verisi | ✅/⚠️ | Config fail-closed + ayrı DB kuralı yazılı; ortam ve marker henüz kurulmadı |
| Bağımlılık denetimi | ⚠️ | 4 moderate yalnızca build/dev zincirinde; yüksek/kritik yok |

Açık güvenlik bulguları:

1. **STAGING-CONFIG (kod düzeltildi, ortam açık):** `ConfigFile` staging
   `.kocluk-staging` işaretini görünce yalnızca staging config'i seçiyor;
   `ConfigGuard` `app.env=staging` + `_staging` DB zorunluluğu getiriyor.
   Staging ortamında marker'ın oluştuğu ve `/api/health` yanıtının
   `database=u2964068_staging` döndüğü **canlı staging'de doğrulanmalı**
   (Blocker).
2. **STATIC-HSTS:** API yanıtlarına HSTS eklendi; statik `index.html`/asset
   yanıtları LiteSpeed tarafından üretiliyor. Kök alan adı için HSTS'in
   cPanel/LiteSpeed'de doğrulanması gerekir (Blocker).
3. **OFFSITE-BACKUP:** `backup.php` offsite dizini tanımlıysa kopyalar ve orada
   da 14 gün saklar; varsayılan boştur. Haftalık şifreli indirme/offsite kopya
   operasyonu kurulmadan canlı yedek şartı tamamlanmaz (Blocker).
4. **RESTORE-DRILL:** Rutin tatbikat staging'in kendi yedeğiyle yapılır; canlı
   yedek staging'e yüklenmez. Canlı restore yalnızca açık onay + izole DB +
   derhal imha istisnasıdır. Gerçek tatbikat staging'de yapılmadı (Blocker).
5. **NPM-AUDIT:** `glob`, `minimatch`, `workbox-build`, `vite-plugin-pwa`
   zincirinde 4 moderate bulgu var. Hepsi geliştirme/build bağımlılığı; üretim
   paketine girmiyor. `npm audit fix --force` `vite-plugin-pwa`'yı kırdığı için
   zorla düzeltme yapılmadı; yeni sürüm çıkınca güncellenecek (izleme).
6. **KVKK-LEGAL:** Aydınlatma metni ürün metnidir; nihai hukuki inceleme ve
   veri sorumlusu/iletişim bilgilerinin teyidi gerekir (Blocker).
7. **PHP-LOCAL:** Bu makinede başlangıçta PHP yoktu; taşınabilir PHP 8.4.28
   ile `php -l` ve seçili birim testleri çalıştırıldı. MariaDB gerektiren tam
   PHPUnit paketi (247 test, 3064 assertion) CI'da yeşil geçti.

### Doğrulama kayıtları (2026-11-25)

| Komut | Sonuç |
|---|---|
| `npm run typecheck` | ✅ Geçti |
| `npm run test:run` | ✅ 72 dosya, 763 test geçti |
| `npm run build` | ✅ Geçti (`dist/` yenilendi) |
| `npm run test:e2e` | ✅ 4 auth/sync E2E geçti |
| `npm audit --audit-level=high` | ✅ Çıkış 0; 4 moderate (build/dev zinciri) |
| `php -l` (tüm `api/**/*.php`) | ✅ Sözdizimi hatası yok (PHP 8.4.28) |
| PHPUnit `Config/ConfigGuard/Response/TableMap` | ✅ 42 test, 493 assertion |
| `git diff --check` | ✅ Boşluk hatası yok |
| GitHub Actions `CI` (run 45543767125) | ✅ `web`, `e2e`, `api` (247 PHPUnit testi, 3064 assertion) yeşil |
| Staging/canlı deploy | ⛔ Bu görevde yapılmadı |

---

## 1. Kimlik doğrulama ve oturum

- [x] Şifreler `password_hash(PASSWORD_DEFAULT)` ile saklanır; düz metin yok.
- [x] Girişte `password_verify`; `password_needs_rehash` varsa yeniden hash.
- [x] Şifre en az 8, en fazla 200 karakter; baş/son boşluk kırpılmaz.
- [x] Oturum tokenı 32 rastgele bayt; DB'de yalnızca SHA-256 özeti.
- [x] Üretim çerezi `__Host-kocluk_session`; `HttpOnly; Secure; SameSite=Lax;
      Path=/`; `Domain` yok.
- [x] Geliştirme/staging çerezi ayrı ad; staging'de `__Host-` + Secure.
- [x] Kayan 30 gün, mutlak 90 gün; `last_seen_at` en fazla 5 dakikada bir.
- [x] Giriş yalnızca o tarayıcıdaki eski oturumu iptal eder; diğer cihazlar
      korunur (çoklu cihaz senkronu için gerekli).
- [x] Şifre değişiminde diğer oturumlar iptal; işlemi yapan oturum döner.
- [x] Şifre sıfırlamada tüm oturumlar iptal.
- [x] Çıkışta oturum iptal + çerez silme.
- [x] Giriş hatası genel mesaj (`E-posta veya şifre hatalı`); e-posta varlığı
      sızdırılmaz. Kayıtta "e-posta kayıtlı" istisnası bilinçli kabul.
- [x] Davet kodu `hash_equals` ile karşılaştırılır; boşsa kapalı beta kapalıdır.
- [ ] **Blocker:** Staging'de çerez bayrakları DevTools ile doğrulandı.
- [ ] **Blocker:** Canlıda `__Host-` çerezi ve HTTPS yönlendirmesi doğrulandı.

## 2. Yetkilendirme ve kullanıcı izolasyonu

- [x] Her senkron sorgusu oturumdaki `user_id` ile sınırlı; istemciden gelen
      kullanıcı kimliği kullanılmaz.
- [x] `catalog_books` yalnızca `owner_id = oturum` satırlarını döner.
- [x] `notes` `(user_id, topic_id)`, `user_settings` `user_id` anahtarlı.
- [x] Bilinmeyen tablo/alan `unknown_table`/`validation_failed` ile reddedilir.
- [x] Başka kullanıcının satırına yazma `forbidden` döner.
- [x] Hesap dışa aktarma yalnızca kendi verisini JSON indirir; şifre özeti/token
      yoktur.
- [x] Hesap silme şifre + CSRF ister; yalnızca kendi satırlarını siler.
- [x] İki kullanıcılı izolasyon testleri: `SyncPushTest`, `SyncPullTest`,
      `AccountTest`.
- [ ] **Blocker:** Staging'de A/B hesaplarıyla iki tarayıcı izolasyon smoke'u
      yapıldı.

## 3. CSRF ve Origin

- [x] Oturum açmış tüm yazma istekleri `X-CSRF-Token` ister.
- [x] Token oturumdan bağımsız üretilir; karşılaştırma zamanlama güvenli.
- [x] `SameSite=Lax` çerez.
- [x] Oturumsuz yazmalarda `Origin` başlığı `app_url` ile karşılaştırılır;
      staging'de `app_url` staging adresidir.
- [x] Eksik/yanlış token `403 csrf_failed`; testlerde doğrulandı.
- [ ] **Blocker:** Staging'de `app_url` doğru mu; kayıt/giriş Origin kontrolü
      geçiyor mu?

## 4. Hız sınırları

- [x] `rate_limits` tablosu; pencere dolunca `429` + `Retry-After`.
- [x] Giriş: 10 / 15 dk / IP + e-posta özeti.
- [x] Kayıt: 5 / saat / IP.
- [x] Şifre sıfırlama: 3 / saat / e-posta, 10 / saat / IP; reset 5 / saat / IP.
- [x] Senkron: push/pull 120 / saat / kullanıcı; status 60; full 5.
- [x] E-posta doğrulama: 10 / saat / IP.
- [x] Genel API: 300 / saat / IP; `/api/health` muaf. `GeneralRateLimitTest`
      hem 301. isteğin 429 + `Retry-After` döndüğünü hem health muafiyetini
      doğrular.
- [ ] **Blocker:** Staging'de 11 hatalı girişte 429 ve `Retry-After` görüldü.

## 5. SQL injection ve veri bütünlüğü

- [x] PDO prepared statement; `ATTR_EMULATE_PREPARES=false`.
- [x] Tablo/kolon adları beyaz listeden; kullanıcı girdisiyle SQL birleştirme
      yok.
- [x] Her senkron satırı ayrı transaction; `sync_changes` aynı transaction'da.
- [x] Push en fazla 100 değişiklik / 1 MB; bilinmeyen alan reddi.
- [x] LWW future tolerance 5 dakika; sunucu saati otoritesi.
- [x] Yedek PDO dökümü `information_schema` + `SHOW CREATE TABLE`; generated
      `active_*` kolonları INSERT'e alınmaz (BackupTest).
- [x] PDO dökümü `PDO::MYSQL_ATTR_USE_BUFFERED_QUERY=false` ile unbuffered
      akar; tüm tablo PHP belleğine alınmaz.
- [x] Yedek geçici `.sql`/`.err` dosyaları `umask(0077)` + `chmod(0600)`;
      yarım kalmış `.kocluk-*` dosyaları 24 saat sonra temizlenir.
- [ ] **Blocker:** Canlı öncesi yedek staging'de geri yüklendi; tablo/satır
      sayıları ve giriş/senkron doğrulandı.

## 6. XSS ve çıktı

- [x] API yalnızca JSON döner; HTML içerik tarayıcıda React tarafından kaçışa
      uğrar.
- [x] Not HTML'i `DOMPurify` ile temizlenir (`src/lib/sanitize.ts`); testleri
      var.
- [x] `plain_text` temizlenmiş HTML'den üretilir.
- [x] `Content-Type: application/json; charset=utf-8`, `nosniff`.
- [ ] **İzleme:** CSP başlığı yok. React + DOMPurify birincil savunma; statik
      hostta CSP eklemek ayrı iş (Blocker değil).
- [ ] **Blocker:** Staging'de not içine `<script>`/`javascript:` denemesi
      temizleniyor mu?

## 7. Secret'lar ve yapılandırma

- [x] Gerçek config `/home/u2964068/kocluk-config.php` (canlı) ve
      `/home/u2964068/kocluk-staging-config.php` (staging); `public_html`
      dışında.
- [x] `api/config.php` `.gitignore`'da; repoda yalnızca `config.example.php`.
- [x] `config.example.php` gerçek parola/token içermez; örnek değerler boş.
- [x] `.cpanel.yml` gerçek config kopyalamaz (yalnızca `config.example.php`
      kopyalanır); deploy sonunda `api/config.php` varsa siler; dış config'e
      dokunmaz.
- [x] Repoda özel anahtar/API anahtarı/parola taraması yapıldı; bulgu yok.
- [ ] **Blocker:** Config ve log dosyaları `600`, yedek dizini `700`.
- [ ] **Blocker:** Canlı DB/SMTP parolaları parola yöneticisinde; staging'den
      farklı; deploy sonrası rotate edildi.
- [ ] **Blocker:** `.env`, yedek, log ve `api/config.php` repoya/CI artifact'ına
      girmedi.

## 8. Loglama ve hata yönetimi

- [x] `display_errors=0`; istemciye yalnızca JSON hata zarfı.
- [x] Beklenmeyen hatalar sınıf/mesaj/dosya/satır olarak loglanır; istek
      gövdesi, başlık, şifre ve token loglanmaz.
- [x] Log dosyası config'in yanında, `public_html` dışında.
- [x] 404/405 ve doğrulama hataları istemciye ayrıntı sızdırmaz.
- [ ] **Blocker:** Canlı log izni `600`, rotasyon/temizlik planı var; logda
      kişisel veri/şifre yok.
- [ ] **İzleme:** `error_log` PDO istisna mesajlarında bağlı değer görürse
      temizlenmeli; canlı örnek log incelenecek.

## 9. Güvenlik başlıkları ve taşıma

- [x] API: `Strict-Transport-Security: max-age=31536000` (bu görevde eklendi).
- [x] API: `X-Content-Type-Options: nosniff`.
- [x] API: `Referrer-Policy: strict-origin-when-cross-origin`.
- [x] API: `X-Frame-Options: DENY`.
- [x] API: `Cache-Control: no-store` (oturum/veri yanıtları).
- [ ] **Blocker:** Statik kök alan adı HTTPS'e yönleniyor; HSTS başlığı
      LiteSpeed/cPanel'de doğrulandı (API dışı yanıtlar).
- [ ] **Blocker:** AutoSSL sertifikası geçerli; karışık içerik yok.
- [ ] **İzleme:** CSP ve `Permissions-Policy` statik sitede yok; ayrı iş.

## 10. API dizin koruması

- [x] `api/.htaccess`: `Options -Indexes`, yalnızca `index.php` çalışır.
- [x] `src/`, `lib/`, `bin/`, `migrations/`, `tests/`, `vendor/`, `.git`
      rewrite ile 403.
- [x] `config.php`, `config.example.php`, `composer.*`, `phpunit.xml`, `.log`,
      `.sql`, `.md`, `.json` erişimi kapalı.
- [x] Dotfile erişimi kapalı; `.well-known` açık.
- [ ] **Blocker:** Canlıda `/api/src/...`, `/api/config.example.php`,
      `/api/tests/...` → 403; `/api/health` → 200.
- [ ] **Blocker:** `public_html` kökünde eski `.htaccess`/rewrite kuralları
      API'yi engellemiyor.

## 11. Veritabanı ve en az yetki

- [x] Tüm tablolar InnoDB, `utf8mb4_unicode_ci`.
- [x] Bağlantıda `SET NAMES utf8mb4`, `time_zone='+00:00'`.
- [x] Canlı ve staging ayrı DB.
- [x] DB kullanıcısı yalnızca uygulama DB'sinde yetkili olacak şekilde
      belgelendi.
- [ ] **Blocker:** cPanel DB kullanıcısı `root` değil; yalnızca
      `u2964068_*` veritabanında `ALL PRIVILEGES`; başka DB yok.
- [ ] **Blocker:** DB kullanıcı parolası staging/canlı için farklı ve güçlü.
- [ ] **Blocker:** Yedek kullanıcısı/komutu aynı en az yetkiyle çalışıyor.

## 12. Yedekleme ve geri yükleme

- [x] `api/bin/backup.php`: `mysqldump` varsa
      `--single-transaction --quick --routines --triggers
      --default-character-set=utf8mb4`; yoksa PDO fallback.
- [x] Geçici `--defaults-extra-file` `0600`; parola process listesinde yok.
- [x] gzip (`wb9`); dosya adı `kocluk-YYYYMMDD-HHMMSS.sql.gz`.
- [x] **Tüm kopyalarda 14 gün saklama:** günlük, Pazar `weekly/` ve offsite
      kopyaları aynı 14 gün sınırıyla silinir; tasarım §11'deki 14 gün sözü ile
      uyumludur.
- [x] `public_html` içindeki dizin reddedilir; dizin `0700`, dosya `0600`.
- [x] Offsite dizini verilirse kopyalar ve orada da 14 gün temizlik yapar;
      verilmezse uyarır.
- [x] BackupTest: PDO dökümü, gzip, generated kolon dışlama, günlük/haftalık
      14 gün temizlik, config `keep_days`, `--weekly`, mysqldump yolu,
      public_html reddi, eksik config ve yarım geçici dosya temizliği.
- [ ] **Blocker:** Canlıda günlük cron 03:00 kuruldu; ilk yedek alındı,
      `gzip -t` geçti.
- [ ] **Blocker:** Haftalık kopya `weekly/` altında; haftalık şifreli
      indirme/offsite kopya prosedürü çalışıyor.
- [ ] **Blocker:** Rutin geri yükleme tatbikatı **staging'in kendi yedeğiyle**
      `u2964068_staging` DB'sinde yapıldı (önce mevcut staging yedeği alındı);
      tablo/satır sayıları, staging test hesabı ve senkron doğrulandı. Canlı
      veri staging'e yüklenmedi.
- [ ] **Blocker:** Canlı restore yalnızca açık yazılı onay + izole
      `u2964068_restore_YYYYMMDD` DB'si + derhal imha kaydı ile yapılıyor;
      staging'e canlı yedek yüklenmiyor.
- [ ] **Blocker:** Geri yükleme öncesi mevcut canlı yedek alınıyor; yedek
      olmadan migration/restore yok.
- [ ] **Blocker:** Yedekler şifreli veya yalnızca güvenli kanaldan taşınıyor;
      indirilen kopya test sonrası siliniyor.

## 13. KVKK ve gizlilik

- [x] Kayıt sırasında aydınlatma metni onayı; `privacy_version` ve
      `consented_at` kaydedilir.
- [x] Gizlilik sayfası (`/#/gizlilik`) oturumsuz erişilebilir.
- [x] Veri kategorileri, amaç, saklama, alıcı (Natro), haklar, iletişim,
      72 saat ihlal bildirimi ve 18 yaş altı notu metinde var.
- [x] Hesap silme: kullanıcı satırları, oturumlar, tokenlar ve rate-limit
      kayıtları silinir; yedeklerde en fazla 14 gün.
- [x] Veri indirme JSON; şifre özeti/token yok.
- [x] Fotoğraflar/ekler yalnızca cihazda; sunucuya yüklenmez.
- [x] Analitik, reklam, üçüncü taraf izleme yok.
- [x] Veri Türkiye'de (Natro İstanbul); yurt dışı aktarım yok.
- [ ] **Blocker:** Aydınlatma metni hukuki incelemeden geçti; veri sorumlusu,
      iletişim ve saklama süreleri onaylandı.
- [ ] **Blocker:** İhlal müdahale planı, 72 saat bildirim sorumlusu ve iletişim
      listesi yazılı.
- [ ] **Blocker:** 18 yaş altı kullanıcı/veli onayı politikası netleşti.
- [ ] **Blocker:** Gizlilik metni sürümü değişince yeniden onay akışı test
      edildi.
- [ ] **İzleme:** KVKK başvuru süresi (30 gün) ve destek e-posta kutusu canlıda
      izleniyor.

## 14. Staging verisi ve ortam ayrımı

- [x] Ayrı subdomain, ayrı belge kökü, ayrı DB, ayrı config kuralı
      `docs/STAGING.md` içinde.
- [x] Staging'e yalnızca uydurma veri kuralı yazılı.
- [x] Canlı DB'nin staging'e kopyalanmaması kuralı yazılı; canlı yedek staging'e
      yüklenmez, canlı restore ayrı izole DB'de ve onayla yapılır.
- [x] Staging web config'i fail-closed: `.kocluk-staging` marker'ı varsa
      yalnızca `/home/u2964068/kocluk-staging-config.php`; `ConfigGuard`
      `app.env=staging` + `_staging` DB zorunluluğu getirir.
- [ ] **Blocker:** Staging ortamı kuruldu; DB adı `u2964068_staging`, config
      `/home/u2964068/kocluk-staging-config.php`, marker
      `/home/u2964068/staging/.kocluk-staging` var.
- [ ] **Blocker:** Staging `/api/health` yanıtı `environment=staging` ve
      `database=u2964068_staging` döndürüyor; production config/DB'ye
      bağlanmadığı doğrulandı.
- [ ] **Blocker:** Staging'de gerçek kullanıcı verisi yok; smoke sonrası
      hesaplar silindi/DB sıfırlandı.
- [ ] **Blocker:** Staging ve canlı `.cpanel.yml` `DEPLOYPATH` değerleri
      birbirine karışmıyor; staging dalı `main`'e merge edilmedi; canlı deploy
      marker oluşturmuyor.

## 15. Bağımlılık ve tedarik zinciri

- [x] `npm ci` lockfile ile kurulur; CI'da `npm audit --audit-level=high`.
- [x] PHP runtime için Composer bağımlılığı yok; PHPMailer 6.9.3 `api/lib`
      altında vendor edilmiş, LICENSE korunmuş.
- [x] `composer.json` yalnızca PHP sürümü + PHPUnit (dev).
- [x] `npm audit` sonucu: 0 critical, 0 high, 4 moderate (build/dev zinciri).
- [x] `npm audit --audit-level=high` CI'da yeşil; moderate bulgular release
      notunda kayıtlı.
- [ ] **İzleme:** PHPMailer ve Vite/Workbox sürümleri çeyreklik kontrol
      ediliyor; güvenlik yaması çıkınca güncelleniyor.
- [ ] **İzleme:** `npm audit fix --force` çalıştırılmadı (vite-plugin-pwa
      major düşüşü); düzeltme yeni sürümle yapılacak.

## 16. Yayınlama ve değişiklik yönetimi

- [x] `.cpanel.yml` `dist/` + `api/` kopyalar; dış config'e dokunmaz,
      `api/config.php` varsa siler ve yalnızca staging `DEPLOYPATH` değerinde
      `.kocluk-staging` marker'ı oluşturur.
- [x] Canlı deploy bu görevde yapılmadı; `main`'e push/merge yok.
- [x] Staging → smoke → kullanıcı onayı → canlı sırası belgelendi.
- [x] Migration `schema_migrations` ile idempotent; tekrar çalıştırma güvenli.
- [x] `docs/ROLLBACK.md` canlı geri dönüş için mevcut.
- [ ] **Blocker:** `main` dalı korumalı; doğrudan push yok; PR/CI zorunlu.
- [ ] **Blocker:** Canlı deploy öncesi güncel yedek alındı.
- [ ] **Blocker:** Kullanıcı yazılı onay verdi; deploy sonrası health/log
      kontrolü yapıldı.
- [ ] **Blocker:** `staging` dalı `main`'e merge edilmedi; canlı `.cpanel.yml`
      `/home/u2964068/public_html/` gösteriyor.

## 17. Olay müdahalesi

- [ ] **Blocker:** Güvenlik ihlali iletişim listesi (sahip, yedek, KVKK
      danışmanı) hazır.
- [ ] **Blocker:** Şüpheli oturumları iptal etme ve parola sıfırlama adımları
      yazılı.
- [ ] **Blocker:** Yedekten geri dönüş tatbikatı yapıldı; süre kaydedildi.
- [ ] **Blocker:** KVKK 72 saat bildirimi için şablon ve sorumlu atandı.
- [ ] **İzleme:** Log/DB erişimleri ve olağan dışı 429/401 artışları izleniyor.

---

## Onay

| Rol | Ad | Tarih | İmza/Onay |
|---|---|---|---|
| Geliştirici (bu görev) | OpenCode | 2026-11-25 | Kod/CI incelemesi tamam; staging/canlı yok |
| Ürün sahibi / kullanıcı |  |  | Staging smoke + canlı onay |
| KVKK / hukuk |  |  | Aydınlatma metni ve ihlal planı |
| Operasyon (cPanel) |  |  | Yedek, cron, SSL, SPF/DKIM |

**Canlı deploy kuralı:** Yukarıdaki **Blocker** maddelerinin tamamı
işaretlenmeden canlı deploy yapılmaz. Bu belge bir kontrol listesidir; tek
başına deploy onayı değildir.
