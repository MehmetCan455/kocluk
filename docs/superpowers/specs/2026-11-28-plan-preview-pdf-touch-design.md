# Tasarım — Sayfa zinciri önizleme, test PDF ve dokunmatik düzenleme

- Tarih: 2026-11-28
- Durum: Onay bekliyor
- İlgili: sayfa zinciri, rastgele test, haftalık plan

## 1. Amaç

Üç bağımsız iyileştirmeyi tek sürümde, canlıdaki mevcut veriyi bozmadan
tamamlamak:

1. Yeni sayfa zincirleri dengeli dağılsın (kalan ilk günlere birer birer),
   önizlemede günlük sayfa adetleri düzenlenebilsin. Mevcut zincirlerin
   aralıkları aynen kalsın.
2. Oluşturulan rastgele test, iki soru bir sayfada (solda/sağda) olacak şekilde
   A4 yatay PDF olarak indirilebilsin; sonunda cevap anahtarı olsun.
3. Telefon/tablet/masaüstünde görev düzenleme ve silme erişilebilir olsun:
   görev çipine dokunmak düzenleme modalını açsın, silme modal içinde olsun.
   Mevcut çizelge verisi değişmesin.

## 2. Kapsam

### Hedefler

- Sayfa zinciri oluşturma önizlemesinde otomatik dengeli dağılım + elle
  düzenleme.
- Eski zincirlerde `chunkSizes` boş kaldığında bugünkü `floor + son gün`
  formülünün aynen çalışması.
- Test oturumu aktifken ve tamamlandıktan sonra PDF indirme.
- PDF: kapak yok; her sayfada iki soru (sol/sağ), numaralı; sonda cevap
  anahtarı.
- Dokunmatikte görev çipine dokun → düzenleme modalı; modalda “Görevi sil”.
- Masaüstünde mevcut hover davranışının korunması.

### Kapsam dışı

- Branş denemelerinin yanlış fotoğraf akışına bağlanması (kullanıcı bu turda
  istemedi).
- Oluşturulmuş bir zincirin sonradan düzenlenmesi; düzenleme yalnızca oluşturma
  önizlemesinde.
- Sunucuda PDF üretimi. Fotoğraflar cihazda (blob) tutuluyor; PDF istemcide
  üretilecek.
- Sayfa zinciri görevlerinin şemasını değiştirmek. `schedule_tasks` aynı kalır.
- Dokunmatik düzenleme için veri göçü. Yalnızca arayüz değişir.

### Anti-hedefler

- Mevcut canlı zincirlerin sayfa aralıklarının değişmesi.
- Eski istemcinin yeni zincir alanını (`chunkSizes`) gönderemediği için sync
  dead-letter üretmesi.
- PDF’in sunucuya yüklenmesi veya hesap verisinin dışarı çıkması.
- Dokunmatik düğmelerin her görevde sürekli görünüp çizelgeyi kalabalıklaştırması.

## 3. Kısıtlar

- Node.js `>=22.22.2`; mevcut React 19 + Vite 8 + Dexie + Tailwind 4 yapısı.
- Tüm arayüz metinleri Türkçe; mevcut `Button`, `Modal`, `Field`, `cn`
  desenleri.
- Canlı veri: mevcut `schedulePageChains` satırları `chunkSizes` olmadan
  okunabilmeli; migration yalnızca ek kolon ekler.
- Sync: istemci, sunucu, mock ve backup aynı alanları taşımalı.
- PHPUnit yerelde yok; `api` CI işi (PHP 8.4 + MariaDB 10.6) merge/deploy
  kapısı.
- Yeni PDF bağımlılığı yalnızca PDF indirilirken dinamik yüklenecek; ilk açılış
  paketini büyütmeyecek.
- PWA çevrimdışı çalışmaya devam edecek; PDF fontu ve jsPDF chunk’ı önbelleğe
  alınacak.

## 4. Yaklaşımlar

### 4.1 Sayfa zinciri dağılımı

- **A (seçilen):** Zincire `chunkSizes` JSON alanı ekle. Yeni zincirler
  dağılımı açıkça saklar; eski zincirlerde alan boşsa bugünkü formül kullanılır.
  Böylece hem dengeli hem elle düzenlenmiş dağılım desteklenir, mevcut
  zincirler hiç değişmez.
