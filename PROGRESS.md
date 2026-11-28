# Zirve Akademi — Proje Durumu, Kurallar ve Oturum Hafızası

> **Son güncelleme:** 2026-11-28
> **Amaç:** Yeni bir oturum/agent, projeyi sıfırdan öğrenmeden kaldığı yerden devam edebilsin.
> **Öncelik:** Bu dosya ile `README.md` veya `docs/*` çelişirse **bu dosyadaki güncel durum esas alınır**.
> **Sır kuralı:** DB/e-posta şifresi, davet kodu, oturum tokenı bu dosyaya yazılmaz.

---

## 1. Tek cümle

`zirveacademy.com` üzerinde çalışan, YKS öğrencileri için kitap/konu/deneme/plan takibi yapan, hesaplı ve telefon–bilgisayar arasında senkronize olan Türkçe bir PWA.

Şu an **10 kişilik davet kodlu kapalı beta** canlıda. Yeni özellikler doğrudan canlıda test ediliyor; ayrı staging yok.

---

## 2. Canlı durum (özet)

| Alan | Durum |
|---|---|
| Canlı adres | `https://zirveacademy.com` |
| Hosting | Natro cPanel, kullanıcı `u2964068` |
| Sunucu | LiteSpeed, PHP 8.4.28, MariaDB 10.6.27 |
| Veritabanı | `u2964068_db385` |
| DB kullanıcısı | `u2964068_kocluk` |
| Config | `/home/u2964068/kocluk-config.php` (public_html **dışında**, izin 600) |
| API log | `/home/u2964068/kocluk-api-error.log` |
| Yedek dizini | `/home/u2964068/kocluk-backups/` |
| SMTP | `mail.kurumsaleposta.com`, port `465`, SSL |
| Gönderen | `no-reply@zirveacademy.com` |
| API health | **200** — `{"ok":true,...,"environment":"production"}` |
| Migration | 006 bekliyor; 004/005'in canlıda uygulandığı doğrulanmadı (yalnızca istemci build'i doğrulandı) |
| Son canlı commit | `2fd9775` |
| Son canlı build | `index-BQQehRpI.js` |
| GitHub Pages | Otomatik deploy **kapalı** (`workflow_dispatch`); canlı cPanel'den |
| Ana dal | `main`, çalışma ağacı temiz |
| Beta | Canlı kapalı beta; 10 kişiye açılım kullanıcının kontrolünde |
| Aktif çalışma | `feat/preview-pdf-touch` — plan önizleme, test PDF ve dokunmatik düzenleme; canlıya deploy edilmedi; PHPUnit CI + merge/deploy onayı bekliyor |

> Build hash'i her deploy'da değişir. Canlı sürümü doğrulamak için
> `https://zirveacademy.com/` HTML'indeki `assets/index-*.js` ile yerel
> `dist/index.html` içindeki hash'i karşılaştır.

### Son doğrulama (2026-11-28)

- `npm run typecheck` ✅
- Vitest: **77 dosya / 907 test** ✅
- `npm run build` ✅ (yalnızca mevcut 500 kB chunk boyutu uyarısı)
- Playwright: **28/28** ✅ (özel sayfa dağılımı, PDF indirme ve dokunmatik düzenleme dahil tam E2E)
- Canlı kontrol: ana sayfa 200; canlı istemci build'i `index-BQQehRpI.js`, yerel `main` build'iyle aynı (sayfa zinciri istemcide canlı); API/migration 004/005 doğrulanmadı
- PHPUnit: yerelde PHP yok; CI `api` işi push sonrası yeşil olmalı (son bilinen canlı öncesi: 270 test / 3239 assertion)
- `npm audit --audit-level=high`: yüksek/kritik yok; 4 moderate yalnızca build/dev zincirinde (`glob`/`minimatch` → `vite-plugin-pwa`)

---

## 3. Ürün kapsamı

