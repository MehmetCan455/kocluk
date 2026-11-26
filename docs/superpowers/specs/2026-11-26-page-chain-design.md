# Sayfa Zinciri — Haftalık Planı Hızlı Doldurma Tasarımı

- Tarih: 2026-11-26
- Durum: Onay bekliyor
- Kapsam: `/program` haftalık plan ekranı
- İlgili dosyalar: `WeeklyPlan.tsx`, `WeeklyPlanTable.tsx`, `TaskChip.tsx`, `scheduleRepository.ts`, `db.ts`, `sync/constants.ts`, `api/src/Sync/TableMap.php`, `api/migrations/`

## 1. Özet

Haftalık planda kullanıcı bir satır (ör. Matematik) ve o satırdaki günleri seçer; bir kitap ile başlangıç/bitiş sayfası girer. Uygulama seçilen günlere sayfa aralığını sırayla böler:

```
Pzt 100-109 · Sal 110-119 · Çar 120-129 · Per 130-139 · Cum 140-150
```

Bir gün **“Yapılmadı” (kırmızı çarpı)** işaretlenirse o günün aralığı bir sonraki güne kayar; sonraki aralıklar da bir sağa kayar. Yapılmış günlerin sayfaları değişmez. Bir gün işaretsiz kalıp geçmişse otomatik “Yapılmadı” sayılır; zincir göreviyse aynı şekilde kaydırır, normal görev yalnızca kırmızı çarpı görür. Seçilen günler biterse taşan aralık **“Planlanmamış”** olarak gösterilir ve kullanıcıya **“Sonraki boş güne ekle”** düğmesi sunulur.

Mevcut plan davranışı (hücreye tek tek görev ekleme, tik modu, geçen haftadan kopyalama, haftanın notu) aynen kalır. Sayfa zinciri ayrı bir panel ve ayrı bir senkron tablosudur; mevcut `schedule_tasks` şeması değişmez.

## 2. Neden

Mevcut planda her hücre ayrı bir modal açıyor. 8 ders × 7 gün doldurmak 56 modal demek. Kullanıcıların çoğu planı doldurmaya üşeniyor; özellikle her gün aynı kitaptan paragraf/problem çözenler aynı bilgileri tekrar tekrar giriyor.

Kullanıcıyla yapılan görüşmede şu akış seçildi: 5 hücre seç, kitap + 100-150 gir, sistem günlere bölsün; kaçırılan günün sayfaları bir sonraki güne kaysın. Şablon veya sadece toplu doldurma, kaçırılan günü telafi etmediği için yetersiz bulundu.

## 3. Hedefler

- Tek panelde bir satırın birden çok gününü tek seferde doldurmak.
- Sayfa aralığını günlere eşit/bitişik parçalar hâlinde bölmek.
- “Yapılmadı” işaretlenen günün aralığını sonraki güne kaydırmak; yapılan günleri sabit tutmak.
- Geçmiş günde işaretsiz kalan görevi otomatik “Yapılmadı” saymak; zincir göreviyse kaydırmak, normal görevde yalnızca kırmızı çarpı göstermek.
- Seçilen günler yetmediğinde sessizce veri kaybetmemek; taşan aralığı göstermek ve tek tıkla sonraki boş güne eklemeyi teklif etmek.
- Mevcut plan, tik modu, kopyalama, yedek ve senkron davranışını bozmamak.
- Telefonda ve bilgisayarda aynı şekilde çalışmak.

## 4. Hedef olmayanlar

- Konu veya serbest görev zinciri; v1 yalnızca **kitap sayfası** zinciridir.
- Aynı anda birden çok kitabı tek zincire karıştırmak; bir zincir tek kitap kullanır.
- Farklı satırlardaki hücreleri tek zincire bağlamak; bir zincir tek satırda çalışır.
- OCR, fotoğraftan plan okuma, sesli komut, dış AI servisi.
- Haftalar arası otomatik taşıma; taşan aralık aynı haftada sonraki boş güne eklenir. Hafta dolduysa kullanıcı yeni haftada yeni zincir kurar.
- Geçmiş günlerdeki **normal** görevlerin sayfa kaydırması; onlar yalnızca otomatik kırmızı çarpı görür, zincir gibi kaymaz.
- Zinciri şablon olarak kaydetme; ileride ayrı bir özellik olabilir.
- Eski istemcileri zincir özelliğinden haberdar etmek; eski istemciler görevleri normal görev olarak görmeye devam eder.

## 5. Kullanıcının verdiği kararlar

- Panel ayrı olacak; mevcut hücre modalı ve tik modu korunacak.
- Zincir tek satırda, seçilen günler sırasıyla doldurulacak.
- Tek kitap ve tek başlangıç/bitiş aralığı kullanılacak.
- Kırmızı çarpı (“Yapılmadı”) aralığı bir sağa kaydıracak.
- Seçilen günler yetmezse **“Planlanmamış: 140-150”** uyarısı gösterilecek; kullanıcı isterse “Sonraki boş güne ekle” ile devam edecek.
- Mevcut yapı bozulmayacak.

