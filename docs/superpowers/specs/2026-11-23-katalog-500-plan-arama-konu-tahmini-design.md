# Katalog 500+, Plan Araması ve Kitap Tabanlı Konu Tahmini — Tasarım

**Tarih:** 2026-11-23
**Durum:** Onay bekliyor
**Kapsam:** Kitaplar kataloğu, ders çalışma çizelgesi görev formu, genel bakıştaki bugünün planı, ders/konu ilerlemesi.

## 1. Amaç ve neden

Kullanıcı üç somut ihtiyaç bildirdi:

1. **Bugünün planında yayınevi görünsün.** Şu an kitap görevi yalnızca kitap adı ve sayfa aralığıyla görünüyor; aynı adlı farklı yayınevi kitapları ayırt edilemiyor.
2. **Görev eklerken kitap seçimi aranabilir olsun.** Şu anki düz `<select>`, kitap sayısı arttıkça kullanılamaz hale geliyor.
3. **Katalog 500+ kitaba çıksın.** Fasikül, problemler ve paragraf kitapları dahil; sayfa sayıları subagent araştırması ve reviewer doğrulamasıyla gelmeli.

Buna ek olarak kullanıcı, kitapların derse göre ilerlemesini konu ilerlemesine **tahmini** olarak yansıtmasını istedi: bir AYT Fizik kitabı bitince AYT Fizik konuları %50'ye, iki kitap bitince %100'e çıkmalı. Amaç, sayfa-takibi yapan kullanıcının konuları ayrıca elle işaretlemek zorunda kalmadan dersin genel durumunu görmesi.

## 2. Hedefler ve hedef olmayanlar

### Hedefler

- Bugünün planı kitap etiketinde `Yayınevi · Kitap Adı Syf. X–Y` biçimi.
- Görev formunda raf kitapları için yazarak filtreleyen, klavyeyle kullanılabilir seçici.
- `CATALOG_SEED` en az 500 kitap; hedef 530–545. Mevcut 80 satır korunur.
- Katalog verisi ders bazlı modüllere ayrılır; her yeni kitap kaynak URL'li araştırma raporundan gelir ve bağımsız reviewer'dan geçer.
- Kitap ilerlemesinden ders/konu tahmini: her kitap yüzdesini konu sırasına göre dağıtır; bir kitap bir konuya en fazla %50 katkı verir, iki kitap konuyu %100 yapar.
- Katalog modalı 500+ satırla akıcı kalır (kademeli listeleme).
- Mevcut testler, tip kontrolü ve üretim derlemesi geçer.

### Hedef olmayanlar

- Katalog kitaplarını otomatik olarak rafa eklemek. Raf ayrı kalır; kullanıcı "Rafa ekle" ile seçer.
- Sayfa numarası → konu eşlemesi. Tahmin ders bazlıdır, konu bazlı değildir.
- Yeni veritabanı şeması, yeni tablo veya senkronizasyon.
- Supabase/hesap/sunucu özellikleri.
- Deneme sınavı kitapları/setlerini kataloğa doldurmak; katalog soru bankası, konu anlatımı, fasikül, problemler, paragraf, kamp ve özet türlerine odaklanır.
- Kullanıcı onayından önce `main` dalına push veya canlı dağıtım.

### Anti-hedef

- Sayfa sayısı uydurulmuş, kaynaksız veya aynı kitabı farklı başlıklarla tekrar eden bir katalog.
- Manuel konu işaretlemelerini sessizce silen veya geri alınamaz biçimde değiştiren bir ilerleme modeli.

## 3. Kısıtlar