- **Kitaplar:** 528 kitaplık katalog + kendi kitabını ekleme; sayfa aralığına göre okuma ilerlemesi; örtüşen aralıklar çift sayılmaz.
- **Konular:** TYT/AYT ders ve konuları; konu durumu, tekrar geçmişi, kitap okumasından tahmini ilerleme.
- **Denemeler:** TYT/AYT deneme sonuçları, net trend grafiği, ders bazlı analiz.
- **Haftalık plan:** Tarihli haftalar, satır/hücreler, kitap sayfası / konu tekrarı / serbest görev; otomatik kayıt.
- **Notlar:** Zengin metin notları, konuya bağlama, fotoğraflar (fotoğraflar yalnızca cihazda).
- **Genel Bakış:** Bugünün planı, kitap ilerlemesi, deneme trendi.
- **Hesap:** Kayıt (davet kodlu), giriş/çıkış, şifre sıfırlama, e-posta doğrulama (isteğe bağlı), görünen ad.
- **Senkron:** Push/pull/status/full; çevrimdışı kuyruk, dead-letter, iki cihaz arası eşitleme.
- **KVKK:** Aydınlatma metni + rıza, veri indirme (JSON), hesap silme, 18 yaş altı veli izni notu.
- **PWA:** Ana ekrana ekleme, çevrimdışı açılış, sürüm güncelleme bildirimi.
- **Yedek:** Uygulama içi cihaz yedeği + sunucuda günlük DB yedeği.

---

## 4. Değişmez kurallar

1. **Veri Türkiye'de kalır.** Supabase veya yurt dışı veri servisi kullanılmaz; Natro MariaDB kullanılır.
2. **Sırlar repoya girmez.** Gerçek config yalnızca `/home/u2964068/kocluk-config.php`; repo içinde `api/config.example.php` olur.
3. **Config `public_html` dışında ve izin 600.** Config'e cPanel giriş şifresi değil, **MySQL kullanıcı şifresi** yazılır.
4. **`dist/` commit edilmeden deploy edilmez.** Sunucuda Node.js yoktur; cPanel yalnızca kopyalar.
5. **Her yayın öncesi:** typecheck + Vitest + build + ilgili E2E yeşil olmalı.
6. **Canlıya çıkmadan önce yedek.** Riskli değişiklikte önce `api/bin/backup.php` veya cPanel yedeği alınır.
7. **GitHub Pages otomatik deploy kapalı kalır.** Canlı çıkış yalnızca cPanel → Git → Deploy HEAD Commit.
8. **Davet kodu yalnızca yeni kayıt kapısıdır.** Girişi, mevcut hesapları veya senkronu etkilemez; değiştirmek eski hesapları bozmaz.
9. **Alt ajanlar yalnızca `opencode-go/deepseek-v4.1-flash#max` kullanır.**
10. **Kullanıcıya basit ve adım adım anlatılır.** Kullanıcı lise öğrencisi; teknik jargon açıklanmadan bırakılmaz.
11. **Yıkıcı işlem öncesi onay.** Hesap silme, DB temizleme, force-push, migration sıfırlama kullanıcı onayı olmadan yapılmaz.
12. **Bu dosya güncel tutulur.** Her anlamlı oturum sonunda "Oturum Kayıtları" bölümüne kısa kayıt eklenir.

---

## 5. Mimari

### Frontend

- React 19 + TypeScript + Vite 8.
- Tailwind CSS 4, lucide-react ikonları.
- `HashRouter` (alt sayfalar sunucuda 404 vermez).
- Dexie / IndexedDB: her kullanıcı için ayrı DB (`kocluk-u-<userId>`); eski `kocluk` DB'si salt okunur taşıma kaynağı.
- Zustand, zod, date-fns, chart.js, Tiptap, DOMPurify, JSZip, file-saver.
- PWA: `vite-plugin-pwa`, `registerType: 'prompt'`, Workbox precache.

### Backend (`api/`)

- Framework yok; PHP 8.4 + PDO + JSON.
- `api/index.php` front controller; `.htaccess` tüm `/api/*` isteklerini buraya yönlendirir.
- `api/src/App.php` rotaları ve guard'ları tanımlar.
- Kimlik: sunucu taraflı oturum; çerez `__Host-kocluk_session`, `HttpOnly`, `Secure`, `SameSite=Lax`; kayan 30 gün, mutlak 90 gün.
- CSRF: oturumlu yazmalarda `X-CSRF-Token`; oturumsuz yazmalarda `Origin` kontrolü.
- Rate limit: genel 300/saat/IP (`/api/health` muaf), push/pull 120/saat, status 60/saat, full 5/saat.
- Log: `display_errors=0`; ayrıntılar public_html dışındaki log dosyasına.

