# Natro Hesaplar ve Cihazlar Arası Senkron — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React PWA'ya Natro MariaDB + PHP 8.4 API üzerinden hesap, oturum ve cihazlar arası senkron eklemek; KVKK ve güvenliği önceliklendirmek.

**Architecture:** Statik React uygulaması Dexie ile çevrimdışı çalışır; kullanıcıya özel `kocluk-u-<userId>` veritabanı açılır. `public_html/api` altındaki çerçevesiz PHP API, HttpOnly oturum çerezi, bcrypt ve MariaDB üzerinde kullanıcıya özel satırlarla auth + push/pull senkronu sağlar. Değişiklikler `sync_changes` günlüğüyle taşınır; LWW, tombstone ve deterministik kimliklerle çakışma çözülür.

**Tech Stack:** PHP 8.4, MariaDB 10.6, PDO, PHPUnit, PHPMailer; React 19, TypeScript, Dexie, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-24-natro-mysql-hesap-senkron-design.md`

## Global Constraints

- PHP 8.4, MariaDB 10.6; tüm tablolar InnoDB ve `utf8mb4_unicode_ci`.
- Supabase veya başka yurt dışı veri servisi kullanılmaz; veri Natro İstanbul'da kalır.
- Canlıya (`public_html`, `main`) deploy **yasak**; son onaya kadar yalnızca feature branch, CI, local mock ve staging.
- Alt ajanlar yalnızca `opencode-go/deepseek-v4.1-flash#max` modelini kullanır.
- Şifreler `password_hash`/`password_verify`; düz metin şifre/token loglanmaz.
- Oturum çerezi `HttpOnly; Secure; SameSite=Lax`; üretimde `__Host-kocluk_session`.
- Her API sorgusu oturumdaki `user_id` ile sınırlanır; istemciden gelen kullanıcı kimliği kullanılmaz.
- Yapılandırma ve yedekler `public_html` dışında; repoda secret yok.
- Test/staging verisi sahte olur; gerçek kullanıcı verisi kopyalanmaz.
- E-posta, şifre sıfırlama ve KVKK metinleri Türkçe.
- Her task sonunda testler geçer ve commit atılır; canlı deploy yok.

## Review Focus

1. **Kullanıcı izolasyonu:** A kullanıcısı B'nin satırını okuyamaz/yazamaz; ID tahminiyle bile.
2. **Oturum/CSRF/rate limit:** Çalınmış çerez, CSRF'siz yazma, brute force ve çok cihazlı oturum.
3. **Senkron çakışması:** Saati ileri cihaz, doğal anahtar çakışması, çevrimdışı düzenleme, tombstone.
4. **Veri taşıma:** Eski `kocluk` DB'si kaybolmadan hesaba taşınır; yarıda kalırsa tekrar çalışır.
5. **KVKK:** Veri indirme/silme, aydınlatma onayı, loglarda PII yok, staging'de gerçek veri yok.

---

### Task 1: CI ve PHP test iskeleti

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `api/composer.json`
- Create: `api/phpunit.xml`
- Create: `api/tests/bootstrap.php`
- Create: `api/tests/SmokeTest.php`
- Create: `api/.gitignore`

**Interfaces:**
- Consumes: mevcut `npm run typecheck`, `npm run test:run`, `npm run build`.
- Produces: CI'da `api/vendor/bin/phpunit`; sonraki tasklar bu komutu kullanır.

- [ ] **Step 1: `api/composer.json` ve PHPUnit iskeletini yaz**

```json
{
  "name": "zirve/api",
  "type": "project",
  "require": { "php": ">=8.4" },
  "require-dev": { "phpunit/phpunit": "^11.5" },
  "autoload": { "psr-4": { "Kocluk\\Api\\": "src/" } },
  "autoload-dev": { "psr-4": { "Kocluk\\Api\\Tests\\": "tests/" } }
}
```

`api/.gitignore`: `/vendor/`, `.phpunit.cache/`, `config.php`.

- [ ] **Step 2: `api/phpunit.xml` ve smoke testi yaz**

`api/tests/SmokeTest.php`:

```php
<?php
declare(strict_types=1);
namespace Kocluk\Api\Tests;

use PHPUnit\Framework\TestCase;

final class SmokeTest extends TestCase
{
    public function test_php_version_is_supported(): void
    {
        self::assertGreaterThanOrEqual(80400, PHP_VERSION_ID);
    }
}
```

`api/tests/bootstrap.php` `require __DIR__ . '/../vendor/autoload.php';` yapar; test DB env değişkenlerini okur.

- [ ] **Step 3: CI workflow'u yaz**

`.github/workflows/ci.yml`: `push` ve `pull_request`; iki job:

- `web`: Node 22, `npm ci`, `npm run typecheck`, `npm run test:run`, `npm run build`.
- `api`: `shivammathur/setup-php@v2` PHP 8.4 + `pdo_mysql, mbstring, openssl, curl`; `mariadb:10.6` service (`MARIADB_DATABASE=kocluk_test`, root şifresi); `composer install --working-dir=api`; `find api -name '*.php' -not -path 'api/vendor/*' -exec php -l {} \;`; `api/vendor/bin/phpunit -c api/phpunit.xml`.

API job env: `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_DATABASE=kocluk_test`, `DB_USERNAME=root`, `DB_PASSWORD=test`.

- [ ] **Step 4: Local ve CI doğrulaması**

Run: `npm run typecheck`, `npm run test:run`, `npm run build`
Expected: PASS.

Run: `git push -u origin feat/accounts-sync` (canlıya değil), `gh run watch`
Expected: `web` ve `api` job'ları PASS; `api` yalnızca smoke testi çalıştırır.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml api/composer.json api/phpunit.xml api/tests api/.gitignore
git commit -m "chore: add CI and PHP test harness"
```

---

### Task 2: Veritabanı şeması, migration ve Database/UUID

**Files:**
- Create: `api/migrations/001_auth.sql`
- Create: `api/migrations/002_sync.sql`
- Create: `api/src/Db/Database.php`
- Create: `api/src/Support/Uuid.php`
- Create: `api/src/Support/Clock.php`
- Create: `api/bin/migrate.php`
- Create: `api/config.example.php`
- Test: `api/tests/Unit/UuidTest.php`
- Test: `api/tests/Integration/MigrationTest.php`
- Test: `api/tests/Support/TestDatabase.php`

**Interfaces:**
- Produces:
  - `Database::connect(array $config): self`
  - `Database::transaction(callable $fn): mixed`
  - `Database::fetchOne(string $sql, array $params = []): ?array`
  - `Database::fetchAll(string $sql, array $params = []): array`
  - `Database::execute(string $sql, array $params = []): int`
  - `Uuid::v4(): string`, `Uuid::token(int $bytes = 32): string`, `Uuid::hashToken(string $token): string`
  - `Clock::now(): DateTimeImmutable`, `Clock::nowSql(): string`
  - `php api/bin/migrate.php` idempotent migration.

- [ ] **Step 1: Migration SQL'lerini yaz**

Spec §6.1–6.4'ü uygula. Zorunlu ayrıntılar:

- `users`, `sessions`, `password_resets`, `email_verifications`, `rate_limits` (`id, user_id?, bucket, ip?, created_at`), `schema_migrations`.
- `subjects`, `topics`, `exams`, `exam_results`, `notes`, `catalog_books`, `user_books`, `activity_logs`, `schedule_weeks`, `schedule_rows`, `schedule_tasks`, `topic_progress`, `user_settings`, `sync_changes`.
- Senkron tablolarında PK `(user_id, id)`; `notes` `(user_id, topic_id)`; `user_settings` `(user_id)`; `catalog_books` `(owner_id, id)`.
- `deleted_at` + generated `active_*` kolonları + unique index'ler.
- Her senkron tablosunda `server_updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)` ve `(user_id, server_updated_at)` index.
- `sync_changes(id BIGINT AUTO_INCREMENT PK, user_id, table_name, row_id, op, changed_at)`, index `(user_id, id)`.
- Tüm tablolar `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`.

- [ ] **Step 2: Database, UUID ve Clock sınıflarını yaz**

`Database::connect` PDO `ERRMODE_EXCEPTION`, `FETCH_ASSOC`, `EMULATE_PREPARES=false`; bağlantıda `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci` ve `SET time_zone = '+00:00'`.

`Uuid::token` `rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=')` döner; `hashToken` `hash('sha256', $token)`.