- B: `layout` enum’u + yeniden hesaplama. Elle günlük adetleri desteklemek için
  yine ayrı bir boyut alanı gerekir; iki alan fazladan karmaşıklık.
- C: Formülü tüm zincirlerde değiştirmek. Mevcut canlı zincirlerin aralıklarını
  kaydırır; kullanıcı isteğine aykırı.

### 4.2 Önizleme düzenleme

- **A (seçilen):** Her gün için sayfa adedi girilir; son gün toplamdan otomatik
  hesaplanır. Aralıklar bitişik kalır, toplam garanti edilir.
- B: Her gün için başlangıç–bitiş sayfası. Daha esnek ama bitişiklik/toplam
  doğrulaması ve hata yüzeyi daha karmaşık.

### 4.3 PDF

- **A (seçilen):** `jsPDF` + gömülü Türkçe TTF font. Gerçek dosya indirme,
  tarayıcıdan bağımsız düzen, çevrimdışı çalışma.
- B: Tarayıcı yazdırma penceresi (“PDF olarak kaydet”). Bağımlılık yok ama
  mobilde ekstra adım ve düzen tarayıcıya bağlı.

### 4.4 Dokunmatik düzenleme

- **A (seçilen):** Görev çipine dokun → mevcut düzenleme modalı; modalda sil.
  Masaüstünde hover ikonları kalır. Normal görünümde ikon kalabalığı yok.
- B: Tick modu gibi ayrı bir “Düzenle” modu. Üçüncü mod; kullanıcı emin değildi.
- C: Tüm düzenle/sil ikonlarını dokunmatikte sürekli göstermek. Kullanıcı
  görsel olarak kalabalık buldu.

## 5. Sayfa zinciri

### 5.1 Veri modeli

`SchedulePageChain`’e eklenir:

```ts
chunkSizes?: string | null; // JSON: "[3,3,3,3,3,3,2]"; null/undefined = legacy
```

- Varsayılan/eski satırlar: `null`, `undefined` veya `"[]"` → eski formül.
- Dexie store tanımı değişmez; yeni index gerekmez, Dexie sürümü artmaz.
- `chunkSize` alanı korunur ve **taban** (`floor(toplam / gün)`) olarak
  yazılmaya devam eder. Eski formül ve sunucu doğrulaması bozulmaz.

> **Neden nullable?** Sunucu `TableMap::toDb()` opsiyonel alanları satırda yoksa
> açıkça `NULL` yazar. `NOT NULL DEFAULT '[]'` olsaydı eski istemcinin
> gönderdiği zincir satırı 500 üretirdi. Bu yüzden `chunk_sizes` **NULL
> olabilir**; `NULL` “legacy formül” demektir.

### 5.2 Domain (`src/domain/pageChain.ts`)

Yeni saf fonksiyonlar:

```ts
export function balancedChunkSizes(
  startPage: number,
  endPage: number,
  chunkCount: number,
): number[];
```

- `total = endPage - startPage + 1`
- `base = floor(total / chunkCount)`, `remainder = total % chunkCount`
- `sizes[i] = base + (i < remainder ? 1 : 0)`
- Örnek: `1–20 / 7 → [3,3,3,3,3,3,2]`; `100–150 / 5 → [11,10,10,10,10]`.

```ts
export function chunksFromSizes(
  startPage: number,
  sizes: readonly number[],
): PageChainChunk[];
```

- Kümülatif, bitişik, bitiş dahil aralıklar üretir.
- Her boyut pozitif tam sayı olmalı.

```ts
export function parseChunkSizes(
  value: unknown,
  chunkCount: number,
  totalPages: number,
): number[] | null;
```

- `null`, `undefined`, `''`, `'[]'`, bozuk JSON, yanlış uzunluk, pozitif
  olmayan/ondalıklı değer veya toplam uyuşmazlığı → `null`.
- `null`, “eski formül” anlamına gelir; dolu ama geçersiz JSON ayrıca
  `isValidChainSettings` tarafından zinciri geçersiz kılar.

`splitPageRange` **değişmez**; eski zincirlerin ve mevcut testlerin legacy
davranışı korunur. Yeni zincirler `chunksFromSizes` kullanır.