### Senkron

- Uçlar: `POST /api/sync/push`, `GET /api/sync/pull`, `GET /api/sync/status`, `GET /api/sync/full`.
- İlk açılış: **pull → push** (yerel varsayılanlar sunucudaki gerçek ayarları ezmesin).
- Sonraki: **push → pull → status**.
- Deterministik ID, soft delete, değişiklik günlüğü + cursor, last-writer-wins.
- Tetikleyiciler: uygulama açılışı, `online`, sekme görünürlüğü, yazıdan 2 sn sonra, 5 dakikada bir.
- Başarısız satır 5 denemeye kadar bekler; kalıcı hata "Gönderilemeyen kayıt" olur.
- 410 cursor_expired → tam snapshot (`/full`) ile kurtarma.

### Auth / KVKK

- Şifreler bcrypt; oturum tokenı DB'de yalnızca SHA-256 özeti.
- Şifre değişince diğer oturumlar, şifre sıfırlamada tüm oturumlar iptal.
- Kayıtta aydınlatma onayı zorunlu; `privacy_version` ve onay zamanı saklanır.
- Veri indirme ve hesap silme Ayarlar → Hesap'tan çalışır.
- Fotoğraflar sunucuya yüklenmez; yalnızca cihazda.
- Beta için ağır hukukçu/VERBIS süreci yok; temel aydınlatma/rıza/silme/indirme yeterli kabul edildi. Uygulama herkese açılırsa hukukçuya danışılacak.

### Yedek

- `api/bin/backup.php`: günlük DB yedeği, `kocluk-backups/`, 14 gün saklama.
- `api/bin/maintenance.php`: 90 gün change-log, 24 saat rate-limit, süresi dolmuş token/oturum temizliği.
- `api/bin/migrate.php`: idempotent migration; **tek seferlik**, sürekli cron değil.
- Uygulama içi yedek: JSON/ZIP dışa aktarma ve geri yükleme.

---

## 6. Önemli dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `src/app/AuthProvider.tsx` | Oturum durumu, çevrimdışı ipucu |
| `src/app/SyncProvider.tsx` | Senkron zamanlayıcıları, ilk senkron kapısı |
| `src/db/sync/engine.ts` | Push → pull → status akışı, hata sınıflandırma, backoff |
| `src/db/sync/push.ts` | Kuyruk → API push; eski satır `updatedAt` tamamlama |
| `src/db/sync/pull.ts` | Cursor sayfalama, 410 → full |
| `src/db/sync/queue.ts` | Kuyruk, dead-letter, onboarding/settings önceliği |
| `src/lib/api.ts` | Same-origin JSON istemcisi, hata kodları |
| `src/features/sync/SyncStatus.tsx` | Senkron paneli ve göstergesi |
| `src/features/auth/*` | Kayıt, giriş, şifre sıfırlama, doğrulama |
| `api/src/App.php` | API rotaları, guard, rate limit |
| `api/src/Sync/SyncService.php` | Sunucu tarafı push/pull/status/full |
| `api/src/Auth/*` | Kayıt, giriş, oturum, şifre sıfırlama |
| `api/src/Support/ConfigFile.php` | Config yolu ve staging tespiti |
| `api/config.example.php` | Config örneği; gerçek değer içermez |
| `api/bin/migrate.php` | Migration CLI |
| `api/bin/backup.php` | Günlük yedek |
| `api/bin/maintenance.php` | Veri temizliği |
| `.cpanel.yml` | `dist/` + `api/` deploy kuralları |
| `docs/LIVE-BETA.md` | Canlı beta kurulum runbook'u |
| `docs/SECURITY-CHECKLIST.md` | Güvenlik/KVKK kontrol listesi (tarihsel) |
| `docs/ROLLBACK.md` | Eski canlı sürüme dönüş örneği (tarihsel) |
| `docs/STAGING.md` | Subdomain staging kurulumu (şu an kullanılmıyor) |