- [ ] **Step 3: Migration runner ve config örneğini yaz**

`bin/migrate.php` yalnızca CLI (`PHP_SAPI === 'cli'`) çalışır; `migrations/*.sql` dosyalarını sıralar, `schema_migrations` tablosuna bakarak eksikleri transaction içinde uygular. `config.example.php` env anahtarlarını gösterir; gerçek `config.php` repoda yok.

- [ ] **Step 4: Testleri yaz**

`UuidTest`: v4 formatı, iki token farklı, hash deterministik.

`MigrationTest`: test DB'ye migration çalıştır; `SHOW TABLES` beklenen tabloları içerir; `users` insert/select; `utf8mb4`; `user_books` aynı `(user_id, active_book_id)` için ikinci aktif satırı reddeder; soft-delete sonrası yeni satır eklenebilir; `sync_changes` auto-increment.

`TestDatabase`: test DB'yi temizler (tabloları truncate eder), migration'ı bir kez çalıştırır.

- [ ] **Step 5: CI'da çalıştır**

Run: `git push origin HEAD`, `gh run watch`
Expected: `api` job PASS; migration testleri yeşil.

- [ ] **Step 6: Commit**

```bash
git add api/migrations api/src/Db api/src/Support api/bin api/config.example.php api/tests
git commit -m "feat(api): add schema migrations and database layer"
```

---

### Task 3: HTTP kernel, yönlendirme, health ve hata yönetimi

**Files:**
- Create: `api/index.php`
- Create: `api/.htaccess`
- Create: `api/src/App.php`
- Create: `api/src/Http/Request.php`
- Create: `api/src/Http/Response.php`
- Create: `api/src/Http/Router.php`
- Create: `api/src/Support/ApiException.php`
- Create: `api/src/Support/Json.php`
- Create: `api/src/bootstrap.php`
- Test: `api/tests/Unit/RouterTest.php`
- Test: `api/tests/Unit/RequestTest.php`
- Test: `api/tests/Integration/HealthTest.php`

**Interfaces:**
- Produces:
  - `Request::fromGlobals(): self`; `Request::json(): array`; `Request::header(string): ?string`; `Request::cookie(string): ?string`
  - `Response::json(array, int $status = 200, array $headers = []): self`; `Response::send(): void`
  - `Router::add(string $method, string $path, callable $handler): void`; `Router::dispatch(Request): Response`
  - `App::handle(Request): Response`
  - `GET /api/health` → `{ "ok": true, "serverTime": "..." }`

- [ ] **Step 1: Request/Response/Router testlerini yaz**

Testler: bilinmeyen yol 404; yanlış method 405; JSON gövde parse; 1 MB üstü gövde 413; hata gövdesi `{error:{code,message}}`; güvenlik başlıkları; `Cache-Control: no-store`.

- [ ] **Step 2: Testleri çalıştır, kırmızı olduğunu gör**

Run: `git push origin HEAD`, `gh run watch`
Expected: FAIL (sınıflar yok).

- [ ] **Step 3: Sınıfları ve front controller'ı yaz**

`Request::fromGlobals` `REQUEST_METHOD`, `parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)`, `getallheaders()`, `$_COOKIE`, `file_get_contents('php://input')`, `$_SERVER['REMOTE_ADDR']` kullanır. `X-Forwarded-For` **kullanılmaz**.

`Response::json` `JSON_UNESCAPED_UNICODE`, `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Cache-Control: no-store` ekler.

`index.php` config'i `public_html` dışından yükler (`KOCLUK_CONFIG` env veya `/home/u2964068/kocluk-config.php`), `App`'i kurar, `handle` eder, `send` eder. `display_errors=0`; hata logu `public_html` dışında.

`.htaccess`: `/api` isteklerini `index.php`'ye yönlendirir; `src/`, `bin/`, `migrations/`, `tests/`, `vendor/` dizinlerini `Require all denied` ile kapatır; `.sql`, `.md`, `.json` dosyalarını reddeder.

- [ ] **Step 4: Testleri çalıştır**

Run: `git push origin HEAD`, `gh run watch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/index.php api/.htaccess api/src api/tests
git commit -m "feat(api): add HTTP kernel and health endpoint"
```

---

### Task 4: Auth çekirdeği (kayıt, giriş, oturum, çıkış)

**Files:**
- Create: `api/src/Auth/PasswordHasher.php`
- Create: `api/src/Auth/SessionService.php`
- Create: `api/src/Auth/RateLimiter.php`
- Create: `api/src/Auth/AuthService.php`
- Modify: `api/src/App.php`
- Modify: `api/src/Http/Response.php` (birden çok `Set-Cookie`)
- Test: `api/tests/Integration/AuthTest.php`
- Test: `api/tests/Unit/PasswordHasherTest.php`
- Test: `api/tests/Unit/RateLimiterTest.php`

**Interfaces:**
- Produces:
  - `PasswordHasher::hash(string): string`, `verify(string, string): bool`, `needsRehash(string): bool`
  - `SessionService::create(string $userId, Request $request): array` → `['token','csrfToken','expiresAt']`
  - `SessionService::validate(?string $token): ?array`; `revoke(string $token): void`; `revokeAll(string $userId): void`; `revokeOthers(string $userId, string $currentToken): void`
  - `RateLimiter::assert(string $bucket, ?string $ip, int $limit, int $windowSeconds): void`
  - `AuthService::register(array $input, Request): array`; `login`; `logout`; `session(?string $token): ?array`; `updateProfile(string $userId, array $input): array`; `changePassword(string $userId, string $currentPassword, string $newPassword, string $currentToken): void`
  - Endpoint'ler: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `POST /api/auth/update-profile`, `POST /api/auth/change-password`

- [ ] **Step 1: Auth testlerini yaz**

`AuthTest` (test DB + `App`):
- Kayıt: 201, `Set-Cookie` HttpOnly/SameSite=Lax, gövdede `password_hash` yok.
- Aynı e-posta ikinci kez: 409 `email_taken`.
- Zayıf şifre: 422 `validation_failed`.
- Giriş doğru/yanlış: 200/401; yanlışta genel mesaj.
- `GET /api/auth/session` çerezle 200, çerezsiz 401.
- Çıkış: çerez silinir; aynı token 401.
- İki cihaz: iki ayrı login oturumu; biri diğerini iptal etmez.
- Şifre değişimi: diğer oturumlar 401, mevcut oturum çalışır.
- Rate limit: 11. yanlış giriş 429.
- CSRF: oturumlu `POST` `X-CSRF-Token` olmadan 403.

`PasswordHasherTest`: hash/verify; iki hash farklı; rehash false.

