# Koçluk — YKS Takip Uygulaması Tasarımı

- Tarih: 2026-11-19
- Durum: Onaylandı (2026-11-19)
- Sürüm: v1
- Çalışma adı: Koçluk

## 1. Özet

YKS'ye hazırlanan bir öğrencinin kitaplarını, konu bazında çözdüğü testleri, TYT/AYT denemelerini, yanlış soru fotoğraflarını ve konu notlarını tek yerde tuttuğu, tamamen tarayıcıda çalışan bir takip uygulaması. Uygulama tek bir statik site olarak yayınlanır; telefon, tablet ve bilgisayarda açılır, "ana ekrana ekle" ile uygulama gibi kurulur. Her cihazın verisi kendi tarayıcısında saklanır; hesap, sunucu ve otomatik senkron yoktur. Yedekleme ve cihaz taşıma, zip dosyasıyla elle yapılır.

## 2. Neden

Kullanıcı kitaplarını, test ilerlemesini, deneme sonuçlarını, yanlışlarını ve notlarını şu anda dağınık biçimde takip ediyor. Amaç; "hangi kitapta hangi konudan kaç test kaldı", "deneme netlerim nasıl gidiyor", "bu konudaki yanlışlarım ve notlarım nerede" sorularını tek ekranda ve birkaç tıkla yanıtlamak. Arkadaşları da aynı uygulamayı kendi cihazlarında, kendi verileriyle kullanacak.

## 3. Kullanıcılar ve senaryolar

- **Ana kullanıcı:** YKS öğrencisi, ağırlıklı olarak Windows bilgisayardan kullanıyor.
- **Arkadaşlar:** Telefon veya tabletten, paylaşılan linkle açıyor. Her biri kendi verisini tutuyor; birbirinin verisini görmüyor.
- **Tipik akışlar:**
  1. Konu çalışırken "Bilgi Sarmal TYT Matematik'ten Türev'de 6 testten 5'ini çözdüm" diye kaydeder.
  2. Deneme sonrası ders bazında doğru/yanlış/boş girer, netler otomatik çıkar.
  3. Yanlış soruların fotoğrafını çeker, ders/konu etiketler.
  4. Boş zamanda fotoğraflardan rastgele bir tekrar testi oluşturur.
  5. Konuya özel notunu yazar veya notunun fotoğrafını yükler; konudan tek tıkla ulaşır.
  6. Ana sayfada kitap yüzdelerini ve deneme net grafiğini görür.

## 4. Hedefler, hedef olmayanlar, anti-hedefler

### Hedefler
- TYT ve AYT'yi ayrı bölümlerde, ders → konu → test hiyerarşisiyle göstermek.
- Her konuda birden çok kitap ve test kaydı tutabilmek; kalan test ve yüzdeyi otomatik hesaplamak.
- Kitap bazında toplam ilerlemeyi ana sayfada göstermek.
- TYT/AYT denemelerini ders bazında kaydetmek, net trendini grafikle göstermek.
- Konu başına not ve dosya ekleyebilmek; notlara konudan doğrudan ulaşmak.
- Deneme yanlışlarının fotoğraflarını arşivlemek ve bu fotoğraflardan filtreli rastgele test üretmek.
- Siyah zemin + ayarlardan değiştirilebilir vurgu rengi.
- Telefon, tablet ve PC'de sorunsuz çalışan, çevrimdışı kullanılabilen, kurulabilir bir PWA.
- Veriyi cihazda tutmak; zip yedek/geri yükleme ile taşınabilirlik sağlamak.

### Hedef olmayanlar (v1)
- Kullanıcı hesabı, bulut, otomatik cihazlar arası senkron.
- Arkadaşlarla veri paylaşımı veya sosyal özellikler.
- Soru bankası içeriği, soru çözme motoru, yapay zekâ, OCR.
- YDT/Dil sınavı takibi.
- Bildirim/hatırlatıcı servisleri.
- Açık tema.

### Anti-hedefler
- Veri kaybına yol açan sessiz hatalar.
- İnternet olmadan açılmayan uygulama.
- Mobilde kullanılamayan masaüstü arayüzü.
- Karmaşık kurulum; arkadaşın "dosya çalıştıramadım" demesi.
- Kullanıcıyı yüzlerce alanla boğan formlar.

## 5. Seçilen yaklaşım ve alternatifler

### A) Dosyadan açılan yerel site (reddedildi)
Site klasörü paylaşılır, `index.html` açılır. Veri yine tarayıcı deposundadır, klasörde değildir. Tabletlerde yerel dosya açmak ve tarayıcı deposunu korumak güvenilir değil; iOS'ta veri temizlenme riski var. Bu yüzden reddedildi.

### B) Statik PWA + GitHub Pages (seçildi)
Tek kod tabanı, tek link. Kullanıcı linki açar; uygulama önbelleğe alınır, ana ekrana eklenir, çevrimdışı çalışır. Veri IndexedDB'de cihazda kalır. Arkadaşlara link göndermek yeterlidir. Güncelleme tek yerden yapılır. İlk açılış için internet gerekir.