`assignChainChunks` girdisine `chunkSizes?: readonly number[]` eklenir:

- Verilmişse `chunksFromSizes` ile parçalar üretilir; toplam/uzunluk doğrulanır.
- Verilmemişse mevcut `splitPageRange` çalışır.
- `chunkSize === pageChunkSize(...)` kontrolü aynı kalır (taban).

### 5.3 Repository (`src/db/pageChainRepository.ts`)

- `CreatePageChainInput`’a `chunkSizes?: readonly number[]` eklenir.
  - Verilmezse `balancedChunkSizes` kullanılır (yeni zincirler dengeli).
  - Uzunluk `days.length`, her değer ≥1 tam sayı, toplam
    `endPage - startPage + 1` olmalı.
- `createPageChain` zincir satırına `chunkSizes: JSON.stringify(sizes)` yazar.
- `chunksFor(chain)`:
  - `parseChunkSizes` başarılıysa `chunksFromSizes`;
  - aksi halde `splitPageRange` (legacy).
- `isValidChainSettings`:
  - Mevcut kontroller (chunkCount, chunkSize tabanı, legacy aralık) aynı.
  - `chunkSizes` `null`/`undefined`/boş/`'[]'` ise legacy geçerli.
  - Dolu ama geçersizse zincir geçersiz (reconcile çözer), sessizce legacy’ye
    düşmez.
- `recomputePageChain` ve `listWeekPageChains` `chunksFor` üzerinden aynı
  parçaları kullanır; `assignChainChunks`’a `chunkSizes` geçirilir.
- Eski zincirlerde `chunkSizes` **backfill edilmez**; recompute sırasında
  `'[]'` yazılsa bile legacy formül korunur.

### 5.4 UI (`src/features/schedule/PageChainModal.tsx`)

- Başlangıç/bitiş ve günler geçerli olduğunda otomatik `balancedChunkSizes`
  hesaplanır ve önizlemeye yazılır.
- Önizlemede her gün için:
  - Gün etiketi,
  - sayfa adedi girişi (son gün hariç, `min=1`),
  - hesaplanan aralık (`Pzt 1–3`).
- Son günün adedi = toplam − diğer günlerin toplamı; en az 1 olmalı.
- Toplam ve gün sayısı canlı gösterilir.
- “Dengeli dağıt” düğmesi elle düzenlemeyi otomatik dağılıma döndürür.
- Başlangıç, bitiş veya seçilen günler değişince elle düzenleme sıfırlanır.
- Dağılım geçersizse kırmızı açıklama ve “Zinciri oluştur” devre dışı.
- `createPageChain` çağrısına `chunkSizes` geçirilir.
- Erişilebilirlik: her giriş için `aria-label` (ör. “Pazartesi sayfa sayısı”),
  hata `role="alert"`.

### 5.5 Sync, sunucu, migration, yedek, mock

- `src/db/sync/constants.ts`: `schedulePageChains` alan listesine
  `'chunkSizes'`.
- `api/src/Sync/TableMap.php`: `chunkSizes => chunk_sizes`,
  `RULE_TEXT`, **required değil** (eski istemciler göndermez).
- `api/migrations/006_page_chain_chunk_sizes.sql`:
  ```sql
  ALTER TABLE `schedule_page_chains`
      ADD COLUMN IF NOT EXISTS `chunk_sizes` TEXT NULL;
  ```
  `004`/`005` değişmez. Kolon bilinçli olarak nullable; eski istemcinin
  gönderdiği satırda alan yoksa sunucu `NULL` yazar.
- `scripts/mock-api.mjs`: `chunkSizes` kolonu, opsiyonel/nullable; eski
  satırlar `null` kalır.
- `src/db/backup.ts`:
  `chunkSizes: z.string().max(65535).nullish().default(null)`; yedek şeması v7
  kalır (eski yedekler `null` ile legacy okunur).
- Push: alan varsa gönderilir; yoksa sunucu `NULL` yazar, dead-letter oluşmaz.
  Yeni zincirler her zaman JSON string yazar.
