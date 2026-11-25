# Zirve Akademi — YKS Takip

YKS hazırlığı için yerel çalışan (local-first) bir takip uygulaması. Kitaplarını
sayfa bazında katalogdan rafına ekler, okuduğun sayfaları ve kitap yüzdesini takip eder;
haftalık planına ders satırları ve kitap/konu/serbest görevler koyar. TYT/AYT
denemelerini, yanlış soru fotoğraflarını, konu notlarını ve konu tamamlama durumunu
tek yerde tutar. Veriler **yalnızca kullandığın cihazın tarayıcısında** saklanır;
hesap, sunucu, analitik veya otomatik senkron yoktur.

## Gereksinimler

- **Node.js `>=22.22.2`** (22 LTS önerilir)
- npm (Node ile birlikte gelir)

## Kurulum ve geliştirme

```bash
npm install
npm run dev
```

Geliştirme sunucusu uygulamayı kök adreste (`/`) açar. Üretim derlemesinin
varsayılan taban yolu da `/`'dir; GitHub Pages için `VITE_BASE=/kocluk/` ayarlanır.

## Komutlar

```bash
npm run dev        # geliştirme sunucusu
npm run mock:api   # yerel mock API (http://127.0.0.1:8787)
npm run typecheck  # TypeScript tip kontrolü
npm test           # Vitest izleme modu
npm run test:run   # Vitest tek seferlik
npm run build      # tip kontrolü + üretim derlemesi (dist/)
npm run preview    # üretim derlemesini kök adreste önizle
npm run test:e2e   # hesap/senkron E2E (mock API + Vite başlatır)
npm run test:e2e:auth   # aynı auth/sync E2E spec'i
npm run test:e2e:legacy # hesap öncesi eski spec'ler (geçici olarak kırmızı)
```

## Yerel önizleme (mock API)

Hesap ve senkron akışlarını canlı PHP/MySQL sunucusuna ihtiyaç duymadan görmek
için iki terminal kullan:

1. Terminal 1: `npm run mock:api` → `http://127.0.0.1:8787`
2. Terminal 2: `npm run dev` → `http://localhost:5173`

