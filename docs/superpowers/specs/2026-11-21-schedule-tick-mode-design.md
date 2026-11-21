# Çizelge Tik Modu Tasarımı

- Tarih: 2026-11-21
- Durum: Onay bekliyor
- Kapsam: Elle ders çalışma çizelgesi (`/program`, `ScheduleTableEditor`)

## 1. Özet

Hücre başına 44 px’lik tik onay kutuları kaldırılacak. Onların yerine tablo
başlığına bir **“Tik modu”** düğmesi eklenecek. Mod açıkken gün hücreleri
düzenlenemez birer düğmeye dönüşür; hücreye dokunmak tik durumunu açar/kapatır.
Mod kapalıyken metin alanları eskisi gibi düzenlenir. Tiklerin yeşil arka plan
ve soluk yazı görünümü, kalıcılığı, otomatik kaydetme ve “Tüm tikleri kaldır”
davranışı aynı kalır. Ayrıca en soldaki ders/etkinlik metni 18 px’e büyütülecek
ve kendi kutusunun ortasına hizalanacak.

## 2. Neden

Tik onay kutuları her gün hücresinde 44 px yükseklik ve sürekli görsel gürültü
oluşturuyor. Kullanıcı tikleri toplu atmak istiyor; tek tek kutular yerine bir
mod anahtarı daha az yer kaplar ve dokunmatik kullanımda daha rahattır.

## 3. Hedefler

- Hücre içi tik onay kutuları tamamen kalksın; satırlar kısalsın.
- “Tik modu” düğmesi başlıkta, “Tüm tikleri kaldır” ve “Satır ekle” ile aynı
  grupta olsun.
- Mod açıkken bir gün hücresine dokunmak tik durumunu değiştirsin; metin
  düzenlenmesin.
- Mod kapalıyken metin alanları normal çalışsın; tikli hücreler yeşil/soluk
  görünmeye devam etsin.
- Tik verisi, otomatik kaydetme, yedek uyumu ve “Tüm tikleri kaldır” değişmesin.

## 4. Hedef olmayanlar

- Tik modunun sayfalar arasında hatırlanması; mod yalnızca bileşen durumunda
  tutulur ve yenilemede kapanır.
- Tik modunda metin düzenleme; düzenleme için mod kapatılır.
- Branş denemeleri; ayrı tasarım/plan.

## 5. Yaklaşımlar

### A) Üstte mod düğmesi + hücre düğmesi (seçilen)

Mod açıkken her gün hücresi, hücreyi dolduran bir `<button aria-pressed>` olur.
Dokunma/Enter/Space tik durumunu değiştirir. Mod kapalıyken mevcut
`AutoGrowTextarea` döner.

- Artı: Hücre başına 44 px kutu kalkar; satırlar kısalır; dokunma alanı tüm
  hücre olur; erişilebilir `aria-pressed` durumu korunur.
- Eksi: Tik atmak için önce modu açmak gerekir; kullanıcı bunu kabul etti.

### B) Uzun basınca tik (reddedildi)

Metin düzenleme ile çakışır, keşfedilebilir değil ve mobilde güvenilir değil.

### C) Satır başına tek tik (reddedildi)

Hangi günün yapıldığını göstermez; kullanıcı hücre bazında işaretleme istedi.

## 6. Kararlar

### 6.1 Tik modu düğmesi

- Başlık grubunda en solda: “Tik modu” (ikon `CheckSquare`), yanında “Tüm
  tikleri kaldır”, en sağda “Satır ekle”.
- `aria-pressed={tickMode}`; açıkken `variant="primary"`, kapalıyken
  `variant="secondary"`.
- Mod açıkken başlığın altında küçük bir ipucu: “Kutulara dokunarak tik at
  veya kaldır.”
- Mod kalıcı değildir; sayfa yenilenince kapalı başlar.

### 6.2 Hücre davranışı