- **Sunucu koruması (eski istemci):** `TableMap`’e
  `preserveWhenNull: ['chunkSizes']` benzeri bir kural eklenir;
  `SyncService::update()` gelen `chunk_sizes` NULL ise kolonu SET listesinden
  çıkarır, mevcut değeri korur. Böylece `chunkSizes` bilmeyen eski istemcinin
  zincir satırı push’u yeni dağılımı silmez.
  - Yeni istemci de bilinçli olarak `chunkSizes`’ı temizlemez; bu yüzden
    koruma davranışı ürün akışını kısıtlamaz.
  - Test: önce `chunkSizes` ile push et, sonra aynı satırı alansız push et;
    veritabanındaki değer korunur.

### 5.6 Testler

- Domain: dengeli dağılım (1–20/7, 100–150/5, 8/7), `chunksFromSizes`,
  `parseChunkSizes` geçerli/geçersiz, `assignChainChunks` özel boyutlarla,
  legacy `splitPageRange` değişmedi.
- Repository: yeni zincir dengeli varyasyonlarla oluşur; özel boyutlarla
  oluşur; eski satır (`chunkSizes` yok) legacy aralıkları korur; recompute eski
  zinciri değiştirmez; kaçırma/yok sayma özel boyutlarda da çalışır.
- UI: önizleme otomatik gelir; adet düzenlenince aralıklar ve son gün
  güncellenir; geçersiz dağılım oluşturmayı kapatır; “Dengeli dağıt” sıfırlar;
  oluşturma girdisinde `chunkSizes` gider.
- Sync/mock/backup: `chunkSizes` round-trip ve eski satır varsayılanı.
- Server: `TableMapTest` (opsiyonel alan), `MigrationTest` (006 statik/CI).
- E2E: önizlemede adet değiştir, oluştur, yenile, aralıklar korunur; eski
  zincir seed’i yenilemede legacy aralıklarını korur.

### 5.7 Deploy ve geri dönüş

Sıra:

1. `006_page_chain_chunk_sizes.sql`
2. API (`TableMap` + sunucu koruması)
3. İstemci build/deploy

- Migration önce çalışmazsa yeni istemci `chunkSizes` gönderdiğinde sunucu
  alanı bilmez; bu yüzden sıra önemli.
- Eski istemciler alanı göndermez; sunucu opsiyonel kabul eder ve mevcut
  değeri korur.

**Geri dönüş politikası (forward-only eşiği):**

- Eski API (`chunkSizes` bilmeyen `TableMap`), yeni istemcinin gönderdiği alanı
  “bilinmeyen alan” diye reddeder. Bu yüzden **API/migration’ı tek başına geri
  almak güvenli değildir**; yeni istemci yayındayken her zincir push’u
  dead-letter olur.
- Yeni dağılımlı zincir yoksa geri dönüş sırası:
  **istemci → API → migration**. (Önce istemci eski sürüme döner; o sürüm
  `chunkSizes` göndermez, yeni API `NULL` kabul eder; sonra API/migration.)
- Aşağıdaki kapı sorgusu `0` değilse **istemci geri alımı desteklenmez**;
  ileriye dönük düzeltme yapılır:
  ```sql
  SELECT COUNT(*) FROM `schedule_page_chains` WHERE `chunk_sizes` IS NOT NULL;
  ```
- Sunucu koruması, eski istemcinin zincir satırı push’unda dağılımı silmesini
  engeller; ancak eski istemci bekleyen görev aralıklarını legacy formülle
  yeniden yazabilir. Bu yüzden yeni zincirler oluştuktan sonra eski istemciyle
  çalışmak desteklenmez.
- Dexie sürümü artmadığı için `VersionError` yok; geri dönüş kısıtı veri
  şemasından değil, zincir dağılımının eski istemcide yanlış hesaplanmasından
  kaynaklanır.

## 6. Test PDF

### 6.1 Teknoloji

- `jspdf` (runtime bağımlılık, dinamik `import()`).
- Gömülü `Roboto-Regular.ttf` (Apache 2.0; Türkçe karakter desteği).
  `src/assets/fonts/` altında; `?url` ile Vite asset’i. Font yalnızca PDF
  üretilirken `fetch` edilir.
- `vite.config.ts` PWA `globPatterns`’e `ttf` eklenir; çevrimdışı PDF için
  font ve jsPDF chunk’ı önbelleğe alınır.