`RateLimiterTest`: limit altı geçer, üstü 429, pencere sonrası geçer.

- [ ] **Step 2: Kırmızıyı gör**

Run: `git push origin HEAD`, `gh run watch`
Expected: FAIL.

- [ ] **Step 3: Servisleri ve route'ları yaz**

- `SessionService` tokenı çerezde, SHA-256 özetini `sessions.id`'de tutar; `csrf_token` rastgele; `expires_at` 30 gün; `last_seen_at` 5 dakikada bir.
- Çerez adı: üretimde `__Host-kocluk_session`, test/dev'de `kocluk_session`; `Secure` üretimde zorunlu, HTTPS'te açık; config varsayılanı `app.env=production` ise `secure=true` olmalı. Test/dev HTTP'de Secure olmayan çerez kullanır.
- `Response` birden çok `Set-Cookie` başlığını koruyabilmeli (oturum + çerez temizleme aynı yanıtta).
- `AuthService::register` e-posta normalize eder, `filter_var`, şifre 8–200, `displayName` 1–80, `privacyAccepted === true`; `users` insert; session; public user döner.
- `login` e-posta+şifre; rate limit `login:` + `hash('sha256', email)`; başarıda `password_needs_rehash`; yalnızca mevcut tarayıcıdaki eski oturumu iptal eder.
- `logout` yalnızca mevcut tokenı iptal eder; çerezi temizler.
- `session` kullanıcı + csrf döner; süresi dolmuşsa 401.
- `updateProfile` yalnızca `display_name` günceller; e-posta değişmez.
- `changePassword` mevcut şifreyi doğrular; yeni şifreyi hash'ler; diğer oturumları iptal eder; mevcut tokenı yeniler.
- Route'lar `App` içinde; hata `ApiException` ile.

- [ ] **Step 4: Testleri çalıştır**

Run: `git push origin HEAD`, `gh run watch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/Auth api/src/App.php api/tests
git commit -m "feat(api): add account registration, login and sessions"
```

---

### Task 5: Şifre sıfırlama, e-posta, davet kodu ve profil

**Files:**
- Create: `api/src/Mail/Mailer.php`
- Create: `api/src/Mail/PhpMailerMailer.php`
- Create: `api/src/Mail/FakeMailer.php`
- Create: `api/src/Mail/Templates.php`
- Create: `api/lib/PHPMailer/PHPMailer.php`, `SMTP.php`, `Exception.php`, `LICENSE` (vendor; sunucuda Composer yok)
- Create: `api/src/Auth/PasswordResetService.php`
- Create: `api/templates/email/reset.php`
- Create: `api/templates/email/verify.php`
- Modify: `api/src/Auth/AuthService.php` (invite code, e-posta doğrulama)
- Modify: `api/src/App.php`
- Test: `api/tests/Integration/PasswordResetTest.php`
- Test: `api/tests/Integration/InviteCodeTest.php`

**Interfaces:**
- Produces:
  - `Mailer::send(string $to, string $subject, string $html): void`
  - `PasswordResetService::request(string $email, Request $request): void`
  - `PasswordResetService::reset(string $token, string $password, Request $request): void`
  - `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
  - `POST /api/auth/verify-email` (token)
  - `AuthService::register` davet kodu isterse `inviteCode` doğrular.

- [ ] **Step 1: Testleri yaz**

`PasswordResetTest`:
- Kayıtlı e-posta için 202; `FakeMailer` bir e-posta yakalar; token tek kullanım; 30 dk sonra 410; süresi dolmuş token 410; başarılı sıfırlama tüm oturumları iptal eder; kayıtsız e-posta için de 202 (enumeration yok).
- `InviteCodeTest`: config'de kod varsa kodsuz kayıt 422; yanlış kod 422; doğru kod 201; config boşsa kodsuz 201.
- E-posta doğrulama: token tek kullanım; `email_verified_at` dolar; doğrulanmamış kullanıcı giriş yapabilir (MVP).

- [ ] **Step 2: Kırmızıyı gör**

Run: `git push origin HEAD`, `gh run watch`
Expected: FAIL.

- [ ] **Step 3: Mailer ve servisleri yaz**

- PHPMailer kaynak dosyalarını `api/lib/PHPMailer/` altına koy (MIT + LICENSE); `PhpMailerMailer` bunları `require` eder; sunucuda Composer gerekmez.
- `PhpMailerMailer` SMTP host/port/user/pass/from config'ten; STARTTLS/SSL; hata `ApiException` 502. Kayıt sırasında doğrulama e-postası gönderilemezse kayıt yine de tamamlanır, kullanıcı doğrulanmamış kalır ve hata loglanır.
- `Templates` Türkçe HTML üretir; token URL fragment'ta; `app_url` config'ten.
- `PasswordResetService` token 32 bayt, SHA-256 özet, 30 dk, tek kullanım; `request` her durumda 202; e-posta yoksa da aynı yanıt. Hız sınırı: 3/saat/e-posta, 10/saat/IP.
- `reset` şifreyi doğrular, hash'ler, `sessions` tümünü iptal eder, tokenı `used_at`; hız sınırı 5/saat/IP.
- Kayıt sırasında `email_verifications` tokenı (24 saat) oluştur ve doğrulama e-postası gönder; mail hatası kaydı düşürmez, kullanıcı doğrulanmamış kalır. `verify-email` tokenı tek kullanımda tüketir, `email_verified_at` doldurur; hız sınırı 10/saat/IP.
- Davet kodu `config['invite_code']`; `hash_equals`; boşsa devre dışı.
- E-posta gönderimi `config['app_url']` üzerinden `#/sifre-sifirla?token=...` ve `#/eposta-dogrula?token=...` bağlantıları üretir.

- [ ] **Step 4: Testleri çalıştır**

Run: `git push origin HEAD`, `gh run watch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/Mail api/src/Auth api/src/App.php api/templates api/tests
git commit -m "feat(api): add password reset, email verification and invite codes"
```

---

### Task 6: Hesap dışa aktarma, silme ve KVKK onayı

**Files:**
- Create: `api/src/Account/AccountService.php`
- Modify: `api/src/Auth/AuthService.php` (privacy version/consent)
- Modify: `api/src/App.php`
- Test: `api/tests/Integration/AccountTest.php`

**Interfaces:**
- Produces:
  - `AccountService::export(string $userId): array`
  - `AccountService::delete(string $userId, string $password): void`
  - `GET /api/account/export` (JSON indirme)
  - `POST /api/auth/delete-account` `{password}`

- [ ] **Step 1: Testleri yaz**

- Export yalnızca oturumdaki kullanıcının satırlarını içerir; başka kullanıcının e-postası/verisi yok.
- Export `notes`, `userBooks`, `scheduleTasks` gibi tabloları ve `user_settings`'i içerir.
- Delete yanlış şifre 403; doğru şifre tüm kullanıcı satırlarını, oturumları, reset tokenlarını, `sync_changes`'i siler; aynı e-posta ile yeniden kayıt olunabilir.
- `privacyAccepted` olmadan kayıt 422; kayıtta `privacy_version` ve `consented_at` dolar.

- [ ] **Step 2: Kırmızıyı gör**

Run: `git push origin HEAD`, `gh run watch`
Expected: FAIL.

- [ ] **Step 3: Servisi yaz**

`export`: `users` public alanları + her senkron tablosundan `user_id = ?` satırları; JSON. `delete`: transaction; tüm senkron tablolar, `sync_changes`, `sessions`, `password_resets`, `email_verifications`, `rate_limits` (`user_id = ?`), `users`; sonra çerez temizlenir.