---

## 7. Komutlar

### Yerel geliştirme

```bash
npm install
npm run mock:api      # http://127.0.0.1:8787
npm run dev           # http://localhost:5173 (doluysa 5174)
```

Mock demo hesap: `deneme@kocluk.local` / `deneme1234`.

### Test ve derleme

```bash
npm run typecheck
npm run test:run        # Vitest, tek sefer
npm run test:e2e        # Tüm Playwright
npm run test:e2e:auth   # Auth/sync E2E
npm run build           # dist/ üretir
```

### Yayın

```bash
npm run build
git add dist
git commit -m "build: refresh dist"
git push origin main
```

Sonra cPanel → **Git Version Control** → **Update from Remote** → **Deploy HEAD Commit**.

### Sunucu kontrolleri

```bash
https://zirveacademy.com/api/health
```

Beklenen: HTTP 200 + `{"ok":true,...,"environment":"production"}`.

### Cron (cPanel)

Günlük yedek (03:00):

```bash
/usr/local/bin/php /home/u2964068/public_html/api/bin/backup.php >> /home/u2964068/kocluk-backup.log 2>&1
```

Günlük bakım (04:00):

```bash
/usr/local/bin/php /home/u2964068/public_html/api/bin/maintenance.php >> /home/u2964068/kocluk-maintenance.log 2>&1
```

Migration yalnızca gerektiğinde bir kez:

```bash
/usr/local/bin/php /home/u2964068/public_html/api/bin/migrate.php
```

---

## 8. Her değişiklikte yayın akışı

1. Gerekiyorsa `main`'den yeni branch aç.
2. Küçük ve odaklı değişiklik yap; mevcut desenlere uy.
3. Test ekle; önce testin başarısız olduğunu gör, sonra düzelt.
4. `npm run typecheck`, `npm run test:run`, ilgili E2E.
5. `npm run build`; `dist/` değişikliklerini commit et.
6. `main`'e merge/push.
7. cPanel → **Update from Remote** → **Deploy HEAD Commit**.
8. `https://zirveacademy.com/api/health` + canlı build hash'ini doğrula.
9. Kullanıcıya ne değiştiğini kısa ve net anlat.
10. Bu dosyaya oturum kaydı ekle.

**Geri dönüş:** Sorun olursa cPanel'den önceki commit'i deploy et. DB değiştiyse önce yedek al; gerekirse yedeği geri yükle. `docs/ROLLBACK.md` genel yöntemi anlatır ama tarihseldir.

---

## 9. Tamamlananlar

### Hesap, oturum, KVKK

- Kayıt/giriş/çıkış, davet kodu, şifre sıfırlama, e-posta doğrulama.
- Sunucu taraflı oturum, CSRF, Origin kontrolü, rate limit.
- Aydınlatma metni + rıza, veri indirme, hesap silme, 18 yaş altı veli izni notu.
- Hesap paneli, şifre değiştirme, görünen ad.

### Senkron

- Push/pull/status/full, per-user Dexie, deterministik ID, soft delete.
- İlk açılışta pull → push; onboarding ayarlarının sunucudan gelmesi.
- Çevrimdışı kuyruk, yeniden deneme, dead-letter, manuel tekrar/atma.
- Eski yerel veriyi hesaba taşıma; kimlikleri koruma.
- İki cihaz senkronu ve çevrimdışı→çevrimiçi akışı E2E ile test edildi.
- Tablo seti büyüyünce (`syncTableVersion`) tek seferlik `full` backfill; eski istemci cursor’ı yeni tabloyu kaçırmaz.

### Haftalık plan — sayfa zinciri (2026-11-26, `feat/page-chain`)

