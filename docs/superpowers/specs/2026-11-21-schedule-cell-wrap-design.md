# Çizelge Hücrelerini Sarmalama ve Duyarlı Tablo Tasarımı

- Tarih: 2026-11-21
- Durum: Onaylandı (2026-11-21)
- Kapsam: Elle ders çalışma çizelgesi (`/program`, `ScheduleTableEditor`)

## 1. Özet

Elle çizelgedeki hücreler şu anda tek satırlık `<input>` alanlarıdır. Uzun metin
kutu içinde sağa doğru kayar ve tabloya bakınca görünmez. Hücreler, yazdıkça
aşağı doğru büyüyen çok satırlı alanlara çevrilecek; metin sütun genişliğinde
satırlara bölünecek ve satır yüksekliği en uzun hücreye göre artacak.

Aynı değişiklikte tablo duyarlı hale gelecek:

- **Telefon (< 720 px):** Aynı anda yalnızca bir gün gösterilecek. Tablonun üstünde
  yedi günlük bir seçici olacak; Ders, seçili gün ve Toplam sütunları ekrana
  sığacak. Günler arasında geçiş yapılabilecek.
- **Tablet ve masaüstü (≥ 720 px):** Yedi günün tamamı tek tabloda, yatay kaydırma
  olmadan ekrana sığacak.

## 2. Neden

Kullanıcı hücreye uzun bir açıklama yazdığında (ör. “2 saat türev tekrarı + 40
soru”) metnin sağa kayması, yazılanı okuyamamasına ve düzeltememesine yol açıyor.
Amaç, tabloya bakan kişinin yazılmış her şeyi olduğu gibi görebilmesi. Telefonda
yedi sütunun tamamını sıkıştırmak okunaksız olduğu için orada gün gün gezinme
tercih ediliyor.

## 3. Hedefler

- Hücre metni sütun içinde sarılsın; satır içeriğe göre aşağı doğru büyüsün.
- Uzun ve boşluksuz metinler (ör. bağlantı) bile hücreyi yatay taşırmasın.
- Telefonda tek gün + ders + toplam görünür ve gün değiştirilebilir olsun.
- Tablet ve masaüstünde yedi gün aynı anda, yatay tablo kaydırması olmadan
  görünsün.
- Mevcut veri modeli, otomatik kaydetme ve erişilebilir etiketler korunsun.

## 4. Hedef olmayanlar

- Veri modeli, IndexedDB şeması veya yedekleme biçimi değişmeyecek.
- Gün sütunlarının sırası, ders listesi veya toplamların otomatik hesaplanması
  değişmeyecek.
- “Haftanın notu” alanının davranışı bu kapsamda değişmeyecek.
- Hücreye tıklayınca ayrı düzenleme penceresi açılmayacak.

## 5. Yaklaşımlar

### A) Otomatik büyüyen çok satırlı hücreler (seçilen)

Her hücrede `rows={1}` ile başlayan, içeriğe göre yüksekliğini ayarlayan bir
`<textarea>` kullanılır. Metin sütun genişliğinde sarar; hücre ve satır büyür.
`ResizeObserver` ile pencere/duyarlı yerleşim değişimlerinde yükseklik yeniden
hesaplanır. Veri ve etiketler aynı kalır.

- Artı: Tabloya bakınca her şey görünür; klavye ve erişilebilirlik davranışı
  standart form alanı gibi kalır; testler `toHaveValue` ile çalışmaya devam eder.
- Eksi: Çok uzun metinlerde satır yüksekliği artar; bu istenen davranış.

### B) Hücreye tıklayınca büyük düzenleme penceresi (reddedildi)

Metin yalnızca pencerede görünür, tabloya bakınca görünmez. Kullanıcının
“tabloya bakılınca her şey gözüksün” isteğini karşılamaz.

### C) Sütunları daraltıp tabloyu her ekrana sığdırmak (tek başına reddedildi)

Telefonda yedi günü sığdırmak için gün başına ~35 px kalır; metin okunaksız olur.
Tablet/masaüstünde sütun genişliklerini esnetmek A ile birlikte kullanılır.

## 6. Kararlar

### 6.1 Hücre alanı

- `AutoGrowTextarea` adında küçük bir bileşen: `value`, `onChange`, `label`,
  `maxLength`, `className` alır.
- Başlangıç yüksekliği en az 44 px; `scrollHeight`e göre büyür, içerik azalınca
  küçülür.
- `resize-none`, `overflow-hidden`, `break-words` (`overflow-wrap: anywhere`).
- Enter yeni satır üretmez; hücreden çıkar (kazara boşlukları önlemek için).
- Hücreler `align-top` hizalanır; satır silme düğmesi üstte kalır.

### 6.2 Duyarlı yerleşim

- Kırılım noktası **720 px**. Altında tek gün, üstünde tam tablo.
- Tam tabloda `table-fixed w-full`, yüzde genişlikler: ders %20, her gün %9,6,
  toplam %12,8. `min-w` ve `overflow-x-auto` kaldırılır.
- Telefonda yüzde genişlikler: ders %36, seçili gün %42, toplam %22.
- Telefonda gün seçici: yedi kısa etiketli (`Pzt`, `Sal`, …) düğme; `aria-pressed`
  ve grup etiketi “Çizelge günü”. Varsayılan seçim Pazartesi; seçim yalnızca
  bileşen durumunda tutulur, kaydedilmez.
- Seçili olmayan gün sütunları telefonda `display:none`, 720 px üstünde görünür.
  Veri tüm günler için bellekte ve veritabanında korunur.
- Gün başlıkları kısa etiket + ekran okuyucu için tam gün adı kullanır; “Toplam”
  başlığı sığsın diye kısaltılır.

### 6.3 Veri ve kaydetme

- `ScheduleTable` tipi, doğrulama ve otomatik kaydetme aynen kalır.
- Telefonda gizli günlerde yapılan değişiklikler kaybolmaz; gizlemek yalnızca
  görünümü etkiler.

## 7. Doğrulama

- Birim testleri: mevcut çizelge testleri geçmeli; hücrelerin textarea olduğu ve
  Enter’ın odak bıraktığı küçük bir test eklenir.
- E2E (Playwright):
  - 390 px’de yalnızca seçili gün sütunu görünür; gün düğmesine basınca o günün
    hücreleri görünür.
  - 768 px’de yedi gün başlığı görünür ve tablo kart içinde yatay kaydırma
    üretmez.
  - Uzun metinli hücrede iç kaydırma olmaz (`scrollHeight <= clientHeight + 1`)
    ve satır yüksekliği artar.
- Mevcut 360 px yatay taşma testi ve program akışı testi korunur; gün değiştirme
  gereken adımlar güncellenir.

## 8. Önizleme ve teslim

- Değişiklik sonrası `npm run build` ve `npm run preview` ile
  `http://localhost:4173/kocluk/` üzerinde çalıştırılır.
- 390, 768 ve 1440 px ekran görüntüleri alınıp kullanıcıya gösterilir.
- İş dalda küçük commit'lerle ilerler; kullanıcı önizlemeyi onaylamadan push
  yapılmaz.

## 9. Uygulayıcıya kalanlar

- `AutoGrowTextarea` bileşeninin dosya yeri ve tam sınıf listesi.
- Gün seçici düğmelerinin odak/hover stilleri; mevcut `Button`/`cn` desenleriyle
  uyum.
- Testlerin dosya yerleşimi ve yardımcı fonksiyonlar.