Vite `/api` isteklerini mock API'ye yönlendirir. Hazır demo hesap:
`deneme@kocluk.local` / `deneme1234`. Kayıt ekranından yeni hesap da
açabilirsin. Veriler `scripts/mock-api-data.json` dosyasında tutulur
(gitignore'da); temiz başlangıç için mock'u durdurup dosyayı sil, sonra yeniden
başlat. Çalışırken sıfırlamak için (PowerShell):

```powershell
Invoke-RestMethod -Method Delete http://127.0.0.1:8787/api/__test__/reset
```

Bu mock yalnızca yerel önizleme ve E2E içindir, üretim paketine girmez; gerçek
sözleşme `api/` altındaki PHP API'dir. Playwright aynı mock'u 8788/4173
portlarında, ayrı bir veri dosyasıyla başlatır:

```bash
npm run test:e2e:auth
```

`auth-sync.spec.ts` hesap, senkron, profil/şifre, export ve hesap silme
akışlarını kapsar. `backup`, `branch-exams`, `exams`, `onboarding`, `photos`,
`program`, `pwa`, `responsive` ve `tracking` spec'leri hesap öncesi dönemden
kaldı; ortak auth fixture'ı eklenene kadar `npm run test:e2e:legacy` kırmızıdır
ve merge gate değildir. Günlük/CI doğrulaması `npm run test:e2e` (auth/sync
spec'i) ile yapılır.

## Kitaplar, konu durumu ve haftalık plan

- **Kitaplar** sayfasında katalogdan kitap seçip rafına ekleyebilirsin. Her kitap
  okunan sayfa / toplam sayfa, kalan sayfa ve yüzde ilerleme ile gösterilir; toplam
  sayfa girilmemiş kitaplarda yüzde yerine **Sayfa sayısını gir** uyarısı çıkar.
  Katalog, farklı yayınevlerinden TYT Türkçe; AYT edebiyat; TYT ve AYT matematik,
  geometri, fizik, kimya, biyoloji, tarih, coğrafya, felsefe ve din kültürü
  kitaplarından oluşan 500+ kitaplık (528 kitap) bir set içerir; fasikül,
  problemler ve paragraf kitapları da bu kapsamdadır. Listede olmayan kitapları
  kendi başlık, yayınevi ve sayfa sayısıyla rafına ekleyebilirsin.
  Baskıya göre değişen sayfa sayılarını kitap detayından düzeltebilirsin.
- Kitap detayında **Başlangıç sayfası** ve **Bitiş sayfası** alanlarıyla okuduğun
  sayfa aralığını ekleyebilir, geçmişi görebilir ve plandaki kitap görevlerini
  izleyebilirsin. İlerleme, etkin okuma aralıklarının birleşimindeki benzersiz
  sayfalardan hesaplanır: 480 sayfalık kitapta 250–255 girmek 6 sayfa sayar.
  Aynı veya örtüşen aralıklar çift sayılmaz.
- **Ders Çalışma Çizelgesi** sayfasında haftalık plan tarihli olarak tutulur. Haftalar
  arasında geçiş yapabilir, satır ekleyebilir ve her hücreye kitap sayfası, konu
  tekrarı veya serbest görev ekleyebilirsin. Kitap görevinde rafındaki kitaplar
  arasında kitap veya yayınevi adıyla arama yapabilirsin. Değişiklikler kısa bir
  gecikmeyle otomatik kaydedilir; haftanın notu da aynı şekilde saklanır.
- Plan görevini tiklemek kitap görevinde okuma kaydını oluşturur ve kitap
  ilerlemesini otomatik günceller. Tiki geri almak kaydı geri alır, böylece ilerleme
  çift sayılmaz. Konu görevi tiklenince tekrar geçmişine kayıt eklenir; konunun
  **Bitti** durumu ayrıca konu sayfasındaki **Durum** sekmesinden işaretlenir.
- **Genel Bakış** sayfası bugünün planını ve kitap ilerlemesini bir arada gösterir.
  Eski test kayıtları ve eski serbest metin çizelgesi salt okunur olarak korunur.

**Ders ilerlemesi** elle işaretlediğin konu tamamlamaları ile kitap ilerlemenden
tahmini olarak hesaplanır. Her kitabın sayfaları dersin konularına mümkün olduğunca
eşit bölünür; her konu yalnızca kendi sayfa diliminde okunan oran kadar, tek bir
kitaptan en fazla %50 katkı alır. Böylece kısmi okumada konular sırayla dolmaz ve
son sayfada toplu sıçrama olmaz: 416 sayfalık kitabın 415 sayfası okunduğunda 21
konulu ders %49'da kalır, son sayfa okunduğunda %50 olur. İki biten kitap konuları
%100 yapar. Bu tahmin ders kartında ve ders sayfasında **Kitap tahmini** olarak
görünür. Konu sayfasından elle **Bitti** işaretlenen konu her zaman %100 kalır ve
kitap tahmini bunu düşürmez. Arşivlenen kitaplar ile toplam sayfası girilmemiş
kitaplar bu tahmine katılmaz; TYT ve AYT ayrı dersler olarak değerlendirilir.

PWA ikonlarını `public/favicon.svg` kaynağından yeniden üretmek için:

```bash
npx pwa-assets-generator
```

Playwright ilk kullanımda Chromium'u indirmen gerekir:

```bash
npx playwright install chromium
```

## Yayınlama (cPanel / zirveacademy.com)

Üretim adresi:

```
https://zirveacademy.com/
```

Yayın cPanel **Git Version Control** ile bu depodan yapılır. Depodaki `.cpanel.yml`
dosyası derlenmiş `dist/` klasörünü `/home/u2964068/public_html/` altına kopyalar;
alan adının belge kökü farklıysa `.cpanel.yml` içindeki `DEPLOYPATH` değerini
güncelle. Sunucuda Node.js gerekmez, çünkü çıktı depoda hazır durur.

### İlk cPanel kurulumu

1. cPanel → **Git Version Control** → **Create** ile bu depoyu (GitHub URL'si,
   `main` dalı) ekle.
2. Depoyu oluşturduktan sonra **Update from Remote** ile kodu çek.
3. **Deploy HEAD Commit** düğmesine bas; `.cpanel.yml` `dist/` içeriğini belge
   köküne kopyalar.
4. cPanel'de alan adının belge kökünü kontrol et; farklıysa `.cpanel.yml`
   içindeki `DEPLOYPATH` değerini düzeltip yeniden deploy et.

### Her yayında

1. `npm run build`
2. `git add dist && git commit -m "build: refresh dist"`
3. Değişiklikleri GitHub'a push et.
4. cPanel → Git Version Control → **Update from Remote** → **Deploy HEAD Commit**.

`dist/` depoya commit edilir; cPanel yalnızca kopyalama yapar. `.gitattributes`
sayesinde `dist/` dosyaları checkout sırasında satır sonu dönüşümüne uğramaz.

GitHub Pages desteği isteğe bağlı/eski yol olarak korunur: `.github/workflows/deploy.yml`
iş akışı derleme adımında `VITE_BASE=/kocluk/` kullanır, yani Pages yayını eski
`/kocluk/` taban yolunda çalışmaya devam eder.

Uygulama `HashRouter` kullandığı için alt sayfalar (`#/tyt`, `#/denemeler` gibi)
sunucuda 404 üretmez. Aynı statik `dist/` çıktısı Cloudflare Pages veya Netlify'a
da taşınabilir; yalnızca taban yolunu ortama göre ayarlaman gerekir.

## Arkadaşlarınla paylaşma

Yayınlanan bağlantıyı (`https://zirveacademy.com/`) göndermen yeterli.
Herkes uygulamayı kendi cihazında, kendi verisiyle kullanır. Ayarlar → **Uygulama
linkini paylaş** düğmesi cihazın paylaşım menüsünü veya panoyu kullanır.

İlk açılış internet gerektirir; uygulama bir kez yüklendikten sonra çevrimdışı
açılır. Her cihazın verisi ayrıdır: telefonundaki veriler bilgisayarında otomatik
görünmez.

## Kurulum (PWA)

- **iPhone / iPad (Safari):** Paylaş → **Ana Ekrana Ekle** → **Ekle**.
- **Android (Chrome):** Menü → **Uygulamayı yükle** veya **Ana ekrana ekle**.
- **Bilgisayar (Chrome / Edge):** Adres çubuğundaki kurulum simgesi → **Yükle**.
  Edge'de **Uygulamalar → Bu siteyi uygulama olarak yükle** de kullanılabilir.

Kurulumdan sonra uygulama tam ekran açılır. Yeni bir sürüm yayınlandığında
uygulama içinde **“Yeni sürüm hazır”** bildirimi çıkar; hazır olduğunda **Yenile**
ile güncelleyebilirsin.

## Yedekleme uyarısı

Veriler tarayıcı deposunda (IndexedDB) tutulur. Tarayıcı verilerini temizlersen,
cihaz değiştirirsen veya iOS depolamayı boşaltırsa veriler kaybolabilir.
**Ayarlar → Yedekleme → Yedek indir** ile zip yedeği al ve düzenli olarak
güncelle. Yedek dosyası sayfa bazlı kitapları ve okuma kayıtlarını, haftalık planı
ve görevleri, konu durumlarını, denemeleri, notları, fotoğrafları ve ekleri; ayrıca
salt okunur eski test ve çizelge kayıtlarını içerir. Geri yükleme mevcut verilerin
tamamını değiştirir; birleştirme yapmaz.

## Gizlilik

- Hesap, bulut, reklam ve analitik yoktur.
- Hiçbir veri cihazdan dışarı gönderilmez; tüm okuma/yazma IndexedDB üzerindedir.
- Fotoğraflar ve ekler yalnızca yerel veritabanında saklanır.
- Depo yalnızca kodu içerir; örnek veya kişisel veri commit edilmez.

## Sonraki aşama

Hesap açma ve cihazlar arası bulut senkronizasyonu planlanan sonraki aşamadır. Bu
sürümde bulunmaz; uygulama hesap istemez, veri göndermez ve cihazlar arasında
otomatik eşitleme yapmaz.

## Teknolojiler

React 19, TypeScript, Vite, Tailwind CSS, Dexie (IndexedDB), TipTap, Chart.js,
JSZip ve `vite-plugin-pwa`. Testler Vitest + React Testing Library ve Playwright
ile yazılmıştır.