- Uygulama local-first; katalog çevrimdışı çalışmalı. Uzaktan JSON çekmek elenir.
- `CatalogBook` kimliği `title|publisher|edition` üzerinden deterministik. Mevcut 80 kitabın kimliği değişmemeli; aksi halde kullanıcı rafı ve ilerlemesi kopar.
- `seedCatalog()` her açılışta çalışır ve yalnızca eksik satırları ekler; mevcut/düzenlenmiş/silinmiş satırları ezmez. Bu davranış korunur.
- `ExamType` yalnızca `TYT` ve `AYT`. Yeni kitap `exam` alanı bu ikisinden biri olmalı.
- `subjectSlug` müfredattaki slug'lardan biri olmalı: `turkce`, `matematik`, `geometri`, `fizik`, `kimya`, `biyoloji`, `tarih`, `cografya`, `felsefe`, `din-kulturu`, `edebiyat`, `tarih-1`, `tarih-2`, `cografya-1`, `cografya-2`, `felsefe-grubu`.
- Subagent'lar yalnızca `opencode-go/deepseek-v4.1-flash#max` modeliyle çalışır.
- Canlıya push, kullanıcı local preview'ı onayladıktan sonra yapılır.

## 4. Yaklaşımlar ve seçilenler

### 4.1 Katalog verisi

| Yaklaşım | Artı | Eksi | Karar |
|---|---|---|---|
| A. Ders bazlı seed modülleri | Paralel araştırma/yazım, kolay review, küçük dosyalar | Birkaç dosya daha | **Seçildi** |
| B. Tek `catalogBooks.ts` | En az dosya değişikliği | 500+ satır tek dosya; subagent çakışması ve review zor | Elendi |
| C. Ağdan JSON | Uygulama güncellemeden katalog | Çevrimdışı/PWA ile çelişir, ağ bağımlılığı | Elendi |

`src/data/catalog/` altında ders başına modül olacak; `src/data/catalogBooks.ts` bunları birleştiren ince bir giriş noktası olarak kalacak. Mevcut 80 satır `src/data/catalog/mevcut.ts` dosyasına taşınacak (içerik ve kimlikler birebir korunur).

### 4.2 Görev formunda kitap seçimi

| Yaklaşım | Artı | Eksi | Karar |
|---|---|---|---|
| A. Satır içi aramalı seçici | Ekstra modal yok, hızlı, klavye desteklenebilir | Erişilebilir combobox dikkat ister | **Seçildi** |
| B. Ayrı seçim modalı | Geniş liste alanı | Her görevde fazladan tık | Elendi |
| C. Native `<datalist>` | Az kod | Mobilde zayıf, aynı adlı kitaplarda belirsiz | Elendi |

Seçici yalnızca **rafındaki** kitapları arar; katalogdan yeni kitap ekleme işi Kitaplar sayfasında kalır.

### 4.3 Bugünün planı

| Yaklaşım | Artı | Eksi | Karar |
|---|---|---|---|
| A. `Yayınevi · Kitap` öneki | Çip ile aynı dil; dar ekranda yayınevi kesilmez | Tek satırda daha uzun metin | **Seçildi** |
| B. Alt satırda yayınevi | Daha okunaklı | Kartı uzatır, mevcut tek satırlık yapıyı bozar | Elendi |

### 4.4 Araştırma akışı

| Yaklaşım | Artı | Eksi | Karar |
|---|---|---|---|
| A. Ders bazlı 13 araştırma subagent'ı + 2 reviewer | Paralel, dengeli iş yükü, ders bazlı doğrulama | Koordinasyon | **Seçildi** |
| B. Yayınevi bazlı ~20 subagent | Yayınevi tutarlılığı | Aynı kitabın dersler arası tekrar riski | Elendi |
| C. Tek büyük subagent | Az koordinasyon | Bağlam ve süre sınırı | Elendi |

## 5. Tasarım

### 5.1 Bugünün planında yayınevi

`TodayPlanCard` içindeki yerel `taskLabel` yerine `domain/schedule.ts` içindeki `scheduleTaskContent` kullanılır. Kitap görevi için bağlam `bookTitle` ve `bookPublisher` ile doldurulur. Etiket:

```
Bilgi Sarmal · TYT Matematik Soru Bankası Syf. 12–20
```

Yayınevi yoksa eski davranış (`Kitap Adı Syf. …`) korunur. Konu ve serbest görev etiketleri değişmez. `aria-label` etiketi aynı metni kullanmaya devam eder.