- Aynı satırda 2–7 gün seç, tek kitap + başlangıç/bitiş sayfası; aralık `chunkCount` ile bitişik parçalara bölünür.
- Kırmızı çarpı veya geçmiş gün otomatik “Yapılmadı” bekleyen aralıkları sağa kaydırır; yapılan/kaçırılan aralıklar sabit kalır.
- Taşan aralık “Planlanmamış sayfalar” uyarısı + “Sonraki boş güne ekle”; hafta dolarsa uyarı.
- Planlanmamış aralık **Sil** ile yok sayılır (`skippedChunks`); görevler/plan silinmez, cihazlar arasında senkron olur.
- Ayrı `schedulePageChains` senkron tablosu; `schedule_tasks` şeması değişmedi; eski istemciler görevleri normal kullanır.
- Plan açılışında reconcile; gece/gün değişiminde visibility ile tekrar.
- Panel, zincir rozeti, düzenle/sil uyarısı, erişilebilir etiketler.
- Migration `004_page_chain.sql`, TableMap, mock API, yedek şeması v7.
- Testler: 856 Vitest, 24 Playwright; PHPUnit CI bekliyor.

### Plan önizleme, test PDF ve dokunmatik düzenleme (2026-11-28, `feat/preview-pdf-touch`)

- **Sayfa zinciri özel dağılımı:** Önizleme dengeli dağılım önerir (kalan ilk günlere birer birer); günlük sayfa adetleri elle düzenlenebilir, son gün toplamdan hesaplanır. Yeni `SchedulePageChain.chunkSizes` alanı saklanır; alanı olmayan eski zincirler mevcut `floor + son gün` formülüyle aynen çalışır.
- **Sunucu/migration:** `schedule_page_chains` tablosuna nullable `chunk_sizes TEXT NULL` (`006_page_chain_chunk_sizes.sql`). TableMap’de opsiyonel; `preserveWhenNull` sayesinde eski istemcinin push’u mevcut dağılımı silmez.
- **Test PDF:** Rastgele test A4 yatay PDF olarak indirilir; iki soru bir sayfada (sol/sağ), numaralı, sonda cevap anahtarı. `jspdf` yalnızca indirmede dinamik yüklenir; gömülü Roboto TTF Türkçe karakterleri taşır. Fotoğraflar cihazda kalır; font ve jsPDF PWA önbelleğindedir.
- **Dokunmatik düzenleme:** Görev çipine dokunmak düzenleme modalını açar; “Görevi sil” modal içindedir. Dokunmatikte satır çöpü görünür; masaüstünde çip tıklaması, Enter/Space ve tick modu korunur. DB şeması ve veri göçü yoktur.
- **Testler:** 907 Vitest / 77 dosya, 28 Playwright; typecheck ve build yeşil; `npm audit` yüksek/kritik yok. PHPUnit CI bekliyor.
- **Geri dönüş:** `chunk_sizes` dolu en az bir zincir varsa istemci geri alımı desteklenmez; ileriye dönük düzeltme yapılır. Deploy sırası **006 → API → istemci**. Ayrıntı ve kapı sorgusu: `docs/ROLLBACK.md`.

### Ürün

- Sayfa bazlı kitap modeli, 528 kitaplık katalog, okuma aralıkları.
- Konu durumu/tekrar geçmişi, kitap okumasından tahmini ders ilerlemesi.
- Denemeler, net trend grafiği, ders analizi.
- Haftalık plan, kitap/konu/serbest görev, otomatik kayıt.
- Notlar, fotoğraflar, genel bakış.
- PWA kurulumu, çevrimdışı açılış, güncelleme bildirimi.
- Uygulama içi yedek/geri yükleme ve sunucu yedeği.

### Canlı beta

- Natro cPanel + MariaDB kurulumu.
- Config, migration, health kontrolü.
- Canlıda kayıt → sync/status → hesap silme smoke testi.
- GitHub Pages otomatik deploy kapatıldı.
- `docs/LIVE-BETA.md` runbook'u eklendi.

---

## 10. Son düzeltmeler ve bilinen tuzaklar

