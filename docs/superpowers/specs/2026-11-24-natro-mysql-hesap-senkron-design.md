# Natro MariaDB + PHP API ile Hesaplar ve Cihazlar Arası Senkron — Tasarım

- Tarih: 2026-11-24
- Durum: Onay bekliyor
- Kapsam: Hesap sistemi + yapısal verilerin cihazlar arası senkronu
- Önceki tasarım: `docs/superpowers/specs/2026-11-22-kitap-sayfa-takibi-ve-supabase-senkron-design.md`

Bu doküman, 22 Kasım 2026 tarihli ürün tasarımının kitap, plan, konu ve
onboarding akışlarını korur. Supabase'e bağlı backend bölümlerini (hesap
sağlayıcı, veritabanı, RLS, senkron uçları, yayınlama) Natro üzerindeki
MariaDB + PHP API ile değiştirir. Çelişki varsa bu doküman geçerlidir.

## 1. Özet

Uygulama hesap tabanlı oluyor. Herkes kendi hesabıyla giriş yapıyor; yapısal
verisi (kitaplar, plan, konular, denemeler, notlar) Natro'daki MariaDB'de
kullanıcıya özel tutuluyor ve cihazları arasında senkronlanıyor. Veriler önce
cihazdaki IndexedDB'ye yazılıyor; internet gelince PHP API'ye gönderiliyor.
Fotoğraflar ve ekler bu sürümde cihazda kalıyor.

Backend, Natro cPanel hesabında PHP 8.4 ile çalışan küçük bir JSON API'dir.
Ayrı bir sunucu, Docker veya yönetilen servis yoktur. Kimlik doğrulama,
oturum, şifre sıfırlama ve senkron uçları bu API'de yazılır.

## 2. Neden bu yol

- Natro hesabında **MariaDB 10.6.27** ve **PHP 8.4.28** var; ikisi de bu iş
  için yeterli. `utf8mb4`, JSON, generated column ve transaction destekleniyor.
- Veri Türkiye'de (Natro İstanbul) kalıyor. Supabase'teki gibi yurt dışı
  aktarım ve KVKK standart sözleşmesi (SS-2) imza/bildirim yükü yok.
- Alan adı, SSL, cPanel, e-posta ve yedekleme altyapısı zaten mevcut; ek
  servis ücreti yok.
- Supabase'in teknik avantajı (hazır auth, RLS) bu ölçek için yeterli değil;
  asıl sorun SS-2'yi imzalayacak muhatap bulmak. Bu yüzden Supabase seçilmedi.
- MySQL 5.0 endişesi geçersiz: ekranda görünen sürüm MariaDB 10.6.27. Yine de
  her tablo `utf8mb4` ile açılacak; sunucunun varsayılan `latin1` karakter
  grubu kullanılmayacak.

### Değerlendirilen alternatifler

- **Supabase (Frankfurt):** En az kod ve hazır auth; ancak yurt dışı aktarım
  nedeniyle SS-2 + KVKK bildirimi gerekir, Supabase'in Türkçe sözleşmeyi
  imzalaması belirsizdir. Reddedildi.
- **SQLite (PHP dosyası):** MySQL sürümü kötü olsaydı iyi bir yedek yoldu;
  MariaDB 10.6 sağlıklı olduğu için gereksiz. Reddedildi.
- **Natro VPS + PocketBase:** Hazır auth ve yurt içi veri; aylık VPS, sunucu
  bakımı ve ayrı dağıtım getirir. Bu ölçek için gereksiz. Reddedildi.
- **Natro MariaDB + PHP API (seçildi):** Mevcut hostingde kalır, veri yurt
  içinde kalır, aylık maliyet yoktur. Bedeli: auth ve API'yi dikkatli yazmak,
  yedekleme ve güvenlik sorumluluğunu üstlenmek.

## 3. Kapsam

### Hedefler

- E-posta + şifre ile kayıt, giriş, çıkış; oturumun çevrimdışı korunması.
- Şifre sıfırlama; isteğe bağlı e-posta doğrulama; davet koduyla kapalı beta.
- Kullanıcı verisinin diğer kullanıcılardan izole edilmesi.
- Kitaplar, plan, konular, denemeler, notlar ve hesap ayarlarının cihazlar
  arası senkronu; çevrimdışı yazma ve sonra gönderme.
- Mevcut yerel `kocluk` verisinin hesaba tek seferlik, kayıpsız taşınması.
- Günlük otomatik veritabanı yedeği ve geri yükleme denenmiş olması.
- KVKK aydınlatma metni, açık rıza kaydı, veri indirme ve hesap silme.

### Hedef olmayanlar

- Fotoğraf, ek ve çizelge dosyalarının buluta yüklenmesi.
- Koç/öğrenci rolleri, paylaşım, sosyal özellikler.
- Gerçek zamanlı (websocket) senkron; periyodik çekme yeterli.
- Uygulama içinden ortak katalog düzenleme/moderasyon.
- Mobil uygulama, push bildirim, analitik.
- Supabase veya başka bir yurt dışı servise veri aktarımı.
- E-posta adresi değiştirme. Bu sürümde e-posta giriş kimliğidir ve
  değiştirilmez; görünen ad düzenlenebilir. E-posta değişikliği ileride ayrı
  bir doğrulama akışıyla eklenir.

### Anti-hedefler