- [ ] **Step 4: Testleri çalıştır**

Run: `git push origin HEAD`, `gh run watch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/Account api/src/Auth api/src/App.php api/tests
git commit -m "feat(api): add account export, deletion and privacy consent"
```

---

### Task 7: Senkron tablo haritası ve push

**Files:**
- Create: `api/src/Sync/TableMap.php`
- Create: `api/src/Sync/ChangeLog.php`
- Create: `api/src/Sync/SyncService.php`
- Modify: `api/src/App.php`
- Test: `api/tests/Integration/SyncPushTest.php`
- Test: `api/tests/Unit/TableMapTest.php`

**Interfaces:**
- Produces:
  - `TableMap::definition(string $apiKey): array`; `TableMap::toDb(string $apiKey, array $row): array`; `TableMap::toApi(string $apiKey, array $row): array`; `TableMap::rowId(string $apiKey, array $row): string`
  - `ChangeLog::append(string $userId, string $table, string $rowId, string $op): void`; `maxId(string $userId): int`; `minId(string $userId): int`
  - `SyncService::push(string $userId, array $input): array` → `['results'=>..., 'serverTime'=>...]`
  - `POST /api/sync/push`

- [ ] **Step 1: Testleri yaz**

`SyncPushTest`:
- Yeni `userBooks` satırı insert; `sync_changes` bir satır.
- Aynı satırı daha yeni `updatedAt` ile güncelle; eski `updatedAt` conflict döner ve sunucu satırı döner.
- Gelecek tarihli `updatedAt` (`now + 1 gün`) `timeAdjusted: true` ve sunucu sınırına çekilir.
- `subjects` aynı `seedKey` farklı `id` ile gelirse `conflict` + kanonik satır; ikinci satır oluşmaz.
- `activityLogs` aynı `taskId` için ikinci aktif kayıt oluşmaz.
- Başka kullanıcının `id`'siyle push: `forbidden`; satır yazılmaz.
- 101 değişiklik 422 `payload_too_large`; bilinmeyen tablo/alan 422.
- Silme `deletedAt` set eder; change log yazar.

`TableMapTest`: camelCase↔snake_case; `notes` rowId=topicId; `settings` rowId=userId; `catalogBooks` owner kontrolü; bilinmeyen alan reddi.

- [ ] **Step 2: Kırmızıyı gör**

Run: `git push origin HEAD`, `gh run watch`
Expected: FAIL.

- [ ] **Step 3: TableMap, ChangeLog ve push'u yaz**

- `TableMap::TABLES` spec §8.1'deki 13 anahtar; her definition `table`, `columns` (API→DB), `required`, `natural`, `pk`, `immutable`.
- `push`: gövde `deviceId` + `changes`; max 100, 1 MB; her satır `transaction`; `user_id` oturumdan; `updated_at` clamp `[now+5m]`; LWW; natural unique ihlali yakala → kanonik satır; `applied` sonucunda `row` döner; change log.
- `settings`: `user_settings.data` JSON; rowId userId.
- `activityLogs`: insert-only; `deletedAt` update; `updatedAt` yoksa sunucu zamanı.
- `catalogBooks`: `owner_id` oturum; ortak katalog kabul edilmez.

- [ ] **Step 4: Testleri çalıştır**

Run: `git push origin HEAD`, `gh run watch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/Sync api/src/App.php api/tests
git commit -m "feat(api): add sync push with LWW and change log"
```

---

### Task 8: Senkron pull, status ve full

**Files:**
- Modify: `api/src/Sync/SyncService.php`
- Modify: `api/src/App.php`
- Test: `api/tests/Integration/SyncPullTest.php`
- Test: `api/tests/Integration/SyncStatusTest.php`

**Interfaces:**
- Produces:
  - `SyncService::pull(string $userId, ?int $since, int $limit): array` → `['changes'=>..., 'nextCursor'=>int, 'hasMore'=>bool]`
  - `SyncService::status(string $userId): array` → `['hasData'=>bool, 'counts'=>array, 'cursor'=>int, 'serverTime'=>string]`
  - `SyncService::full(string $userId): array` → `['tables'=>array, 'cursor'=>int, 'serverTime'=>string]`
  - `GET /api/sync/pull?since=&limit=`, `GET /api/sync/status`, `GET /api/sync/full`

- [ ] **Step 1: Testleri yaz**