### C) Yerel sunucu + klasörde veri (reddedildi)
PC'de Node.js sunucusu, fotoğraflar diskte klasörde. Veri sahipliği ve yedekleme açısından güçlü; ancak arkadaşların tabletinde çalıştırmak gerçekçi değil (iPad'de Node yok). Kullanıcının "herkes kendi cihazında" isteğiyle çelişiyor.

### Neden B
Tek kodla üç platform, mağaza gerektirmemesi, kurulum kolaylığı, çevrimdışı çalışma ve verinin cihazda kalması. Verinin klasörde görünmemesi kabul edildi; karşılığında zip yedek ve geri yükleme var.

## 6. Ürün yapısı

### 6.1 Navigasyon

**Masaüstü (≥1024px):** Sol sabit menü.
- Ana Sayfa
- TYT
- AYT
- Denemeler
- Yanlışlar
- Kitaplar
- Alt kısımda: Ayarlar, profil adı, kurulum durumu.

**Mobil/tablet:** Üstte logo + arama + ayarlar; altta 5 sekme: Ana Sayfa, TYT, AYT, Denemeler, Yanlışlar. Kitaplar ana sayfadan ve aramadan erişilir.

**Rotalar (HashRouter):**
- `/` ana sayfa
- `/tyt`, `/tyt/:subjectId`, `/tyt/:subjectId/:topicId`
- `/ayt`, `/ayt/:subjectId`, `/ayt/:subjectId/:topicId`
- `/denemeler`, `/denemeler/yeni`, `/denemeler/:id`
- `/yanlislar`, `/yanlislar/test`, `/yanlislar/test/:sessionId`
- `/kitaplar`, `/kitaplar/:id`
- `/ayarlar`

### 6.2 Sayfa sayfa

#### Ana Sayfa
```
┌──────────────────────────────────────────────────────────┐
│ Günaydın, Deniz                        [Ara]  [Ayarlar]  │
│ Bugün 19 Kasım 2026 · YKS'ye 213 gün                     │
├──────────────────────────────────────────────────────────┤
│  Genel ilerleme   TYT %34   AYT %12   Çözülen test 128   │
│  ▓▓▓▓▓▓░░░░░░░░░░  (büyük halka/çubuk)                   │
├───────────────────────────────┬──────────────────────────┤
│ Kitaplar                      │ Deneme net grafiği        │
│ Bilgi Sarmal TYT Mat  %83     │      ╱╲    ╱              │
│ 3D AYT Fizik          %41     │  ╱╲╱  ╲__╱                │
│ ...               [Tümü →]    │ TYT son 8 deneme          │
├───────────────────────────────┴──────────────────────────┤
│ Son denemeler                         Hızlı ekle          │
│ 17 Kas TYT · 78.25 net                [+ Deneme]          │
│ 15 Kas AYT · 41.50 net                [+ Yanlış foto]     │
│                                       [+ Test]            │
└──────────────────────────────────────────────────────────┘
```
- YKS'ye kalan gün: sınav tarihi ayarlardan değiştirilebilir (varsayılan: YKS 2027 ilk oturum tarihi; kullanıcı günceller).
- Genel ilerleme: görünür derslerdeki test kayıtlarının çözülen/toplamı.
- Kitap kartları: son güncellenen 5 kitap + "Tümü".
- Net grafiği: son 8 deneme, TYT/AYT geçişi.
- Yedek hatırlatması: son yedekten bu yana 30 gün geçtiyse veya 100+ yeni fotoğraf varsa ince bir uyarı şeridi.

#### TYT / AYT
- Ders kartları: ders adı, ikon, konu sayısı, genel yüzde, "devam eden konu" bilgisi.
- AYT sayfasında alan filtresi: Sayısal / Eşit Ağırlık / Sözel / Tümü. Varsayılan, ayarlardaki alan seçimidir; gizlenen dersler listelenmez.
- Ders sayfası: başlık + ders genel yüzdesi; konu listesi (yüzde çubuğu, çözülen/toplam test, kalan); filtre: Tümü / Devam edenler / Bitenler; "Konu ekle".
- Konu sayfası sekmeleri: **Testler**, **Notlar**, **Yanlışlar**.
  - Testler: kitap/test kayıtları; her satırda kitap adı, `5/6 test`, yüzde, kalan; ekle/düzenle/sil.
  - Notlar: zengin metin editörü + dosya ekleri.
  - Yanlışlar: bu konuya etiketlenmiş fotoğraflar + "rastgele test" kısayolu.

#### Denemeler
- Üstte TYT/AYT/Tümü filtresi ve net trend grafiği; AYT'de alan filtresi.
- Liste: tarih, deneme adı, tür, toplam net, ders mini çubukları.
- "Yeni deneme": tür, ad, tarih, ders satırları (D/Y/B), not, fotoğraf ekleme.
- Detay: ders tablosu (D/Y/B/net), toplam net, grafikteki yeri, bağlı yanlış fotoğrafları, düzenle/sil.

