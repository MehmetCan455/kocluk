# Preview Geri Bildirimi — Sayfa Aralıkları ve Tik Modu (Aşama 1 düzeltmesi)

- Tarih: 2026-11-22
- Durum: Kullanıcı geri bildirimiyle onaylandı
- Ana spec: `docs/superpowers/specs/2026-11-22-kitap-sayfa-takibi-ve-supabase-senkron-design.md`

## 1. Sayfa ilerlemesi: en büyük sayfa değil, okunan aralıkların birleşimi

Mevcut model "son okunan sayfa"yı ilerleme sayıyor. Kullanıcı 0–250'yi okumadan
250–255 girerse 255 sayfa okumuş gibi görünüyor. Bu yanlış.

Yeni kural:

- İlerleme, aktif `book_pages` kayıtlarındaki sayfa aralıklarının **birleşimidir**.
- 250–255 girilirse 6 sayfa sayılır; 0–250 varsayılmaz.
- 1–100 ve 101–200 bitişikse birleşim 200 sayfadır; 50–60 tekrar girilirse
  yalnızca yeni sayfalar eklenir, çift sayılmaz.
- `readPages` = birleşimdeki benzersiz sayfa sayısı.
- `lastPage` = en büyük `toPage` (yalnızca "son sayfa" bilgisi).
- Yüzde = `readPages / totalPages`; %100 yalnızca tüm sayfalar okunduysa.
- Manuel sayfa girişi tek sayı değil, **başlangıç–bitiş aralığı** olur.
- Eski `page_set` kayıtları ilerlemeye sayılmaz; geçmişte "Konum (eski)"
  olarak görünür. Yeni manuel girişler `book_pages` + `source: 'manual'` olur.
- Kitap kartı/detayı "okunan sayfa / toplam" gösterir; ayrıca "Son sayfa"
  bilgisi gösterilebilir.

## 2. Haftalık plan: tik modu, durum renkleri ve kompakt görev çipi

- **Tik modu** geri gelir. Açıkken:
  - sol tık: yapıldı (yeşil),
  - sağ tık: yapılmadı (kırmızı),
  - aynı tık tekrar edilirse işaret kalkar (nötr).
- Normal modda görev çipindeki düzenle/sil düğmeleri yalnızca hover/focus
  sırasında görünür.
- Geçmiş haftalarda işaretlenmemiş görevler otomatik kırmızı görünür.
- Bir hücrede görev varsa altta büyük kesikli `+` kutusu çıkmaz; yalnızca küçük
  bir `+` düğmesi kalır. Boş hücrede büyük `+` kalabilir.
- Görev çipi üç satır:
  1. kitap adı (veya konu/serbest başlık),
  2. konu/ders (kitap görevinde isteğe bağlı `Konu` alanı; boşsa satır etiketi),
  3. `s. 123–128` (veya `Tekrar`).
- Uzun metin karakter karakter kırılmaz; satır `truncate` olur, tam metin
  `title` ile görünür.

## 3. Veri modeli

- `ScheduleTask.missedAt?: string` eklenir. `completedAt` yapıldı, `missedAt`
  yapılmadı demektir; ikisi birden dolu olamaz.
- `setTaskStatus(taskId, 'done' | 'missed' | 'pending')` repository fonksiyonu:
  - done: aktivite kaydı oluşturur, `missedAt` temizler;
  - missed: aktif aktiviteyi siler, `completedAt` temizler;
  - pending: ikisini de temizler, aktiviteyi siler.
- `deleteTask`/`deleteRow` davranışı değişmez: aktivite kayıtları kalır.
- `copyWeek` görevleri işaretsiz kopyalar.
- Backup zod şeması `missedAt` alanını opsiyonel kabul eder; schema v6 kalır.

## 4. Aşama 2 notu

Supabase, hesaplar ve çok cihaz senkronu bu düzeltmenin kapsamında değildir;
Aşama 2'dir. Bu düzeltmeler preview'da onaylandıktan sonra Aşama 2 planı yazılır.

## 5. Kabul testleri

- 480 sayfalık kitapta 250–255: 6/480, %1; 0–250 eklenince 255/480, %53.
- Bitişik/örtüşen aralıklar çift sayılmaz; silinen kayıt düşer.
- Tik modu sol tık yeşil, sağ tık kırmızı, tekrar tık nötr.
- Geçmiş haftada işaretsiz görev kırmızı; tamamlanmış yeşil.
- Görev çipi üç satır ve taşma yapmaz; hover'da düzenle/sil görünür.
- Görevli hücrede büyük alt `+` yok; ikinci görev küçük `+` ile eklenir.