## 6. Yaklaşımlar

### A) Sadece toplu doldurma (reddedildi)

Seçilen hücreleri tek panelde doldurur, ancak kaçırılan günü telafi etmez. Kullanıcı her kaçırmada aralıkları elle düzeltmek zorunda kalır.

### B) Şablon + tek tık (reddedildi)

Haftalık rutini kaydedip yeni haftaya uygular. Ancak istisnalarda yine hücre modalı gerekir; sabit sayfa aralıkları her hafta tekrar eder veya “kaldığı yerden” kuralı belirsizdir. Kullanıcı bunu yeterli bulmadı.

### C) Sayfa zinciri (seçilen)

Seçilen günlere ardışık sayfa aralıkları yazar; durum değişince bekleyen aralıkları kaydırır; taşan aralığı uyarı olarak gösterir. Kullanıcının tarif ettiği davranışın tamamını karşılar. Ek bir senkron tablosu gerektirir, ancak mevcut görev şemasına dokunmaz.

## 7. Kullanıcı akışı

### 7.1 Zincir oluşturma

1. Haftalık plan başlığında **“Sayfa zinciri”** düğmesine basılır.
2. Modal açılır:
   - **Satır:** Plan satırlarından biri (ör. Matematik). Yalnızca kaydedilmiş satırlar seçilebilir.
   - **Günler:** Pzt–Paz onay kutuları. En az 2, en fazla 7 gün.
   - **Kitap:** Rafındaki kitaplardan biri.
   - **Başlangıç sayfası**, **Bitiş sayfası**.
3. Seçilen günlerde zaten görev varsa o gün pasif görünür ve “dolu” etiketi taşır.
4. Önizleme canlı güncellenir:

```
Pzt 100-109 (10 sayfa)
Sal 110-119 (10 sayfa)
Çar 120-129 (10 sayfa)
Per 130-139 (10 sayfa)
Cum 140-150 (11 sayfa)
```

5. **“Zinciri oluştur”** ile tüm görevler tek işlemde yazılır; panel kapanır, plan yenilenir.
6. Zincir görevleri normal kitap görevi gibi görünür; yanlarında küçük bir **zincir bağlantısı simgesi** ve erişilebilir “Sayfa zinciri” etiketi bulunur.

### 7.2 Kaçırılan gün

Başlangıç: Pzt 100-109, Sal 110-119, Çar 120-129, Per 130-139, Cum 140-150.

Salı “Yapılmadı” işaretlenir:

```
Pzt 100-109  ✓ yapıldı
Sal 110-119  ✗ yapılmadı (aynı kalır)
Çar 110-119  ← kaydı
Per 120-129  ← kaydı
Cum 130-139  ← kaydı
Planlanmamış: 140-150
```

- Salı’nın aralığı tarihsel kayıt olarak **110-119 / yapılmadı** kalır.
- Çarşamba’nın görevi 110-119’a kayar; perşembe 120-129, cuma 130-139 olur.
- 140-150 için seçili gün kalmadığından “Planlanmamış” uyarısı çıkar.
- “Sonraki boş güne ekle” aynı satırda cumartesi boşsa oraya 140-150 görevini ekler. **Yeni görev zincire katılır**: `slotIndex` bir artar, `chunkIndex` planlanmamış aralığın numarası olur ve sonraki kaçırmalarda o da kayabilir.

### 7.3 “Yapılmadı” geri alınırsa

Salı yeniden “Planlandı” veya “Yapıldı” yapılırsa zincir yeniden hesaplanır; bekleyen günler eski sıralarına dönebilir. Yapılmış günlerin aralıkları değişmez.

### 7.4 Planlanmamış aralık uyarısı

Planın altında, zincir başına bir uyarı satırı:

```
Planlanmamış sayfalar
Matematik · 140-150   [Sonraki boş güne ekle]
```

- Birden çok aralık varsa hepsi listelenir; düğme her basışta sıradaki aralığı ekler.
- Aynı satırda boş gün yoksa düğme pasif olur ve “Bu haftada boş gün kalmadı” açıklaması gösterilir.
- Uyarı yalnızca zincirin bağlı olduğu satır için gösterilir; diğer plan satırlarını etkilemez.

### 7.5 Otomatik “Yapılmadı” ve kaydırma