#### Yanlışlar
- Özet: toplam fotoğraf, çözülen, bu hafta eklenen.
- Filtre çubuğu: tür, ders, konu, deneme, çözüm durumu, tarih, metin arama.
- Galeri: küçük resimler; seçim modu; "Seçilenlerden test oluştur".
- Fotoğraf detayı: büyük görsel, not, etiketler, deneme bağlantısı, düzenle/sil, "çözüldü" işareti.
- "Rastgele test" sihirbazı: filtreler → adet → karıştır → oturum.

#### Kitaplar
- Tüm kitaplar: ad, yayınevi (varsa), kullanıldığı ders(ler), toplam ilerleme, çözülen/toplam test.
- Kitap detayı: konu konu test kayıtları; düzenle/sil; yeni konuya ekle.

#### Ayarlar
- Profil adı.
- Görünüm: vurgu rengi (hazır palet + özel renk), önizleme. Zemin her zaman siyah.
- Sınav tarihi ve sınav adı.
- Yedekleme: yedek indir, yedekten geri yükle, son yedek tarihi.
- Depolama: kullanılan alan, fotoğraf sayısı, kalıcı depolama izni durumu.
- Uygulama: kurulum yönergeleri (iOS/Android/PC), paylaş linki, sürüm.
- Tehlikeli bölge: tüm verileri sil (iki adımlı onay).

## 7. Özellik detayları

### 7.1 Ders, konu ve test takibi

- TYT ve AYT dersleri uygulamayla birlikte gelir; konu listeleri MEB/YÖK güncel müfredatına göre **ünite düzeyinde** seed edilir (ör. "Türev", "Polinomlar"; kazanım düzeyinde değil). Hedef: ders başına 10-35 konu, toplam ~250-350 konu. Liste geliştirici tarafından resmi müfredattan hazırlanır; uygulama içinden düzenlenebilir.
- Her ders ve konu için kararlı bir `seedKey` tutulur (ör. `tyt-mat-turev`). `settings.seedVersion` ile sürüm izlenir. Güncellemede eksik seed konuları `seedKey` ile eklenir; mevcut kayıtların adı/verisi ezilmez, kaldırılan seed konular silinmez.
- Dersler sabittir; konular yeniden adlandırılabilir, yeni konu eklenebilir. Seed konular silinemez; kullanıcı konuları kendi düzenine göre ekleyebilir.
- Bir özel konu silinirse: bağlı test kayıtları, not ve ekleri silinir; o konuya etiketli fotoğrafların `topicId` alanı boşaltılır (fotoğraflar kalır); geçmiş test oturumları korunur. Onay ekranında etkilenecek kayıt sayıları gösterilir.
- Ders görünürlüğü ayarlardan yönetilir (bkz. 7.9); gizlenen dersler yüzde hesaplarına katılmaz, verileri korunur.
- Bir konuya birden çok kitap eklenebilir. Her kayıt: kitap, o kitapta bu konudaki toplam test sayısı, çözülen test sayısı.
- Aynı kitap farklı konularda kullanılabilir; kitap ilerlemesi tüm konulardaki kayıtların toplamından hesaplanır.
- Doğrulama: toplam test ≥ 1, çözülen ≥ 0, çözülen ≤ toplam. Ondalık girilemez.
- Konu yüzdesi: `sum(çözülen) / sum(toplam)`. Kayıt yoksa "Henüz test eklenmedi".
- Durum: %0 "Başlanmadı", %1-99 "Devam ediyor", %100 "Bitti".
- Test kaydı düzenlendiğinde tüm yüzdeler anında güncellenir.

### 7.2 Kitaplar

- Kitap global bir varlıktır: ad, yayınevi (opsiyonel), not (opsiyonel).
- Kitabın dersi, kullanıldığı konulardan türetilir. Tek ders kullanılıyorsa ders adı; birden fazlaysa "TYT/AYT" gibi özet gösterilir.
- Kitap silinirse bağlı test kayıtları da silinir; onay istenir ve etkilenen konu sayısı gösterilir.
- Aynı isimde kitap uyarısı verilir ama engellenmez.

### 7.3 Denemeler