- Mod kapalı: mevcut `AutoGrowTextarea`; tikli hücrede `text-muted opacity-80`,
  `<td>` arka planı `bg-success/10`.
- Mod açık: metin alanı yerine hücreyi dolduran bir `<button type="button">`:
  - `aria-label={`${index + 1}. satır ${day.label}${value ? `: ${value}` : ''}`}`
    (hücre metni erişilebilir adın parçası olur),
  - `aria-pressed={row.done[dayIndex]}`,
  - `className` ile tam genişlik, `min-h-11`, solda hizalı, `whitespace-pre-wrap`,
  - boş hücrede görünmez/boş metin; hücre yine tiklenebilir,
  - tıklama `updateRowDone(row.id, dayIndex, !row.done[dayIndex])` çağırır.
- `<td>` üzerinde `data-done={row.done[dayIndex] ? 'true' : undefined}`; testler
  ve durum gözlemi için.
- Tikli hücrede buton metni `text-muted opacity-80`; `<td>` yeşil ton.
- Mod kapalıyken tikli hücrede `<td>` içinde `sr-only` “Tamamlandı” metni
  bulunur; ekran okuyucu tik durumunu duyar.
- Mod açıkken satır silme düğmesi ve gün seçici çalışmaya devam eder.

### 6.3 Ders sütunu

- En soldaki ders/etkinlik alanı `text-lg` (14 → 18 px), `font-semibold` ve
  yatayda `text-center` olur.
- Dikey ortalama için `AutoGrowTextarea` bileşenine `variant` prop’u eklenir:
  `cell` (varsayılan: `text-sm py-2 text-left`) ve `subject`
  (`text-lg py-3 text-center font-semibold`). Ders hücresi
  `variant="subject"` kullanır; gün ve toplam hücreleri `cell` kalır.
- Ders `<td>`’si `align-middle`, iç sarmalayıcı `items-center` kullanır;
  böylece gün hücresi satırı uzattığında ders metni dikeyde ortada kalır.
- Silme düğmesi sağda ve dikeyde ortada kalır; metin alanı `flex-1`.

### 6.4 Veri ve kayıt

- `ScheduleTableRow.done`, repository normalizasyonu, yedek şeması ve otomatik
  kaydetme değişmez.
- “Tüm tikleri kaldır” düğmesi aynı kalır; tik yokken devre dışıdır.

## 7. Doğrulama

- Birim:
  - “Tik modu” başlangıçta kapalı; tıklanınca `aria-pressed` true olur.
  - Mod açıkken gün hücresi düğmesine tıklama tikler; tekrar tıklama kaldırır;
    `<td>` `data-done`/`bg-success/10` ve buton `opacity-80` durumu değişir.
  - Mod kapatılınca metin alanı geri gelir ve değer korunur.
  - “Tüm tikleri kaldır” tik modunda atılan tikleri tek tıkla temizler.
  - Yeniden açılışta tikli hücre yeşil/soluk görünür.
  - Ders sütunu 18 px, kalın ve ortalanmış; gün/toplam hücreleri 14 px kalır.
  - Gün hücresi satırı uzattığında ders metni dikeyde ortada kalır (önizleme).
- E2E:
  - 390 px’te tik modu aç → hücreye dokun → kaydet → yenile → hücre
    `data-done="true"` ve yeşil/soluk.
  - Mevcut genişlik/kaydırma/uzun metin testleri geçmeye devam eder.
- Önizleme: 360/390/768/1024/1440 ekran görüntüleri; tik modu açık ve kapalı
  hâli.

## 8. Uygulayıcıya kalanlar

- Buton ve ipucu sınıfları; mevcut `Button`/`cn` desenleri.
- Tik modu hücre düğmesinin tam `className` listesi.
- `AutoGrowTextarea` `variant` sınıflarının tam listesi.
- E2E’de tik modu akışının mevcut program senaryosuna eklenmesi.