| Tarih | Konu | Durum / commit |
|---|---|---|
| 2026-11-28 | Plan önizleme + test PDF + dokunmatik düzenleme | `chunkSizes`/006, jsPDF/Roboto, dokun-düzenle — `feat/preview-pdf-touch` (canlıya deploy edilmedi) |
| 2026-11-26 | Sayfa zinciri eklendi | Yeni `schedulePageChains` tablosu, panel/reconcile/backup v7 — `2fd9775` ile `main`'e merge edildi; canlı istemci build'i doğrulandı, API/migration 004/005 doğrulanmadı |
| 2026-11-26 | Yarıda kalan haftada zincir oluşturma | `createPageChain` artık oluştururken recompute eder; geçmiş günler anında kayar |
| 2026-11-26 | Eski istemci yeni tabloyu kaçırıyordu | `syncTableVersion` ile tek seferlik `full` backfill |
| 2026-11-26 | `invalid_response`: 2xx ama JSON olmayan host/WAF sayfası | Otomatik 30 sn retry + HTTP/content-type teşhisi — `4e59f99` |
| 2026-11-26 | Tarayıcı yanlış "çevrimdışı" diyor | Manuel/açılış senkronu artık gerçekten ağa çıkıyor — `4e59f99` |
| 2026-11-25 | Eski satırda `updatedAt` eksikti | Kuyruk zamanından tamamlanıyor — `53080a7` |
| 2026-11-25 | Onboarding reload sonrası geri geliyordu | `onboardingDone` tek yönlü korundu — `c35a1ad` |
| 2026-11-25 | DB config'de cPanel şifresi kullanılmıştı | MySQL kullanıcı şifresiyle düzeltildi; health 200 |
| 2026-11-25 | GitHub Pages `main` push'unda otomatik deploy ediyordu | Manuel (`workflow_dispatch`) yapıldı — `863cc4d` |
| 2026-11-25 | SMTP host yanlıştı | `mail.kurumsaleposta.com` — `d24cee0` |

### Bilinen açık tuzaklar

1. **www / http origin uyuşmazlığı:** API yalnızca `https://zirveacademy.com` origin'ini kabul eder. Arkadaş `www.zirveacademy.com` veya `http://` ile girerse kayıt `csrf_failed` / "istek doğrulanamadı" alır. Çözüm: adres çubuğuna tam `https://zirveacademy.com` yaz. Kalıcı çözüm (yapılacak): cPanel Force HTTPS + www → non-www 301 yönlendirmesi.
2. **`invalid_response`:** Araya giren host/WAF/modem/antivirüs sayfası olabilir. Yeni sürümde 30 sn sonra otomatik denenir; mesajda `HTTP 200, text/html` gibi teşhis görünür. Tekrarlarsa ekran görüntüsü + F12 Console'daki `kocluk-api: JSON olmayan yanıt` satırı alınmalı.
3. **`navigator.onLine` yanlış `false`:** VPN, uyku sonrası veya embedded tarayıcıda olabilir. "Şimdi senkronize et" artık bu durumda da dener.
4. **Davet kodu:** Yalnızca yeni kayıt kapısı. Girişe/senkrona etkisi yok. Herkese açık yerde paylaşılmamalı.
5. **Migration cron'u:** Tek seferliktir; sürekli çalışırsa log şişer. İş bitince silinmeli.
6. **`dist/` unutulması:** Kaynak commit edilip `dist/` edilmezse cPanel eski siteyi yayınlar.
7. **Config yolu:** `public_html` içine konursa dış config'i gölgeler ve güvenlik riski olur.
8. **DB şifresi karışıklığı:** cPanel giriş şifresi değil, MySQL kullanıcısının şifresi kullanılır.
9. **Sayfa zinciri + Dexie v9 rollback:** yeni istemci bir kez v9 DB açtıktan sonra eski (v8) istemciye geri dönmek `VersionError` verebilir. Canlı geri dönüşte yalnızca API/migration geri alınır; istemci yeni sürümde kalır. Ayrıntı: `docs/ROLLBACK.md`. (004 dönemi; 006 sonrası API/migration tek başına geri alınmaz — bkz. 12.)
10. **Page chain deploy sırası:** önce `api/bin/migrate.php` (004) çalışır, sonra yeni API/istemci deploy edilir. Yeni API tablo yokken tüm sync çağrılarında 500 verir.
11. **Sayfa zinciri planlanmamış aralık:** normal görevler otomatik çarpı görse de sayfa kaydırmaz; yalnızca zincir görevleri kayar.
12. **Özel dağılım geri dönüş eşiği:** `chunk_sizes` dolu tek zincir varsa eski istemci dağılımı legacy formülle yeniden yazar; istemci geri alımı desteklenmez. Kapı sorgusu `SELECT COUNT(*) FROM schedule_page_chains WHERE chunk_sizes IS NOT NULL;` — sonuç `0` değilse ileriye dönük düzeltme yapılır. Yeni istemci yayındayken API/migration tek başına geri alınmaz (yeni istemci `chunkSizes` gönderir, eski API reddeder → dead-letter). Ayrıntı: `docs/ROLLBACK.md`.
13. **006 deploy sırası:** `006_page_chain_chunk_sizes.sql` → API → istemci. Migration önce çalışmazsa yeni istemcinin `chunkSizes` push’u sunucuda bilinmeyen alan olur.