### 5.2 Aranabilir kitap seçici

Yeni bileşen: `src/features/schedule/ShelfBookPicker.tsx`.

**Girdi:** `books: ShelfBook[]`, `value: string`, `onChange`, `disabled`.

**Davranış:**

- Etiketli arama kutusu: "Kitap ara", placeholder "Kitap veya yayınevi ara".
- Boş sorguda rafın tamamı yerine ilk 8 kitap gösterilir ve "X kitaptan ilk 8'i" ipucu verilir.
- Yazdıkça `normalizeTr`/`matchesTokens` ile kitap adı, yayınevi ve `subjectSlug` üzerinden sıralı filtre. Sonuç en fazla 8 satır.
- Her sonuç satırı: kitap adı (kalın), `yayınevi · edition · toplam sayfa` (muted). Seçili satır işaretli.
- Seçim yapılınca arama temizlenir, liste kapanır; seçili kitap kutunun altında özet satır olarak görünür: ad, yayınevi, toplam sayfa ve "Değiştir" düğmesi.
- Sonuç yoksa: "Rafında eşleşen kitap yok. Kitaplar sayfasından ekleyebilirsin."
- Klavye: `ArrowDown/ArrowUp` aktif sonucu gezer, `Enter` seçer, `Escape` listeyi kapatır.
- Erişilebilirlik: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; liste `role="listbox"`, seçenekler `role="option"`.
- Form doğrulaması aynı kalır: `type === 'book'` için `selectedBookId !== ''`.
- Düzenleme modunda mevcut `task.userBookId` seçili gelir; kitap artık rafta yoksa uyarı gösterilir ve kaydetme engellenir.

`ScheduleTaskModal` içindeki `<select>` ve `selectedBook` bulma mantığı bu bileşenle değiştirilir. Kitap sayfa sayısı ipucu korunur.

### 5.3 Katalog 500+

#### 5.3.1 Dosya yapısı

```
src/data/catalog/
  mevcut.ts              # mevcut 80 satır, birebir
  tyt-turkce.ts
  tyt-matematik.ts
  tyt-geometri.ts
  tyt-fizik.ts
  tyt-kimya.ts
  tyt-biyoloji.ts
  tyt-tarih.ts
  tyt-cografya.ts
  tyt-felsefe.ts
  tyt-din-kulturu.ts
  ayt-matematik.ts
  ayt-geometri.ts
  ayt-edebiyat.ts
  ayt-fizik.ts
  ayt-kimya.ts
  ayt-biyoloji.ts
  ayt-tarih-1.ts
  ayt-tarih-2.ts
  ayt-cografya-1.ts
  ayt-cografya-2.ts
  ayt-felsefe-grubu.ts
  ayt-din-kulturu.ts
src/data/catalogBooks.ts  # CatalogBookSeed, CATALOG_SEED, catalogBookId
```

Her modül `CatalogBookSeed[]` dışa aktarır. `catalogBooks.ts` bunları sırayla birleştirir. `catalogBookId` değişmez.

#### 5.3.2 Hedef dağılım

Mevcut 80'e ek olarak yaklaşık 456 yeni kitap; toplam hedef 536.

| Ders | Mevcut | Yeni hedef | Toplam |
|---|---:|---:|---:|
| TYT Türkçe | 5 | 35 | 40 |
| TYT Matematik | 13 | 35 | 48 |
| TYT Geometri | 7 | 25 | 32 |
| TYT Fizik | 9 | 28 | 37 |
| TYT Kimya | 9 | 28 | 37 |
| TYT Biyoloji | 7 | 28 | 35 |
| TYT Tarih | 0 | 18 | 18 |
| TYT Coğrafya | 0 | 18 | 18 |
| TYT Felsefe | 0 | 15 | 15 |
| TYT Din Kültürü | 0 | 10 | 10 |
| AYT Matematik | 10 | 30 | 40 |
| AYT Geometri | 0 | 25 | 25 |
| AYT Edebiyat | 3 | 25 | 28 |
| AYT Fizik | 3 | 25 | 28 |
| AYT Kimya | 6 | 25 | 31 |
| AYT Biyoloji | 8 | 25 | 33 |
| AYT Tarih-1 | 0 | 9 | 9 |
| AYT Tarih-2 | 0 | 9 | 9 |
| AYT Coğrafya-1 | 0 | 9 | 9 |
| AYT Coğrafya-2 | 0 | 9 | 9 |
| AYT Felsefe Grubu | 0 | 15 | 15 |
| AYT Din Kültürü | 0 | 10 | 10 |
| **Toplam** | **80** | **456** | **536** |

