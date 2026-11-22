# Kitap Sayfa Takibi, Haftalık Plan ve Supabase Senkronu — Tasarım

- Tarih: 2026-11-22
- Durum: Onaylandı (2026-11-22)
- Sürüm: v1
- Kapsam: Kitap sistemi yenilemesi + hesaplar + çok cihaz senkronu

## 1. Özet

Koçluk'un kitap takibi sayfa bazlı bir modele geçiyor. Kitaplar ortak bir katalogda
tutuluyor; kullanıcı katalogdan kitap seçip rafına ekliyor ve okuduğu sayfayı
giriyor. Kitabın yüzdesi "okunan sayfa / toplam sayfa" olarak hesaplanıyor. Asıl
kullanım yeri haftalık ders çalışma planı: plana "Bilgi Sarmal TYT Matematik,
s. 210–220" gibi bir görev ekleniyor; görev tiklenince kitap ilerlemesi kendiliğinden
kaydediliyor. Aynı yerden konu tekrarı görevleri de verilebiliyor.

Uygulama hesap tabanlı oluyor. Herkes kendi hesabıyla giriş yapıyor; verisi
Supabase'de kendine özel tutuluyor ve cihazları arasında senkronlanıyor. Kitap
kataloğu ortak, kullanıcı verileri birbirinden izole. Uygulama çevrimdışı çalışmaya
devam ediyor: veriler önce cihazdaki IndexedDB'ye yazılıyor, internet gelince
Supabase'e gönderiliyor. Fotoğraflar ve ekler bu sürümde cihazda kalıyor; mimari
ileride Supabase Storage'a taşınabilecek şekilde kuruluyor.

## 2. Neden

Mevcut kitap sistemi, bir kitabın ilerlemesini konu başına elle girilen
"toplam test / çözülen test" kayıtlarının toplamından hesaplıyor. Kitabın gerçek
toplamı hiçbir yerde olmadığı için:

- Yüzde yalnızca kullanıcının kayıt girdiği konuları kapsıyor; kitabın tamamını
  temsil etmiyor.
- Aynı kitap 20 konuya bölündüğünde 20 kez sayı girmek gerekiyor.
- "Kitabın %60'ı bitti" sorusunun tek ve doğru bir cevabı olmuyor.

Kullanıcı sayfa bazlı ilerlemeyi daha doğal buluyor: "340 sayfanın 120'sindeyim".
Ayrıca ilerlemeyi ayrı bir ekranda ikinci kez girmek istemiyor; haftalık planda
tiklediği görev neyse ilerleme oradan otomatik işlenmeli. Hesaplar ve senkron,
aynı veriyi telefonda ve bilgisayarda görmek için isteniyor.

Başarı ölçütü:

- Katalogdan seçilen bir kitabın yüzdesi, sadece o kitabın sayfa sayısına göre
  doğru hesaplanır.
- Haftalık planda bir kitap görevi tiklenince kitap yüzdesi kendiliğinden
  güncellenir; kullanıcı başka ekranda tekrar sayı girmez.
- Aynı hesap iki cihazda açıldığında kitap, plan, konu ve deneme verileri görünür.
- İnternet yokken plan tiklenebilir; internet gelince senkronlanır.
- Bir kullanıcı diğerinin verisini göremez.
- Mevcut yerel veriler ve fotoğraflar kaybolmaz.

## 3. Kullanıcılar ve senaryolar

- **Ana kullanıcı:** YKS öğrencisi; ağırlıklı olarak telefon ve bilgisayar
  kullanıyor. Kitaplarını ve haftalık planını takip ediyor.
- **Arkadaşlar:** Paylaşılan bağlantıdan kendi hesabını açıyor; kendi verisini
  tutuyor. Kitap kataloğunu ortak görüyor, başka kullanıcının verisini görmüyor.
- **Tipik akışlar:**
  1. Kullanıcı "Bilgi Sarmal TYT Matematik" kitabını katalogdan rafına ekler.
     Katalogdan 480 sayfa gelir; baskısı farklıysa 472 olarak düzeltir.
  2. Pazar akşamı haftalık planı hazırlar; çarşamba gününe "s. 210–220" görevini
     ekler.
  3. Çarşamba görevi tikler. Kitabın okunan sayfası 220 olur, yüzde güncellenir.
     Aynı görevi ikinci kez tiklemek ilerlemeyi şişirmez.
  4. Yanlış tiklerse tik kaldırılır; ilerleme kaydı geri alınır.
  5. Aynı planda "Türev konu tekrarı" görevi verir; tikleyince konu tekrar
     geçmişine bir kayıt düşer, konu "bitti" olmaz.
  6. Konu sayfasına girip konuyu bitmiş olarak işaretler; ders yüzdesi bu
     işaretlerden hesaplanır.
  7. Telefonda tiklediği görev, bilgisayarda birkaç saniye içinde görünür.
  8. Metrodalersa internet olmadan tikler; eve gelince senkron tamamlanır.

## 4. Hedefler, hedef olmayanlar, anti-hedefler

### Hedefler

- Kitap ilerlemesini sayfa bazlı, kitabın tamamına göre hesaplamak.
- Ortak kitap kataloğu: ad, yayınevi, sınav, ders, sayfa sayısı, baskı bilgisi.
- Kullanıcının kendi rafı: katalogdan ekleme, özel kitap ekleme, sayfa sayısını
  düzeltme, arşivleme.
- Haftalık, tarihli plan; önceki haftadan kopyalama; görev tipleri:
  kitap sayfası, konu tekrarı, serbest görev.
- Görev tiklenince ilerlemeyi otomatik kaydetmek; tik kaldırılınca geri almak.
- Konu takibini ayrı tutmak: konu bitirme işareti ve tekrar geçmişi.
- Hesap açma, giriş, çıkış; kullanıcı verisinin Supabase'de izole tutulması.
- Yapısal verilerin cihazlar arası senkronu; çevrimdışı çalışma.
- Mevcut yerel verilerin hesaba tek seferlik taşınması.
- Zip yedek/geri yüklemenin yeni modelle uyumlu devam etmesi.

### Hedef olmayanlar (bu sürüm)

- Fotoğraf, ek ve çizelge dosyalarının buluta senkronu. Bunlar cihazda kalır.
  Mimari, ileride Supabase Storage'a taşınabilecek şekilde ayrılır.
- Koç/öğrenci rolleri, bir kullanıcının başkasının verisini görme özelliği.
- Sosyal özellikler, sıralama, liderlik tablosu, paylaşım.
- Uygulama içinden ortak kataloğa kitap ekleme/düzenleme veya moderasyon.
- Yeni modelde test sayısı takibi. Eski test kayıtları yalnızca arşiv olarak
  görüntülenir.
- Test sayısı, soru sayısı, süre gibi ikinci bir ilerleme metriği.
- Otomatik yedekleme servisi; zip yedeği elle alınmaya devam eder.
- Bildirim/hatırlatıcı servisleri.

### Anti-hedefler

- Aynı ilerlemeyi iki farklı ekranda iki kez girmek.
- İnternet olmadan görev tikleyememek.
- Görev tikini kaldırınca geçmişin sessizce bozulması veya ilerlemenin geri
  gitmemesi.