- Bir kullanıcının diğerinin verisini görmesi veya değiştirmesi.
- Şifrenin düz metin, log veya istemcide görünmesi.
- Senkron hatasının veri kaybı gibi görünmesi.
- Yedek alınmadan şema değiştirmek veya hesap silmek.
- Her yazmada sunucuya gitmeyi zorunlu kılıp çevrimdışı deneyimi bozmak.

## 4. Altyapı gerçekleri

| Konu | Değer | Not |
|---|---|---|
| Sunucu | Natro cPanel, LiteSpeed, İstanbul | Tek lokasyon, coğrafi yedeklilik yok |
| PHP | 8.4.28 | `mysqli`, `curl`, `mbstring` görünüyor; PDO MySQL doğrulanacak |
| Veritabanı | MariaDB 10.6.27 | InnoDB, `utf8mb4`, JSON, generated column |
| Bağlantı | MySQL kullanıcısı başına 25 eşzamanlı | Batch senkronla yönetilebilir |
| DB boyutu | Tek DB 5 GB, toplam 10 GB | Metin verisi için fazlasıyla yeterli |
| Cron | En sık 15 dakikada bir | Yedek/temizlik için; gerçek zamanlı senkron değil |
| Yedek | Klasik pakette otomatik yok | Günlük `mysqldump` + sunucu dışı kopya şart |
| E-posta | Saatte 100, tek seferde 50 alıcı | Şifre sıfırlama için yeterli; SPF/DKIM test edilecek |
| Karakter seti | Sunucu varsayılanı latin1 | Her bağlantıda `utf8mb4` açıkça ayarlanacak |

Uygulama kodu `public_html/api/` altında, veritabanı aynı hesabın MariaDB
sunucusunda olacak. Yapılandırma ve yedekler `public_html` dışında tutulacak.

## 5. Mimari

```
Tarayıcı (React PWA)
  ├─ Dexie: kocluk-u-<userId>  (kullanıcıya özel yerel DB)
  ├─ syncQueue / syncMeta
  └─ fetch('/api/...')  ── HTTPS ──►  public_html/api/index.php
                                         ├─ Auth (oturum, şifre, e-posta)
                                         ├─ Sync (push / pull / full)
                                         └─ MariaDB (InnoDB, utf8mb4)
```

- Statik site değişmeden cPanel'den yayınlanır; API aynı alan adının `/api`
  yolunda çalışır. Ayrı origin/CORS yoktur.
- API çerçevesiz PHP'dir: front controller, küçük sınıflar, PDO (yoksa
  mysqli), JSON. Composer sunucuda gerekmez; PHPMailer depoya vendor edilir.
- Tüm yanıtlar JSON; hata gövdesi `{ "error": { "code", "message" } }`.
- Oturumlar HttpOnly çerez + sunucudaki `sessions` tablosuyla yönetilir.
  JWT kullanılmaz; iptal ve şifre değişince oturum kapatma daha kolaydır.

## 6. Veritabanı şeması

Tüm tablolar InnoDB, `utf8mb4_unicode_ci`. Her bağlantıda:

```sql
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';
```

Kimlikler istemcide üretilen UUID (`CHAR(36)`). Zamanlar UTC `DATETIME(6)`.
Silme yumuşaktır (`deleted_at`); listeler ve hesaplar silinmiş satırları yok
sayar. Her senkron satırında `server_updated_at DATETIME(6)` bulunur.

### 6.1 Kimlik ve oturum tabloları

| Tablo | Alanlar | Kısıt |
|---|---|---|
| `users` | id, email, password_hash, display_name, email_verified_at?, privacy_version, consented_at, created_at, updated_at, deleted_at? | unique(email) |
| `sessions` | id (token hash), user_id, csrf_token, expires_at, created_at, last_seen_at, revoked_at?, ip, user_agent | index(user_id, expires_at) |
| `password_resets` | id (token hash), user_id, expires_at, used_at?, created_at | index(user_id) |
| `email_verifications` | id (token hash), user_id, expires_at, used_at?, created_at | index(user_id) |
| `rate_limits` | id, bucket, ip?, created_at | index(bucket, created_at), index(ip, created_at) |
| `schema_migrations` | version, applied_at | pk(version) |

### 6.2 Senkron tabloları

| Tablo | Anahtar alanlar | Not |
|---|---|---|
| `subjects` | id, user_id, seed_key, exam, name, slug, icon, sort_order, updated_at, deleted_at? | unique(user_id, active_seed_key) |
| `topics` | id, user_id, seed_key?, subject_id, name, sort_order, is_custom, created_at, updated_at, deleted_at? | unique(user_id, active_seed_key) |
| `exams` | id, user_id, type, name, date, alan, kind, branch, note, created_at, updated_at, deleted_at? | |
| `exam_results` | id, user_id, exam_id, subject_id, correct, wrong, blank, net, updated_at, deleted_at? | unique(user_id, active_result_key) |
| `notes` | user_id, topic_id, content_html, plain_text, updated_at, deleted_at? | pk(user_id, topic_id) |
| `catalog_books` | id, owner_id, title, publisher, exam, subject_slug, total_pages, edition, created_at, updated_at, deleted_at? | Yalnızca kullanıcının özel kitapları |
| `user_books` | id, user_id, book_id, total_pages_override?, note?, status, started_at?, created_at, updated_at, deleted_at? | unique(user_id, active_book_id) |
| `activity_logs` | id, user_id, type, user_book_id?, topic_id?, from_page?, to_page?, task_id?, source, created_at, deleted_at? | unique(user_id, active_task_id) |
| `schedule_weeks` | id, user_id, week_start, note, created_at, updated_at, deleted_at? | unique(user_id, active_week_start) |
| `schedule_rows` | id, user_id, week_id, subject_id?, label, sort_order, created_at, updated_at, deleted_at? | |
| `schedule_tasks` | id, user_id, week_id, row_id, day_index, type, user_book_id?, from_page?, to_page?, topic_id?, title?, completed_at?, created_at, updated_at, deleted_at? | index(user_id, week_id, day_index) |
| `topic_progress` | id, user_id, topic_id, done, done_at?, updated_at, deleted_at? | unique(user_id, active_topic_id) |
| `user_settings` | user_id, data JSON, updated_at | pk(user_id) |