Kesin alt sınır: `CATALOG_SEED.length >= 500`. Hedefin altında kalınırsa eksik ders için ek araştırma turu yapılır.

#### 5.3.3 Kapsam kuralları

- Kitap türleri: soru bankası, konu anlatımı, konu özetli, fasikül (tek fasikül veya set), problemler, paragraf, dil bilgisi, kamp, mikro/orta/zor seviye.
- TYT-AYT ortak tek cilt kitaplar TYT batch'ine yazılır; `exam: 'TYT'`. AYT batch'i yalnızca `AYT` ile başlayan AYT'ye özgü kitapları alır.
- AYT Edebiyat, Tarih-1/2, Coğrafya-1/2 ve Felsefe Grubu yalnızca AYT'dir.
- Aynı `title|publisher|edition` üçlüsü tüm katalogda benzersiz olmalı. Aynı kitabın farklı dersi/versiyonu varsa başlıkta ayırt edici ifade bulunmalı.
- **Baskı farkı yüzünden çift kayıt açılmaz:** `mevcut.ts` içinde aynı `title + publisher` varsa, yeni edition farklı olsa bile yeni satır eklenmez. Mevcut satır korunur; yeni araştırma o kitabı atlar. Böylece kullanıcı aynı görünen iki satır görmez ve mevcut testlerdeki başlık+yayınevi aramaları kararlı kalır.
- AYT Tarih-1/Tarih-2 ve AYT Coğrafya-1/Coğrafya-2 için yalnızca tek alt dersi hedefleyen kitaplar/fasiküller eklenir. "AYT Tarih" veya "AYT Coğrafya" gibi iki alt dersi birlikte kapsayan tek cilt kitaplar, tek bir `subjectSlug` ile diğer alt dersi tahminsiz bırakacağı için kataloğa alınmaz.
- Fasikül seti tek satırsa başlıkta `(X Fasikül)` belirtilir ve `totalPages` setin toplam sayfasıdır. Tek tek satılan fasiküller ayrı satır olabilir.
- Deneme sınavı kitapçıkları, çözüm DVD'leri, poster/defter gibi sayfa takibine uygun olmayan ürünler eklenmez.
- `edition` çoğunlukla `2026`. Resmî künyede yıl yoksa ve güncel sezon listingi varsa `2026`; yalnızca doğrulanmış eski baskı varsa o yıl.
- `totalPages` pozitif tam sayı. Aynı ISBN'te kaynaklar çelişirse resmî yayınevi künyesi > aynı ISBN'li mağaza çoğunluğu > eski baskı sırası uygulanır; fark rapora yazılır.

#### 5.3.4 Araştırma raporu biçimi

Her batch `docs/superpowers/research/catalog-2026-11-23/<batch>.json` dosyasına yazar:

```json
{
  "batch": "tyt-matematik",
  "books": [
    {
      "title": "TYT Matematik Soru Bankası",
      "publisher": "Örnek Yayınları",
      "exam": "TYT",
      "subjectSlug": "matematik",
      "totalPages": 400,
      "edition": "2026",
      "sourceUrl": "https://...",
      "sourceUrls": ["https://...", "https://..."],
      "confidence": "high",
      "notes": "Resmî künye ve iki mağaza 400 sayfada birleşiyor."
    }
  ]
}
```

