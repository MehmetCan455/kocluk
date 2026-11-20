# Koçluk — YKS Takip

YKS hazırlığı için yerel çalışan (local-first) bir takip uygulaması. Kitaplarını,
konu bazında çözdüğün testleri, TYT/AYT denemelerini, yanlış soru fotoğraflarını ve
konu notlarını tek yerde tutar. Veriler **yalnızca kullandığın cihazın tarayıcısında**
saklanır; hesap, sunucu, analitik veya otomatik senkron yoktur.

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
https://<kullanici>.github.io/kocluk/
```

Uygulama `HashRouter` kullandığı için alt sayfalar (`#/tyt`, `#/denemeler` gibi)
sunucuda 404 üretmez. Aynı statik `dist/` çıktısı Cloudflare Pages veya Netlify'a
da taşınabilir; yalnızca taban yolunu ortama göre ayarlaman gerekir.

## Arkadaşlarınla paylaşma

Yayınlanan bağlantıyı (`https://<kullanici>.github.io/kocluk/`) göndermen yeterli.
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
güncelle. Yedek dosyası tüm dersleri, testleri, denemeleri, notları, fotoğrafları
ve ekleri içerir. Geri yükleme mevcut verilerin tamamını değiştirir; birleştirme
yapmaz.

## Gizlilik

- Hesap, bulut, reklam ve analitik yoktur.
- Hiçbir veri cihazdan dışarı gönderilmez; tüm okuma/yazma IndexedDB üzerindedir.
- Fotoğraflar ve ekler yalnızca yerel veritabanında saklanır.
- Depo yalnızca kodu içerir; örnek veya kişisel veri commit edilmez.

## Teknolojiler

React 19, TypeScript, Vite, Tailwind CSS, Dexie (IndexedDB), TipTap, Chart.js,
JSZip ve `vite-plugin-pwa`. Testler Vitest + React Testing Library ve Playwright
ile yazılmıştır.