Senkron tablolarında birincil anahtar `(user_id, id)` bileşimidir; `notes`
`(user_id, topic_id)`, `user_settings` `user_id`. `id` tek başına global
benzersiz değildir: deterministik kimlikler farklı kullanıcılarda aynı olabilir.
Her senkron tablosunda `server_updated_at DATETIME(6)` ve
`index(user_id, server_updated_at)` bulunur. Bu alan sunucunun satırı teslim
aldığı zamanı tutar; çakışma kararında kullanılmaz (bkz. 8.2).

Ortak kitap kataloğu sunucuya yüklenmez; uygulama paketindeki deterministik
kimliklerle yerelde tutulur. `catalog_books` yalnızca kullanıcının eklediği
özel kitapları taşır; birincil anahtarı `(owner_id, id)`'dir.
`user_books.book_id` bu iki kaynaktan birine işaret eder.

### 6.3 Silme ve benzersizlik

MariaDB partial index desteklemez. Silinmiş satırların yeni satırı
engellememesi için generated column + unique index kullanılır:

```sql
active_book_id CHAR(36) AS (IF(deleted_at IS NULL, book_id, NULL)) PERSISTENT,
UNIQUE KEY uq_user_book (user_id, active_book_id)
```

Aynı desen: `activity_logs.active_task_id`, `schedule_weeks.active_week_start`,
`topic_progress.active_topic_id`, `subjects.active_seed_key`,
`topics.active_seed_key`, `exam_results.active_result_key`
(`CONCAT(exam_id, ':', subject_id)`).

### 6.4 Senkron değişiklik günlüğü

`sync_changes` (sunucuya özel, istemciye inmez):

| Alan | Not |
|---|---|
| id | BIGINT AUTO_INCREMENT, pk |
| user_id | index(user_id, id) |
| table_name | API tablo anahtarı (`userBooks` gibi) |
| row_id | Satırın kimliği; `notes` için topic_id, `settings` için user_id |
| op | `upsert` / `delete` (hata ayıklama için) |
| changed_at | DATETIME(6) |

Her yazma işlemiyle aynı transaction içinde bir satır eklenir. İstemci
`lastChangeId` imlecini tutar; çekme bu imleçten ileri gider. 90 günden eski
günlük satırları cron ile silinir; daha eski imleci olan istemci tam çekme
yapar. Bu yöntem zaman damgası çakışması ve sayfalama sorununu ortadan
kaldırır.

### 6.5 Deterministik kimlikler ve doğal anahtar çakışması

Aynı doğal anahtarın iki cihazda iki farklı `id` ile oluşmasını engellemek
için şu satırlar deterministik UUIDv5 kullanır (`src/lib/deterministicId.ts`):

| Satır | Anahtar | Not |
|---|---|---|
| `subjects` | `seedKey` | Yeni tohumlar; mevcut aktarılan satırlar kimliğini korur |
| `topics` | `seedKey` | Yeni tohumlar; `subjectId` deterministik subject'e bağlanır |
| `userBooks` | `bookId` | Mevcut `USER_BOOK_NAMESPACE` + `LOCAL_SCOPE` |
| `scheduleWeeks` | `weekStart` | Mevcut `WEEK_NAMESPACE` + `LOCAL_SCOPE` |
| `topicProgress` | `topicId` | Mevcut `TOPIC_PROGRESS_NAMESPACE` + `LOCAL_SCOPE` |
| `examResults` | `examId + subjectId` | Yeni `EXAM_RESULT_NAMESPACE`; mevcut satır varsa onun kimliği korunur |
| Hafta kopyası satır/görev | `targetWeekId + sourceId` | Mevcut `COPY_NAMESPACE` |
| `notes` | `userId + topicId` | Sunucuda bileşik anahtar |
| `settings` | `userId` | Sunucuda tek satır |

Yeni sabit UUIDv5 namespace'leri `src/lib/namespaces.ts`'e eklenir:
`SUBJECT_NAMESPACE`, `TOPIC_NAMESPACE`, `EXAM_RESULT_NAMESPACE`. Mevcut
namespace'ler ve `LOCAL_SCOPE` değişmez; onlar diskteki kimliklerin parçasıdır.

- `seedCurriculum` artık `newId()` değil deterministik kimlik üretir; böylece
  iki cihaz aynı müfredat satırını aynı kimlikle oluşturur.
- `saveExam` sonuçları silip yeniden eklemez. Var olan sonucu `subjectId` ile
  bulur, kimliğini korur; yeni konu için deterministik kimlik üretir; kaldırılan
  konuyu `deletedAt` ile işaretler. Böylece sonuç kimlikleri cihazlar arasında
  değişmez.