- Fotoğraflar zaten JPEG (max 1600 px); PDF’e olduğu gibi gömülür.

### 6.2 Sayfa düzeni

- **A4 yatay** (297 × 210 mm), kenar 12 mm.
- Kapak yok. Her sayfada ince üst bilgi: solda “Rastgele Test”, sağda tarih;
  altta sayfa numarası.
- İçerik alanı: üst 24 mm, alt 198 mm; yükseklik 174 mm.
- İki sütun: sütun genişliği 132,5 mm, aralarında 8 mm.
- Her hücrede:
  - “Soru N” etiketi (üstte, 6 mm),
  - görsel, 132,5 × 166 mm alana en-boy oranı korunarak sığdırılır ve ortalanır.
- Sıra oturumun `photoIds` sırasıdır; silinmiş fotoğraflar atlanır ve görünen
  sorular yeniden 1..N numaralanır.
- Tek sayıda soru kalırsa son sayfada sol sütun kullanılır, sağ boş kalır.
- Cevap anahtarı ayrı sayfada: “Cevap Anahtarı”, 8 sütunlu ızgara,
  `1 · C` biçiminde; doğru şıkkı olmayan soru için `—`.
- Dosya adı: `rastgele-test-YYYY-MM-DD-HHmm.pdf` (oturumun `createdAt`’i).

### 6.3 Kod yapısı ve akış

- `src/features/practice/practicePdf.ts`:
  - `layoutPracticePdf(doc, input)` — test edilebilir, jsPDF’ten bağımsız
    minimal arayüz (`text`, `addImage`, `addPage`, `setPage`,
    `getNumberOfPages`).
  - `buildPracticePdf(session)` — fotoğrafları Dexie’den okur, jsPDF’i dinamik
    yükler, fontu ekler, düzeni uygular, `Blob` döndürür.
  - `downloadPracticePdf(session)` — blob’u indirir.
- `src/features/practice/PracticePdfButton.tsx`:
  - `busy` / `error` durumu, “PDF indir” / “PDF hazırlanıyor…”.
  - Hata: `role="alert"`.
- Buton yerleri:
  - Aktif `PracticeSessionPage` başlık aksiyonları.
  - `CompletedPractice` buton grubu.
  - (İsteğe bağlı, bu sürümde değil) geçmiş listesi.

### 6.4 Uç durumlar

- Hiç görünür fotoğraf yoksa: “PDF oluşturulacak soru yok.” hatası.
- Bir fotoğraf silinmişse atlanır; numaralandırma ve cevap anahtarı buna göre.
- `correctOption` yoksa cevap anahtarında `—`.
- Büyük testlerde (20+ soru) bellek/gecikme: düğme meşgul durumda; işlem
  bitince indirme. Gerekirse ileride görsel küçültme eklenir.
- `doc.save` yerine blob + object URL + `a[download]` kullanılır; iOS Safari’de
  indirme davranışı farklı olabilir, hata yakalanır.

### 6.5 Testler

- Birim: `layoutPracticePdf` sahte doc ile sıra, iki sütun, sayfa sayısı, cevap
  anahtarı ve eksik şık davranışı.
- Bileşen: buton tıklanınca meşgul olur, başarıda indirme çağrılır, hatada
  mesaj gösterir (exporter mock’lanır).
- E2E: test oluştur → “PDF indir” → Playwright `download` olayı; dosya adı
  `.pdf`, içerik `%PDF` ile başlar.
- `npm run typecheck`, tam Vitest, build, page-chain + practice PDF E2E.
- PHPUnit yok; sunucu değişmiyor.

## 7. Dokunmatik düzenleme

### 7.1 Davranış

- Normal modda görev çipine dokunmak/ tıklamak `onEdit` çağırır ve mevcut
  `ScheduleTaskModal` açılır.
- Modalda, düzenlenen bir görev varsa “Görevi sil” (danger) düğmesi görünür.
  Tıklanınca modal kapanır ve mevcut silme onay modalı açılır; zincir görevi
  uyarısı aynen korunur.
