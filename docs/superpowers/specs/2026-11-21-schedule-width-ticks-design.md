# Çizelge Genişletme ve Gün Tikleri Tasarımı

- Tarih: 2026-11-21
- Durum: Onaylandı (2026-11-21)
- Kapsam: Elle ders çalışma çizelgesi (`/program`, `ScheduleTableEditor`)

## 1. Özet

Çizelge hücreleri, uzun kelimeleri bölmeden alabilecek kadar genişleyecek.
Telefon dışındaki tüm ekranlarda tablo sağa doğru büyür; kartın içinde yatay
kaydırılır, sayfa gövdesi yatay taşmaz. Ayrıca her gün hücresinin sağ üst
köşesine bir onay kutusu eklenir. İşaretlenen hücre hafif yeşile döner ve
yazısı soluklaşır. Tik durumu çizelge kaydında saklanır.

## 2. Neden

Önceki düzen 7 günü içerik genişliğine sığdırdığı için 768–1024 px’te gün
metin alanı ~50 px’e iniyor; “konuların”, “Matematik” gibi kelimeler ortadan
bölünüyor. Kullanıcı, kelimelerin aşağı doğru kırılması yerine hücrelerin sağa
doğru genişlemesini ve gerekirse tablonun kaydırılmasını istiyor. Tikler ise
günlük çalışmanın yapıldığını tek bakışta göstermeli.

## 3. Hedefler

- ≥768 px’te yedi günlük tablo, gün hücresi en az ~120 px olacak şekilde
  genişlesin; uzun kelimeler bölünmeden okunsun.
- Masaüstünde çizelge sayfası `max-w-5xl` sınırına takılmasın; mevcut ekran
  genişliğini kullansın.
- Dar ekranlarda tablo kart içinde yatay kaydırılsın; sayfa gövdesi yatay
  taşmasın.
- Telefonda (<768 px) mevcut tek gün + gün seçici düzeni korunsun.
- Her gün hücresinde sağ üstte tik olsun; işaretlenince hücre hafif yeşile
  dönsün, yazı soluklaşsın. Tik durumu kaydedilsin ve yedekte korunsun.
- Otomatik kaydetme, veri modeli ve mevcut klavye davranışı bozulmasın.

## 4. Hedef olmayanlar

- Telefonda yedi günü aynı anda göstermek.
- Ders (satır başlığı) ve toplam hücrelerinde tik.
- Tamamlanan hücreyi düzenlemeye kapatmak; yazı okunur ve düzenlenebilir kalır.
- IndexedDB şema sürümünü artırmak; yeni alan nesne içinde tutulur.
- Branş denemeleri; ayrı bir tasarım ve uygulama olarak ele alınacak.

## 5. Yaklaşımlar

### A) Tabloyu sağa doğru genişlet ve kart içinde kaydır (seçilen)

Tabloya `min-width: 1160px` verilir; sütunlar ders %18, her gün %10,4,
toplam %9,2 olur. Ekran 1160 px’ten darsa kart içinde yatay kaydırma oluşur.
Çizelge sayfası `max-w-5xl` sınırını aşar; geniş ekranda tablo daha da büyür.
Telefonda tek gün düzeni aynı kalır.

- Artı: Hücreler gerçekten genişler; uzun kelimeler bölünmez; yedi gün
  masaüstünde aynı anda görünür.
- Eksi: 768–1024 px’te yatay kaydırma gerekir; kullanıcı bunu kabul etti.

### B) Tablet ve altında tek gün göster (reddedildi)

Hücreler rahatlar ama kullanıcı tablette yedi günü aynı anda görmek istiyor;
ayrıca “hepsinde sağa doğru genişlet” isteğini karşılamaz.

### C) Yazıyı küçült (reddedildi)

Yatay kaydırma olmaz ama uzun kelimeler yine bölünebilir; okunabilirlik düşer.

### Tik: hücre başına (seçilen)

Her gün hücresinde ayrı tik. Satır başına tek tik, hangi günün yapıldığını
göstermez; kullanıcı hücre bazında işaretleme istedi.