- Mevcut yerel veri taşınırken kimlikler korunur. Sunucuda aynı doğal anahtar
  farklı bir `id` altında varsa push `conflict` ve kanonik sunucu satırını
  döner; istemci `rekeyRow` ile yerel kimliği ve referansları günceller:
  `topics.subjectId`, `notes.topicId`, `topicProgress.topicId`,
  `activityLogs.topicId`, `scheduleTasks.topicId`, `activityLogs.userBookId`,
  `scheduleTasks.userBookId`, `scheduleRows.weekId`, `scheduleTasks.weekId` ve
  ayarlardaki `hiddenSubjects`.
- Yeniden anahtarlama başarısız olursa satır kuyrukta `dead` işaretlenir ve
  Ayarlar → Senkron'da "Gönderilemeyen kayıt" olarak gösterilir; kuyruk
  tıkanmaz.
- Sunucu, doğal anahtar çakışmasını `error` değil `conflict` olarak döner;
  HTTP durumu 200'dür, hata satır bazındadır.

## 7. Kimlik doğrulama

### 7.1 Uçlar

| Uç | Gövde | Davranış |
|---|---|---|
| `POST /api/auth/register` | email, password, displayName, inviteCode?, privacyAccepted | Kullanıcı + oturum; çerez |
| `POST /api/auth/login` | email, password | Oturum; yalnızca bu tarayıcıdaki eski oturum iptal |
| `POST /api/auth/logout` | — | Oturumu iptal; çerezi sil |
| `POST /api/auth/update-profile` | displayName | Görünen adı güncelle; e-posta değişmez |
| `GET /api/auth/session` | — | Kullanıcı + CSRF token; yoksa 401 |
| `POST /api/auth/forgot-password` | email | Her durumda 202; varsa e-posta |
| `POST /api/auth/reset-password` | token, password | Şifreyi değiştir; tüm oturumları iptal et |
| `POST /api/auth/change-password` | currentPassword, newPassword | Diğer oturumları iptal et |
| `POST /api/auth/delete-account` | password | Kullanıcı verisini sil; çerezi temizle |
| `GET /api/account/export` | — | Kullanıcının senkron verisini JSON indir |

### 7.2 Şifre ve oturum

- `password_hash($password, PASSWORD_DEFAULT)` (bcrypt; PHP 8.4 varsayılan
  maliyet) ve `password_verify`. Girişte `password_needs_rehash` varsa yenile.
  Argon2id mevcutsa kullanılabilir; bcrypt yeterli ve taşınabilir.
- Şifre en az 8, en fazla 200 karakter; baştaki/sondaki boşluk kırpılmaz.
- Oturum tokenı 32 rastgele bayt; çerezde token, veritabanında SHA-256 özeti.
- Çerez: üretimde `__Host-kocluk_session`; `HttpOnly; Secure; SameSite=Lax;
  Path=/`. Geliştirmede Secure olmayan `kocluk_session`.
- Kayan süre 30 gün, mutlak üst sınır 90 gün. `last_seen_at` en fazla 5
  dakikada bir güncellenir.
- Giriş, yalnızca o tarayıcıdaki önceki oturumu iptal eder; aynı kullanıcının
  diğer cihazlardaki oturumları korunur. Çoklu cihaz senkronu bunu gerektirir.
- Şifre değişimi, işlemi yapan oturum dışındaki tüm oturumları iptal eder;
  işlemi yapan oturum yeniden üretilir. Şifre sıfırlama oturum gerektirmediği
  için tüm oturumları iptal eder. "Tüm cihazlardan çık" isterse kullanıcı tüm
  oturumları iptal edebilir.
- CSRF: oturum açmış yazma isteklerinde `X-CSRF-Token`; oturum yokken
  `Origin` başlığı `https://zirveacademy.com` ile karşılaştırılır.
- Giriş/kayıt hatası genel mesajdır; e-posta varlığı sızdırılmaz (kayıt
  sırasında "bu e-posta kayıtlı" istisnası kabul edilir).

### 7.3 Hız sınırları

`rate_limits` tablosu; pencere dolunca 429 ve `Retry-After`.

| İşlem | Sınır |
|---|---|
| Giriş | 10 / 15 dk / IP+e-posta |
| Kayıt | 5 / saat / IP |
| Şifre sıfırlama | 3 / saat / e-posta, 10 / saat / IP |
| Senkron | 120 / saat / kullanıcı |
| Genel API | 300 / saat / IP |

### 7.4 E-posta