- Tür: TYT veya AYT.
- AYT denemesinde opsiyonel alan bilgisi (Sayısal / Eşit Ağırlık / Sözel / Genel) saklanır; form satırları ayarlardaki görünür derslere göre gelir, kullanıcı satır ekleyip çıkarabilir.
- Alanlar: deneme adı (ör. "3D TYT 5"), tarih, not.
- Ders sonuçları: doğru, yanlış, boş. Boş opsiyonel (varsayılan 0). Bir satır tamamen boşsa "girilmedi" sayılır ve toplama katılmaz.
- Net: `doğru - yanlış / 4`. Toplam net, girilen derslerin netlerinin toplamıdır.
- Aynı gün birden çok deneme girilebilir.
- Grafikler: toplam net trendi (son 10), ders bazında net trendi, son deneme ile önceki deneme farkı. AYT grafiğinde alan filtresi (Sayısal/EA/Sözel/Genel) vardır; alanı girilmemiş denemeler "Genel" sayılır.
- Deneme fotoğrafları: denemeye bağlı yanlış fotoğrafları; her fotoğrafın dersi ve opsiyonel konusu vardır.
- Silme onayı; denemeye bağlı fotoğraflar silinmez, bağlantısı kopar (fotoğraflar Yanlışlar'da kalır).

### 7.4 Konu notları

- Her konunun tek bir zengin metin notu vardır (TipTap).
- Biçimler: kalın, italik, başlık, madde işaretli/numaralı liste, alıntı, vurgu, bağlantı, satır içi kod.
- Otomatik kaydetme (800 ms debounce); "Kaydedildi" göstergesi.
- Dosya ekleri: görsel (jpg/png/webp) ve PDF. Görseller en fazla 2000 px'e küçültülür; PDF'ler olduğu gibi saklanır. Dosya başına üst sınır 20 MB.
- Ekler: önizleme, indir/aç, sil.
- Not içeriği HTML olarak saklanır; gösterimde ve içe aktarmada DOMPurify ile temizlenir.
- Not metni global aramaya dahil edilir.

### 7.5 Yanlış fotoğrafları

- Yükleme: dosya seç veya mobilde kamera. Çoklu seçim desteklenir.
- Her fotoğraf için: tür (TYT/AYT), ders (zorunlu), konu (opsiyonel), deneme (opsiyonel), not (opsiyonel), tarih (varsayılan bugün).
- Fotoğraf, yükleme sırasında en uzun kenar 1600 px olacak şekilde JPEG'e sıkıştırılır; ayrıca 400 px küçük resim üretilir. Orijinal dosya saklanmaz; sıkıştırılmış sürüm saklanır.
- Durum: `çözülmedi` / `çözüldü`. Rastgele testte doğru → çözüldü, yanlış → tekrar çözülmedi (bkz. 7.6); kullanıcı elle de değiştirebilir.
- Deneme silinse bile fotoğraf kalır; `denemeId` boşalır.
- Galeri filtreleri: tür, ders, konu, deneme, durum, tarih aralığı, metin.
- Toplu seçim: seçilenleri sil, etiket değiştir, test oluştur.

### 7.6 Rastgele test

1. Filtre: tür (TYT/AYT/karışık), ders(ler), konu(lar) (opsiyonel), deneme (opsiyonel), sadece çözülmemişler (varsayılan açık).
2. Adet: 5, 10, 20 veya tümü. Yeterli fotoğraf yoksa uyarı + mevcut sayı.
3. Karıştır ve oturum başlat.
4. Oturum ekranı: fotoğraf büyük görünür; yakınlaştırma/kaydırma; "Notu göster" düğmesi; "Doğru", "Yanlış", "Boş" işaretleme; ileri/geri; ilerleme çubuğu.
5. Her cevap işaretlendiği anda kaydedilir (`practiceSessions.results` + fotoğraf durumu). Uygulama kapansa bile oturum kaldığı yerden devam eder.
6. Durum geçişi: Doğru → `mastered = true`; Yanlış → `mastered = false` (daha önce çözüldüyse geri alınır); Boş → durum değişmez. `practiceCount` ve `lastPracticedAt` her cevapta güncellenir.
7. Oturum sonu özeti: doğru/yanlış/boş sayısı, süre.
8. Oturum geçmişi: son 10 **tamamlanmış** oturum; yarıda kalanlar "Devam eden test" olarak ayrıca gösterilir ve kaldığı yerden sürdürülebilir. Oturum yeniden açıldığında sıradaki soru, henüz sonuçlanmamış ilk fotoğraftır. Oturum iptal edilebilir; iptal edilmiş cevaplar geri alınmaz. v1'de analitik grafiği yok.

### 7.7 Ana sayfa

- Bölümler: karşılama + sınav geri sayımı, genel istatistikler, kitap ilerlemeleri, deneme net grafiği, son denemeler, hızlı ekleme, yedek uyarısı.
- Genel istatistikler: toplam çözülen test, toplam test, genel yüzde, TYT yüzdesi, AYT yüzdesi, deneme sayısı.
- "Hızlı ekle" düğmeleri: Deneme, Yanlış fotoğrafı, Test kaydı (konu seçtirir).
- Mobilde tek sütun; masaüstünde iki sütunlu düzen.

### 7.8 Arama

- Üst çubuktan açılan komut paleti benzeri arama.
- Aranan: ders/konu adı, not metni, kitap adı, deneme adı, fotoğraf notu.
- Sonuçlar gruplu; tıklayınca ilgili sayfaya gider.
- Türkçe küçük/büyük harf duyarlılığı: `toLocaleLowerCase('tr-TR')`.
- Boş sorguda son konular ve hızlı bağlantılar.

### 7.9 Ayarlar ve tema

- Zemin sabit siyah; açık tema yok.
- Vurgu rengi hazır palet: mavi (varsayılan), indigo, mor, turkuaz, yeşil, amber, turuncu, pembe, kırmızı. Ek olarak özel renk seçici.
- Renk CSS değişkenleriyle uygulanır: `--accent`, `--accent-soft`, `--accent-strong`, `--accent-contrast`.
- Vurgu rengi; butonlar, aktif menü, ilerleme çubukları, grafik çizgileri, odak halkaları ve seçili durumlarda kullanılır.
- Metin kontrastı için vurgu renginin parlaklığına göre siyah/beyaz metin seçilir.
- Profil adı, sınav tarihi, sınav adı.
- AYT alanı: Sayısal / Eşit Ağırlık / Sözel / Tümü (varsayılan Tümü). Seçim, görünür dersleri önceden işaretler; kullanıcı tek tek açıp kapatabilir.
- Görünür dersler: TYT ve AYT dersleri için onay kutuları. Gizlenen dersler menülerde ve deneme formunda görünmez; verileri silinmez, yüzde hesaplarına katılmaz.
- Alan → ders eşlemesi: Sayısal (Matematik, Geometri, Fizik, Kimya, Biyoloji); Eşit Ağırlık (Matematik, Geometri, Edebiyat, Tarih-1, Coğrafya-1, Tarih-2, Coğrafya-2, Felsefe Grubu, Din Kültürü); Sözel (Edebiyat, Tarih-1, Coğrafya-1, Tarih-2, Coğrafya-2, Felsefe Grubu, Din Kültürü); Tümü (hepsi).
- Tema değişikliği anında uygulanır ve cihazda saklanır.

### 7.10 Yedekleme ve geri yükleme

- "Yedek indir": `kocluk-yedek-YYYY-MM-DD-HHmm.zip`.
- Zip içeriği:
  - `manifest.json`: sürüm, tarih, uygulama sürümü, tablo sayıları.
  - `veri.json`: tüm tablolar (blob'lar hariç).
  - `fotograflar/yanlislar/<id>.jpg`
  - `fotograflar/notlar/<id>.<uzantı>`
  - `ekler/` (PDF vb.)
- "Yedekten geri yükle": zip seç → doğrula → özet göster (tarih, deneme/fotoğraf/not sayısı) → "Mevcut verilerin değiştirilecek" onayı → atomik olarak tüm veritabanını değiştir.
- v1'de birleştirme yok; geri yükleme tamamen değiştirir.
- Şema sürümü eskiyse migrasyon uygulanır; yeniyse uyarı verilir.
- İçe aktarmada HTML notlar DOMPurify ile temizlenir; zod ile şema doğrulanır.
- Yedek hatırlatıcısı: son yedekten 30 gün geçince veya 100+ yeni fotoğraf eklenince ana sayfada şerit.

### 7.11 Depolama

- IndexedDB (Dexie). Fotoğraflar Blob olarak.
- Açılışta `navigator.storage.persist()` istenir (destekleyen tarayıcılarda).
- Ayarlar'da `navigator.storage.estimate()` ile kullanılan/tahmini kota gösterilir.
- Kota aşımı riskine karşı yükleme sırasında hata yakalanır ve anlaşılır mesaj verilir.

### 7.12 İlk açılış (onboarding)

- 4 adımlı kısa karşılama: isim, AYT alanı (Tümü dahil), vurgu rengi, "konular hazır / veriler cihazında / yedek almayı unutma".
- "Başla" deyince seed veri yüklenir ve ana sayfaya geçilir.
- Daha önce veri varsa onboarding gösterilmez.

## 8. Veri modeli

Dexie tabloları (ID'ler `crypto.randomUUID()`):

| Tablo | Alanlar |
|---|---|
| `settings` | `key` (PK), `value` |
| `subjects` | `id` (PK), `seedKey` (unique), `exam` (`TYT`/`AYT`), `name`, `slug`, `icon`, `order` |
| `topics` | `id` (PK), `seedKey` (unique, sadece seed), `subjectId`, `name`, `order`, `isCustom`, `createdAt` |
| `books` | `id` (PK), `name`, `publisher`, `note`, `createdAt`, `updatedAt` |
| `topicBooks` | `id` (PK), `topicId`, `bookId`, `totalTests`, `solvedTests`, `createdAt`, `updatedAt`; indeksler: `topicId`, `bookId` |
| `exams` | `id` (PK), `type`, `name`, `date`, `alan?`, `note`, `createdAt`; indeks: `type`, `date` |
| `examResults` | `id` (PK), `examId`, `subjectId`, `correct`, `wrong`, `blank`, `net`; indeks: `examId`, `subjectId` |
| `photos` | `id` (PK), `examId?`, `examType`, `subjectId`, `topicId?`, `note`, `blob`, `thumbBlob`, `width`, `height`, `mastered`, `practiceCount`, `lastPracticedAt?`, `createdAt`; indeks: `examId`, `subjectId`, `topicId`, `createdAt` (`mastered` boolean olduğu için indekslenmez, filtre bellekte) |
| `notes` | `topicId` (PK), `contentHtml`, `plainText`, `updatedAt` |
| `attachments` | `id` (PK), `topicId`, `name`, `mime`, `size`, `blob`, `createdAt`; indeks: `topicId` |
| `practiceSessions` | `id` (PK), `createdAt`, `updatedAt`, `completedAt?`, `filters` (JSON), `photoIds` (dizi), `results` (JSON: fotoId → doğru/yanlış/boş) |

Notlar:
- `examResults.net` hesaplanmış değerdir; yine de saklanır (hızlı listeleme). Güncellemede yeniden hesaplanır.
- `photos.examType` deneme silinse de kalır.
- `topics` seed kayıtları `isCustom: false`; kullanıcı ekledikleri `true`.
- `subjects`/`topics` seed kayıtları `seedKey` ile eşlenir; uygulama güncellemesinde eksikler eklenir, mevcut kayıtlar ezilmez.
- `settings` anahtarları: `profileName`, `accent`, `examDate`, `examName`, `onboardingDone`, `lastBackupAt`, `schemaVersion`, `seedVersion`, `aytAlan`, `hiddenSubjects`.

## 9. Hesaplamalar ve kurallar

- Net: `correct - wrong / 4`; 2 ondalık, Türkçe biçim (`78,25`).
- Konu yüzdesi: `solved / total`; 0-100 arası, tam sayı gösterim.
- Ders yüzdesi: dersin tüm topicBook kayıtlarının toplamı.
- Sınav türü yüzdesi: o türdeki görünür derslerin toplamı.
- Genel yüzde: görünür derslerdeki tüm topicBook kayıtlarının toplamı.
- Gizlenen derslerin verileri korunur; yalnızca menü, form ve yüzde hesaplarının dışında kalır.
- Kitap yüzdesi: kitabın tüm topicBook kayıtlarının toplamı.
- Boş test: toplam > çözülen.
- Bir konuda test kaydı yoksa yüzde hesabına katılmaz; "başlanmadı" sayılır.
- Tarihler ISO string; gösterim `tr-TR` (`19 Kas 2026`).
- Para/sayı biçimlendirme `Intl.NumberFormat('tr-TR')`.

## 10. Tasarım sistemi

### Renkler
- Zemin: `#07080A`
- Yüzey: `#0F1218`
- Yükseltilmiş yüzey: `#161A22`
- Kenarlık: `#232A36`
- Metin: `#F5F7FA`
- İkincil metin: `#98A2B3`
- Varsayılan vurgu: `#3B82F6` (mavi)
- Başarı: `#22C55E`, uyarı: `#F59E0B`, hata: `#EF4444`

### Tipografi
- Sistem font yığını: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Başlıklar 600-700, gövde 400-500.
- Sayısal verilerde `font-variant-numeric: tabular-nums`.

### Bileşenler
- Kart, ilerleme çubuğu, halka, sekme, modal, drawer, toast, boş durum, iskelet yükleme.
- İkonlar: lucide-react.
- Dokunma hedefleri en az 44×44 px.
- Odak halkası vurgu rengiyle.
- Mobilde alt menü; güvenli alan (safe-area) desteği.
- Hareket: 150-200 ms geçişler; `prefers-reduced-motion` desteği.

### Grafikler
- Chart.js (react-chartjs-2).
- Çizgi grafik: net trendi; alan dolgusu vurgu renginin %10'u.
- Ders karşılaştırması için sabit kategorik palet (mavi, mor, yeşil, amber, kırmızı, turkuaz).
- Eksenler koyu tema; grid çizgileri `#232A36`.
- Grafiklerde tooltip Türkçe.

### Wireframe — konu sayfası (mobil)
```
← TYT Matematik
Türev                         %83
▓▓▓▓▓▓▓▓▓░ 5/6 test

[Testler] [Notlar] [Yanlışlar]

┌─────────────────────────────┐
│ Bilgi Sarmal TYT Mat        │
│ 6 testten 5'i çözüldü       │
│ 1 test kaldı         %83    │
└─────────────────────────────┘
[+ Kitap / test ekle]

Notlar sekmesi:
┌─────────────────────────────┐
│ B    I    H1   •   1.       │
│ Türev kuralları...          │
│                             │
│ [görsel] [PDF]              │
└─────────────────────────────┘
Kaydedildi · 2 dk önce
```

## 11. Teknoloji

- **React 19 + TypeScript + Vite 7**
- **Tailwind CSS 4** (tasarım sistemi, koyu tema)
- **Dexie 4** (IndexedDB)
- **React Router 7** (`HashRouter` — GitHub Pages uyumu)
- **Zustand** (ayarlar/UI durumu)
- **TipTap** (not editörü)
- **Chart.js + react-chartjs-2**
- **JSZip + file-saver** (yedek)
- **zod** (şema doğrulama)
- **DOMPurify** (not temizleme)
- **date-fns** (tr-TR)
- **lucide-react** (ikonlar)
- **vite-plugin-pwa** (manifest + service worker)
- **Vitest + React Testing Library** (birim/component)
- **Playwright** (E2E; mobil viewport dahil)

Kod organizasyonu:
```
src/
  app/            # router, layout, providers
  components/     # ortak UI
  features/
    dashboard/
    subjects/
    topics/
    books/
    exams/
    photos/
    notes/
    practice/
    settings/
    backup/
  db/             # Dexie şeması, migrations, seed
  data/           # curriculum.ts, accent palettes
  lib/            # hesaplamalar, tarih, format, görsel sıkıştırma
  styles/
```

- Sunucu yok; tüm işlemler istemcide.
- Dış ağ isteği yok; font ve ikonlar paket içinde.
- Hassas veri yok; analitik yok.

## 12. PWA / çevrimdışı / kurulum

- `manifest.webmanifest`: ad, kısa ad, tema rengi siyah, arka plan siyah, 192/512 px ikonlar, maskable ikon.
- Service worker: uygulama kabuğunu önbelleğe alır; `registerType: 'prompt'`; yeni sürüm hazır olduğunda "Yenile" toast'ı.
- Çevrimdışı: ilk yüklemeden sonra tüm sayfalar açılır; veri zaten yerel.
- Kurulum: iOS Safari "Ana Ekrana Ekle"; Android Chrome "Uygulamayı yükle"; PC Chrome/Edge adres çubuğundaki kurulum ikonu.
- iOS'ta depolama temizlenme riskine karşı: kurulum teşviki, `persist()` denemesi, yedek hatırlatıcısı.

## 13. Yayın

- GitHub Pages (public repo). Repo adı ASCII: `kocluk`.
- URL: `https://<kullanici>.github.io/kocluk/`.
- Vite `base: '/kocluk/'`; HashRouter sayesinde alt sayfa 404'ü olmaz.
- GitHub Actions ile otomatik build/deploy.
- Aynı statik çıktı Cloudflare Pages/Netlify'a da taşınabilir.
- README: kurulum, yayın, arkadaşlarla link paylaşımı, yedekleme talimatı.
- Kod public; veri repo'da yok. Repo'ya örnek veri veya kişisel veri konmaz.

## 14. Test

### Birim
- Net hesaplama (doğru/yanlış/boş, ondalık).
- Konu/ders/kitap/genel yüzde.
- `solved > total` doğrulaması.
- Rastgele test seçimi: filtreler, adet, yeterli fotoğraf yoksa davranış.
- Mastery geçişleri: doğru → çözüldü, yanlış → tekrar çözülmedi, boş → değişmez.
- Yarıda kalan oturumun kalıcılığı ve devamı.
- Seed ekleme: `seedKey` ile eksik konuyu ekleme, mevcut kaydı ezmeme.
- Gizlenen dersin yüzde dışında kalması.
- Özel konu silme: test/not/ek cascade, fotoğraf bağlantısını koparma.
- Yedek serileştirme/geri yükleme round-trip (blob'lar dahil).
- Tarih/numara biçimlendirme (tr-TR).
- Arama normalizasyonu (İ/ı).

### Component
- Test kaydı formu doğrulaması.
- Deneme formu: boş satırlar, net önizleme.
- Tema değişimi.
- Fotoğraf yükleme akışı (mock canvas).

### E2E (Playwright)
- İlk açılış → onboarding → ana sayfa.
- TYT → ders → konu → kitap/test ekle → yüzdelerin güncellenmesi.
- Deneme ekle → net ve grafik.
- Fotoğraf yükle → filtrele → rastgele test → oturum tamamla.
- Rastgele testi yarıda bırak → geri dön → devam et.
- AYT alan filtresini değiştir → ders listesinin ve yüzdelerin güncellenmesi.
- Not yaz → yenile → not kalıcı.
- Yedek indir → verileri sil → geri yükle → veriler aynı.
- Vurgu rengi değiştir → yenile → kalıcı.
- Mobil viewport (390×844) ve masaüstü (1440×900).

### Manuel
- iOS Safari (kurulum, kamera, dosya yükleme).
- Android Chrome.
- Windows Chrome/Edge.
- Çevrimdışı mod.
- Yavaş cihazda fotoğraf galerisi.

### Kabul kriterleri (v1)
- Konuya test kaydı 3 dokunuştan eklenebiliyor.
- Deneme netleri otomatik ve doğru.
- Fotoğraf telefondan kamerayla yüklenebiliyor.
- Rastgele test filtreli çalışıyor ve sonuçları kaydediyor.
- Zip yedek → geri yükleme veri kaybı olmadan çalışıyor.
- İlk yüklemeden sonra çevrimdışı açılıyor.
- 360 px genişlikte yatay kaydırma yok.
- Vurgu rengi anında değişiyor ve kalıcı.
- Lighthouse PWA "kurulabilir".

## 15. Riskler ve önlemler

| Risk | Önlem |
|---|---|
| Tarayıcı verisinin silinmesi / iOS temizliği | `persist()`, kurulum teşviki, düzenli yedek hatırlatıcısı, zip yedek |
| Fotoğrafların kotayı aşması | Sıkıştırma, küçük resim, depolama göstergesi, hata mesajı |
| iOS'ta HEIC fotoğrafların açılmaması | Kamera girişi JPEG üretir; HEIC seçilirse açıklayıcı hata ve JPEG'e çevirme önerisi |
| GitHub Pages limitleri | 1 GB site / 100 GB trafik; uygulama birkaç MB, kullanıcı sayısı az |
| Kodun public olması | Kişisel veri yok; istenirse Cloudflare Pages + private repo |
| Cihazlar arası senkron olmaması | Açıkça belirtilir; yedek/geri yükleme akışı |
| Not HTML'inde XSS | DOMPurify, içe aktarmada zod doğrulama |
| Seed konu listesinin eksik/eski olması | `seedKey` + `seedVersion` ile eksik konuları ekleme; mevcut kayıtları ezmeme; liste düzenlenebilir |
| Gizlenen dersin yanlışlıkla veri kaybı | Gizleme yalnızca görünürlük; veri silinmez, geri açılabilir |
| Büyük zip'in mobilde oluşturulamaması | JSZip streaming/parça parça; hata mesajı ve harici yedek önerisi |
| PWA güncellemesinde veri kaybı | Dexie kalıcı; güncelleme öncesi otomatik yedek önerisi |

## 16. v1 kapsam dışı

- Hesaplar, bulut, otomatik senkron, cihazlar arası paylaşım.
- YDT/Dil.
- Bildirimler, takvim entegrasyonu.
- OCR ile fotoğraftan soru metni çıkarma.
- Soru bankası / video / konu anlatımı.
- Sosyal özellikler (arkadaş listesi, sıralama).
- Çoklu profil (aynı cihazda birden çok öğrenci).
- Açık tema.
- PDF'e not alma / çizim.

## 17. Benim kararlarım (kontrol et)

Bunları konuşmadık; aşağıdaki gibi karar verdim. Yanlışsa söyle:
1. **Notlar:** Düz metin değil, zengin metin editörü + görsel/PDF ekleri.
2. **Deneme girişi:** Ders bazında doğru/yanlış/boş; net otomatik. Toplam net, girilen derslerin toplamı.
3. **Ders listesi:** TYT'de Matematik ve Geometri ayrı; AYT'de de ayrı. Deneme formunda geometriyi matematikten ayırıp ayırmamak kullanıcıya bırakılır.
4. **Kitap modeli:** Kitap global; dersi kullanıldığı konulardan türer. Aynı kitap birden çok konuda kullanılabilir.
5. **Seed konular:** MEB/YÖK güncel listesi hazır gelir; yeniden adlandırılabilir, yeni konu eklenebilir; seed konular silinemez.
6. **Rastgele test:** Filtre + adet + oturum + doğru/yanlış/boş işaretleme + son 10 oturum geçmişi.
7. **Tema:** Sadece koyu; vurgu rengi 9 hazır renk + özel renk seçici.
8. **Yedek:** Tek zip; geri yükleme mevcut veriyi tamamen değiştirir (birleştirme yok).
9. **Yayın:** GitHub Pages, public repo, ASCII repo adı `kocluk`.
10. **Teknoloji:** React + TypeScript + Vite + Tailwind + Dexie + TipTap + Chart.js + PWA.
11. **Navigasyon:** Masaüstünde sol menü, mobilde alt 5 sekme; Kitaplar ana sayfa/arama üzerinden.
12. **Sınav tarihi:** Ayarlardan değiştirilebilir; varsayılan YKS 2027 ilk oturum tarihi.
13. **Seed kapsamı:** Ünite düzeyinde, ders başına 10-35 konu, toplam ~250-350 konu; liste geliştirici tarafından resmi müfredattan hazırlanır.
14. **Seed güncellemesi:** `seedKey` + `seedVersion`; güncellemede eksik seed konuları eklenir, mevcut veriler ezilmez.
15. **AYT alanı:** Ayarlarda Sayısal/Eşit Ağırlık/Sözel/Tümü; görünür dersler buna göre filtrelenir, veri silinmez; gizlenen dersler yüzdelere katılmaz.
16. **Yanlış fotoğrafı durumu:** Doğru → çözüldü; yanlış → tekrar çözülmedi; boş → değişmez. Her cevap anında kaydedilir; yarıda kalan test devam ettirilebilir.
17. **Özel konu silme:** Test/not/ekler silinir; fotoğrafların konu bağlantısı kopar, fotoğraflar kalır; oturum geçmişi korunur.
18. **Kullanıcı onayı (19 Kas 2026):** Uygulama adı şimdilik "Koçluk"; notlar zengin metin + görsel/PDF eki; kullanıcının AYT alanı **Sayısal** (onboarding'de seçilecek; uygulamanın genel varsayılanı Tümü).

## 18. Açık sorular

- Kesin YKS 2027 sınav tarihi (varsayılan girilecek; kullanıcı ayarlardan güncelleyebilir).
- GitHub kullanıcı adı / repo adı (yayın aşamasında netleşecek).