## 6. Kararlar

### 6.1 Genişlik

- Kırılım 768 px kalır: altında tek gün, üstünde yedi gün.
- ≥768 px: tablo `min-w-[1160px] w-full table-fixed`; sütunlar %18 / %10,4 /
  %9,2. Kart sarmalayıcısı `overflow-x-auto`; yatay kaydırma yalnızca kart
  içinde olur.
- `<768 px`: mevcut 45/33/22 oranları ve tek gün düzeni korunur; tabloda
  `min-width` yok, sayfa taşmaz.
- Çizelge sayfasındaki `<main>` sınırı kaldırılır: `AppShell`, `/program`
  rotasında `max-w-none`, diğer rotalarda `max-w-5xl` kullanır. Böylece geniş
  ekranda tablo gerçekten büyür.
- Hücre içi boşluklar `p-0.5` / `px-1` olarak kalır.
- Yatay kaydırmada ders sütunu `sticky left-0` ile sabit kalır; başlık, gövde
  ve toplam satırı aynı hizayı izler.

### 6.2 Gün tikleri

- `ScheduleTableRow` tipine `done: [boolean × 7]` eklenir; `days` ile aynı
  sırada, Pazartesi ilk.
- Eski kayıtlarda `done` yoksa tümü `false` kabul edilir. `getScheduleTable`
  okurken normalize eder; kaydetme yeni alanı yazar. IndexedDB sürümü artmaz.
- Her gün hücresinin içinde üstte sağa yaslı küçük bir `<input type="checkbox">`
  (`h-5 w-5`, `accent-[var(--color-success)]`), altında tam genişlikte metin
  alanı. Tik, metin alanının genişliğini azaltmaz.
- İşaretli hücrede `<td>` arka planı `bg-success/10`, metin alanı
  `text-muted opacity-60` olur. Tik kaldırılınca eski görünüme döner.
- Tik değişikliği taslağı kirli yapar ve mevcut otomatik kaydetmeyle kaydedilir.
- Erişilebilir ad: `1. satır Pazartesi tamamlandı`; `aria-label` ile.

### 6.3 Yedekleme ve doğrulama

- `scheduleTableRowSchema` içine `done` eklenir; eski yedeklerde alan yoksa
  yedi `false` varsayılanı kullanılır. Yeni yedeklerde alan korunur.
- `saveScheduleTable` doğrulaması yedi boolean bekler; eksik/yanlış tipte
  varsayılan `false` ile normalize eder.
- Mevcut `days`, `subject`, `total` doğrulamaları değişmez.

## 7. Doğrulama

- Birim: tik işaretleme/kaldırma taslağı ve kaydı günceller; eski `done`’sız
  kayıt okununca yedi `false` döner; yedek export/import tikleri korur.
- E2E:
  - 768 px’te tablo kart içinde yatay kaydırılabilir, gün hücresi ~120 px,
    sayfa gövdesi taşmaz.
  - 1440 px’te tablo daha geniş; yatay kaydırma yok.
  - 390 px’te tek gün düzeni ve gün seçici korunur.
  - Bir gün hücresine tik atılınca arka plan yeşil tonu alır, yazı soluklaşır;
    yeniden yüklenince tik korunur.
- Mevcut 330 birim ve 15 E2E testi geçmeye devam eder; yeni testler eklenir.

## 8. Önizleme ve teslim

- `npm run build` + `npm run preview` ile `http://localhost:4173/kocluk/`
  üzerinde 360/390/768/1024/1440 px ekran görüntüleri alınır.
- Kullanıcı önizlemeyi onaylamadan push yapılmaz.
- Uygulama `opencode-go/deepseek-v4.1-flash#max` subagent’larıyla yapılır.

## 9. Uygulayıcıya kalanlar

- Tik onay kutusunun tam sınıfları ve odak halkası.
- `done` normalizasyonunun repository içindeki tam yeri.
- E2E yardımcılarının yeni yatay kaydırma beklentisine göre düzenlenmesi.