- Bir görevin günü geçmişse (dün veya daha eski) ve görev işaretsizse, plan onu otomatik **“Yapılmadı”** gösterir. Bu, mevcut geçmiş-hafta davranışının gün bazına genişletilmiş hâlidir.
- Görev bir **zincir** göreviyse otomatik “Yapılmadı” zinciri kaydırır: sonraki bekleyen gün aynı sayfa aralığını alır.
- Görev **normal** (zincir dışı) ise yalnızca kırmızı çarpı görür; sayfa aralıkları kaymaz.
- Otomatik durum `missedAt` olarak kaydedilmez; kullanıcı sonradan “Yapıldı” derse zincir yeniden hesaplanır.
- **Bugünün** işaretsiz görevi “Planlandı” kalır; gün bitince otomatik “Yapılmadı” olur.
- Plan ekranı yeniden görünür olduğunda gün değiştiyse reconcile tekrar çalışır; uygulama gece açık kalsa bile ertesi gün zincir kayar.

## 8. Sayfa matematiği

- Aralıklar **başlangıç ve bitiş dahil**, bitişik ve örtüşmesizdir.
- `sayfaSayısı = bitiş - başlangıç + 1`.
- `günSayısı = seçilen gün sayısı`; bu sayı zincirde **`chunkCount`** olarak saklanır. Slot sayısı sonradan artsa bile parça listesi bu sayıdan üretilir.
- Geçerlilik: `sayfaSayısı >= günSayısı` (her güne en az 1 sayfa).
- `parçaBoyu = max(1, floor(((bitiş - başlangıç) + 1) / günSayısı))`. Sayfa aralığı **bitiş dahil** olduğu için pay `+1`’dir; son parça kalanı üstlenir.
- `i` numaralı gün (0'dan başlar):
  - `baş = başlangıç + i × parçaBoyu`
  - `bit = i === günSayısı - 1 ? bitiş : min(başlangıç + (i + 1) × parçaBoyu - 1, bitiş)`
- Örnekler:
  - 100-150, 5 gün → `chunkCount=5`, parça 10 → 100-109, 110-119, 120-129, 130-139, 140-150.
  - 100-104, 5 gün → `chunkCount=5`, parça 1 → 100, 101, 102, 103, 104.
  - 100-102, 5 gün → geçersiz (3 sayfa, 5 gün).
- `chunkCount` olmadan yalnızca `parçaBoyu` ile üretim yanlış olur: 100-150 / 10, son parçayı 150-150 diye altıncı bir parça üretir. Bu yüzden `chunkCount` zorunludur.
- Önizlemede her aralığın sayfa sayısı ve toplam gösterilir; kullanıcı oluşturmadan önce görür.

## 9. Durum ve kaydırma algoritması

Zincirdeki her görev üç durumdan birindedir: `completedAt` (yapıldı), `missedAt` (yapılmadı), ikisi de yok (planlandı). Buna ek olarak **geçmiş güne kalmış işaretsiz görev** görsel olarak “Yapılmadı” sayılır (mevcut `scheduleTaskStatus` davranışının gün bazına genişletilmiş hâli); bu durum `missedAt` olarak **saklanmaz**, yalnızca görüntü ve zincir hesabında etkilidir.

Saf fonksiyon `assignChainChunks(görevler, başlangıç, bitiş, parçaBoyu, chunkCount, weekStart, now)`:

1. Aralıkları (`chunks`) üret.
2. **Yapıldı** görevlerin mevcut aralıklarını koru; kullandıkları aralığı `tüketilen` kümesine ekle.
3. Görevleri `slotIndex` sırasıyla gez:
   - **Yapıldı:** dokunma; aralığı ve `chunkIndex` aynı kalır.
   - **Yapılmadı:** mevcut aralığını koru; aralığı tüketilenlere ekleme, rezerve etme. Böylece bir sonraki bekleyen görev aynı aralığı alır.
   - **Planlandı:** `tüketilen` ve `rezerve` kümelerinde olmayan en küçük aralığı ata; `rezerve`ye ekle.
4. `Planlanmamış` = hiçbir slotta **atanmamış** aralıklar. Bir aralık “yapılmadı” görevine atanmışsa (ve belki onu devralan bekleyen görevde de görünüyorsa) planlanmamış sayılmaz; yalnızca seçilen günlerin dışına taşan aralıklar buraya düşer.
5. Yalnızca aralığı/`chunkIndex` değişen görevleri `updatedAt` ile güncelle.

Örnekler:

| Durum | Pzt | Sal | Çar | Per | Cum | Planlanmamış |
|---|---|---|---|---|---|---|
| Başlangıç | 100-109 planlı | 110-119 planlı | 120-129 planlı | 130-139 planlı | 140-150 planlı | — |
| Sal yapılmadı | 100-109 yapıldı | 110-119 yapılmadı | 110-119 planlı | 120-129 planlı | 130-139 planlı | 140-150 |
| Sal yapıldı (geri) | 100-109 yapıldı | 110-119 yapıldı | 120-129 planlı | 130-139 planlı | 140-150 planlı | — |
| Çar da yapılmadı | 100-109 yapıldı | 110-119 yapılmadı | 110-119 yapılmadı | 110-119 planlı | 120-129 planlı | 130-139, 140-150 |
| Per yapıldı (Çar kaçtı) | 100-109 yapıldı | 110-119 yapılmadı | 110-119 yapılmadı | 110-119 yapıldı | 120-129 planlı | 130-139, 140-150 |

Not: “Yapılmadı” görevinin aralığı tarihsel olarak sabittir; sonradan aynı aralık başka gün yapılsa bile o gün “yapılmadı / 110-119” olarak kalır. Yapılan günün aralığı da sabittir.

Not: Zincir matematiği üç durumu okur: açık `completedAt`, açık `missedAt` ve **geçmiş gün + işaretsiz** (otomatik yapılmadı). Otomatik yapılmadı görev görselde kırmızı çarpı alır; `missedAt` alanına yazılmaz. Zincir göreviyse kaydırma yapar; normal görevler yalnızca kırmızı çarpı görür, sayfa kaydırmaz. Böylece geçmiş veri sessizce değişmez; kullanıcı sonradan “Yapıldı” derse zincir ona göre yeniden hesaplanır. Bugünün işaretsiz görevi “Planlandı” kalır; gün geçince otomatik “Yapılmadı” olur.

## 10. Veri modeli

### 10.1 Neden görev alanları değil, ayrı tablo?

Görevlere `pageChainId` gibi alanlar eklemek mümkün, ancak senkron API'si bir satırı **tam replacement** olarak işler: eski istemci zincir alanlarını bilmediği için gönderdiği görev satırında bu alanlar yoktur ve sunucu onları `NULL` yapar. Kapalı betada telefonda eski PWA kalmış bir kullanıcı, zinciri farkında olmadan bozabilir.

Bu yüzden zincir, **eski istemcilerin hiç bilmediği ayrı bir senkron tablosunda** tutulur. `schedule_tasks` şeması değişmez; eski istemciler görevleri normal görev olarak okumaya/yazmaya devam eder.

### 10.2 `schedulePageChains` tablosu

Her satır bir zincirdir. Bağlı görevler `slots` alanında JSON metni olarak tutulur. (Dexie tarafında da metin saklanır; UI `parseChainSlots` ile okur.)

| Alan | Tip | Kural |
|---|---|---|
| `id` | string | UUID, PK |
| `weekId` | string | UUID |
| `rowId` | string | UUID |
| `userBookId` | string | UUID |
| `startPage` | int | 1..4294967295 |
| `endPage` | int | 1..4294967295, > startPage |
| `chunkSize` | int | 1..65535 |
| `chunkCount` | int | 2..7; oluşturulurken seçilen gün sayısı |
| `slots` | string | JSON: `[{taskId, slotIndex, chunkIndex, dayIndex}]`, en fazla 7 |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |
| `deletedAt` | timestamp? | |

`slots` örneği:

```json
[
  {"taskId":"...","slotIndex":0,"chunkIndex":0,"dayIndex":1},
  {"taskId":"...","slotIndex":1,"chunkIndex":1,"dayIndex":2},
  {"taskId":"...","slotIndex":2,"chunkIndex":2,"dayIndex":3}
]
```

Kurallar:

- `slotIndex` 0..6, zincir içinde benzersiz.
- `taskId` her slotta benzersiz; görev aynı hafta/satırda ve `type='book'` olmalı (repository doğrular).
- `dayIndex` slotun oluşturulduğu gün (1 = Pazartesi); görev taşınırsa zincir çözülür.
- `chunkIndex` 0..(`chunkCount`-1) aralığında olabilir ve **tekrar edebilir**. Aynı aralık hem “yapılmadı” görevinde hem de onu devralan bekleyen görevde görünür; bu tasarımın gereğidir. Bu yüzden `chunkIndex` benzersiz değildir.
- `chunkCount` slot sayısından bağımsızdır; “sonraki boş güne ekle” slot sayısını artırır ama yeni parça üretmez.
- `slots` geçersiz JSON, eksik alan, tekrarlı `slotIndex` veya tekrarlı `taskId` içeriyorsa zincir yok sayılır; görevler normal görev olarak kalır.
- Bir görev silinir/düzenlenirse zincir çözülür: `deletedAt` ile zincir kapatılır, görevler normal kalır.

### 10.3 Neden `slots` JSON?

- Bir zincir en fazla 7 satır; ayrı bir slot tablosu ve join gereksiz.
- Eski istemciler bu tabloyu hiç görmez; şema değişikliği onları etkilemez.
- Sunucu tarafında yalnızca metin uzunluğu doğrulanır; iş kuralı istemcide ve testlerde.
- Gelecekte slot sayısı artarsa JSON büyür; 64 KB sınırı 7 slot için fazlasıyla yeterli.

### 10.4 Değişen dosyalar

- `src/domain/types.ts`: `SchedulePageChain` arayüzü.
- `src/db/db.ts`: v9 store `schedulePageChains: 'id, weekId, rowId, updatedAt, deletedAt'`.
- `src/db/sync/constants.ts`: `schedulePageChains` tablosu, `SYNC_ROW_ID_FIELDS`, `SYNC_TABLE_FIELDS`.
- `api/src/Sync/TableMap.php`: `schedulePageChains` tanımı, alan kuralları.
- `api/migrations/004_page_chain.sql`: tablo + indeksler.
- `scripts/mock-api.mjs`: tablo tanımı, alan listesi, sync/full/status sayıları.
- `src/db/backup.ts`: yedek şema sürümü 7, yeni tablo şeması, dışa/içe aktarma, sayımlar, benzersizlik.
- `src/db/scheduleRepository.ts`: durum değişince recompute; görev düzenle/sil/row sil → zinciri çöz; kopyalama zincir kopyalamaz.
- `src/domain/schedule.ts`: `scheduleTaskStatus` gün bazlı otomatik “Yapılmadı”; `plannedPages` benzersiz sayfa birleşimi.
- Yeni: `src/domain/pageChain.ts` (saf parçalama/atama/parse fonksiyonları).
- Yeni: `src/db/pageChainRepository.ts` (Dexie CRUD, recompute, reconcile).
- Yeni: `src/features/schedule/PageChainModal.tsx`, `PageChainBanner.tsx`.
- `src/features/schedule/WeeklyPlan.tsx`, `WeeklyPlanTable.tsx`, `TaskChip.tsx`.

### 10.5 Görev durumu ile bağlantı

`setTaskStatus(taskId, status)` mevcut işini yaptıktan sonra, görev bir zincire bağlıysa `recomputePageChain(chainId)` çağrılır. Recompute yalnızca bekleyen görevlerin `fromPage`/`toPage` alanlarını ve zincir satırının `slots` JSON'unu günceller; yapılmış/yapılmadı görevlerin aralıklarına dokunmaz.

- Zincir, görevden `weekId` + `taskId` ile bulunur: haftanın aktif zincirleri `weekId` indeksinden okunur, `slots` JSON'u taranır. Haftada en fazla 7 zincir olduğu için ek bir `taskId` indeksi gerekmez.
- Durum değişikliği başarısız olursa recompute çağrılmaz.
- Recompute başarısız olursa durum değişikliği geri alınmaz; kullanıcıya “Zincir güncellenemedi” hatası gösterilir, plan yeniden yüklenince tekrar denenir.
- `updateTask`/`deleteTask` bir zincir görevine dokunuyorsa önce/sonra zincir `deletedAt` ile çözülür; görevler normal görev olarak kalır. İşlem başarısız olursa zincir çözülmez.
- Plan satırı silinirse o satırın zincirleri de çözülür; görevler satırla birlikte silinir.

### 10.6 Hafta yükleme ve reconcile

`WeeklyPlan`, `getOrCreateWeek` ile veriyi okuduktan sonra `reconcileWeekPageChains(weekId)` çağırır. Bu fonksiyon **tüm zincirleri yeniden hesaplar** ve yalnızca değişen görevleri/zincir satırlarını yazar. Böylece:

- Bir cihazda kaçırılan görev diğer cihazda pull sonrası ilk plan açılışında aralıkları düzeltir.
- Recompute yarıda kaldıysa sonraki yüklemede tamamlanır.
- `getWeek`/`getOrCreateWeek` okuyucuları (dashboard, arama, kitap detayı) yan etkili yazma yapmaz; reconcile yalnızca plan ekranının yükleme yolundadır.

Reconcile kuralları:

1. `slots` parse edilemiyor, `slotIndex`/`taskId` tekrarlı, `chunkCount` 2..7 dışında veya `chunkSize` geçersiz → zincir çözülür; görevler normal kalır.
2. Slotun görevi **hiç yok** (satır bulunamadı) → zincir bu yüklemede atlanır; çözülmez, görevlere dokunulmaz. Kısmi bir pull’un geçerli zinciri yok etmesi engellenir. UI “Zincir senkronize ediliyor” uyarısı gösterebilir; sonraki yüklemede görev gelirse devam eder.
3. Slotun görevi var ama `deletedAt` dolu → zincir çözülür; kalan görevler normal kalır.
4. Görev kimliği zincirle uyuşmuyor (`weekId`, `rowId`, `userBookId`, `type='book'`, `dayIndex` slotla eşleşmiyor) → zincir çözülür; kullanıcının elle taşıdığı/düzenlediği görev korunur.
5. Sayfa aralığı orijinal parçadan farklı olabilir; bu bir hata değildir (kaydırma/kaçırma sonucudur). Recompute bekleyenleri yeniden atar; yapılmış/yapılmadı aralıklarına dokunmaz.
6. Görev durumu `completedAt`/`missedAt` ise aralık sabittir; **geçmiş gün + işaretsiz** görev de zincir hesabında yapılmadı sayılır ve aralığı sabit kalır. Yalnızca bugün/gelecek günlerdeki işaretsiz görevler yeniden atanır.
7. Otomatik yapılmadı durumu `missedAt` olarak yazılmaz; yalnızca zincir görevlerinin bekleyen aralıkları güncellenir. Normal görevler otomatik kırmızı çarpı görse de sayfa kaydırmaz.
8. Plan ekranı yeniden görünür olduğunda gün değiştiyse reconcile tekrar çalışır; uygulama gece açık kalsa bile ertesi gün zincir kayar.

### 10.7 Hafta özeti

Zincir kaydırması aynı sayfa aralığını iki görevde gösterebildiği için `summarizeWeek.plannedPages` artık **kitap başına benzersiz sayfa birleşimi** olur: aynı `userBookId`’li görevlerin aralıkları birleştirilir, farklı kitapların sayfaları ayrı ayrı toplanır. `userBookId` yoksa her görev kendi grubunda kalır; görev durumu (yapıldı/yapılmadı) bu toplamı değiştirmez. Böylece:

- 100-150 zincirinde bir gün kaçırıldığında aynı 10 sayfa iki kez sayılmaz.
- Planlanmamış aralık görev olmadığı için “Planlanan sayfa”ya eklenmez; kullanıcı “Planlanmamış” uyarısında görür.
- `taskCount` ve `doneCount` mevcut anlamını korur; yalnızca sayfa toplamı benzersizleştirilir.

## 11. Arayüz

### 11.1 Düğme ve panel

- Plan başlığında **“Sayfa zinciri”** (`Link2` ikonu) düğmesi; “Tik modu” ve “Satır ekle” ile aynı grupta.
- Panel bir `Modal`; mobilde tam genişlik, masaüstünde `max-w-xl`.
- Alanlar:
  - Satır `select` (yalnızca `id` tanımlı satırlar).
  - Gün onay kutuları; dolu günler pasif, `aria-describedby` ile “dolu” açıklaması.
  - Kitap: mevcut `ShelfBookPicker` (raf kitaplarında arama); raf boşsa “Önce Kitaplar sayfasından rafına kitap ekle” ve bağlantı.
  - Başlangıç/bitiş `input type="number" inputMode="numeric"`.
  - Önizleme listesi; `aria-live="polite"`.
  - Hata metni; oluştur düğmesi geçersizken pasif.
- Kitap seçilince “Kaldığın yer: X” ipucu ve “X+1’den başla” düğmesi (opsiyonel hızlandırma).
- Oluşturma sonrası panel kapanır; plan görevleri yenilenir; `aria-live` ile “Zincir oluşturuldu” duyurusu.

### 11.2 Zincir görevi görünümü

- `TaskChip` mevcut üç satırı korur; yalnızca küçük bir `Link2` simgesi ve `sr-only` “Sayfa zinciri” etiketi eklenir.
- Zincir görevi normal görev gibi düzenlenebilir/silinebilir; ancak modalda **“Bu görev bir sayfa zincirinin parçası. Düzenlersen/silersen zincir çözülür.”** uyarısı çıkar.
- Tik modu aynen çalışır; sol tık yapıldı, sağ tık yapılmadı.

### 11.3 Planlanmamış uyarısı

- Planın altında, `WeekSummary` üstünde.
- Her zincir için satır etiketi + aralıklar + “Sonraki boş güne ekle”.
- “Sonraki boş gün”: aynı satırda, zincirin son gününden sonraki ilk boş hücre (1..7). Yoksa düğme pasif.
- Ekleme, yeni görevi **zincire bağlar**: `slotIndex` bir artar, `chunkIndex` planlanmamış aralığın numarası olur, `dayIndex` seçilen boş gün olur. Böylece sonraki kaçırmalarda bu görev de kayabilir ve yeniden “Planlanmamış” uyarısı üretmez.
- Ekleme sonrası zincir yeniden hesaplanır; uyarı güncellenir.
- Birden çok zincir varsa her biri kendi satırında.

### 11.4 Mobil

- Panel tam ekran alt sayfa gibi; gün kutuları iki satırda sarar.
- Plan tablosunda ek bir seçim modu yok; mevcut tek gün görünümü ve tik modu bozulmaz.
- Dokunma hedefleri en az 44 px.

## 12. Kenar durumları

| Durum | Davranış |
|---|---|
| Seçilen günde zaten görev var | Gün pasif; kullanıcı önce mevcut görevi siler. |
| Satır henüz kaydedilmemiş (draft) | Satır seçilemez; “Önce satırı kaydet” ipucu. |
| 2’den az gün | Oluştur pasif; “En az 2 gün seç”. |
| Sayfa aralığı gün sayısına yetmiyor | Hata: “Seçilen aralık 5 güne yetmiyor; en az 5 sayfa gerekli.” |
| Bitiş ≤ başlangıç | Hata. |
| Kitap seçilmemiş | Hata. |
| Kitabın toplam sayfası biliniyor ve bitiş onu aşıyor | Mevcut `validateTaskFields` kuralına uy; hata göster. |
| Aynı satırda ikinci zincir | İzin ver; yalnızca boş günler seçilebilir. |
| Zincir görevini elle düzenleme | Zincir çözülür; kalan görevler normal görev olur. |
| Zincir görevini silme | Zincir çözülür; kalan görevler normal görev olur. |
| Plan satırını silme | O satırdaki zincir çözülür; görevler satırla birlikte silinir. |
| Geçen haftadan kopyalama | Zincir kopyalanmaz; görevler normal görev olarak kopyalanır. |
| Kitap arşivlendi/silindi | Zincir görevleri görünür kalır; yeni ekleme yapılamaz; uyarı gösterilir. |
| Eski istemci görevi günceller | Zincir tablosu etkilenmez; yeni istemci plan açılışında recompute eder. Kimlik alanları (gün/satır/kitap/tür) değişmişse zincir çözülür. |
| Eski istemci görevi siler | Silme tombstone’dur (`deletedAt`); yeni istemci açılışta zinciri çözer, kalan görevler normal kalır. |
| Görev henüz pull edilmedi (satır yok) | Zincir çözülmez; bu yüklemede atlanır, “Zincir senkronize ediliyor” uyarısı gösterilebilir; sonraki yüklemede devam eder. |
| Görev taşınmış (gün/satır/kitap değişmiş) | Zincir çözülür; kullanıcının düzenlediği görev korunur. |
| Geçmiş gün + işaretsiz görev | Görselde otomatik “Yapılmadı” (kırmızı çarpı). Zincir göreviyse zincir kayar; normal görev sayfa kaydırmaz. `missedAt` yazılmaz. |
| Bugünün işaretsiz görevi | “Planlandı” kalır; ertesi gün otomatik “Yapılmadı” olur. |
| Uygulama gece açık kaldı | Plan ekranı yeniden görünür olduğunda gün değişimi algılanır ve reconcile çalışır. |
| `chunkIndex` tekrarı | Geçerlidir: kaçırılan aralık hem eski görevde hem devralan görevde görünür. |
| Çevrimdışı | Zincir oluşturma ve durum değişikliği yerelde çalışır; senkron kuyruğa girer. |
| Recompute sırasında hata | Görev durumu korunur; hata gösterilir; sonraki plan yüklemesinde reconcile tekrar dener. |
| `slots` bozuk JSON | Zincir yok sayılır/çözülür; görevler normal görev olarak kalır; konsola uyarı. |
| Haftada boş gün yok | “Sonraki boş güne ekle” pasif; “Bu haftada boş gün kalmadı” açıklaması. |

## 13. Test planı

### Birim (Vitest)

- `splitPageRange(100, 150, 5)` → 100-109, 110-119, 120-129, 130-139, 140-150.
- `splitPageRange(100, 104, 5)` → 100, 101, 102, 103, 104.
- `chunkCount` olmadan üretimin altıncı bir parça ürettiğini doğrulayan regresyon testi; `chunkCount` ile doğru son parça.
- Geçersiz aralıklar (bitiş ≤ başlangıç, sayfa < gün).
- `assignChainChunks` örnekleri: hiç kaçırma, bir kaçırma, iki kaçırma, geri alma, sıra dışı yapılan gün.
- `parseChainSlots` bozuk JSON, eksik alan, 7’den fazla slot, tekrarlı `taskId`/`slotIndex`, tekrarlı `chunkIndex` kabulü.

### Repository (Dexie / fake-indexeddb)

- Zincir oluşturma: N görev + 1 zincir satırı; görev aralıkları doğru.
- Durum `missed` → bekleyen aralıklar kayar; yapılanlar sabit.
- Durum `done` → sonraki bekleyenler ilerler.
- Durum `pending` → geri alma.
- Planlanmamış aralık hesabı ve “sonraki boş güne ekle”; yeni görevin zincire katılması.
- Görev düzenleme/silme → zincir çözülür.
- Satır silme → zincir çözülür.
- `copyWeek` → zincir kopyalanmaz; görevler normal gelir.
- Reconcile: görev tombstone → zincir çözülür; görev satırı hiç yok → zincir atlanır, çözülmez.
- Reconcile: gün/satır/kitap/tür kimliği değişmiş görev → zincir çözülür.
- Geçmiş haftada saklanan `missedAt` olmasa da otomatik “Yapılmadı” zinciri kaydırır; `missedAt` yazılmaz.
- Bu haftanın geçmiş günü (dün) işaretsizse otomatik “Yapılmadı” olur ve zincir kayar; bugünün işaretsiz görevi kaymaz.
- Normal (zincir dışı) geçmiş görev otomatik “Yapılmadı” görünür ama sayfa kaydırmaz.
- Çoklu zincir aynı haftada; aynı `chunkIndex` iki görevde geçerli.
- `summarizeWeek`: kaçırılan/örtüşen aralıklar benzersiz sayılır; planlanan görev sayısı değişmez.

### Arayüz (React Testing Library)

- Panel açılır; satır/gün/kitap/aralık doğrulaması.
- Önizleme doğru; oluştur düğmesi geçerlilikle değişir.
- Dolu gün pasif.
- Planlanmamış uyarısı ve “Sonraki boş güne ekle”.
- Zincir görevi rozeti ve düzenleme/silme uyarısı.

### Senkron / API (PHPUnit + Vitest)

- `TableMap` yeni tablo alanları ve kuralları.
- Push/pull/full `schedulePageChains` satırını round-trip eder.
- Eski istemci senaryosu: zincir tablosu yokken görev push/pull çalışmaya devam eder.
- Export/delete yeni tabloyu kapsar.
- Mock API contract testleri.

### E2E (Playwright)

1. Zincir panelinden 5 gün, kitap, 100-150 oluştur; 5 görev doğru aralıklarla görünür.
2. Salı’yı sağ tıkla “Yapılmadı”; çarşamba 110-119, cuma 130-139, uyarı 140-150.
3. “Sonraki boş güne ekle” → cumartesi 140-150; görev zincir rozetini taşır.
4. Sayfayı yenile → zincir ve aralıklar korunur.
5. Bu haftanın geçmiş gününü işaretsiz bırak → otomatik “Yapılmadı” ve zincir kayar; normal görev varsa yalnızca çarpı görür.
6. Hafta özetinde kaçırılan aralığın iki kez sayılmadığını doğrula.
7. İki cihaz senaryosu: bir cihazda kaçır, diğerinde senkron sonrası aralıklar aynı.
8. Mevcut plan/tik/kopyalama testleri geçmeye devam eder.

### Migration / yayın

- `004_page_chain.sql` boş DB’de ve mevcut canlı DB’de çalışır; tablo/indeksler oluşur.
- `/api/health` 200; `/api/sync/status` 200.
- Canlıda test hesabıyla zincir oluştur, kaçır, yenile, sil.

## 14. Yayın planı

1. Migration `004_page_chain.sql` eklenir; `api/bin/migrate.php` ile canlıya uygulanır.
2. `TableMap`, sync istemcisi, mock API ve yedek şeması güncellenir.
3. `npm run build`; `dist/` commit edilir; cPanel deploy.
4. Canlıda `/api/health` ve test hesabıyla zincir smoke testi.
5. Beta kullanıcılarına “sayfayı yenileyin / yeni sürümü yükleyin” duyurusu; eski istemciler zincir tablosunu görmez, görevleri normal kullanmaya devam eder.
6. Sorun olursa önceki commit + önceki migration durumu; yeni tablo additive olduğu için geri dönüşte veri kaybı olmaz (tablo kullanılmadan kalır).

## 15. Uygulayıcıya kalanlar

- Modal/panel sınıfları ve tam yerleşim; mevcut `Modal`, `Button`, `Field` desenleri.
- Gün etiketleri ve kısa adlar (`SCHEDULE_DAYS`).
- Hata metinlerinin tam Türkçe ifadeleri.
- Planlanmamış uyarısının tam yeri ve mobil yerleşimi.
- `slots` JSON’unun kesin alan adları ve sürümü; `chunkCount` ve `dayIndex` dahil.
- Recompute’un hangi repository fonksiyonunda tetikleneceği (setTaskStatus / updateTask / deleteTask) ve `reconcileWeekPageChains` çağrısının `WeeklyPlan` yükleme yoluna yerleşimi.
- “Görev yok” ile “tombstone” ayrımının repository testlerinde nasıl kurulacağı.
- Hafta özetinde benzersiz sayfa birleşimini hesaplayan yardımcı fonksiyonun yeri.
- `scheduleTaskStatus` için gün bazlı etkin durum yardımcı fonksiyonunun yeri ve hafta başlangıcı/gün indeksi hesabı.
- Yedek şema sürümü 7 migrasyonunun ayrıntıları.
- Test fixture’ları ve E2E seçicileri.
- Eski istemci uyumluluğu için canlıda hangi sürümün dağıtıldığının kontrolü.

## 16. Onay

Bu tasarım onaylanmadan ürün kodu yazılmaz. Onaydan sonra uygulama planı (`docs/superpowers/plans/…`) çıkarılır ve görevler sırayla uygulanır.
