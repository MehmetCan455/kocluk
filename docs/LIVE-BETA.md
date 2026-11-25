# Canlı Kapalı Beta — 10 Kişilik Yayın Runbook'u

Amaç: staging/subdomain olmadan, `zirveacademy.com` üzerinde davet kodlu
kapalı beta. Veri Natro MariaDB'de (Türkiye) kalır; Supabase/yurt dışı servis
yoktur. Hukukçu onayı bu ölçek için zorunlu değildir; temel aydınlatma/rıza,
silme ve veri indirme akışları uygulamada vardır.

## 0. Ön koşullar

- PHP 8.4 + MariaDB 10.6 (mevcut cPanel).
- `zirveacademy.com` HTTPS/AutoSSL.
- cPanel'de bir MySQL veritabanı ve kullanıcı.
- `no-reply@zirveacademy.com` e-posta hesabı + SMTP bilgileri.
- Bir davet kodu (aşağıda örnek: `ZIRVE-BETA-2026`).

## 1. Veritabanı

cPanel → **MySQL Databases**:

1. Mevcut `u2964068_db385` **boşsa** onu kullanabilirsin. Doluysa yeni bir DB
   oluştur (plan izin veriyorsa).
2. Bir kullanıcı oluştur (ör. `u2964068_kocluk`) ve güçlü bir şifre belirle.
3. Kullanıcıyı DB'ye **All Privileges** ile ekle.
4. Not al: DB adı, kullanıcı adı, şifre. Şifreyi sohbete yazma; doğrudan
   config dosyasına koy.

## 2. E-posta / SMTP

cPanel → **Email Accounts** → `no-reply@zirveacademy.com` oluştur.
**Connect Devices** ekranından SMTP bilgilerini al:

- Host: genellikle `mail.zirveacademy.com` veya `smtp.zirveacademy.com`
- Port: `465` (SSL) veya `587` (STARTTLS)
- Kullanıcı: `no-reply@zirveacademy.com`
- Şifre: e-posta hesabının şifresi

SPF/DKIM kayıtlarının cPanel'de açık olduğunu kontrol et. Şifre sıfırlama
e-postasını kendi Gmail/Outlook adresine göndererek test et.

## 3. Config dosyası (public_html DIŞINDA)

cPanel → File Manager → `/home/u2964068/` → **kocluk-config.php** oluştur.
İçeriği aşağıdaki gibi düzenle; gerçek şifreleri sadece bu dosyaya yaz:

```php
<?php
declare(strict_types=1);

return [
    'app' => [
        'env' => 'production',
        'base_url' => 'https://zirveacademy.com',
    ],
    'app_url' => 'https://zirveacademy.com',
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'database' => 'u2964068_db385',
        'username' => 'u2964068_kocluk',
        'password' => 'BURAYA_DB_SIFRESI',
    ],
    'session' => [
        'cookie_name' => '__Host-kocluk_session',
        'secure' => true,
    ],
    'invite_code' => 'ZIRVE-BETA-2026',
    'mail' => [
        'host' => 'mail.zirveacademy.com',
        'port' => 465,
        'username' => 'no-reply@zirveacademy.com',
        'password' => 'BURAYA_MAIL_SIFRESI',
        'encryption' => 'ssl',
        'from_address' => 'no-reply@zirveacademy.com',
        'from_name' => 'Zirve Akademi',
    ],
    'privacy_version' => '2026-11-24',
    'backup' => [
        'dir' => '/home/u2964068/kocluk-backups',
        'offsite_dir' => '',
        'keep_days' => 14,
    ],
    'maintenance' => [
        'change_log_days' => 90,
        'rate_limit_hours' => 24,
    ],
    'sync' => [
        'full_max_bytes' => 20 * 1024 * 1024,
    ],
];
```

Dosya izni: **600** (`-rw-------`). `public_html` içine koyma.

## 4. Deploy (kod hazır olduğunda)

1. Repoda `npm run build` ile `dist/` üretilir ve commit edilir.
2. cPanel → **Git Version Control** → mevcut repo → **Update from Remote** →
   **Deploy HEAD Commit**.
3. `.cpanel.yml` `dist/` ve `api/` klasörlerini `public_html` altına kopyalar;
   gerçek config'e dokunmaz.

Deploy sonrası:
- `https://zirveacademy.com/` açılmalı.
- `https://zirveacademy.com/api/health` → `{"ok":true,...}` dönmeli.
- Giriş ekranı gelmeli; kayıt için davet kodu istenmeli.

## 5. Migration

cPanel → **Cron Jobs** ile bir kez:

```
/usr/local/bin/php /home/u2964068/public_html/api/bin/migrate.php >> /home/u2964068/kocluk-migrate.log 2>&1
```

`php` yolu farklıysa cPanel Terminal'de `which php` ile bul. Migration
idempotenttir; tekrar çalışması zarar vermez. Logda hata varsa dur.

## 6. Cron'lar

Günlük yedek (03:00):

```
/usr/local/bin/php /home/u2964068/public_html/api/bin/backup.php >> /home/u2964068/kocluk-backup.log 2>&1
```

Günlük bakım (04:00):

```
/usr/local/bin/php /home/u2964068/public_html/api/bin/maintenance.php >> /home/u2964068/kocluk-maintenance.log 2>&1
```

Yedekler `/home/u2964068/kocluk-backups/` altında, `public_html` dışında.
İlk yedekten sonra haftada bir dosyayı bilgisayarına indir.

## 7. Telefon + bilgisayar testi

1. Telefondan `https://zirveacademy.com` → **Kayıt ol** → davet kodu.
2. Onboarding'i tamamla; sayfayı yenile → onboarding tekrar gelmemeli.
3. Telefonda kitap ekle; bilgisayarda aynı hesapla gir → kitap görünmeli.
4. Bilgisayarda görev tikle; telefonda görünmeli.
5. Telefonda uçak modu → tikle → interneti aç → senkronu doğrula.
6. Çıkış/giriş; veri kalmalı.
7. Telefonda “Ana ekrana ekle” ile PWA açılışını dene.

## 8. Geri dönüş

- Deploy öncesi mevcut `public_html` ve DB yedeğini al.
- Sorun olursa cPanel Git'te önceki commit'i deploy et; DB'yi yedekten geri yükle.
- Kullanıcı verisi varsa önce `api/bin/backup.php` ile yedek al.

## 9. KVKK minimal

- Gizlilik/aydınlatma sayfası ve kayıt rıza kutusu açık.
- Davet kodu kapalı; herkes kayıt olamaz.
- Veri indirme ve hesap silme çalışır.
- 18 yaş altı arkadaşlar için veli bilgisi/izni notu ekle (metin).
- Özel nitelikli veri toplama; fotoğraflar cihazda kalsın.
- Beta sonrası, uygulama herkese açılacaksa hukukçuya danış.