- Tick modunda davranış değişmez: sol tık/tık “yapıldı”, sağ tık “yapılmadı”.
- Masaüstünde hover ile görünen kalem/çöp ikonları korunur; ikon tıklamaları
  çip tıklamasını tetiklemez (`stopPropagation`).
- Dokunmatikte görev ikonları sürekli gösterilmez; erişim dokun-düzenle ile.
- Satır silme: satır etiketinin yanındaki tek çöp kutusu dokunmatikte görünür
  (`pointer-coarse` / `any-pointer-coarse`); masaüstünde hover’da.

### 7.2 Bileşenler

- `TaskChip.tsx`:
  - Normal modda çip içeriğine `onClick={onEdit}` (disabled/undefined guard).
  - Aksiyon kapsayıcısına `onClick` stopPropagation.
  - `HOVER_ACTIONS`’tan `max-[767px]` görünürlüğü kaldırılır; dokunmatik
    erişim dokun-düzenle.
- `ScheduleTaskModal.tsx`:
  - `onDelete?: () => void` prop’u; footer’da danger “Görevi sil”.
- `WeeklyPlan.tsx`:
  - `onDelete` için `taskEditor.task`’ı kapatıp `requestDeleteTask(task)` çağırır.
- `WeeklyPlanTable.tsx`:
  - Satır çöp kutusuna `pointer-coarse:opacity-100
    any-pointer-coarse:opacity-100` eklenir.

### 7.3 Veri güvenliği

- DB şeması, sync tabloları, yedek şeması değişmez.
- Mevcut görevler/satırlar aynı kalır; yalnızca erişim yolu değişir.
- Silme işlemi yine mevcut onay akışından geçer; doğrudan silme yok.
- Sayfa zinciri görevi silinirse mevcut “zincir çözülür” uyarısı korunur.

### 7.4 Testler

- Bileşen: normal modda çip tıklaması modalı açar; hover ikon tıklaması modalı
  iki kez açmaz; modal “Görevi sil” onay modalını açar.
- Bileşen: tick modunda çip tıklaması hâlâ durum değiştirir.
- CSS sınıf testi: satır çöp kutusunda `pointer-coarse:opacity-100` ve
  `any-pointer-coarse:opacity-100`.
- E2E (touch): önceden oluşturulmuş görev yüklenir, çipe dokunulur, modal
  açılır, silinir; yenilemede yok. Veri göçü olmadığı doğrulanır.
- E2E (masaüstü): hover ikonları ve çip tıklaması birlikte çalışır.

## 8. Riskler ve notlar

- **Eski istemci + yeni zincir:** Eski istemci `chunkSizes`’ı bilmez, yeni
  zinciri legacy formülle gösterir. Sunucu koruması sayesinde eski istemcinin
  zincir satırı push’u dağılımı **silmez**; ancak eski istemci bekleyen görev
  aralıklarını legacy formülle yeniden yazabilir. Bu yüzden yeni özel dağılımlı
  zincirler oluşturulduktan sonra o haftayı eski istemciyle düzenlemeyin; önce
  tüm cihazları güncelleyin. Kapalı betada bu operasyonel bir kısıt; mevcut
  (eski) zincirler etkilenmez.
- **İstemci geri dönüşü:** Yeni dağılımlı zincir varsa desteklenmez; sunucu
  dağılımı korusa bile eski istemcinin görev aralığı yazımları geçici olarak
  yanlış olabilir. Geri dönüş yerine ileriye dönük düzeltme yapılır.
- **PDF fontu:** Roboto TTF repoya eklenir; lisans dosyası konur. Font
  yüklenemezse PDF üretimi hata verir, uygulama çökmez.
- **PDF belleği:** 1600 px JPEG’ler 20+ soruda büyük PDF üretebilir; düğme
  meşgul durumda ve hata yakalanır. Gerekirse sonraki sürümde PDF için görsel
  küçültme.
- **iOS indirme:** `a[download]` davranışı tarayıcıya göre değişebilir; hata
  mesajı gösterilir.
- **Migration sırası:** 006 önce çalışmalı; aksi halde yeni istemci 400 alır.
- **Eski zincirler:** Hiçbir backfill yok; `chunkSizes` boş → legacy. Bu,
  kullanıcının “canlıdaki zincirler etkilenmesin” şartının garantisi.