---

## 11. Açık işler

- [ ] **Günlük yedek + bakım cron'larının kurulduğunu teyit et** (03:00 / 04:00).
- [ ] Migration cron'u hâlâ duruyorsa **sil**.
- [ ] `www` → non-www ve `http` → `https` kalıcı yönlendirmesini cPanel'de aç; HSTS'i doğrula.
- [ ] "Şifremi unuttum" ile gerçek e-posta gönderimini test et (SMTP 465/SSL).
- [ ] Telefon + bilgisayar canlı senkron testini son sürümle bir kez daha yap.
- [ ] 10 kişilik beta davetini aç; geri bildirimleri topla.
- [ ] `docs/SECURITY-CHECKLIST.md` içindeki "staging yapılmadı" durumunu güncel canlı duruma göre yenile.
- [ ] İleride gerekirse `test.zirveacademy.com` subdomain staging'i kur (ek domain ücreti yok).
- [ ] API hata logunu ve yedek boyutlarını ara sıra kontrol et.
- [ ] `feat/preview-pdf-touch` için CI `api` işini (PHPUnit + MariaDB) çalıştır ve yeşil olduğunu doğrula.
- [ ] `feat/preview-pdf-touch` dalını `main`’e merge et; `dist` build; **önce migration 006, sonra API/istemci** deploy et.
- [ ] Canlıda yeni sürüm smoke testi: özel dağılımlı zincir oluştur, yenile; test PDF indir; telefonda çipe dokunup düzenle/sil.
- [ ] Dexie v9 ve özel dağılım (`chunk_sizes`) geri dönüş kurallarını (`docs/ROLLBACK.md`) yayından önce bir kez daha oku; kapı sorgusunu not et.

---

## 12. Karar geçmişi (neden böyle)

- **Supabase reddedildi:** KVKK/veri yurt dışı riski; Natro MariaDB Türkiye'de.
- **Staging atlandı:** Ucuz planda ek domain/subdomain yok; canlı kapalı beta test ortamı olarak kullanılıyor. Kullanıcı bunu açıkça onayladı.
- **10 kişi + davet kodu:** Kontrollü beta; kayıt herkese açık değil.
- **Ağır hukukçu/VERBIS süreci yok:** Bu ölçek için temel aydınlatma/rıza/silme/indirme yeterli kabul edildi; herkese açılırsa hukukçuya danışılacak.
- **PHP + MariaDB:** Natro planında mevcut; Node sunucuda gerekmiyor, `dist/` statik.
- **GitHub Pages kapalı:** Tek canlı kaynak cPanel; yanlışlıkla eski statik site yayınlanmasın.
- **Senkron modeli:** Offline-first; yerel Dexie ana kaynak, sunucu eşitleme katmanı.
- **Davet kodu yalnızca kapı:** Mevcut hesapları ve senkronu etkilemez.

---

## 13. Oturum kayıtları

### 2026-11-28 — Plan önizleme, test PDF ve dokunmatik düzenleme (`feat/preview-pdf-touch`)

