# Koçluk — YKS Takip

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

Geliştirme sunucusu uygulamayı kök adreste (`/`) açar. Üretim derlemesi GitHub
Pages için `/kocluk/` taban yolunu kullanır.

## Komutlar

```bash
npm run dev        # geliştirme sunucusu
npm run typecheck  # TypeScript tip kontrolü
npm test           # Vitest izleme modu
npm run test:run   # Vitest tek seferlik
npm run build      # tip kontrolü + üretim derlemesi (dist/)
npm run preview    # üretim derlemesini /kocluk/ altında önizle
npm run test:e2e   # Playwright uçtan uca testleri (derleme + preview başlatır)
```

## Kitaplar, konu durumu ve haftalık plan

- **Kitaplar** sayfasında katalogdan kitap seçip rafına ekleyebilirsin. Her kitap
  toplam sayfa, güncel sayfa, kalan sayfa ve yüzde ilerleme ile gösterilir; toplam
  sayfa girilmemiş kitaplarda yüzde yerine **Sayfa sayısını gir** uyarısı çıkar.
  Bu aşamada katalog, doğrulanmış dört başlangıç kitabı içerir; diğer kitapları
  kendi başlık, yayınevi ve sayfa sayısıyla rafına ekleyebilirsin.
- Kitap detayında **Şu anki sayfa** alanına okuduğun son sayfayı girerek ilerlemeyi
  elle kaydedebilir, geçmişi görebilir ve plandaki kitap görevlerini izleyebilirsin.
  İlerleme yalnızca etkin okuma kayıtlarından hesaplanır; tek sayfa girişi kitabın
  güncel sayfasını ayarlar, sayfa aralığı ise haftalık plandaki kitap görevlerine
  aittir.
- **Ders Çalışma Çizelgesi** sayfasında haftalık plan tarihli olarak tutulur. Haftalar
  arasında geçiş yapabilir, satır ekleyebilir ve her hücreye kitap sayfası, konu
  tekrarı veya serbest görev ekleyebilirsin. Değişiklikler kısa bir gecikmeyle
  otomatik kaydedilir; haftanın notu da aynı şekilde saklanır.
- Plan görevini tiklemek kitap görevinde okuma kaydını oluşturur ve kitap
  ilerlemesini otomatik günceller. Tiki geri almak kaydı geri alır, böylece ilerleme
  çift sayılmaz. Konu görevi tiklenince tekrar geçmişine kayıt eklenir; konunun
  **Bitti** durumu ayrıca konu sayfasındaki **Durum** sekmesinden işaretlenir.
- **Genel Bakış** sayfası bugünün planını ve kitap ilerlemesini bir arada gösterir.
  Eski test kayıtları ve eski serbest metin çizelgesi salt okunur olarak korunur.

PWA ikonlarını `public/favicon.svg` kaynağından yeniden üretmek için:

```bash
npx pwa-assets-generator
```

Playwright ilk kullanımda Chromium'u indirmen gerekir:

```bash
npx playwright install chromium
```

## Yayınlama (GitHub Pages)

Depo adı **`kocluk`** olacak şekilde yayın tasarlanmıştır. Farklı bir depo adı
kullanırsan `vite.config.ts` içindeki `base` değerini ve bu README'deki adresleri
güncelle.

1. Kodu `main` dalına gönder.
2. GitHub'da **Settings → Pages** sayfasını aç.
3. **Build and deployment → Source** altında **GitHub Actions** seç.
4. `Deploy to GitHub Pages` iş akışı her `main` push'unda testleri çalıştırır,
   derler ve `dist/` klasörünü yayınlar. İlk yayın için **Actions** sekmesinden
   iş akışını elle de çalıştırabilirsin.

Yayın adresi:

```
https://mehmetcan455.github.io/kocluk/
```

Uygulama `HashRouter` kullandığı için alt sayfalar (`#/tyt`, `#/denemeler` gibi)
sunucuda 404 üretmez. Aynı statik `dist/` çıktısı Cloudflare Pages veya Netlify'a
da taşınabilir; yalnızca taban yolunu ortama göre ayarlaman gerekir.

## Arkadaşlarınla paylaşma

Yayınlanan bağlantıyı (`https://mehmetcan455.github.io/kocluk/`) göndermen yeterli.
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