- Kitap yüzdesinin yine kısmi kayıtlardan hesaplanması.
- Mevcut veriyi, fotoğrafları veya eski planı taşırken kaybetmek.
- Kullanıcıyı ilk açılışta onlarca alanla boğmak.
- Senkron hatasının veri kaybı gibi görünmesi.

## 5. Seçilen yaklaşımlar ve alternatifler

### 5.1 Kitap ilerleme modeli

- **A) Kitap = ders, sayfa bazlı ilerleme (seçildi).** Her kitabın bir dersi ve
  toplam sayfası var. İlerleme, okunan en yüksek sayfa / toplam sayfa. Konu
  takibi ayrı bir "konu bitti" işareti. En az tık, en anlaşılır sonuç.
- **B) Sayfa kaydı + konu etiketi.** Her sayfa güncellemesinde konu seçilir.
  Daha zengin veri, ama her girişte ekstra seçim; kullanıcının şikayet ettiği
  yükü geri getirir. Reddedildi.
- **C) Kitabın içindekilerini kataloğa koymak.** Ünite/konu sayfa aralıkları
  katalogda olur, sayfa ilerledikçe konular otomatik ilerler. En "akıllı" model,
  ama her kitap ve baskı için bölüm verisi girmek/bakmak gerekir; katalog
  sürdürülemez. Reddedildi.

### 5.2 Plan modeli

- **A) Sabit, tekrar kullanılan tablo (mevcut).** Haftalar aynı tabloyu kullanır.
  Tik geçmişi ve ilerleme kaydı haftalar birbirine karışır; tikleri temizlemek
  geçmişi siler. Reddedildi.
- **B) Tarihli haftalık plan (seçildi).** Her haftanın kendi planı vardır.
  Yeni hafta, önceki haftadan kopyalanabilir. Tikler yeni haftada temiz başlar;
  geçmiş kayıtlar ve istatistikler kalır. İlerleme doğru güne yazılır.
- **C) Tarihli görev listesi.** Takvim benzeri tek liste. Esnek, ama mevcut
  7 günlük tablo düzenini kaybettirir. Reddedildi.

### 5.3 Senkron mimarisi

- **A) Kendi hafif senkron motoru (seçildi).** Dexie yerel veritabanı + Supabase.
  Küçük, sadece ihtiyaç duyulan tablolar için kuyruk ve çekme mantığı. Ek servis,
  ek ücret ve vendor bağımlılığı yok. Veri modeli (ekleme-only ilerleme
  kayıtları, küçük satırlar) bu yaklaşıma uygun.
- **B) Hazır senkron servisi (PowerSync, RxDB vb.).** Daha az özel kod, ama yeni
  servis, limit/ücret, öğrenme ve entegrasyon yükü. Bu ölçek için gereksiz.
  Reddedildi.
- **C) Bulut-only.** Supabase doğrudan kaynak; çevrimdışı yazma yok. Mevcut PWA
  deneyimini bozar. Reddedildi.

### 5.4 Senkron kapsamı

- **A) Her şey, fotoğraflar dahil.** En eksiksiz, ama Supabase Storage kotası,
  yükleme süresi ve daha karmaşık senkron. Bu sürümde reddedildi.
- **B) Yalnızca yapısal veriler.** Kitaplar, plan, konular, denemeler, notlar
  senkron; fotoğraflar ve ekler cihazda. Seçildi.
- **C) Önce B, sonra fotoğraflar.** Aynı mimariyle başlanır; fotoğraf senkronu
  ayrı bir aşamada eklenir. Yol haritası olarak benimsendi.

## 6. Ürün tasarımı

### 6.1 Hesap ve ilk açılış

- Uygulama hesap gerektirir. Giriş yapılmamışsa tam ekran giriş/kayıt ekranı
  gösterilir. İlk açılış internet gerektirir; oturum açıldıktan sonra uygulama
  çevrimdışı çalışır.
- Giriş yöntemi: e-posta + şifre (Supabase Auth). Bu sürümde e-posta onayı
  kapalıdır; arkadaş ölçeğinde SMTP kurulumu ve e-posta limitleriyle uğraşmamak
  için. Genel açılışa çıkmadan önce onay ve şifre sıfırlama açılmalı.
- Kayıt sonrası sıra:
  1. Profil satırı oluşturulur.
  2. Bu cihazda eski `kocluk` veritabanı ve anlamlı veri var mı diye bakılır.
     Varsa "Bu cihazdaki verileri hesabına aktar" ekranı gösterilir; kullanıcı
     yedek indirebilir.
  3. Hesap için yerel veritabanı açılır (`kocluk-u-<userId>`).
  4. Buluttan veri çekilir.
  5. Bulut boş ve eski yerel veri varsa: önce eski veri kopyalanır (ID'ler
     korunur), sonra yalnızca eksik müfredat `seedKey` ile tamamlanır. Müfredat
     baştan tohumlanmaz; böylece eski `subjects`/`topics` ID'leri ve bunlara
     bağlı not/fotoğraf/ekler bozulmaz.
  6. Bulut boş ve eski veri yoksa: müfredat tohumlanır ve yüklenir.
  7. Bulut dolu ve eski yerel veri varsa: otomatik birleştirme yapılmaz.
     Kullanıcıya "Hesabında zaten veri var; bu cihazdaki eski veriler
     taşınmadı, yedek olarak duruyor" denir. İsterse yedek indirir. Bu, iki
     cihazda birbirinden habersiz oluşmuş veriyi yanlış birleştirmekten daha
     güvenlidir.
  8. Eski ayarlar kopyalanmışsa ve `onboardingDone` true ise onboarding
     atlanır; yoksa mevcut onboarding (ad, AYT alanı, vurgu rengi) gösterilir.
- "Boş başla" seçilirse eski veritabanı silinmez. Ayarlar → Hesap altında
  "Bu cihazdaki eski verileri aktar" düğmesi kalır; kullanıcı daha sonra tekrar
  deneyebilir. Aynı taşıma idempotenttir; yarıda kalan aktarım tekrar çalışır.
- Çıkış: senkron bekleyen kayıt varsa uyarılır; yerel veritabanı silinmez.
  Başka hesapla giriş yapılırsa o hesabın kendi yerel veritabanı açılır; önceki
  hesabın fotoğrafları cihazda kalır.
- Oturum çevrimdışıyken korunur. Uygulama, kullanıcı kimliğini `getSession` ile
  yerel oturumdan alır; her açılışta ağ üzerinden `getUser` çağırmaz.
- Ayarlar ekranında hesap bilgisi (e-posta, görünen ad) ve çıkış bulunur.
  Kullanıcının kendi hesabını silmesi bu sürümde kapsam dışıdır; `auth.users`
  silmek servis rolü veya Edge Function gerektirir. Gerekirse yönetici
  tarafından yapılır ve ileride ayrı bir aşamada eklenir.

### 6.2 Kitap kataloğu ve raf

**Katalog (ortak, okunur):**