- Ne yapıldı: Sayfa zinciri önizlemesine dengeli/elle düzenlenebilir günlük dağılım (`chunkSizes`), rastgele testler için iki soru/sayfa A4 yatay PDF indirme (jsPDF + Roboto) ve görev çipine dokununca açılan düzenleme/silme modalı eklendi.
- Değişen dosyalar / commit: Migration `006_page_chain_chunk_sizes.sql`, TableMap `preserveWhenNull`, sync/backup/mock parity; `practicePdf*`, `PracticePdfButton`; `TaskChip`/`ScheduleTaskModal`/`WeeklyPlanTable`. 24 önceki commit + docs commit'leri (bu düzeltmeyle toplam 26).
- Test sonucu: typecheck ✅, Vitest **77 dosya / 907 test** ✅, build ✅, Playwright **28/28** ✅, `npm audit` yüksek/kritik yok (4 moderate build/dev zinciri).
- Açık kalan: PHPUnit yerelde yok; CI `api` işi push sonrası yeşil olmalı. `main`’e merge ve deploy kullanıcı onayına bağlı; sıra **006 → API → istemci**. Canlıya deploy edilmedi.

### 2026-11-26 — Sayfa zinciri (feat/page-chain)

- Haftalık plana sayfa zinciri eklendi: seçilen günlere tek kitaptan ardışık sayfa aralıkları, kırmızı çarpı/geçmiş gün kaydırması, planlanmamış aralık uyarısı + sonraki boş güne ekleme, **Sil ile aralığı yok sayma**.
- Yeni `schedulePageChains` senkron tablosu; `schedule_tasks` değişmedi. Migration `004_page_chain.sql`, TableMap, mock API, yedek v7.
- Plan açılışında reconcile; yarıda kalan haftada oluşturmada anında recompute; eski istemci için `syncTableVersion` full backfill.
- Erişilebilir zincir rozeti, panel doğrulamaları, düzenle/sil uyarıları.
- Testler: 856 Vitest, 24 Playwright, typecheck/build yeşil; PHPUnit CI bekliyor.
- Final review “With fixes” dedi; Critical/Important fix wave + scoped re-review ile kapatıldı. Canlıya deploy edilmedi.

### 2026-11-26 — Canlı deploy doğrulama + bu dosya

- `4e59f99` canlıya deploy edildi; canlı `index-OlxWTaAn.js` yerel build ile aynı.
- Canlı smoke: `health` 200, kayıt 201, `sync/status` 200, hesap silme 200; test hesabı silindi.
- `invalid_response` için otomatik retry + teşhis; yanlış `navigator.onLine` için manuel senkron düzeltmesi.
- Testler: 798 Vitest, typecheck, build, auth-sync E2E 5/5.
- Bu `PROGRESS.md` oluşturuldu.

### 2026-11-25 — Canlı kapalı beta açılışı

- cPanel DB/config/migration tamamlandı; ilk `health` 200.
- Onboarding reload, eski `updatedAt`, DB şifresi ve SMTP host sorunları düzeltildi.
- GitHub Pages otomatik deploy kapatıldı; veli izni notu eklendi.
- Canlı kayıt/senkron/hesap silme smoke testleri geçti.

### Daha önce — Hesap + senkron geliştirmesi

- Auth/session/CSRF/rate limit, şifre sıfırlama, e-posta doğrulama.
- Push/pull/status/full, per-user Dexie, soft delete, transfer, hesap paneli.
- KVKK export/delete, mock API, E2E, backup/deploy runbook.
- Kitap/plan/deneme/not özellikleri ve PWA tamamlandı.

---

## 14. Bu dosyayı güncelleme kuralı

Her anlamlı oturum sonunda **en üste tarih**, **Oturum Kayıtları** bölümüne de kısa bir kayıt ekle:

```markdown
### YYYY-MM-DD — Kısa başlık

- Ne yapıldı:
- Değişen dosyalar / commit:
- Test sonucu:
- Açık kalan:
```

Kurallar:

- Sır yazma (şifre, token, davet kodu).
- Uzun günlük tutma; 3–6 madde yeter.
- Durum değiştiyse **2. Canlı durum** tablosunu güncelle.
- Yeni bir tuzak öğrenildiyse **10. bölüme** ekle.
- Açık iş kapandıysa **11. bölümden** işaretle.