- Push edilen satır pull'da gelir; `nextCursor` artar; `limit` sayfalama; `hasMore`.
- Silinen satır `deletedAt` dolu gelir.
- 90 günden eski cursor `410 cursor_expired`.
- `status` yalnızca `user_settings` varsa `hasData:false`; kitap varsa `true`; counts doğru.
- `full` tüm tabloları ve cursor döner; başka kullanıcının satırı yok.
- 20 MB üstü full `payload_too_large` (test için limit config'ten düşürülebilir).

- [ ] **Step 2: Kırmızıyı gör**

Run: `git push origin HEAD`, `gh run watch`
Expected: FAIL.

- [ ] **Step 3: Pull/status/full'u yaz**

- `pull`: `since` yoksa 0; `minId` kontrolü; `sync_changes` `id > since ORDER BY id LIMIT`; her change için tablo satırını `user_id` ile getir; yoksa atla; aynı satır için son hali; `nextCursor` son id; `hasMore`.
- `status`: `hasData` spec §8.5; counts; `cursor=maxId`.
- `full`: tablo tablo `user_id` satırları; `cursor=maxId`; JSON boyutu 20 MB kontrolü.
- Rate limit: pull 120/saat, status 60/saat, full 5/saat.

- [ ] **Step 4: Testleri çalıştır**

Run: `git push origin HEAD`, `gh run watch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/Sync api/src/App.php api/tests
git commit -m "feat(api): add sync pull, status and full snapshot"
```

---

### Task 9: İstemci DB manager, proxy ve Dexie v7

**Files:**
- Modify: `src/db/db.ts`
- Create: `src/db/dbManager.ts`
- Create: `src/db/sync/meta.ts`
- Modify: `src/test/setup.ts`
- Test: `src/db/dbManager.test.ts`
- Test: `src/db/dbProxy.test.ts`

**Interfaces:**
- Produces:
  - `new KoclukDB(name?: string)`; `db` proxy; `setActiveDb(db: KoclukDB | null): void`; `getActiveDb(): KoclukDB`
  - `openUserDb(userId: string): Promise<KoclukDB>`; `closeActiveDb(): Promise<void>`; `openLegacyDb(): Promise<KoclukDB>`; `activeUserId(): string | null`
  - `getMeta(db, key): Promise<unknown>`; `setMeta(db, key, value): Promise<void>`
  - Dexie v7 stores: `syncQueue` (`id, table, rowId, op, createdAt, updatedAt, attempts, status, lastError`), `syncMeta` (`key`).

- [ ] **Step 1: Testleri yaz**

- `openUserDb('u1')` sonrası `db.name === 'kocluk-u-u1'`; `db.subjects.count()` çalışır.
- `u1`'e kitap ekle, `u2` aç, `u2`'de kitap yok; `u1`'e dön, kitap var.
- `db.transaction('rw', db.subjects, ...)` proxy üzerinden çalışır.
- `db.delete()` + `db.open()` proxy üzerinden çalışır (mevcut test uyumu).
- v7 upgrade eski v6 tablolarını korur; `syncQueue`/`syncMeta` eklenir.
- `getActiveDb()` boşken anlamlı hata fırlatır.

- [ ] **Step 2: Kırmızıyı gör**

Run: `npx vitest run src/db/dbManager.test.ts src/db/dbProxy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Proxy ve manager'ı yaz**

- `KoclukDB` yapıcısı `constructor(name = 'kocluk') { super(name); ... }`; mevcut version tanımları korunur; v7 eklenir.
- `db.ts`: `let activeDb: KoclukDB | null = null`; `setActiveDb`; `getActiveDb`; `db` proxy `get` trap: aktif DB'nin property'si; fonksiyonsa `bind(activeDb)`; aktif yoksa `Error('Veritabanı açılmadı')`.
- `dbManager`: `openUserDb` önce aktif DB'yi kapatır; `new KoclukDB('kocluk-u-' + userId)`; `await open()`; `setActiveDb`; `activeUserId` sakla.
- `openLegacyDb`: `new KoclukDB('kocluk')`, `open()`; aktif yapmaz (transfer için).
- `src/test/setup.ts`: her testten önce `setActiveDb(new KoclukDB('kocluk-test'))` ve `await db.delete(); await db.open();`; mevcut testleri bozmadan.
- `meta.ts`: `syncMeta` key/value.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm run test:run -- src/db/dbManager.test.ts src/db/dbProxy.test.ts`; sonra tüm `npm run test:run`
Expected: PASS; mevcut testler de yeşil.

- [ ] **Step 5: Commit**

```bash
git add src/db src/test/setup.ts
git commit -m "feat(db): add per-user database manager and proxy"
```

---

### Task 9b: Deterministik müfredat ve deneme sonucu kimlikleri

**Files:**
- Modify: `src/lib/namespaces.ts`
- Modify: `src/domain/types.ts` (`Subject`, `Topic`, `Exam`, `ExamResult` için `updatedAt?`, `deletedAt?`)
- Modify: `src/db/seed.ts`
- Modify: `src/db/repositories.ts` (`saveExam`)
- Test: `src/db/seed.test.ts`
- Test: `src/db/exams.test.ts`

**Interfaces:**
- Produces:
  - `SUBJECT_NAMESPACE`, `TOPIC_NAMESPACE`, `EXAM_RESULT_NAMESPACE`
  - `seedCurriculum(seed)` aynı `seedKey` için her cihazda aynı subject/topic ID'sini üretir.
  - `saveExam` var olan `examResults` kimliklerini korur; yeni sonuç deterministik; kaldırılan sonuç `deletedAt` alır.

- [ ] **Step 1: Testleri yaz**

- İki ayrı DB'de `seedCurriculum(CURRICULUM)` çalıştır; aynı `seedKey` subject/topic ID'leri eşit.
- Mevcut bir subject/topic satırı varsa kimliği değişmez.
- `saveExam` iki kez kaydedilir; sonuç ID'leri aynı kalır.
- Yeni bir subject sonucu eklenir; deterministik ID üretilir.
- Sonuç listesinden çıkarılan subject `deletedAt` alır; `listExamResults` göstermez.
- Aynı `examId+subjectId` için ikinci aktif sonuç oluşmaz.

- [ ] **Step 2: Kırmızıyı gör**

Run: `npm run test:run -- src/db/seed.test.ts src/db/exams.test.ts`
Expected: FAIL.

- [ ] **Step 3: Deterministik kimlikleri uygula**

- `namespaces.ts`: üç yeni sabit UUIDv5 namespace; mevcutlar değişmez.
- `domain/types.ts`: `Subject`, `Topic`, `Exam`, `ExamResult` için `updatedAt?: string` ve `deletedAt?: string` ekle; mevcut alanlar değişmez.
- `seed.ts`: `newId()` yerine `deterministicId(SUBJECT_NAMESPACE, subjectSeed.seedKey)` ve `deterministicId(TOPIC_NAMESPACE, topicSeed.seedKey)`; subject/topic mevcut `seedKey` ile bulunursa korunur; yeni satırlara `updatedAt = now` yaz.
- `saveExam`: `examId` için mevcut sonuçları `subjectId` map'ine al; varsa `id` korunur; yoksa `deterministicId(EXAM_RESULT_NAMESPACE, `${exam.id}:${row.subjectId}`)`; kaldırılan subject `deletedAt = now`; `updatedAt` güncelle.
- `listExamResults` `deletedAt` filtreler.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm run test:run -- src/db/seed.test.ts src/db/exams.test.ts`; sonra tüm testler.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/namespaces.ts src/db/seed.ts src/db/repositories.ts src/db/seed.test.ts src/db/exams.test.ts
git commit -m "feat(db): deterministic seed and exam result ids"
```

---

### Task 9c: Senkron tablolarında soft delete

**Files:**
- Modify: `src/db/repositories.ts`
- Modify: `src/db/topicProgressRepository.ts`
- Modify: `src/features/exams/ExamsPage.tsx`, `ExamDetailPage.tsx` (filtreler)
- Modify: `src/features/subjects/SubjectsPage.tsx`, `SubjectPage.tsx` (filtreler)
- Modify: `src/features/topics/TopicPage.tsx` (filtreler)
- Test: `src/db/softDelete.test.ts`
- Test: `src/features/exams/exams.test.tsx`
- Test: `src/features/subjects/subjects.test.tsx`

**Interfaces:**
- Produces:
  - `deleteCustomTopic(topicId)` artık `topics`, `notes`, `topicProgress` satırlarını `deletedAt` ile işaretler; `activityLogs` tombstone; fiziksel silme yok.
  - `deleteExamUnlinkPhotos(examId)` `exams` ve `examResults` satırlarını `deletedAt` ile işaretler; fotoğraf bağlarını çözer.
  - `getTopic`, `listTopics`, `getExam`, `listExams`, `listExamResults`, dashboard sorguları `deletedAt` filtreler.
  - Silinen satır aynı doğal anahtarla yeniden oluşturulursa `deletedAt` temizlenir (revive).

- [ ] **Step 1: Testleri yaz**

- Özel konu silinir: `topics` satırı kalır, `deletedAt` dolu; `notes`/`topicProgress` tombstone; `listTopics` göstermez; `activityLogs` korunur.
- Aynı konu tekrar eklenirse yeni satır oluşur; eski tombstone kalır.
- Deneme silinir: `exams` ve `examResults` tombstone; `listExams` göstermez; fotoğrafların `examId` bağı çözülür.
- Deneme düzenlenir: silinen sonuç `deletedAt` alır; aktif sonuçlar görünür.
- Backup export tombstone'ları içerir; restore sonrası filtreler doğru.
- UI: silinen deneme/konu listelerde görünmez.

- [ ] **Step 2: Kırmızıyı gör**

Run: `npm run test:run -- src/db/softDelete.test.ts src/features/exams/exams.test.tsx src/features/subjects/subjects.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Soft delete'i uygula**

- `repositories.ts`: synced tablolarda `.delete()` yerine `put({...row, deletedAt: now, updatedAt: now})`; `notes` için `deletedAt`; `topicProgress` için `deletedAt`; `topics` için `deletedAt`.
- `deleteCustomTopic`: transaction içinde tombstone; `topicBooks` legacy hard delete kalabilir (senkron değil).
- `deleteExamUnlinkPhotos`: `exams`/`examResults` tombstone; fotoğraf/photoSearch `examId` undefined.
- Liste/get fonksiyonları `!deletedAt` filtreler; `saveExam`/`addCustomTopic` revive gerekiyorsa `delete revived.deletedAt`.
- `topicProgressRepository`: `setTopicDone(false)` `deletedAt` mı yoksa `done:false` mi? Spec: done=false; tombstone yalnızca konu silinince. `setTopicDone(true)` tombstone'u revive eder.
- UI sorguları repository'lerden geldiği için çoğu otomatik düzelir; doğrudan `db.exams.toArray()` kullanan yerleri filtrele.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm run test:run -- src/db/softDelete.test.ts src/features/exams/exams.test.tsx src/features/subjects/subjects.test.tsx`; sonra tüm testler.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db src/features/exams src/features/subjects src/features/topics src/db/softDelete.test.ts
git commit -m "feat(db): soft delete synced rows"
```

---

### Task 10: API istemcisi ve AuthProvider

**Files:**
- Create: `src/lib/api.ts`
- Create: `src/app/AuthProvider.tsx`
- Create: `src/test/mockApi.ts`
- Test: `src/lib/api.test.ts`
- Test: `src/app/AuthProvider.test.tsx`

**Interfaces:**
- Produces:
  - `ApiError` (`status`, `code`, `details`)
  - `api.get<T>(path): Promise<T>`; `api.post<T>(path, body?, csrfToken?): Promise<T>`
  - `AuthProvider`/`useAuth`: `status: 'loading'|'signedOut'|'signedIn'|'offline'`; `user`; `csrfToken`; `login`, `register`, `logout`, `refresh`
  - `AUTH_HINT_KEY = 'kocluk.authHint'`

- [ ] **Step 1: Testleri yaz**

`api.test.ts`: 200 JSON; 204; 401 `ApiError`; 422 code; CSRF header; `credentials:'same-origin'`; ağ hatası.

`AuthProvider.test.tsx`:
- Oturum yokken `signedOut`; `/api/auth/session` 200 ise `signedIn`.
- Offline + hint varsa `offline`; hint yoksa `signedOut`.
- Login başarılı: hint yazılır, `signedIn`; logout: hint silinir, API çağrılır.
- 401 event: `signedOut`.

- [ ] **Step 2: Kırmızıyı gör**

Run: `npm run test:run -- src/lib/api.test.ts src/app/AuthProvider.test.tsx`
Expected: FAIL.

- [ ] **Step 3: API istemcisi ve provider'ı yaz**

- `api` fetch: `credentials:'same-origin'`, `Accept: application/json`, `Content-Type` yalnızca body varsa; `X-CSRF-Token` opsiyonel; `cache:'no-store'`.
- 401'de `window.dispatchEvent(new CustomEvent('kocluk:unauthorized'))`.
- `AuthProvider`: mount'ta hint oku; `navigator.onLine` ise session çağır; değilse offline; event dinle; `refresh`; `login/register` response'undan user/csrf/hint; `logout` API + hint temizle.
- `register` input: `{email,password,displayName,inviteCode?,privacyAccepted}`.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm run test:run -- src/lib/api.test.ts src/app/AuthProvider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/app/AuthProvider.tsx src/test/mockApi.ts src/lib/api.test.ts src/app/AuthProvider.test.tsx
git commit -m "feat(auth): add API client and auth provider"
```

---

### Task 11: Giriş/kayıt ekranları ve route kapısı

**Files:**
- Create: `src/features/auth/AuthLayout.tsx`
- Create: `src/features/auth/LoginPage.tsx`
- Create: `src/features/auth/RegisterPage.tsx`
- Create: `src/features/auth/ForgotPasswordPage.tsx`
- Create: `src/features/auth/ResetPasswordPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/test/renderApp.tsx`
- Test: `src/features/auth/auth.test.tsx`
- Test: `src/App.test.tsx` (güncelle)

**Interfaces:**
- Consumes: `useAuth`, `api`, `AuthLayout`.
- Produces: `AuthGate` bileşeni; giriş yapılmamışsa auth route'ları; yapılmışsa mevcut `AppShell`.

- [ ] **Step 1: Testleri yaz**

- Giriş formu: boş e-posta/şifre hataları; yanlış girişte Türkçe hata; başarılı girişte ana sayfa.
- Kayıt: e-posta/şifre/ad; gizlilik onayı yoksa buton disabled/uyarı; başarılı kayıt onboarding'e.
- `#/sifremi-unuttum` formu 202 sonrası "e-posta gönderildi" mesajı.
- `#/sifre-sifirla?token=...` yeni şifre; başarılıysa giriş.
- Oturum yokken `#/` auth ekranına yönlendirir; oturum varken auth ekranı ana sayfaya.
- Mevcut App testleri `renderApp({ authUser })` ile yeşil kalır.

- [ ] **Step 2: Kırmızıyı gör**

Run: `npm run test:run -- src/features/auth/auth.test.tsx src/App.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Ekranları ve kapıyı yaz**

- `AuthLayout`: ortalanmış kart, logo, başlık; mobil uyumlu.
- `LoginPage`: e-posta, şifre, "Giriş", "Şifremi unuttum", "Hesabın yok mu? Kayıt ol".
- `RegisterPage`: ad, e-posta, şifre, davet kodu (opsiyonel), gizlilik checkbox + link; hata gösterimi.
- `ForgotPasswordPage`/`ResetPasswordPage`: token URL fragment'ından; başarı mesajı.
- `App.tsx`: `AuthProvider` → `AuthGate`; `signedIn` ise `SettingsProvider` + `AppShell`; `key={user.id}`.
- `routes.tsx`: auth route'ları ayrı; mevcut app route'ları korunur.
- `renderApp`: test için `AuthProvider` mock veya `initialAuth` prop.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm run test:run -- src/features/auth/auth.test.tsx src/App.test.tsx`; sonra tüm testler.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth src/App.tsx src/app/routes.tsx src/test/renderApp.tsx src/App.test.tsx
git commit -m "feat(auth): add auth screens and route gate"
```

---

### Task 12: Senkron kuyruğu, push, rekey ve ölü kayıtlar

**Files:**
- Create: `src/db/sync/queue.ts`
- Create: `src/db/sync/push.ts`
- Create: `src/db/sync/rekey.ts`
- Create: `src/db/sync/constants.ts`
- Modify: `src/db/dbManager.ts` (hook kurulumu)
- Test: `src/db/sync/queue.test.ts`
- Test: `src/db/sync/push.test.ts`
- Test: `src/db/sync/rekey.test.ts`

**Interfaces:**
- Produces:
  - `SYNCED_TABLES`: API anahtarları
  - `installSyncHooks(db, userId): void`; `setApplyingRemote(boolean): void`
  - `pendingChanges`, `pendingCount`, `markApplied`, `markDead`, `retryDead`, `deadLetters`
  - `pushOnce(db, apiClient, csrfToken): Promise<{applied, conflicts, errors}>`
  - `rekeyRow(db, table, oldId, canonicalRow): Promise<void>`

- [ ] **Step 1: Testleri yaz**

`queue.test.ts`:
- `userBooks` create → `syncQueue` bir kayıt; aynı satır update → tek kayıt, op upsert; delete → op delete.
- `setApplyingRemote(true)` iken yazma kuyruğa girmez.
- `settings` yazımı tek `settings` kaydı üretir.
- Senkron dışı tablo (`photos`) kuyruğa girmez.
- `updatedAt` yoksa hook yazar.

`push.test.ts`:
- 3 değişiklik gönderilir; `applied` queue'dan siler.
- `conflict` sunucu satırını uygular, queue'dan siler.
- 422 → `dead`, kuyruk tıkanmaz; `retryDead` tekrar dener.
- Ağ hatası → attempts artar, pending kalır.
- `subjects` conflict rekey: yerel subject id değişir, topic.subjectId güncellenir.

`rekey.test.ts`: subject/topic/userBook/scheduleWeek/examResult referansları.

- [ ] **Step 2: Kırmızıyı gör**

Run: `npm run test:run -- src/db/sync/queue.test.ts src/db/sync/push.test.ts src/db/sync/rekey.test.ts`
Expected: FAIL.

- [ ] **Step 3: Kuyruk, hook ve push'u yaz**

- Hook'lar `creating/updating/deleting`; `applyingRemote` bayrağı; `updatedAt`; queue id `${table}:${rowId}`; `put`.
- `pushOnce`: pending 100; her satır için aktif DB'den satır oku; yoksa delete; payload; POST; sonuç.
- `applied`: queue sil; sunucu `row` varsa `put` (guard).
- `conflict`: `rekeyRow` gerekliyse; sunucu satırını uygula; queue sil.
- `error`: 4xx `dead`, 5xx/ağ attempts; 5 sonrası dead.
- `rekeyRow`: tablo bazlı referans güncellemeleri (spec §6.5); Dexie transaction.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm run test:run -- src/db/sync`; sonra tüm testler.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/sync src/db/dbManager.ts src/db/sync/*.test.ts
git commit -m "feat(sync): add queue, push and rekey"
```

---

### Task 13: Pull, senkron motoru ve durum göstergesi

**Files:**
- Create: `src/db/sync/pull.ts`
- Create: `src/db/sync/engine.ts`
- Create: `src/app/SyncProvider.tsx`
- Create: `src/features/sync/SyncStatus.tsx`
- Modify: `src/App.tsx` (SyncProvider)
- Modify: `src/components/layout/TopBar.tsx` (gösterge)
- Modify: `src/features/settings/SettingsPage.tsx` (senkron bölümü)
- Test: `src/db/sync/pull.test.ts`
- Test: `src/db/sync/engine.test.ts`
- Test: `src/features/sync/SyncStatus.test.tsx`

**Interfaces:**
- Produces:
  - `pullOnce(db, apiClient): Promise<{applied:number; hasMore:boolean}>`
  - `fullSync(db, apiClient): Promise<void>`
  - `syncNow(db, apiClient, csrfToken): Promise<SyncResult>`
  - `useSync(): {status, pending, dead, lastSyncAt, syncNow}`
  - `SyncStatus` bileşeni.

- [ ] **Step 1: Testleri yaz**

- Pull bir satırı uygular; `lastChangeId` güncellenir; `hasMore` döngüsü.
- Bekleyen queue satırı sunucu satırıyla ezilmez.
- `deletedAt` dolu satır tombstone olarak yazılır.
- 410 cursor_expired → `fullSync` çağrılır.
- Push sonrası pull; iki cihaz simülasyonu.
- Tetikleyiciler: online, visibility, debounce, interval, manuel.
- SyncStatus: pending/offline/error/synced metinleri; "Şimdi senkronize et".
- Sunucu `serverTime` ile yerel saat farkı >5 dk ise "Cihaz saatinizi düzeltin" uyarısı.

- [ ] **Step 2: Kırmızıyı gör**

Run: `npm run test:run -- src/db/sync/pull.test.ts src/db/sync/engine.test.ts src/features/sync/SyncStatus.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Pull ve motoru yaz**

- `pullOnce`: meta `lastChangeId`; GET; apply with `setApplyingRemote`; skip pending; update meta; `hasMore`.
- `fullSync`: GET full; clear/merge yalnızca senkron tabloları (fotoğraflar korunur); cursor.
- `syncNow`: push → pull → status; hata sınıflandırma.
- `SyncProvider`: `useEffect` triggers; `document.visibilitychange`, `window.online`, `setInterval(5 dk)`, debounce 2 sn; cleanup; `serverTime` sakla.
- `TopBar`: küçük ikon/renk; `SettingsPage`: son senkron, pending, dead, hata, manuel.
- `SyncStatus`: `serverTime` ile yerel saat farkı >5 dk ise uyarı; saat farkı LWW'yi etkileyebilir.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm run test:run -- src/db/sync src/features/sync`; sonra tüm testler.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/sync src/app/SyncProvider.tsx src/features/sync src/App.tsx src/components/layout/TopBar.tsx src/features/settings/SettingsPage.tsx
git commit -m "feat(sync): add pull engine and status UI"
```

---

### Task 14: Eski veri taşıma, hesap paneli ve KVKK sayfası

**Files:**
- Create: `src/db/transfer.ts`
- Create: `src/features/account/AccountPanel.tsx`
- Create: `src/features/account/DeleteAccountModal.tsx`
- Create: `src/features/account/PrivacyPage.tsx`
- Modify: `src/app/routes.tsx` (`/gizlilik`)
- Modify: `src/features/settings/SettingsPage.tsx`
- Modify: `src/features/onboarding/Onboarding.tsx` (hoş geldin/transfer)
- Test: `src/db/transfer.test.ts`
- Test: `src/features/account/account.test.tsx`

**Interfaces:**
- Produces:
  - `hasLegacyData(): Promise<boolean>`
  - `transferLegacyData(userId: string, onProgress?: (done:number,total:number)=>void): Promise<TransferSummary>`
  - `AccountPanel`: görünen ad, e-posta salt okunur, şifre değiştir, çıkış, veri indir, hesap sil, gizlilik linki.
  - `/gizlilik` sayfası.

- [ ] **Step 1: Testleri yaz**

`transfer.test.ts`:
- Legacy DB'de kitap/konu/deneme varken taşıma kopyalar; ID'ler korunur; eski DB silinmez.
- Taşıma iki kez çalıştırılabilir; duplicate oluşmaz.
- Cloud dolu senaryosu: taşıma önerilmez; kullanıcı bilgilendirilir.
- Fotoğraflar/ekler kopyalanır; sunucuya gönderilmez.

`account.test.tsx`:
- Görünen ad güncelle; e-posta input disabled.
- Şifre değiştir; hata/başarı.
- Veri indir: JSON blob indirilir.
- Hesap sil: şifre ister; onay sonrası logout.
- Gizlilik sayfası metni görünür.

- [ ] **Step 2: Kırmızıyı gör**

Run: `npm run test:run -- src/db/transfer.test.ts src/features/account/account.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Taşıma ve paneli yaz**

- `hasLegacyData`: legacy `kocluk` DB'yi aç; `subjects`/`books`/`exams`/`notes`/`photos` sayıları; anlamlı eşik.
- `transferLegacyData`: legacy tabloları oku; aktif user DB'ye `bulkPut`; kimlikleri koru; eksik müfredatı `seedKey` ile ekle; queue'ya düşen hook'lar; fotoğraflar/ekler de kopyalanır; özet.
- `AccountPanel`: `useAuth`; `api`; `getActiveDb`; `SyncStatus`; `ConfirmModal`.
- `PrivacyPage`: veri kategorileri, amaç, saklama, Natro, haklar, iletişim, fotoğrafların cihazda kaldığı.
- Onboarding: kayıt sonrası transfer seçeneği; "Boş başla" eski DB'yi silmez.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm run test:run -- src/db/transfer.test.ts src/features/account/account.test.tsx`; sonra tüm testler.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/transfer.ts src/features/account src/app/routes.tsx src/features/settings/SettingsPage.tsx src/features/onboarding/Onboarding.tsx src/db/transfer.test.ts src/features/account
git commit -m "feat(account): add legacy transfer, account panel and privacy page"
```

---

### Task 15: Mock API, local preview ve E2E

**Files:**
- Create: `scripts/mock-api.mjs`
- Create: `scripts/mock-api-data.json` (gitignore)
- Modify: `vite.config.ts` (dev proxy `/api` → `http://localhost:8787`)
- Modify: `package.json` (`mock:api` script)
- Create: `e2e/auth-sync.spec.ts` (veya mevcut Playwright yapısına ekle)
- Modify: `playwright.config.ts` (webServer mock + vite)
- Test: `src/features/auth/auth.test.tsx` (mock API ile)
- Test: `e2e/auth-sync.spec.ts`

**Interfaces:**
- Produces:
  - `npm run mock:api` → `http://localhost:8787`; auth/sync endpoint'leri; JSON dosyasında kalıcı.
  - `npm run dev` + mock API ile local preview.
  - Playwright: kayıt → giriş → kitap ekle → senkron → ikinci context.

- [ ] **Step 1: Mock API testlerini/ senaryosunu yaz**

Mock API: `/api/health`, `/api/auth/register|login|logout|session`, `/api/auth/forgot-password`, `/api/sync/push|pull|status|full`, `/api/account/export`. Cookie `kocluk_session`; CSRF; in-memory + JSON persistence; hata formatı aynı.

E2E:
- Kayıt ol, onboarding'i geç, kitap ekle.
- İkinci browser context aynı hesapla giriş; kitap görünür.
- Çevrimdışıyken tikle; online olunca senkron.
- Çıkış/giriş; veri kalıcı.

- [ ] **Step 2: Kırmızıyı gör**

Run: `npm run test:run -- src/features/auth`; `npx playwright test e2e/auth-sync.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Mock API ve preview'ı yaz**

- Node `http` server; JSON body; cookie parse; `crypto.randomUUID`; basit token; CORS yok (aynı origin proxy).
- Vite proxy: `server.proxy['/api'] = 'http://localhost:8787'`.
- `package.json`: `"mock:api": "node scripts/mock-api.mjs"`.
- Playwright `webServer`: mock API + `npm run dev`; veya `npm run build` + `vite preview`.
- README'ye local preview adımları: iki terminal `npm run mock:api`, `npm run dev`; `http://localhost:5173`.

- [ ] **Step 4: Local preview göster**

Run: `npm run mock:api` (background), `npm run dev`; kullanıcıya URL ve test hesabı ver.
Expected: Kullanıcı auth ekranlarını, onboarding'i, kitap ekleme ve senkron göstergesini görür. **Canlıya deploy yok.**

- [ ] **Step 5: Commit**

```bash
git add scripts/mock-api.mjs vite.config.ts package.json playwright.config.ts e2e
git commit -m "test: add mock API and local preview flow"
```

---

### Task 16: Staging, yedekleme, dağıtım dokümanı ve güvenlik incelemesi

**Files:**
- Modify: `.cpanel.yml`
- Create: `api/config.example.php` (gerçek değerler yok)
- Create: `api/bin/backup.php`
- Create: `docs/STAGING.md`
- Create: `docs/SECURITY-CHECKLIST.md`
- Modify: `README.md`
- Create: `.github/workflows/ci.yml` (Task 1'de var; gerekirse genişlet)
- Test: `api/tests/Integration/BackupTest.php` (mümkünse)
- Test: `docs/SECURITY-CHECKLIST.md` manuel

**Interfaces:**
- Produces:
  - `.cpanel.yml`: `dist` + `api` kopyalama; config'e dokunmaz.
  - `php api/bin/backup.php`: `mysqldump` varsa; yoksa PDO dump; gzip; `public_html` dışı.
  - Staging adımları; canlı deploy kapısı.

- [ ] **Step 1: Staging ve yedek planını yaz**

`docs/STAGING.md`:
- cPanel → Subdomains: `staging` → `/home/u2964068/staging`.
- MySQL: `u2964068_staging` + kullanıcı; `utf8mb4`.
- `staging` branch; `.cpanel.yml` `DEPLOYPATH=/home/u2964068/staging/`.
- Config: `/home/u2964068/kocluk-staging-config.php`.
- Migration: `php api/bin/migrate.php`.
- Test hesapları; gerçek veri yok.
- Canlıya geçiş: yalnızca kullanıcı onayı + staging smoke + yedek.

`docs/SECURITY-CHECKLIST.md`:
- Kullanıcı izolasyonu, CSRF, cookie, rate limit, SQL injection, XSS, oturum iptali, secret, log, yedek, KVKK, staging verisi.

- [ ] **Step 2: `.cpanel.yml` ve backup betiğini yaz**

`.cpanel.yml`:
```yaml
deployment:
  tasks:
    - export DEPLOYPATH=/home/u2964068/public_html/
    - /bin/cp -R dist/. $DEPLOYPATH
    - mkdir -p $DEPLOYPATH/api
    - /bin/cp -R api/. $DEPLOYPATH/api/
```
`api/config.php` deploy'a dahil değil; `api/config.example.php` var.

`backup.php`: config; `exec('mysqldump ...')` denenir; `exec` kapalıysa PDO ile `SHOW TABLES`/`SHOW CREATE TABLE`/`SELECT`; `gzip`; `/home/u2964068/kocluk-backups/YYYYMMDD.sql.gz`; 14 gün temizlik. Cron 03:00.

- [ ] **Step 3: README ve güvenlik kontrolünü güncelle**

README: hesap/senkron/KVKK/yedek/staging/local preview; eski "hesap yok" ifadelerini kaldır; canlı deploy adımlarını staging sonrasına bağla. `npm run mock:api` + `npm run dev`.

- [ ] **Step 4: CI ve testleri çalıştır**

Run: `npm run typecheck`, `npm run test:run`, `npm run build`; `git push origin HEAD`, `gh run watch`.
Expected: PASS.

- [ ] **Step 5: Staging smoke (kullanıcı destekli)**

Kullanıcı cPanel'de staging subdomain/DB oluşturur; biz `staging` branch'i deploy ederiz; migration; health; kayıt/giriş/push/pull; iki cihaz; export/delete. **Canlıya dokunulmaz.**
Expected: staging çalışır; gerçek veri yok.

- [ ] **Step 6: Commit**

```bash
git add .cpanel.yml api/config.example.php api/bin/backup.php docs/STAGING.md docs/SECURITY-CHECKLIST.md README.md
git commit -m "docs: add staging, backup and security runbook"
```

- [ ] **Step 7: Canlı öncesi onay kapısı (uygulanmaz)**

Kullanıcı local preview + staging'i onaylamadan:
- `main`'e merge yok.
- cPanel canlı deploy yok.
- `dist/` canlı commit yok.

Onay sonrası ayrı bir görevle canlı deploy yapılır; bu plan canlı deploy içermez.

---

## Self-Review Notları

- Spec §6.1–6.4 tabloları Task 2'de; §7 auth Task 4–5; §8 sync Task 7–8; §9 istemci Task 9–14; §10 güvenlik Task 4, 7, 16; §11 KVKK Task 6, 14, 16; §12 yedek Task 16; §13 dağıtım Task 16; §14 test her task; §15 yol haritası task sırası.
- Deterministik kimlikler Task 2/9/9b/9c/12; `seedCurriculum` ve `saveExam` Task 9b'de; soft delete Task 9c'de.
- Review Focus testleri: izolasyon Task 4/7/8; CSRF/rate limit Task 4; çakışma Task 7/12; taşıma Task 14; KVKK Task 6/14/16.