- `confidence`: `high` (resmî künye veya en az 2 bağımsız kaynak), `medium` (tek güvenilir kaynak veya baskı belirsizliği), `low` (kabul edilmez).
- `sourceUrl` zorunlu; `sourceUrls` en az bir URL içermeli.
- Araştırma subagent'ı uygulama kodu değiştirmez; yalnızca rapor dosyasını yazar.

#### 5.3.5 Araştırma batch'leri

| # | Batch | Kapsam | Hedef |
|---:|---|---|---:|
| 1 | `tyt-turkce` | TYT Türkçe, paragraf, dil bilgisi | 35 |
| 2 | `tyt-matematik` | TYT Matematik, problemler | 35 |
| 3 | `tyt-geometri` | TYT Geometri | 25 |
| 4 | `tyt-fizik` | TYT Fizik | 28 |
| 5 | `tyt-kimya` | TYT Kimya | 28 |
| 6 | `tyt-biyoloji` | TYT Biyoloji | 28 |
| 7 | `tyt-sosyal-1` | TYT Tarih + TYT Coğrafya | 36 |
| 8 | `tyt-sosyal-2` | TYT Felsefe + TYT Din Kültürü | 25 |
| 9 | `ayt-matematik-geometri` | AYT Matematik + AYT Geometri | 55 |
| 10 | `ayt-edebiyat-tarih` | AYT Edebiyat + AYT Tarih-1 + AYT Tarih-2 | 43 |
| 11 | `ayt-fizik-kimya` | AYT Fizik + AYT Kimya | 50 |
| 12 | `ayt-biyoloji-cografya` | AYT Biyoloji + AYT Coğrafya-1 + AYT Coğrafya-2 | 43 |
| 13 | `ayt-felsefe-din` | AYT Felsefe Grubu + AYT Din Kültürü | 25 |

Toplam hedef: 456 yeni satır.

#### 5.3.6 Reviewer

**13 araştırma batch'i, 2 reviewer subagent'ı.** Reviewer A batch 1–8'i (tüm TYT), Reviewer B batch 9–13'ü (tüm AYT) inceler; her batch için ayrı `review-<batch>.md` yazar. Bir batch `FAIL` alırsa düzeltme aynı araştırma subagent'ına `sessionID` ile geri gönderilir; düzeltilmiş batch'i aynı reviewer yeniden inceler. Her reviewer:

- Şema, `exam`, `subjectSlug`, pozitif tam sayı `totalPages`, `edition`, `sourceUrl` ve `confidence` alanlarını doğrular.
- Batch içi ve tüm raporlar arası `title|publisher|edition` tekrarını arar; mevcut 80 ile çakışmayı reddeder.
- Her satırın kaynak URL'sini kontrol eder; en az %20 örnekte sayfayı açıp sayfa sayısını doğrular. Düşük güvenli ve çelişkili satırların tamamını kontrol eder.
- Kapsam kurallarını (fasikül/problem/paragraf, TYT-AYT sahipliği, deneme dışlama) denetler.
- `review-<batch>.md` dosyasına `PASS`/`FAIL`, düzeltilecek satırlar ve gerekçe yazar.
- `FAIL` satırlar araştırma subagent'ına geri gönderilir; düzeltilmeden birleştirme yapılmaz.

#### 5.3.7 Birleştirme

- Kabul edilen JSON raporlarından TS modülleri üretilir. Üretim tek seferlik bir script (`scripts/build-catalog.mjs`) veya elle yapılabilir; script kullanılırsa deterministik sıralama ve biçim korunur.
- `seedCatalog()` toplu okuma/yazmaya geçirilir: `bulkGet` ile mevcut kimlikler alınır, yalnızca eksikler `bulkAdd` edilir. Böylece 536 satır her açılışta tek tek `get` edilmez.
- Mevcut 80 satırın içeriği ve kimlikleri değişmez.

#### 5.3.8 Katalog modalı

`BookCatalogModal` 500+ satırı bir anda basmaz:

- Başlangıçta 60 sonuç gösterilir; "Daha fazla göster" 60'ar artırır.
- Sorgu değişince görünür adet 60'a döner.
- Liste başında `"X kitap"` veya `"X sonuç"` sayısı gösterilir.
- Her satırda yayınevi ve varsa edition (`2026`) gösterilir; aynı adlı farklı baskılar ayırt edilebilir.
- Arama kutusu ve "Kendi kitabımı ekle" akışı aynı kalır.

### 5.4 Kitap tabanlı konu tahmini

#### 5.4.1 Hesap

Bir dersin rafındaki kitapları:

- `userBook.status !== 'archived'`, `deletedAt` yok.
- `catalogBook.deletedAt` yok.
- `catalogBook.subjectSlug === subject.slug`.
- `catalogBook.exam === subject.exam` **veya** kitap başlığı `TYT-AYT` / `TYT - AYT` içeriyor. Ortak tek cilt kitaplar hem TYT hem AYT tahminine sayılır; katalogdaki `exam` alanı TYT kalsa bile AYT tarafı boş kalmaz.
- `totalPages > 0` (toplam sayfası bilinmeyen kitap katkı vermez).

**Dağıtım kuralı:** her kitap, kendi `progress.percent` değerini konu sırasına göre baştan dağıtır. Bir kitap bir konuya **en fazla %50** katkı verir; konu %50'ye gelince o kitabın katkısı sıradaki konuya geçer. Zaten %100 dolu konular atlanır; böylece 3. kitabın katkısı boşa gitmez. İki kitap aynı konuya %50'şer katkı verince konu %100 olur.

```
bookContribution = konu başına 0 ile başlayan katkı dizisi

for her eşleşen kitap:
  kalan = kitap.progress.percent       // 0–100 tam sayı
  for konu in müfredat sırası:
    oda = min(50, 100 - bookContribution[konu])
    pay = min(kalan, oda)              // bir kitap bir konuya en fazla 50
    if pay <= 0: continue              // dolu konuyu atla
    bookContribution[konu] += pay
    kalan -= pay
    if kalan === 0: break

bookPercent[konu] = min(100, bookContribution[konu])
bookEstimate      = min(100, floor(ortalama(bookPercent)))   // "Kitap tahmini"
```

Konu satırı:

```
manualPercent    = manuel "bitirdim" işareti varsa 100, yoksa 0
effectivePercent = max(manualPercent, bookPercent[konu])
done             = effectivePercent >= 100
started          = manualPercent > 0 || reviewCount > 0 || bookPercent[konu] > 0
solved           = done ? 1 : 0
```

Ders özeti:

```
percent = min(100, floor(ortalama(effectivePercent)))
          // tüm konular bitmeden 99'u geçmez
solved  = effectivePercent >= 100 olan konu sayısı
total   = konu sayısı
remaining = total - solved
started = en az bir konu started
done    = total > 0 && solved === total
```

**4 konulu bir derste 1 kitap örneği:**

| Kitap ilerlemesi | 1. konu | 2. konu | 3. konu | 4. konu | Ders |
|---|---:|---:|---:|---:|---:|
| %25 | %25 | %0 | %0 | %0 | %6 |
| %50 | %50 | %0 | %0 | %0 | %12 |
| %75 | %50 | %25 | %0 | %0 | %18 |
| %100 | %50 | %50 | %50 | %50 | %50 |
| 2. kitap da %100 | %100 | %100 | %100 | %100 | %100 |

Örnekler ve sonuçlar:

- 1 kitap bitti → tüm konular %50; 2 kitap bitti → tümü %100. "Bir dersi bitirmek için 2 kitap" kuralı korunur.
- 1 kitap %100, 2. kitap %25 → ilk konu %75, diğerleri %50; ders %56 (4 konu).
- 2 kitap da %50 → her ikisi de ilk konuya %50 verir; ilk konu %100, diğerleri %0; ders %25. Bu, seçilen sıralı modelin doğal sonucudur; yarım iki kitap, tam bir kitaptan daha düşük görünebilir.
- "TYT-AYT Geometri" ortak kitabı TYT Geometri ve AYT Geometri tahminlerinin ikisine de sayılır.
- Manuel bitirilmiş konu her zaman %100 kalır; kitap katkısı onu düşürmez.
- 3. ve sonraki kitaplar dolu konuları atlar, sıradaki eksik konuya katkı verir; bir konunun toplamı %100'ü geçemez.
- Toplam sayfası bilinmeyen, arşivli veya silinmiş kitap katkı vermez.

#### 5.4.2 Arayüz

- `SubjectOverview` yeni alanlar: `bookEstimate: number`, `manualDoneCount: number`.
- `TopicProgressRow.progress` etkin yüzdeyi taşır; `done` etkin tamamlanmayı, `solved/total` konu başına 0/1 veya 1/1'i gösterir.
- `SubjectCard`: yüzde ve çubuk etkin değeri kullanır. Mesaj önceliği: konu yok → "Henüz konu yok"; tümü bitti → "Tüm konular tamam"; `bookEstimate > 0` → `Kitap tahmini: %NN`; devam eden → mevcut mesaj.
- `SubjectPage`: ring etkin yüzdeyi gösterir. Alt metin:
  - konu yok → "Henüz konu yok"
  - tümü bitti → `${solved}/${total} konu · Tümü bitti`
  - `bookEstimate > 0` → `${solved}/${total} konu · Kitap tahmini %NN`
  - aksi halde mevcut `${solved}/${total} konu · ${remaining} konu kaldı`
- `TopicRow`: yüzde ve çubuk etkin değeri kullanır. Durum metni: `done` → "Bitti"; `started` → "Devam ediyor"; değilse "Başlanmadı". Manuel kutu ayrı kaldığı için kitap tahminiyle %100 olan konu "Bitti" görünür.
- `useTopicProgress`: konunun dersini bulup sıralı dağıtımı uygular; konu sayfasındaki ring ve durum etkin değeri gösterir.
- `TopicStatusTab`: manuel kutu davranışı değişmez. İpucu metnine, konunun kitap katkısı varsa "Kitap ilerlemesi bu konuya %NN ekliyor; kutu yalnızca elle bitirme kaydıdır." eklenir.
- Manuel işaretleme hiçbir zaman otomatik değiştirilmez veya silinmez.

#### 5.4.3 Performans

`useSubjectOverview` her ders kartında çalışır. Kitap tahmini için `listShelfBooks()` çağrısı eklenecek; raf küçük olduğu için kabul edilebilir. Ölçümde sorun çıkarsa tahminler tek bir üst seviye hook ile paylaşılır; bu tasarımın ilk sürümünde ek karmaşıklık eklenmez.

### 5.5 Testler

- **Veri:** `CATALOG_SEED.length >= 500`; `catalogBookId` benzersizliği; tüm alanlar geçerli; `subjectSlug` izinli listede; 22 dersin her birinde en az 5 kitap; en az 25 fasikül, 15 problem, 15 paragraf başlığı; mevcut 80'in kimlikleri korunmuş; aynı `title + publisher` yeni satırlarda tekrarlanmamış.
- **Seed:** idempotent; mevcut satırı ezmez; toplu ekleme sonrası sayı doğru.
- **Bugünün planı:** yayınevili etiket ve `aria-label`.
- **Görev formu:** arama ile filtreleme, seçim, klavye, seçili kitap özeti, kaydetme; düzenleme modunda mevcut kitap; aynı adlı farklı yayınevlerinin ayırt edilmesi.
- **Katalog modalı:** 500+ kitapta ilk 60, "Daha fazla göster", arama sonucu sayısı, edition gösterimi.
- **Tahmin:** 4 konulu derste 1 kitap %25 → 1. konu %25, ders %6; 1 kitap %100 → tüm konular %50, ders %50; 2 kitap %100 → tümü %100; 1 kitap %100 + 1 kitap %25 → ilk konu %75, diğerleri %50, ders %56; iki kitap da %50 → ilk konu %100, ders %25; "TYT-AYT" ortak kitabı hem TYT hem AYT tahminine sayılır; manuel biten konu %100 kalır; arşivli/silinmiş/toplam sayfası bilinmeyen kitap katkı vermez; TYT ve AYT ayrı hesaplanır; kitapsız derslerde mevcut davranış birebir korunur.
- **Regresyon:** mevcut `subjects.test.tsx`, `progress.test.tsx`, `schedule.test.tsx`, `dashboard.test.tsx`, `books.test.tsx`, `catalogRepository.test.ts`, `backup.test.ts` güncellenir ve geçer.