- Kitap adı, yayınevi, sınav (TYT/AYT), ders (müfredat slug'ı), toplam sayfa,
  baskı/yıl, isteğe bağlı kapak görseli.
- Katalog yönetici tarafından SQL tohumuyla güncellenir. Uygulama içinden ortak
  kataloğa yazılmaz.
- Başlangıç tohumu: popüler YKS yayınlarından 20–30 kitap. Sayfa sayıları
  doğrulanabildiği kadar; her kitapta `edition` alanı. Yanlış sayfa sayısı
  kullanıcı tarafından kendi rafında düzeltilebilir.
- Katalog araması: ad, yayınevi, ders, sınav. Sonuç yoksa "Kendi kitabımı ekle".

**Raf (kullanıcıya özel):**

- Katalogdan eklenen kitap `user_books` satırı oluşturur. Aynı katalog kitabı bir
  kullanıcıda yalnızca bir kez rafta olur.
- Özel kitap: ad ve toplam sayfa zorunlu; yayınevi, sınav ve ders isteğe
  bağlıdır. Ders seçilmezse "Genel" gösterilir. Katalogda yoksa bu yol
  kullanılır; kitap yalnızca o kullanıcıya görünür.
- Sayfa sayısı geçersizse (boş/0) kitap rafta görünür ama ilerleme hesaplanmaz;
  "Sayfa sayısını gir" uyarısı çıkar.
- Durum: `active`, `archived`, `completed`. %100 olan kitap otomatik `completed`
  olur; kullanıcı arşivleyebilir. Arşivlenen kitap yeni plan görevlerinde
  varsayılan listede görünmez; geçmiş kayıtları korunur.
- Kitap silme: varsayılan arşivleme. Kalıcı silme yalnızca onayla ve tüm
  görev/ilerleme kayıtlarıyla birlikte; geçmiş kaydı olan kitap için önce arşiv
  önerilir.

**Kitap detay ekranı:**

- Üstte ring/yüzde, "220 / 480 sayfa", "260 sayfa kaldı", son okuma tarihi.
- "Sayfa güncelle" alanı: "Şu an kaçıncı sayfadasın?" Bu giriş mutlak bir
  `page_set` kaydı oluşturur ve mevcut sayfayı düzeltmeye de yarar. Örneğin
  yanlışlıkla 220 girildiyse 180 girilerek düzeltilebilir; sonraki plan tikleri
  bu yeni tabandan ileri sayar.
- İlerleme geçmişi: tarih, sayfa aralığı, kaynak (plan görevi / manuel /
  düzeltme). Manuel kayıtlar geçmişten silinebilir; silinince önceki tabana
  dönülür.
- Bu kitapla ilişkili plan görevleri (geçmiş ve gelecek) listelenir.
- Kitap düzenleme:
  - Katalogdan gelen kitapta yalnızca toplam sayfa ve kullanıcı notu
    düzenlenebilir. Ad, yayınevi, sınav ve ders ortak katalog verisidir;
    istemci bu alanları değiştiremez (RLS).
  - Özel kitapta ad, yayınevi, sınav, ders, toplam sayfa ve not düzenlenebilir.
- Toplam sayfa, okunan sayfanın altına düşürülürse uyarı gösterilir; okunan
  sayfa silinmez, yüzde %100'de kalır.
- Kitap yüzdesi: `min(100, round(okunanSayfa / toplamSayfa * 100))`. Okunan
  sayfa hesabı 7.2'de tanımlıdır; `page_set` düzeltmeleri dikkate alınır.

**Kitaplar sayfası:**

- Raf kartları: kitap adı, yayınevi, ders, yüzde, sayfa ilerlemesi.
- Filtre: sınav, ders, durum (aktif/biten/arşiv). Arama.
- "Kitap ekle" → katalog arama + özel kitap.
- Boş durumda katalogdan ekleme yönlendirmesi.

### 6.3 Haftalık plan

**Yapı:**

- Hafta pazartesi başlar; `weekStart` tarihi `YYYY-MM-DD`.
- Her haftanın kendi satırları ve görevleri vardır. Hafta gezinmesi: önceki /
  sonraki hafta, "Bu hafta" düğmesi.
- Satırlar ders veya serbest etiket olabilir. Bir satırın dersi varsa o satırdaki
  görevler varsayılan olarak o dersi kullanır; kullanıcı değiştirebilir.
- Masaüstünde 7 günlük tablo; mobilde mevcut davranış gibi tek gün sütunu ve gün
  seçici.
- Bir hücrede birden çok görev olabilir. Görev çipleri alt alta listelenir.
- Hücreye tıklama: "Görev ekle" modalı, ilgili gün ve satır ön seçili.
- Haftanın notu korunur (tek metin alanı).

**Görev tipleri:**

1. **Kitap sayfası:** raf kitabı + başlangıç sayfa + bitiş sayfa. Aralık
   kapsayıcıdır (210–220 = 11 sayfa). Doğrulama: 1 ≤ başlangıç ≤ bitiş ≤ toplam
   sayfa. Kitabın toplam sayfası yoksa görev kaydedilemez.
2. **Konu tekrarı:** ders + konu. Açıklama isteğe bağlı. Konu bitmiş sayılmaz.
3. **Serbest görev:** başlık/açıklama. İlerleme etkisi yok.

**Tik davranışı:**

- Kitap görevi tiklenince tek işlemde:
  - görev `completedAt` alır,
  - `activity_logs` tablosuna `type: 'book_pages'`, `userBookId`, `fromPage`,
    `toPage`, `taskId`, `source: 'task'` kaydı eklenir.
- Konu tekrarı tiklenince `type: 'topic_review'`, `topicId`, `taskId` kaydı
  eklenir.
- Serbest görev yalnızca `completedAt` alır.
- Tik kaldırılınca görev `completedAt` alanını kaybeder ve o göreve bağlı
  aktivite kaydı silinmiş olarak işaretlenir. Kitap yüzdesi yeniden hesaplanır.
- Aynı görev için ikinci bir aktivite kaydı oluşmaz; görev–aktivite ilişkisi
  benzersizdir.
- Görev silinirse plan kaydı gider; tamamlanmış görevin aktif aktivite kaydı
  kalır. İlerlemeyi geri almak isteyen önce tiki kaldırır. Silme onayında bu
  açıklanır.
- Aktivite kayıtları değiştirilmez; yalnızca silinmiş işaretlenir. Tamamlanmış
  görevin sayfa aralığı düzenlenirse eski aktivite silinmiş işaretlenir ve aynı
  görev için yeni bir aktivite eklenir. Böylece geçmiş bozulmadan düzeltilir.
- Yeniden tikleme de aynı yolu izler: eski kayıt silinmiş kalır, yeni aktif kayıt
  oluşur. Bir görevin aynı anda yalnızca bir aktif aktivitesi olur.

**Hafta kopyalama:**

- "Geçen haftadan kopyala" satırları ve görevleri kopyalar; görevler tamamlanmamış
  gelir, aktivite kayıtları kopyalanmaz. Haftanın notu kopyalanmaz (boş başlar).
- Kopyalama, hedef haftada zaten satır/görev varsa onay ister.
- Kopyalanan satır ve görevlerin kimlikleri deterministiktir: hedef hafta +
  kaynak satır/görev kimliğinden türetilir. İki cihaz aynı haftayı çevrimdışı
  kopyalasa bile sunucuda çoğalmaz; aynı satırlar birleşir.

**Toplamlar:**

- Eski elle "TOPLAM SÜRE/SORU" satırı kaldırılır. Yerine otomatik özet:
  planlanan görev sayısı, tamamlanan görev sayısı, planlanan sayfa, okunan sayfa.
- Haftanın notu ve isteğe bağlı serbest etiketler kalır.

**Bugünün planı:**

- Ana sayfada "Bugünün planı" kartı: bugüne düşen görevler, hızlı tik.
  (Kitap/konu/plan yönetiminin tek yerden yapılmasını destekler.)

### 6.4 Konu ve ders takibi

- Konu sayfasında "Konu durumu": başlanmadı / bitti. Bu sürümde ikili işaret;
  "başladım" ayrı bir durum değil. Konu tekrarı kayıtları "başladı" sinyali
  olarak gösterilir ama ders yüzdesini etkilemez.
- Ders yüzdesi: biten konu / toplam konu. (Görünür dersler üzerinden.)
- Konu sayfası detay ekranı:
  - bitirme anahtarı,
  - tekrar geçmişi (tarih, plan görevi),
  - notlar ve fotoğraflar (mevcut),
  - eski test kayıtları (varsa, salt okunur arşiv).
- Ders sayfası ve ana sayfa yüzdeleri bu yeni kaynaktan beslenir; kitaplar artık
  ders yüzdesine karışmaz.
- Kitap yüzdesi ile ders yüzdesi ayrı gösterilir; etiketlerde karışıklık
  yaratmamak için "Kitap ilerlemesi" ve "Konu ilerlemesi" denir.

### 6.5 Ana sayfa ve diğer ekranlar

- Ana sayfa:
  - Bugünün planı (tiklenebilir),
  - ders yüzdeleri (biten konu),
  - aktif kitaplar ve sayfa yüzdeleri,
  - deneme net grafiği (mevcut),
  - sınav geri sayımı.
- Kitaplar sayfası yeni raf/katalog modeline geçer.
- Arama: kitap adı, yayınevi, ders, konu; yeni tabloları kapsar.
- Denemeler, yanlışlar, notlar, fotoğraflar, pratik testleri mevcut akışında
  kalır; yalnızca veri katmanı senkrona uyumlu hale gelir.

### 6.6 Eski verilerin görünümü

- Eski `topicBooks` test kayıtları silinmez. Konu sayfasında "Eski test
  kayıtları" başlığı altında salt okunur gösterilir; yeni ilerlemeye katılmaz.
- Eski `books` kayıtları yeni rafa taşınır:
  - Katalogda normalize edilmiş ad + yayınevi eşleşmesi varsa katalog kitabına
    bağlanır. Birden çok baskı eşleşirse en yeni `edition` seçilir; eşitlikte
    deterministik katalog kimliği. Sayfa sayısı katalogdan gelir.
  - Eşleşme yoksa özel kitap olur; sayfa sayısı boş gelir, kullanıcı doldurur.
  - Ders/sınav, kitabın eski test kayıtlarındaki konuların çoğunluğundan
    türetilir. Birden çok derse dağılmışsa veya hiç kayıt yoksa ders boş
    ("Genel"), sınav boş kalır; kullanıcı düzenleyebilir.
  - Aynı katalog kitabına birden çok eski kitap eşleşirse tek raf kitabına
    birleştirilir; eski test kayıtları kendi eski kitap kimlikleriyle arşivde
    kalır.
  - `Book.note` alanı `userBooks.note` alanına taşınır.
  - Eski test kaydı olan kitaplar `active` durumda başlar.
- Eski serbest metin çizelgesi (`scheduleTables`, `id: 'main'`) silinmez;
  Program sayfasında "Eski çizelge" başlığı altında salt okunur gösterilir.
  Yeni haftalık plan boş başlar. İsteğe bağlı olarak "Nota kopyala" düğmesi
  eklenebilir (builder kararı).
- Konu bitirme durumu taşınırken: eski kayıtlarda `totalTests > 0` ve
  `solvedTests >= totalTests` olan konular `done` başlar. Kısmi konular
  başlanmamış sayılır; eski test kayıtları yine görünür.

### 6.7 Hesap açma ve yerel veri taşıma

- Eski yerel veritabanı adı `kocluk`; hesap veritabanı `kocluk-u-<userId>`.
- İlk girişte eski veritabanında anlamlı veri varsa taşıma ekranı gösterilir:
  - "Yedek indir" (mevcut zip yedeği, eski veritabanından),
  - "Hesabıma aktar" (önerilen, yalnızca bulut boşsa),
  - "Boş başla" (eski veri cihazda kalır; hesap boş açılır).
- Taşıma yalnızca hesabın bulutu boşken yapılır. Bulut doluysa otomatik
  birleştirme yoktur; kullanıcı yedek indirir, eski veri cihazda kalır.
- Taşıma, veriyi kopyalar; eski veritabanını silmez. Hata olursa eski veri
  sağlam kalır ve tekrar denenebilir. Kopyalama sırasında eski `subjects` ve
  `topics` kimlikleri korunur; not, fotoğraf, ek ve gizli ders referansları
  kırılmaz. Kopyalama sonrası yalnızca eksik müfredat `seedKey` ile eklenir.
- Eski ayarlar kopyalanır: profil adı, sınav adı/tarihi, AYT alanı, gizli
  dersler, geometri modu, onboarding durumu, müfredat sürümü. Vurgu rengi ve
  çizelge modu cihaz ayarı olarak kalır.
- Kopyalananlar: tüm yapısal tablolar, fotoğraflar, ekler, pratik oturumları,
  çizelge dosyaları, eski tablolar. Blob'lar dahil.
- Taşıma sonrası yapısal veriler Supabase'e yüklenir. Fotoğraflar yüklenmez.
- "Boş başla" sonrası Ayarlar → Hesap altındaki "Eski verileri aktar" düğmesi
  ile taşıma yeniden başlatılabilir; bulut doluysa aynı güvenlik kuralı geçerlidir.
- İlerleme çubuğu ve "Aktarılıyor…" durumu gösterilir; uygulama kapatılırsa
  kaldığı yerden devam eder (idempotent `put`).
- Taşıma tamamlanınca özet: kaç kitap, konu, deneme, not, fotoğraf aktarıldı.

## 7. Veri modeli

### 7.1 Yeni yerel tablolar (Dexie v6)

Mevcut tablolar korunur. Yeni tablolar eklenir; eski `books` ve `topicBooks`
"legacy" olarak kalır.

| Tablo | Alanlar | Not |
|---|---|---|
| `catalogBooks` | id, ownerId?, title, publisher?, exam?, subjectSlug?, totalPages, edition?, createdAt, updatedAt, deletedAt? | Ortak katalog önbelleği + özel kitaplar |
| `userBooks` | id, bookId, totalPagesOverride?, note?, status, startedAt?, createdAt, updatedAt, deletedAt? | Kullanıcının rafı |
| `activityLogs` | id, type ('book_pages'\|'page_set'\|'topic_review'), userBookId?, topicId?, fromPage?, toPage?, taskId?, source ('task'\|'manual'), createdAt, deletedAt? | Ekleme-only ilerleme/tekrar kayıtları; değiştirilmez, yalnızca silinmiş işaretlenir |
| `scheduleWeeks` | id, weekStart, note, createdAt, updatedAt, deletedAt? | Haftalık plan |
| `scheduleRows` | id, weekId, subjectId?, label, order, createdAt, updatedAt, deletedAt? | Ders/serbest satır |
| `scheduleTasks` | id, weekId, rowId, dayIndex, type, userBookId?, fromPage?, toPage?, topicId?, title?, completedAt?, createdAt, updatedAt, deletedAt? | Plan görevleri |
| `topicProgress` | id, topicId, done, doneAt?, updatedAt, deletedAt? | Konu bitirme |
| `syncQueue` | id, table, rowId, op, payload?, createdAt, attempts, lastError? | Gönderim kuyruğu |
| `syncMeta` | key, value | Kullanıcı, cihaz, son çekme zamanları |

Mevcut tablolara senkron alanları eklenir:

- `subjects`, `topics`: `updatedAt`, `deletedAt?`
- `exams`, `examResults`: `updatedAt`, `deletedAt?`
- `notes`: `deletedAt?` (updatedAt zaten var)
- `settings`: hesap düzeyi ayarlar `user_settings` üzerinden senkronlanır;
  cihaz ayarları yerelde kalır.

Senkronlanmayan yerel tablolar: `photos`, `photoSearch`, `attachments`,
`practiceSessions`, `scheduleFiles`, `scheduleEntries`, `books`, `topicBooks`,
`scheduleTables`.

### 7.2 Alan kuralları

- Normal içerik satırlarının kimlikleri istemcide üretilen rastgele UUID
  (`crypto.randomUUID`).
- Doğal anahtarı olan satırlar deterministik UUIDv5 kullanır
  (`userId + doğal anahtar`): `userBooks` (`bookId`), `scheduleWeeks`
  (`weekStart`), `topicProgress` (`topicId`), katalog tohum satırları
  (normalize ad + yayınevi + baskı) ve hafta kopyasındaki satır/görevler
  (hedef hafta + kaynak kimliği). Böylece iki cihaz çevrimdışı aynı satırı
  oluştursa bile sunucuda tek satıra düşer.
- Tarihler ISO 8601 string. `weekStart` ve gün indeksleri: pazartesi = 1 … pazar = 7.
- Sayfa aralıkları kapsayıcı; `fromPage` ve `toPage` tam sayı.
- Kitap okunan sayfası:
  - En son aktif `page_set` kaydı (varsa) taban alınır.
  - Tabanın `createdAt` değerinden sonra eklenmiş aktif `book_pages`
    kayıtlarının en büyük `toPage` değeri alınır.
  - Sonuç: `max(taban.toPage, sonrakiTiklerinMaxToPage)`. `page_set` yoksa
    tüm aktif `book_pages` kayıtlarının en büyük `toPage` değeri kullanılır.
  - Böylece yanlış girilen sayfa aşağı doğru düzeltilebilir; sonraki tikler
    yeni tabandan ileri sayar.
- Kitap toplam sayfası = `userBooks.totalPagesOverride ?? catalogBooks.totalPages`.
- Kitap yüzdesi = toplam > 0 ise `min(100, round(okunan / toplam * 100))`,
  değilse 0 ve "sayfa sayısı eksik" durumu.
- Ders yüzdesi = biten konu / görünür konu; konu yoksa 0.
- Bir görevin tamamlanma durumu `completedAt != null` ve `deletedAt == null`.
- Bir göreve bağlı en fazla bir **aktif** aktivite kaydı olur. Bu, kısmi benzersiz
  indeksle sağlanır: `(userId, taskId) where deletedAt is null`. Silinmiş
  kayıtlar aynı `taskId` ile tekrar kullanılabilir.
- Aktivite kayıtları ekleme-only'dir: sayfa aralığı düzeltmesi veya yeniden
  tikleme, eski kaydı silinmiş işaretleyip yeni kayıt ekler. Kayıt içeriği
  güncellenmez.
- Silme yumuşaktır: `deletedAt` doldurulur; listeler ve hesaplar silinmiş
  satırları yok sayar. Silinmiş `page_set` kaydı yok sayılır, bir önceki tabana
  dönülür.

### 7.3 Supabase tabloları

Tüm kullanıcı tablolarında `user_id uuid not null default auth.uid()` ve
`deleted_at timestamptz null` bulunur. `server_updated_at timestamptz` sunucu
trigger'ıyla güncellenir; çekme imleci bunu kullanır. `updated_at` istemcinin
son değişiklik zamanıdır ve çakışma çözümünde kullanılır.

| Tablo | Anahtar alanlar |
|---|---|
| `profiles` | id (auth.users), display_name, created_at, updated_at |
| `catalog_books` | id, owner_id?, title, publisher, exam, subject_slug, total_pages, edition, created_at, updated_at, deleted_at |
| `user_books` | id, user_id, book_id, total_pages_override, note, status, started_at, created_at, updated_at, deleted_at |
| `activity_logs` | id, user_id, type, user_book_id, topic_id, from_page, to_page, task_id, source, created_at, deleted_at; içerik güncellenmez, `updated_at` yok |
| `schedule_weeks` | id, user_id, week_start, note, created_at, updated_at, deleted_at |
| `schedule_rows` | id, user_id, week_id, subject_id, label, order, created_at, updated_at, deleted_at |
| `schedule_tasks` | id, user_id, week_id, row_id, day_index, type, user_book_id, from_page, to_page, topic_id, title, completed_at, created_at, updated_at, deleted_at |
| `topic_progress` | id, user_id, topic_id, done, done_at, updated_at, deleted_at |
| `subjects` | id, user_id, seed_key, exam, name, slug, icon, order, updated_at, deleted_at |
| `topics` | id, user_id, seed_key?, subject_id, name, order, is_custom, created_at, updated_at, deleted_at |
| `exams` | id, user_id, type, name, date, alan, kind, branch, note, created_at, updated_at, deleted_at |
| `exam_results` | id, user_id, exam_id, subject_id, correct, wrong, blank, net, updated_at, deleted_at |
| `notes` | user_id, topic_id, content_html, plain_text, updated_at, deleted_at; pk (user_id, topic_id) |
| `user_settings` | user_id pk, data jsonb, updated_at |

Kısıtlar:

- `subjects`: unique `(user_id, seed_key)`.
- `topics`: unique `(user_id, seed_key)` (seed_key boşsa uygulanmaz).
- `user_books`: unique `(user_id, book_id)` (silinmemiş kayıtlar için).
- `activity_logs`: kısmi unique `(user_id, task_id) where deleted_at is null`
  (task_id boş değilse). Eski silinmiş kayıtlar yeni kaydı engellemez.
- `notes`: primary key `(user_id, topic_id)`.
- `schedule_weeks`: unique `(user_id, week_start)`.
- İndeksler: `schedule_tasks(user_id, week_id, day_index)`,
  `activity_logs(user_id, user_book_id)`, `activity_logs(user_id, topic_id)`,
  `server_updated_at` tüm senkron tablolarında.

### 7.4 RLS ve güvenlik

- Kullanıcı tablolarında select/insert/update/delete yalnızca
  `user_id = auth.uid()`.
- `catalog_books`: select `owner_id is null or owner_id = auth.uid()`;
  insert/update yalnızca `owner_id = auth.uid()`. Ortak katalog satırları
  (`owner_id is null`) yalnızca servis rolüyle yazılır.
- Supabase anon key istemcide bulunur; güvenlik RLS'tedir. Servis rolü anahtarı
  asla istemciye konmaz.
- Auth e-postaları için Supabase'in varsayılan gönderimi MVP'de yeterli; e-posta
  onayı kapalı olduğu için kayıt anında oturum açılır.

## 8. Senkron motoru

### 8.1 Genel akış

1. Kullanıcı giriş yapar; oturum yerel olarak saklanır.
2. O kullanıcının yerel veritabanı açılır.
3. Buluttan çekme (pull) yapılır; bulut boşsa müfredat tohumlanır ve gönderilir.
4. Kullanıcı her yazma işlemini önce yerel veritabanına yazar.
5. Aynı işlem `syncQueue`'ya bir kayıt ekler.
6. Senkron tetiklendiğinde kuyruk sırayla Supabase'e gönderilir (push).
7. Başarılı gönderim kuyruktan silinir; hata olursa kuyruk kalır ve tekrar denenir.
8. Periyodik olarak ve uygulama öne geldiğinde buluttaki değişiklikler çekilir.

Tetikleyiciler: uygulama açılışı, `online` olayı, sekme görünür olması, her
yazmadan ~2 saniye sonra (debounce), 5 dakikada bir, "Şimdi senkronize et"
düğmesi.

### 8.2 Çakışma kuralları

- **Ekleme-only kayıtlar** (`activity_logs`): iki cihazın eklediği kayıtlar
  birleşir. Aynı görev için tek **aktif** kayıt kısıtı vardır; eski kayıt
  silinmişse yenisi eklenebilir. İkinci aktif ekleme sunucuda çakışırsa mevcut
  kayıt kullanılır; yerel kopya ona bağlanır.
- **Doğal anahtarlı satırlar** (`user_books`, `schedule_weeks`,
  `topic_progress`): deterministik kimlikler sayesinde iki cihaz aynı satırı
  üretir. Yine de bir çakışma olursa sunucudaki mevcut satır çekilir ve yerel
  satır ona birleştirilir; alt satırlar (görev, aktivite) yeni kimliğe taşınır.
- **Değiştirilebilir satırlar** (görev, kitap, konu, deneme, not): son yazan
  kazanır. Karşılaştırma `updated_at` ile; eşitlikte `deviceId` ile deterministik
  tie-break. Saat kayması riski kabul edilir; kişisel kullanım için yeterli.
- **Silmeler**: `deleted_at` tombstone'u ile taşınır. Yerelde de satır tutulur;
  listeler ve hesaplar filtreler.
- **Görev–aktivite tutarlılığı**: görev `completedAt` aldıysa ve aktif aktivite
  yoksa, çekme sonrası görev alanlarından aktivite oluşturulur. Görev
  `completedAt` boşsa ve aktif aktivite varsa, aktivite silinmiş işaretlenir.
- **Bekleyen yerel değişiklik**: aynı satırda kuyrukta bekleyen değişiklik varsa
  çekme sırasında yerel veri korunur; gönderim sonrası sunucu değeri uygulanır.

### 8.3 Kuyruk ve çekme

- `syncQueue` her satır için `table`, `rowId`, `op` (`upsert`/`delete`),
  `payload`, `createdAt`, `attempts` tutar.
- Push sırayla yapılır; ağ hatasında döngü durur, 30 saniye sonra tekrar denenir.
  Kalıcı hata (RLS/doğrulama) kullanıcıya "Senkron hatası" olarak gösterilir;
  kayıt kuyrukta kalır, veri kaybolmaz.
- Doğal anahtar çakışması deterministik kimlikler sayesinde beklenmez. Yine
  olursa sunucudaki mevcut satır çekilir, yerel satır ona birleştirilir ve alt
  satırların yabancı anahtarları güncellenir; kuyruk kalıcı hataya düşmez.
- Pull, tablo başına `server_updated_at > sonÇekme` ile artımlıdır. İlk girişte
  tam çekme yapılır. Küçük tablolar için tam çekme de kabul edilebilir.
- Supabase Realtime bu sürümde zorunlu değil; yoksa da periyodik çekme yeterli.
- Senkron durumu: `synced`, `syncing`, `pending`, `offline`, `error`.
  Üst çubukta/menüde küçük gösterge; detayda son senkron zamanı ve bekleyen
  kayıt sayısı.

### 8.4 Çevrimdışı ve oturum

- Supabase istemcisi oturumu localStorage'da tutar; `autoRefreshToken` açık.
- Çevrimdışıyken oturum bilgisi yerelden okunur; ağ isteği yapılmaz.
- Oturum süresi dolmuşsa ve internet varsa yenilenir; yoksa kullanıcı yerel
  veriyle çalışmaya devam eder, senkron "oturum yenilenmeli" durumuna düşer.
- Çıkışta bekleyen kuyruk varsa uyarı; çıkış yerel veriyi silmez.

### 8.5 Yerel veritabanı geçişi

- Repositories tek bir aktif veritabanına yönlendirilir (`getDb()` benzeri).
  Bileşenler doğrudan Dexie'ye değil repository'lere erişir.
- Kullanıcı girişinde `kocluk-u-<userId>` açılır; çıkışta kapatılır.
- Eski `kocluk` veritabanı taşıma kaynağıdır; taşıma sonrası silinmez.
- Aynı cihazda farklı hesapların yerel veritabanları ayrı kalır; fotoğraflar
  hesap değişince karışmaz.

## 9. Arayüz akışları ve metin taslakları

### 9.1 Kitap detayı (taslak)

```
‹ Kitaplar
Bilgi Sarmal TYT Matematik
Bilgi Sarmal · TYT Matematik

   ◕ %46          220 / 480 sayfa
                  260 sayfa kaldı · Son okuma 18 Kasım

[ Sayfa güncelle ]  [ Düzenle ]
Şu anki sayfan: [ 220 ]  (Kaydet)

İlerleme geçmişi
18 Kas  s. 210–220   Plan görevi
15 Kas  s. 150–209   Manuel
```

### 9.2 Haftalık plan (taslak)

```
‹ 17–23 Kasım 2026 ›        [Bu hafta] [Geçen haftadan kopyala]

             Pzt   Sal   Çar   Per   Cum   Cmt   Paz
Matematik    —     —     [Bilgi Sarmal
                          TYT Mat
                          s.210–220]
Türkçe       [Paragraf
             40 soru] ...
```

Mobilde gün seçici ve tek gün sütunu; görev çipi dokununca tiklenir, uzun
basınca/düzenle ikonuyla görev modalı açılır.

### 9.3 Görev ekleme modalı

```
Görev ekle — Çarşamba / Matematik
( ) Kitap sayfası   ( ) Konu tekrarı   ( ) Serbest

Kitap: [ Bilgi Sarmal TYT Matematik ▼ ]
Sayfa: [ 210 ] – [ 220 ]   (11 sayfa)
[ Kaydet ]
```

### 9.4 Boş ve hata durumları

- Kitap yok: "Rafın boş. Katalogdan ilk kitabını ekle."
- Katalog aramasında sonuç yok: "Bu kitap katalogda yok. Kendi kitabını ekle."
- Toplam sayfa yok: "İlerleme için sayfa sayısı gerekli. Düzenle."
- Plan boş: "Bu hafta için henüz görev yok. Görev ekle veya geçen haftadan kopyala."
- Çevrimdışı: "Çevrimdışısın. Değişiklikler internet gelince gönderilecek."
- Senkron hatası: "Bazı değişiklikler gönderilemedi. Tekrar dene." Detayda hata.
- Oturum hatası: "Tekrar giriş yapman gerekiyor." Yerel veri korunur.

## 10. Teknik mimari

### 10.1 Yeni modüller

- `src/lib/supabase.ts`: Supabase istemcisi, env doğrulaması.
- `src/app/AuthProvider.tsx`: oturum, kullanıcı, giriş/çıkış, çevrimdışı durum.
- `src/db/dbManager.ts`: aktif kullanıcı veritabanı, açma/kapatma, taşıma.
- `src/db/sync/`: kuyruk, push, pull, çakışma, durum.
- `src/features/auth/`: giriş, kayıt, şifre sıfırlama (sonra), hesap ekranı.
- `src/features/books/`: katalog arama, raf, kitap detayı, sayfa güncelleme.
- `src/features/schedule/`: haftalık plan, görev modalı, hafta kopyalama.
- `src/features/topics/`: konu durumu ve tekrar geçmişi.
- `src/db/migration/`: eski yerel veriyi yeni kullanıcı veritabanına taşıma.

### 10.2 Mevcut koddan değişecekler

- `Book`/`TopicBook` modeli yerine `catalogBooks`/`userBooks`/`activityLogs`;
  eski tablolar legacy olarak korunur.
- `calculateProgress` ikiye ayrılır: kitap sayfa ilerlemesi ve konu ilerlemesi.
- `useSubjectOverview` konu bitirme durumundan beslenir.
- `BooksPage`, `BookDetailPage`, `TestsTab`, `TopicPage`, `SubjectPage`,
  `DashboardPage`, `SchedulePage` yeni modele göre yeniden yazılır.
- `backup.ts` şema sürümü 6 olur; yeni tablolar ve legacy tablolar eklenir.
- `AppShell`/`TopBar`/`Sidebar`: hesap ve senkron durumu göstergesi.
- `AppRoutes`: auth kapısı; giriş yapılmamışsa auth ekranı.
- `vite.config.ts`: Supabase env ve PWA runtime cache ayarları (API istekleri
  önbelleğe alınmaz).

### 10.3 Ortam ve yayınlama

- `.env.local` / `.env.example`:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- GitHub Actions'a aynı değerler secret olarak eklenir. Anon key istemcide
  görünür; RLS korur.
- Supabase Auth URL ayarları: `http://localhost:5173` ve
  `https://mehmetcan455.github.io/kocluk/`.
- Supabase projesi ücretsiz katmanda: 500 MB veritabanı, 1 GB depolama.
  Fotoğraflar yüklenmediği için veritabanı küçük kalır.
- Ücretsiz projeler hareketsizlikte duraklayabilir; uygulama ilk senkron
  hatasında "Sunucu uyanıyor olabilir, tekrar dene" mesajı gösterir.
- Supabase SQL migration'ları `supabase/migrations/` altında tutulur; katalog
  tohumu ayrı bir SQL dosyasıdır. Yedek geri yükleme için `restore_account`
  adlı, `security definer` ve `auth.uid()` ile sınırlı bir Postgres fonksiyonu
  eklenir. Uygulama dağıtımı GitHub Pages'e devam eder.

### 10.4 PWA

- Mevcut `vite-plugin-pwa` korunur; precache yalnızca statik varlıklar.
- Supabase API istekleri için runtime cache kullanılmaz; `NetworkOnly` veya
  hiç eşleşmeme. Böylece eski kullanıcı verisi servis çalışanından servis
  edilmez.
- Supabase çağrıları başarısızsa uygulama yerel veriyle açılmaya devam eder.

## 11. Yedekleme ve veri güvenliği

- Zip yedek şeması v6'ya çıkar. Yedek şunları içerir:
  - tüm yeni tablolar (`catalogBooks`, `userBooks`, `activityLogs`,
    `scheduleWeeks`, `scheduleRows`, `scheduleTasks`, `topicProgress`),
  - mevcut tablolar (subjects, topics, exams, examResults, notes, settings),
  - legacy tablolar (`books`, `topicBooks`, `scheduleTables`,
    `scheduleEntries`),
  - fotoğraflar, ekler, pratik oturumları, çizelge dosyaları.
- v1–v5 yedekleri içe aktarılabilir. Eski yedek içe aktarılırken kitaplar
  rafa taşınır, eski test kayıtları legacy olarak korunur, tamamlanmış konular
  `done` başlar.
- **Senkronlu hesapta geri yükleme tam değiştirir.** Kullanıcı açıkça onaylar;
  önce mevcut hesap verisi otomatik olarak zip yedeği indirilir. Geri yükleme
  yalnızca internet varken yapılır.
- Geri yükleme, Supabase'de tek bir transaction içinde çalışan
  `restore_account(payload jsonb)` RPC'siyle yapılır: kullanıcının tüm senkron
  satırları silinir, yedekteki satırlar `auth.uid()` sahipliğinde eklenir.
  Ortak katalog satırları (`owner_id is null`) silinmez; kullanıcının özel
  katalog satırları yedekle değiştirilir. İşlem atomiktir: hata olursa hesap
  eski hâlinde kalır.
- RPC başarılı olduktan sonra yerel veritabanı da temizlenip yedekten yeniden
  kurulur; `syncQueue` ve `syncMeta` sıfırlanır. Yerel fotoğraf/ekler yedekten
  geri gelir; buluta yüklenmez.
- Yedek başka hesaptan alınmışsa satırlardaki `user_id` ve özel katalog
  sahipliği mevcut kullanıcıya çevrilir; ortak katalog satırları doğal anahtarla
  eşleştirilir. v5 yedeği önce v6 modeline dönüştürülür.
- Yedek boyutu büyükse RPC isteği parçalara ayrılır veya Supabase Edge Function
  üzerinden yüklenir; MVP'de tipik kişisel veri tek isteğe sığar.
- `syncQueue` ve `syncMeta` yedeğe dahil edilmez.
- Geri yükleme sırasında çevrimdışıysa işlem başlatılmaz; kullanıcıya internet
  gerektiği söylenir.
- Bulut, yedek değildir: yanlışlıkla silme ve hesap kaybı riski için zip yedek
  önerisi korunur. Ayarlar → Yedekleme metni güncellenir.
- Veri sahipliği: her kullanıcı kendi satırlarını görür; RLS testleri yazılır.
- Hesap silme bu sürümde kapsam dışıdır (bkz. 6.1).

## 12. Test stratejisi

### Birim testleri

- Kitap ilerlemesi: max sayfa, yüzde yuvarlama, %100 sınırı, sayfa sayısı
  eksikken 0, silinmiş kayıtların yok sayılması.
- Görev tik/tik kaldır: aktivite oluşur/silinir, yüzde güncellenir, aynı görev
  iki kez sayılmaz.
- Sayfa aralığı doğrulaması: ters aralık, 0, toplam sayfayı aşma.
- Hafta kopyalama: görevler tamamlanmamış, aktivite kopyalanmaz, not kopyalanmaz.
- Konu yüzdesi: biten/toplam; gizli dersler.
- Sayfa düzeltme: `page_set` aşağı doğru düzeltir; sonraki tikler tabandan
  ileri sayar; düzeltme silinince önceki tabana dönülür.
- Migration: eski kitap → katalog eşleşmesi/özel kitap; çok dersli kitapta
  "Genel"; aynı kataloğa eşleşen kitapların birleşmesi; tamamlanmış konu
  aktarımı; ayarların kopyalanması.
- Deterministik kimlikler: aynı doğal anahtar aynı UUID'yi üretir; hafta
  kopyası iki cihazda çoğalmaz.
- Senkron: LWW, tombstone, kuyruk idempotency, görev–aktivite uzlaştırma,
  doğal anahtar çakışmasında birleştirme.
- Yedek geri yükleme: tam değiştirir; RPC atomiktir, hata olursa eski veri
  kalır; önce otomatik güvenlik yedeği alınır; kuyruk/meta içe aktarılmaz.
- Başka hesabın yedeği: `user_id`/özel katalog sahipliği çevrilir; ortak
  katalog satırları doğal anahtarla eşleşir.

### Repository/UI testleri

- BooksPage: katalog ekleme, özel kitap, sayfa güncelleme, arşiv.
- BookDetailPage: yüzde, geçmiş, toplam sayfa düzeltme.
- SchedulePage: hafta gezinme, görev ekleme, tik, kopyalama, mobil gün seçici.
- TopicPage: konu bitti anahtarı, tekrar geçmişi, legacy test kayıtları.
- SubjectPage/Dashboard: yeni yüzdeler.
- Auth: giriş/kayıt formu, çevrimdışı oturum, yönlendirme.
- Sync durumu: çevrimdışı, bekleyen, hata, tekrar dene.

### Uçtan uca (Playwright)

- Katalogdan kitap ekle → plana görev ekle → tikle → kitap yüzdesi doğru.
- Tik kaldır → yüzde geri döner.
- Çevrimdışıyken tikle → sayfa yenile → ilerleme durur → online → senkron.
- İki tarayıcı bağlamı aynı hesapla → birinde tikle → diğerinde görünür
  (test Supabase projesi veya mock API).
- Eski yerel veriyle giriş → taşıma → kitaplar/fotoğraflar yerinde.
- v5 zip yedeği içe aktar → yeni modelde açılır.

Not: Gerçek Supabase'e bağlı E2E testleri CI'da gizli anahtar gerektirir.
Alternatif olarak Supabase REST uçları Playwright route ile taklit edilir;
senkron mantığı ayrıca birim testlerinde doğrulanır.

## 13. Yol haritası

### Aşama 1 — Yerel model ve arayüz (iç kilometre taşı)

- Dexie v6 tabloları, katalog tohumu (yerel), raf, sayfa ilerlemesi.
- Haftalık plan, görev tipleri, tik/tik kaldır, hafta kopyalama.
- Konu bitirme ve tekrar geçmişi.
- Kitaplar, kitap detayı, konu/ders/ana sayfa güncellemeleri.
- Legacy görünümler.
- Bu aşama **yayınlanmaz**; geliştirme/test kilometre taşıdır. Böylece yeni
  modelin yerel verileri için ayrı bir taşıma katmanı yazmak gerekmez. Kullanıcı
  erken erişim isterse bu karar değişir ve Aşama 1 verilerinin de hesaba
  taşınması kapsama eklenir.

### Aşama 2 — Supabase ve hesaplar

- Supabase projesi, şema, RLS, katalog tohumu.
- Auth ekranları, oturum yönetimi, hesap gerektiren kapı.
- Kullanıcıya özel yerel veritabanı ve eski veri taşıma.
- Yapısal veriler için senkron motoru (kuyruk, push, pull, durum).
- Senkron göstergesi ve ayarlar.

### Aşama 3 — Sağlamlaştırma

- Yedek şeması v6 ve eski yedek uyumluluğu.
- `restore_account` RPC'si, tam değiştiren geri yükleme, otomatik güvenlik
  yedeği ve onay akışı.
- Çevrimdışı/iki cihaz testleri, hata mesajları, performans.
- GitHub Actions secrets ve yayın.
- Katalog kitaplarının sayfa sayılarının gözden geçirilmesi.

### Aşama 4 — Sonraki sürüm (bu tasarımın dışı)

- Fotoğraf ve eklerin Supabase Storage'a taşınması.
- Katalog öneri/onay akışı.
- Koç/öğrenci rolleri (istenirse).
- Hesap silme ve veri indirme iyileştirmeleri.

## 14. Riskler ve önlemler

| Risk | Önlem |
|---|---|
| Senkron motorunun karmaşıklığı | Ekleme-only kayıtlar, tombstone, küçük kapsam, birim testleri, aşamalı teslim |
| Taşıma sırasında veri kaybı | Önce yedek, kopyala-silme yapma, eski DB'yi koru, idempotent taşıma |
| Tam değiştiren yedek geri yükleme | Önce otomatik güvenlik yedeği, açık onay, atomik RPC, hata olursa geri alma |
| Katalog sayfa sayılarının yanlış olması | Baskı alanı, kullanıcı düzeltmesi, başlangıçta az ve doğrulanmış kitap |
| Supabase ücretsiz limit/duraklama | Fotoğraflar yüklenmez; küçük veri; uyarı ve yeniden deneme |
| E-posta onayı/şifre sıfırlama | MVP'de onay kapalı; genel açılış öncesi SMTP ve onay |
| Kullanıcının kitap ve konu yüzdesini karıştırması | Ayrı etiketler, açıklama metinleri |
| Kapsamın büyümesi | Hedef olmayanlar listesi, aşamalı yol haritası |
| Çakışmada son yazan kazanır | Kişisel kullanım için kabul; kritik kayıtlar ekleme-only |

## 15. Builder'a bırakılan kararlar

- Supabase Auth'ta e-posta onayının MVP'de kapalı olması; genel açılış öncesi
  açılması.
- Katalog başlangıç listesinin seçimi (20–30 popüler kitap) ve sayfa sayılarının
  doğrulanması; katalog kimliklerinin deterministik olması.
- Hafta kopyalamada notun kopyalanmaması; kopya kimliklerinin deterministik
  olması.
- Tamamlanmış görev silinince ilerlemenin kalması; geri almanın yalnızca tik
  kaldırmayla olması.
- Özel kitapta toplam sayfa zorunluluğu; ders/sınavın isteğe bağlı olması.
- Katalogdan gelen kitapta yalnızca sayfa sayısı ve notun düzenlenebilmesi;
  ad/yayınevi/ders için özel kitap oluşturulması.
- Manuel sayfa girişinin `page_set` olarak tutulması ve aşağı doğru düzeltmeye
  izin vermesi; manuel kayıtların geçmişten silinebilmesi.
- Ders yüzdesinde yalnızca "bitti" durumunun sayılması; "başladı" ayrı durum
  değil.
- Senkron aralığı (5 dakika + odak/online + manuel).
- Supabase Realtime'ın MVP'de kullanılmaması.
- Eski çizelgenin salt okunur gösterilmesi; nota kopyalama düğmesinin opsiyonel
  olması.
- Zip geri yüklemenin hesabı tam değiştirmesi; önce otomatik güvenlik yedeği,
  açık onay ve yalnızca internet varken çalışan atomik `restore_account` RPC'si.
- Hesap silmenin MVP dışı olması.
- Aşama 1'in yayınlanmadan iç kilometre taşı olarak kalması.

## 16. Onay

Bu doküman onaylandığında uygulama planı yazılır. Plan, yukarıdaki aşamaları
ve testleri sıraya koyar; onaydan önce üretim kodu yazılmaz.