- Natro SMTP (cPanel → E-posta Hesapları → Bağlantı bilgileri) ve PHPMailer.
- `no-reply@zirveacademy.com`; SPF ve DKIM doğrulanır; test Gmail/Outlook.
- Şifre sıfırlama bağlantısı: `https://zirveacademy.com/#/sifre-sifirla?token=...`
  (token URL fragment'ında; sunucuya Referer ile gitmez). 30 dakika geçerli,
  tek kullanım.
- E-posta doğrulama bağlantısı benzer; doğrulama zorunlu değilse uygulama
  içinde hatırlatma gösterilir.
- Gönderim hatası kullanıcıya "e-posta gönderilemedi" olarak döner; token
  yine oluşturulmaz veya iptal edilir.

### 7.5 Davet kodu

`config.php` içinde `REGISTRATION_INVITE_CODE` doluysa kayıt bu kodu ister;
`hash_equals` ile karşılaştırılır. Kapalı beta için varsayılan açıktır; kodu
yalnızca arkadaşlarla paylaş. Boşsa kayıt herkese açıktır (istenmeyen durum).

## 8. Senkron API'si

### 8.1 Tablo eşlemesi

| API anahtarı | MariaDB tablosu | Satır kimliği |
|---|---|---|
| `subjects` | `subjects` | id |
| `topics` | `topics` | id |
| `exams` | `exams` | id |
| `examResults` | `exam_results` | id |
| `notes` | `notes` | topicId |
| `catalogBooks` | `catalog_books` | id (yalnızca owner_id = kullanıcı) |
| `userBooks` | `user_books` | id |
| `activityLogs` | `activity_logs` | id |
| `scheduleWeeks` | `schedule_weeks` | id |
| `scheduleRows` | `schedule_rows` | id |
| `scheduleTasks` | `schedule_tasks` | id |
| `topicProgress` | `topic_progress` | id |
| `settings` | `user_settings` | userId |

İstemci camelCase, sunucu snake_case kullanır; dönüşüm API katmanındadır.
Bilinmeyen tablo/alan reddedilir. `user_id`/`owner_id` istemciden asla
alınmaz; oturumdaki kullanıcı yazılır.

### 8.2 Gönderme

`POST /api/sync/push`

```json
{
  "deviceId": "uuid",
  "changes": [
    { "table": "scheduleTasks", "op": "upsert", "row": { "id": "...", "updatedAt": "..." } },
    { "table": "notes", "op": "delete", "rowId": "topic-id", "updatedAt": "..." }
  ]
}
```

- En fazla 100 değişiklik, gövde en fazla 1 MB.
- Her satır ayrı transaction'da işlenir; sonuç satır bazında döner:
  `applied`, `conflict` (sunucu satırıyla), `error`.
- Son yazan kazanır: gelen `updatedAt` sunucudaki `updated_at`'ten büyükse
  uygulanır; değilse sunucu satırı döner. Eşitlikte sunucu kazanır.
- LWW otoritesi istemcinin `updatedAt` değeridir; `server_updated_at` yalnızca
  sunucunun teslim zamanıdır (denetim/debug). Sunucu, `NOW(6) + 5 dakika`dan
  ileri bir `updatedAt` gelirse değeri o sınıra çeker ve `timeAdjusted: true`
  döner. Geçmiş tarihler kabul edilir; istemci sunucu saatiyle 5 dakikadan
  fazla fark görürse "Cihaz saatinizi düzeltin" uyarısı gösterir. Böylece
  saati ileri bir cihaz çakışmaları kalıcı olarak kazanamaz.
- Hatalar satır bazında `error.code` ile döner: `validation_failed`,
  `unknown_table`, `forbidden`, `invalid_timestamp`, `payload_too_large`,
  `rate_limited`. Doğal anahtar çakışması `conflict` olarak döner.
- `activityLogs` ekleme-only'dir; aynı `taskId` için aktif kayıt varsa mevcut
  kayıt döner. Silme `deleted_at` işaretidir; bu tabloda istemci `updatedAt`
  göndermezse sunucu zamanı kullanılır.
- `applied` sonucunda da sunucunun son satırı `row` alanında döner; istemci
  yerel satırı bununla eşitler (özellikle `updatedAt`). Böylece sunucunun saat
  düzeltmesi ve varsayılanları istemciye yansır.
- Başarılı her yazma `sync_changes`'a bir satır ekler.
- `settings` için `row`, `getSettings()` çıktısının hesap düzeyi alanlarıdır;
  cihaz ayarları (vurgu rengi, çizelge modu) gönderilmez.

### 8.3 Çekme

`GET /api/sync/pull?since=<lastChangeId>&limit=500`

```json
{
  "changes": [
    { "table": "userBooks", "row": { "id": "...", "deletedAt": null } }
  ],
  "nextCursor": 12345,
  "hasMore": false
}
```

- Değişiklikler `sync_changes.id` sırasıyla gelir; aynı satır birden çok kez
  gelirse son hali uygulanır.
- Silinmiş satırlar `deletedAt` dolu olarak gelir; istemci tombstone'u saklar.
- `since` çok eskiyse (günlük temizlendi) `410 cursor_expired` döner; istemci
  `GET /api/sync/full` ile tam çekme yapar.
- `GET /api/sync/full` tüm senkron tablolarını ve `cursor` değerini döner.
  Yanıt boyutu 20 MB'ı aşarsa istek reddedilir; bu ölçekte beklenmez.
- İstemci, kuyruğunda bekleyen satırı gelen sunucu satırıyla ezmez; gönderim
  sonrası sunucu değeri uygulanır.

### 8.4 Çakışma ve tutarlılık

- Doğal anahtarlı satırlar (`subjects`, `topics`, `userBooks`,
  `scheduleWeeks`, `topicProgress`, `examResults`, hafta kopyası) deterministik
  UUID kullanır; iki cihaz aynı satırı üretir (bkz. 6.5).
- `notes` anahtarı `(userId, topicId)`; `settings` anahtarı `userId`.
- Görev tamamlandıysa ve aktif aktivite yoksa, çekme sonrası istemci görev
  alanlarından aktivite oluşturur. Görev tamamlanmadıysa ve aktif aktivite
  varsa aktivite silinmiş işaretlenir.
- Silme yarışı: `deleted_at` dolu satır, daha yeni `updated_at` ile gelen
  güncellemeyi kabul etmez; sunucu tombstone'u döner.

### 8.5 Durum ve tam çekme

`GET /api/sync/status`

```json
{
  "hasData": true,
  "counts": { "userBooks": 3, "scheduleTasks": 42, "notes": 12 },
  "cursor": 12345,
  "serverTime": "2026-11-24T12:00:00.000000Z"
}
```

- `hasData`, `subjects`, `topics`, `exams`, `examResults`, `notes`,
  `catalogBooks`, `userBooks`, `activityLogs`, `scheduleWeeks`, `scheduleRows`,
  `scheduleTasks`, `topicProgress` tablolarından herhangi birinde satır varsa
  `true`'dur. Yalnızca `user_settings` satırı varsa hesap "boş" sayılır; böylece
  onboarding ayarları veri taşıma kapısını kapatmaz.
- `cursor`, hesabın son `sync_changes` kimliğidir; tam çekme sonrası istemciye
  başlangıç imleci olarak verilir.
- Taşıma ekranı bu uca bakar; `hasData: false` ve eski yerel veri varsa taşıma
  önerilir.
- `GET /api/sync/full`: tüm senkron tablolarını, `cursor` ve `serverTime`
  döner. 20 MB sınırı; üstünde `payload_too_large`. Yetim/yetkisiz satır yoktur;
  yalnızca oturumdaki kullanıcının satırları gelir.
- İki uç da oturum ve hız sınırı ister; `status` 60/saat, `full` 5/saat.

## 9. İstemci entegrasyonu

### 9.1 Yeni modüller

- `src/lib/api.ts`: fetch sarmalayıcı; `credentials: 'same-origin'`, CSRF,
  JSON hata çözümleme, 401 yönlendirmesi.
- `src/app/AuthProvider.tsx`: oturum durumu, giriş/kayıt/çıkış, çevrimdışı
  ipucu (`localStorage`: userId, email, displayName).
- `src/features/auth/`: giriş, kayıt, şifre sıfırlama, e-posta doğrulama.
- `src/db/dbManager.ts`: aktif `KoclukDB` örneği; `open(userId)`, `close()`,
  `getActiveDb()`. Veritabanı adı `kocluk-u-<userId>`.
- `src/db/db.ts`: mevcut `db` import'larını koruyan bir **proxy** yayınlar;
  proxy aktif DB örneğine delege eder. Böylece 40+ dosyada import değişmez.
- `src/db/sync/`: kuyruk, push, pull, tam çekme, durum, tetikleyiciler.
- `src/features/account/`: hesap ayarları (görünen ad düzenlenir; e-posta
  salt okunur), veri indirme, hesap silme, gizlilik.

### 9.2 Yerel veritabanı geçişi

- `KoclukDB` yapıcısı veritabanı adı alır. `db` proxy'si aktif örneğe delege
  eder; mevcut repository ve test import'ları korunur. `dbManager` aktif
  örneği açar/kapatır, yeni kod `getActiveDb()` kullanır.
- Kullanıcı değişince AppShell `key={userId}` ile remount edilir; Dexie live
  query'leri yeni veritabanına bağlanır. Eski DB kapatılmadan yenisi açılmaz.
- Dexie v7: `syncQueue` (`id, table, rowId, op, createdAt, updatedAt,
  attempts, status, lastError`) ve `syncMeta` (`key, value`) eklenir; mevcut
  tablolar değişmez.
- `syncQueue` kimliği `${table}:${rowId}`; aynı satır için tek kayıt; yeni
  yazma önceki kaydı günceller. `status` `pending` veya `dead` olur.
- Kalıcı hata politikası: 4xx doğrulama/izin hatası alan satır hemen `dead`
  işaretlenir; ağ/5xx hatalarında 5 denemeye kadar geri çekilir. `dead` satırlar
  kuyruğu tıkamaz; Ayarlar → Senkron'da "Gönderilemeyen kayıtlar" altında
  gösterilir, "Tekrar dene" veya "Yerel kaydı sil" seçeneği sunulur. Kalıcı
  hata sessizce yutulmaz.
- Dexie hook'ları (`creating`, `updating`, `deleting`) senkron tablolarında
  `updatedAt` yoksa şimdiki zamanı yazar ve kuyruğa ekler. Çekme sırasında
  `applyingRemote` bayrağı hook'ların tekrar kuyruğa yazmasını engeller.
- `settings` için tek kuyruk kaydı; gönderimde hesap düzeyi ayarlar bütün
  olarak yazılır.
- Fotoğraflar, ekler, pratik oturumları, çizelge dosyaları ve eski tablolar
  kuyruğa girmez.

### 9.3 İlk açılış ve veri taşıma

1. Oturum doğrulanır; kullanıcı DB'si açılır.
2. `GET /api/sync/status` ile hesabın verisi olup olmadığı öğrenilir.
3. Eski `kocluk` veritabanında anlamlı veri varsa ve hesap boşsa taşıma
   ekranı: "Hesabıma aktar", "Yedek indir", "Boş başla".
4. Taşıma kopyalar; eski DB silinmez; kimlikler korunur; eksik müfredat
   `seedKey` ile tamamlanır; sonra kuyruk yüklenir. İşlem idempotenttir.
5. Hesap dolu ve eski yerel veri varsa otomatik birleştirme yapılmaz; bilgi
   verilir, yedek indirilebilir.
6. Boş hesapta müfredat deterministik kimliklerle tohumlanır, kuyruğa girer,
   ilk senkron yüklenir. `saveExam` sonuç kimliklerini korur; yeni sonuçlar
   deterministik üretilir.
7. Taşıma yarıda kalırsa tekrar denenebilir; eski veri sağlam kalır.

### 9.4 Çevrimdışı ve oturum

- Açılışta `localStorage` ipucu varsa kullanıcı DB'si açılır; uygulama
  çevrimdışı çalışır. İnternet varsa `/api/auth/session` ile doğrulanır.
- 401 gelirse giriş ekranı gösterilir; yerel veri silinmez.
- Çıkışta bekleyen kuyruk varsa uyarılır; yerel DB silinmez.
- Başka hesapla girişte o hesabın DB'si açılır; önceki hesabın fotoğrafları
  cihazda kalır.

### 9.5 Senkron tetikleyicileri ve durum

- Açılış, `online` olayı, sekme görünürlüğü, yazmadan ~2 sn sonra (debounce),
  5 dakikada bir, "Şimdi senkronize et".
- Durumlar: `synced`, `syncing`, `pending`, `offline`, `error`.
- Üst çubukta küçük gösterge; Ayarlar → Hesap'ta son senkron, bekleyen kayıt
  sayısı, ölü kayıt sayısı, hata mesajı ve elle tetikleme.
- Sunucu saatiyle 5 dakikadan fazla fark varsa "Cihaz saatinizi düzeltin"
  uyarısı; saat farkı LWW sonucunu etkileyebilir.
- API istekleri service worker tarafından önbelleğe alınmaz (`NetworkOnly`).

## 10. Güvenlik

- Her sorgu `user_id = :userId` ile sınırlanır; istemciden gelen kullanıcı
  kimliği kullanılmaz. Yetki testleri iki kullanıcıyla yazılır.
- PDO prepared statement; tablo/kolon beyaz listesi; bilinmeyen alan reddi.
- XSS: React kaçışı + notlarda DOMPurify; API HTML döndürmez.
- CSRF: SameSite=Lax + `Origin` kontrolü + `X-CSRF-Token`.
- Oturum çerezi HttpOnly; token yalnızca sunucuda özet olarak.
- Hız sınırları; giriş denemeleri; genel hata mesajları.
- `display_errors=0`, hata logu `public_html` dışında; şifre/token loglanmaz.
- Güvenlik başlıkları: HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
- Yapılandırma (`config.php`) `public_html` dışında, izin 600; repoya girmez.
- API dizinlerinde `src/`, `bin/`, `migrations/`, `tests/`, `vendor/` web
  erişimine kapalı; yalnızca `index.php` çalışır.
- PHPMailer sürümü takip edilir; sunucuda Composer gerekmez.
- Veritabanı kullanıcısı yalnızca uygulama DB'sinde yetkili; gereksiz
  `GRANT` verilmez.

## 11. KVKK ve gizlilik

- Veri Türkiye'de kalır; yurt dışı aktarım ve SS-2 yoktur.
- Kayıt sırasında aydınlatma metni ve açık rıza onayı; `privacy_version` ve
  `consented_at` kaydedilir.
- Aydınlatma metni: veri kategorileri, amaç, saklama süresi, alıcılar
  (Natro hosting), haklar, iletişim. Fotoğrafların yalnızca cihazda kaldığı
  açıkça yazılır.
- Hesap silme: kullanıcı satırları ve oturumları silinir; yedekler en fazla
  14 gün içinde döner. Veri indirme JSON olarak sunulur.
- İhlal durumunda 72 saat içinde KVKK bildirimi için iletişim ve adımlar
  yazılıdır.
- 18 yaş altı kullanıcılar için veli onayı gerekebilir; davet koduyla kapalı
  beta bu riski azaltır. Kesin metin için hukuki danışmanlık önerilir.
- Analitik, reklam, üçüncü taraf izleme yoktur.

## 12. Yedekleme

- Günlük 03:00 cron: `mysqldump --single-transaction --quick --routines
  --triggers --default-character-set=utf8mb4` + gzip.
- 14 günlük saklama; haftalık kopya ayrı klasörde; aylık olarak bilgisayara
  indirilir. Yedekler `public_html` dışında, izin 700.
- `mysqldump` çalışmazsa PHP tabanlı döküm betiği (SHOW TABLES / SHOW CREATE
  TABLE / SELECT) aynı cron'dan çalışır.
- Geri yükleme staging'de denenir; README'de adımlar yazılır.
- Uygulama içi zip yedeği (v6) korunur; sunucu yedeği onun yerine geçmez.
- Yedek dosyaları şifrelenir veya yalnızca güvenli kanaldan taşınır.

## 13. Yayınlama ve ortamlar

### 13.1 Depo düzeni

```
api/
  index.php          # front controller
  .htaccess          # /api yönlendirme + dizin koruması
  src/               # bootstrap, db, auth, sync, mail, validate
  bin/migrate.php    # CLI migration
  migrations/*.sql
  tests/             # PHPUnit (CI)
  vendor/            # PHPMailer (commit edilir)
docs/
```

### 13.2 cPanel

- `.cpanel.yml` hem `dist/` hem `api/` klasörünü `public_html` altına kopyalar.
- `config.php` sunucuda `/home/u2964068/kocluk-config.php` olarak durur;
  repoda `api/config.example.php` bulunur, gerçek değerler commit edilmez.
- İlk kurulum: DB + kullanıcı oluştur, `utf8mb4` seç, migration çalıştır,
  cron yedek ekle, SSL/HTTPS doğrula, SPF/DKIM ayarla.
- Migration: `php api/bin/migrate.php` (cPanel cron veya geçici URL token'ı);
  `schema_migrations` ile tekrar çalıştırma güvenli.
- Staging: `staging.zirveacademy.com` + ayrı DB + ayrı config; gerçek auth ve
  senkron testleri orada yapılır. Canlıya ancak staging testinden sonra.
- GitHub Actions: typecheck, Vitest, build, `php -l`, PHPUnit (MariaDB 10.6
  servisi). cPanel dağıtımı elle yapılır.
- README'de hesap/senkron/gizlilik bölümleri güncellenir; "hesap yok" ifadeleri
  kaldırılır.

## 14. Test stratejisi

### PHP

- Birim: e-posta/şifre doğrulama, UUID, LWW karşılaştırma, tablo eşlemesi,
  token üretimi/özeti, hız sınırı sayacı.
- Entegrasyon (MariaDB test DB): kayıt, giriş, oturum, çıkış, şifre sıfırlama,
  davet kodu, hesap silme, push/pull, çakışma, tombstone, cursor_expired,
  iki kullanıcının birbirinin verisini görememesi.
- Güvenlik: SQL injection denemeleri, CSRF'siz yazma, 401/403, hız sınırı,
  oturum iptali, şifre değişince eski oturumun geçersizliği.

### Frontend

- API istemcisi: hata/401/CSRF; auth provider; çevrimdışı ipucu.
- `dbManager`: kullanıcı DB'si açma/kapama, hesap değiştirme.
- Kuyruk: tek kayıt, coalesce, debounce, hata/tekrar, çekmede bekleme.
- Taşıma: eski DB kopyalama, idempotentlik, bulut dolu senaryosu.
- Mevcut Vitest ve Playwright testleri auth kapısına göre güncellenir.
- E2E: iki tarayıcı bağlamı aynı hesap; birinde tikle, diğerinde görünür
  (mock API); çevrimdışı tikle → online → senkron.
- Staging smoke: gerçek API ile kayıt/giriş/push/pull; CI dışında elle.

## 15. Yol haritası

1. **Altyapı:** DB, kullanıcı, config, migration, staging, CI iskeleti.
2. **Auth API:** kayıt/giriş/oturum/çıkış, şifre sıfırlama, hız sınırı,
   e-posta, PHPUnit kapsamı.
3. **Senkron API:** şema, tablo eşlemesi, push/pull/full, change log,
   kullanıcı izolasyonu testleri.
4. **İstemci:** `dbManager`, `AuthProvider`, giriş/kayıt ekranları, kuyruk,
   push/pull, durum göstergesi.
5. **Taşıma ve hesap:** eski veri taşıma, hesap ayarları, veri indirme,
   hesap silme, gizlilik metni.
6. **Sağlamlaştırma:** yedek/geri yükleme, E2E, staging, README, canlıya
   geçiş.

Bu bir proje; parça parça birkaç hafta sürer. Her aşama staging'de
doğrulanmadan canlıya alınmaz.

## 16. Riskler

| Risk | Önlem |
|---|---|
| Kendi auth kodunda açık | Küçük yüzey, prepared statement, testler, gözden geçirme |
| Paylaşımlı hostingde otomatik yedek yok | Günlük cron + sunucu dışı kopya + geri yükleme testi |
| 25 eşzamanlı MySQL bağlantısı | Batch push/pull, kısa transaction, 5 dk çekme |
| E-posta spam'e düşmesi | SPF/DKIM, test, gerekirse harici SMTP |
| Senkron çakışması | Change log, LWW, tombstone, deterministik kimlikler, birim testleri |
| Doğal anahtar başka `id` ile çakışması | `conflict` + kanonik satır; istemci `rekeyRow`; testler |
| Gönderilemeyen satır kuyruğu tıkaması | `dead` durumu, 5 deneme, Ayarlar'da görünürlük |
| Taşımada veri kaybı | Önce yedek, kopyala-silme yok, idempotent, eski DB korunur |
| Yapılandırma/secret sızıntısı | `public_html` dışı config, `.gitignore`, log temizliği |
| 18 yaş altı KVKK riski | Davet kodu, veli onayı metni, hukuki danışmanlık |
| MariaDB 10.6'nın güncel kalmaması | Natro güncellemeleri izlenir; MariaDB 10.11+ hedefi |
| Staging/canlı karışması | Ayrı DB/config; deploy kontrol listesi |

## 17. Builder'a bırakılan kararlar

- Davet kodunun varsayılan açık olması; kodun paylaşım yöntemi.
- E-posta doğrulamanın zorunlu olup olmaması (öneri: zorunlu değil, hatırlatma).
- Oturum süreleri (30/90 gün) ve "beni hatırla" davranışı.
- Şifre sıfırlama ve doğrulama e-posta metinleri.
- Hesap silmede bekleme süresi (öneri: anında silme; yedekler 14 gün).
- Yedek saklama (14 gün) ve aylık indirme hatırlatması.
- Senkron aralığı (5 dk) ve debounce (2 sn).
- Ayarların hangi alanlarının hesap, hangilerinin cihaz düzeyinde olduğu.
- Sync göstergesinin üst çubukta mı, yalnızca Ayarlar'da mı olacağı.
- PHP tarafında PDO/mysqli seçimi (PDO varsa PDO).
- Katalogun yalnızca özel kitaplarının sunucuya yüklenmesi.
- PHPUnit'in CI'da çalışması; sunucuda Composer gerekmemesi.

## 18. Onay

Bu doküman onaylandığında uygulama planı yazılır; plan aşamaları ve testleri
sıraya koyar. Onaydan önce üretim kodu yazılmaz.