### 5.6 Local preview ve yayın

1. `npm run test:run`, `npm run typecheck`, `npm run build` çalıştırılır.
2. `npm run dev -- --host` ile local sunucu açılır.
3. Playwright ile en az dört ekran görüntüsü alınır:
   - Bugünün planında yayınevi.
   - Görev formunda arama sonuçları ve seçili kitap.
   - Katalogda 500+ kitap ve arama.
   - Bir derste kitap tahmininden gelen yüzde (ör. AYT Fizik'te 1 kitap bitmiş → %50).
4. Local URL ve ekran görüntüleri kullanıcıya gösterilir.
5. Kullanıcı onaylamadan `main` dalına push edilmez; GitHub Pages dağıtımı tetiklenmez.
6. Onay sonrası değişiklikler tek bir anlamlı commit ile `main`e alınır ve push edilir.

## 6. Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| 500+ kitap için yeterli doğrulanmış sayfa sayısı bulunamaması | Katalog hedefin altında kalır | Ders bazlı hedefler, eksik batch için ek tur, en az 500 zorunlu test |
| Subagent'ların kaynaksız/uydurma satır üretmesi | Güvenilmez katalog | `sourceUrl` zorunlu, reviewer örnek kontrolü, otomatik şema testi |
| Aynı kitabın batch'ler arası tekrarı | Katalogda çift kayıt | TYT-AYT sahiplik kuralı, reviewer'da tüm raporlar arası tekrar taraması |
| Katalog modalının 500 satırla yavaşlaması | Kötü UX | İlk 60 + "Daha fazla göster" |
| Her ders kartında ek kitap sorgusu | Yavaş açılış | Küçük raf varsayımı; gerekirse üst seviye paylaşımlı hook |
| Manuel konu işaretleriyle tahminin çelişmesi | Kafa karışıklığı | Manuel her zaman %100; metinlerde "Kitap tahmini" etiketi; kutu davranışı değişmez |
| `main`e erken push | İstenmeden canlıya çıkma | Preview onayına kadar push yok |

## 7. Kararların özeti

- Katalog 500+ **katalogda** olacak; raf ayrı kalacak.
- Veri ders bazlı modüllere bölünecek; mevcut 80 korunacak.
- Görev formunda satır içi aramalı seçici olacak; yalnızca raf kitapları aranacak.
- Bugünün planında `Yayınevi · Kitap` biçimi kullanılacak.
- Kitap tahmini: her kitap kendi yüzdesini konu sırasına göre dağıtır; bir kitap bir konuya en fazla %50, iki kitap bir konuyu %100 yapar; tüm konular bitmeden ders %99'u geçmez.
- Konu yüzdesi = max(manuel %100, kitap katkısı); manuel kutu yalnızca elle işaretlemeyi tutar.
- "TYT-AYT" ortak kitaplar hem TYT hem AYT tahminine sayılır; tek alt dersi kapsayan AYT Tarih/Coğrafya kitapları ayrı hedeflenir.
- Baskı farkı yüzünden aynı `title + publisher` çift kayıt olarak eklenmez; mevcut 80 satır korunur.
- Araştırma 13 batch + 2 reviewer; her satır kaynak URL'li; reviewer geçmeyen satır birleşmez.
- Local preview onayı olmadan push yok.
