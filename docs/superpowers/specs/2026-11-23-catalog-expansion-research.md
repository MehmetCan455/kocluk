# Katalog Araştırması — Birleştirilmiş ve Doğrulanmış Rapor

**Durum:** Uygulamaya hazır (implementation-ready)
**Kaynaklar:** `catalog-research-brief.md`, `catalogBooks.ts` (30 satır), `catalog-research-A.md`, `catalog-research-B.md`, `catalog-research-C.md`

## 1. Özet

| Kalem | Sayı |
|---|---:|
| Üç rapordaki toplam aday | 52 |
| **Onaylanan yeni kitap** | **50** |
| Elenen (birleştirme aşamasında) | 2 |
| Elenen (saha ekiplerince zaten elenmiş) | 9 |
| `CATALOG_SEED` ile çakışan | 0 |
| Raporlar arası tekrar | 0 |
| Doğrulanamayanlar bölümüne taşınan | 2 |

**Yayınevi dağılımı (onaylanan):** Bilgi Sarmal 6, Apotemi 6, 3D 4, 345 4, Aydın 3, Biyotik 4, Orbital 2, Orijinal 1, Barış 2, Hız ve Renk 6, Toprak 6, Palme 5, Mikroorijinal 1.

**Ders dağılımı:** TYT 34 (geometri 7, fizik 8, kimya 8, türkçe 5, biyoloji 5, matematik 1), AYT 16 (biyoloji 6, kimya 5, edebiyat 3, fizik 2).

### Doğrulama sonucu

- `exam`: 50/50 TYT veya AYT. ✓
- `subjectSlug`: 50/50 brief'teki izinli slug listesinde. ✓
- `totalPages`: 50/50 pozitif tam sayı (min 128, max 440). ✓
- `edition`: 50/50 makul yıl (2025–2026). ✓
- `title|publisher|edition` tekilliği: 50/50 benzersiz; `CATALOG_SEED` ile çakışma yok. ✓
- Her satırda `sourceUrl` ve `confidence` var; `low` yok. ✓

## 2. Uygulama kararları (implementer için)

1. **Mevcut katalog düzeltmesi ayrı yapılmalı:** 345 AYT Matematik 384 → **375**. Aşağıdaki 7. bölüme bakın. Bu satır yeni diziye dahil değildir.
2. **TYT-AYT ortak tek cilt kitaplar tek satırda tutuldu.** Aynı kitabı iki sınava kopyalamak `title|publisher|edition` tekilliğini bozar. Politika: ortak **geometri** kitapları `TYT` (6 kitap), AYT ağırlıklı içerik (`Biyotik Sistemler`) `AYT`. Bu nedenle B raporundaki Orijinal ve Barış geometri satırları `AYT` → `TYT` normalize edildi; diğer dört geometri kitabıyla aynı davranış.
3. **Baskı yılı:** Yayınevi künyesinde yıl yoksa ve güncel sezon listingi varsa `2026`; yalnızca doğrulanmış eski baskı varsa o yıl yazıldı (Barış Geometri `2025`). Palme'de yıllık baskı numarası yok, bu yüzden tüm Palme satırları `2026` ve notlu.
4. **Sayfa sayısı çelişkisinde öncelik:** resmî yayınevi künyesi > aynı ISBN'li mağaza çoğunluğu > eski baskı. Fark `notes` alanında yazılı.
5. `Mikroorijinal` yayınevi adı, mevcut katalogdaki adlandırmayla uyum için korundu; kitap Orijinal Yayınları'nın "Mikro" serisidir (notta belirtildi).

## 3. Onaylanan kitaplar — JSON

```json
[
  {"publisher":"Bilgi Sarmal","title":"TYT Türkçe Soru Bankası","exam":"TYT","subjectSlug":"turkce","totalPages":336,"edition":"2026","sourceUrl":"https://www.pelikankitabevi.com.tr/universite-hazirlik-yks-tyt-soru-bankasi-turkce/bilgi-sarmal-yayinlari/bilgi-sarmal-yayinlari-tyt-turkce-soru-bankasi","confidence":"high","notes":"2026-27 serisi; Pelikan, Amazon ve Kitapkapımda 336 sayfada birleşiyor."},
  {"publisher":"Bilgi Sarmal","title":"TYT-AYT Geometri Soru Bankası","exam":"TYT","subjectSlug":"geometri","totalPages":400,"edition":"2026","sourceUrl":"https://www.bilgisarmal.com/yayinlar/tyt-ayt-geometri-soru-bankasi","confidence":"high","notes":"TYT-AYT ortak tek cilt; resmî künye (ISBN 9786256712201), Pelikan ve Kitapişler 400."},
  {"publisher":"Bilgi Sarmal","title":"TYT Fizik Soru Bankası","exam":"TYT","subjectSlug":"fizik","totalPages":336,"edition":"2026","sourceUrl":"https://www.bilgisarmal.com/yayinlar/tyt-fizik-soru-bankasi","confidence":"high","notes":"DÜZELTME: 334 değil 336. Resmî künye (ISBN 9786258070545) 336; 334 eski ISBN 9786257905244 baskısı."},
  {"publisher":"Bilgi Sarmal","title":"TYT Kimya Soru Bankası","exam":"TYT","subjectSlug":"kimya","totalPages":304,"edition":"2026","sourceUrl":"https://www.kitapisler.com/bilgi-sarmal-tyt-kimya-soru-bankasi_84327.html","confidence":"high","notes":"Kitapişler, Kitapkapımda ve BBD Store 304 sayfada birleşiyor."},
  {"publisher":"Bilgi Sarmal","title":"TYT Biyoloji Soru Bankası","exam":"TYT","subjectSlug":"biyoloji","totalPages":256,"edition":"2026","sourceUrl":"https://www.kitapisler.com/bilgi-sarmal-tyt-biyoloji-soru-bankasi_96650.html","confidence":"high","notes":"Kitapişler, BBD Store ve Hepsiburada 256 sayfa."},
  {"publisher":"Bilgi Sarmal","title":"AYT Biyoloji Soru Bankası","exam":"AYT","subjectSlug":"biyoloji","totalPages":288,"edition":"2026","sourceUrl":"https://www.bilgisarmal.com/yayinlar/ayt-biyoloji-soru-bankasi","confidence":"high","notes":"Resmî künye (ISBN 9786256712133) ve Kitapişler/Pelikan 288; 400 gösteren eski listing."},
  {"publisher":"Apotemi","title":"TYT Türkçe Soru Bankası","exam":"TYT","subjectSlug":"turkce","totalPages":400,"edition":"2026","sourceUrl":"https://www.kitapisler.com/apotemi-yayinlari-tyt-turkce-soru-bankasi_92519.html","confidence":"high","notes":"Kitapişler, BBD Store ve Hepsiburada 400; ISBN 9786259989815."},
  {"publisher":"Apotemi","title":"Maestro TYT-AYT Geometri Soru Bankası","exam":"TYT","subjectSlug":"geometri","totalPages":400,"edition":"2026","sourceUrl":"https://www.pelikankitabevi.com.tr/universite-hazirlik-yks-tyt-ayt-soru-bankasi-geometri/apotemi-yayinlari/apotemi-yayinlari-maestro-tyt-ayt-geometri-soru-bankasi","confidence":"high","notes":"TYT-AYT ortak tek cilt; Pelikan, Kitapişler ve Kitapova 400."},
  {"publisher":"Apotemi","title":"TYT Fizik Soru Bankası","exam":"TYT","subjectSlug":"fizik","totalPages":288,"edition":"2026","sourceUrl":"https://www.kitapisler.com/apotemi-yayinlari-tyt-fizik-soru-bankasi_83121.html","confidence":"high","notes":"Kitapişler, Pelikan, Hepsiburada ve Kitapanka 288."},
  {"publisher":"Apotemi","title":"TYT Kimya Soru Bankası","exam":"TYT","subjectSlug":"kimya","totalPages":224,"edition":"2026","sourceUrl":"https://www.kitapisler.com/apotemi-yayinlari-tyt-kimya-soru-bankasi_77829.html","confidence":"high","notes":"Kitapişler, Pelikan ve Hepsiburada 224; ISBN 9786057551467."},
  {"publisher":"Apotemi","title":"AYT Biyoloji Soru Bankası","exam":"AYT","subjectSlug":"biyoloji","totalPages":399,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/AYT-Biyoloji-Soru-Bankasi-Apotemi-Yayinlari-815390.html","confidence":"high","notes":"Kitapseç, Pelikan, Dizgi, AKM ve Kitapanka 399; bazı satıcılar 400'e yuvarlıyor."},
  {"publisher":"Apotemi","title":"AYT Edebiyat Soru Bankası","exam":"AYT","subjectSlug":"edebiyat","totalPages":416,"edition":"2026","sourceUrl":"https://www.pelikankitabevi.com.tr/universite-hazirlik-yks-ayt-soru-bankasi-edebiyat/apotemi-yayinlari/apotemi-yayinlari-ayt-edebiyat-soru-bankasi","confidence":"high","notes":"Pelikan ve Hepsiburada 416."},
  {"publisher":"3D Yayınları","title":"TYT Türkçe Soru Bankası","exam":"TYT","subjectSlug":"turkce","totalPages":360,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-3D-Turkce-Tamami-Video-Cozumlu-Soru-Bankasi-3D-Yayinlari-229824.html","confidence":"high","notes":"Kitapseç, Kitapişler ve Hepsiburada 360; ISBN 9786051949314."},
  {"publisher":"3D Yayınları","title":"TYT Geometri Soru Bankası","exam":"TYT","subjectSlug":"geometri","totalPages":304,"edition":"2026","sourceUrl":"https://www.pelikankitabevi.com.tr/universite-hazirlik-yks-tyt-soru-bankasi-geometri/3d-yayinlari/3d-yayinlari-tyt-geometri-soru-bankasi","confidence":"high","notes":"Pelikan ve Kitapişler 304; ISBN 9786051949383."},
  {"publisher":"3D Yayınları","title":"TYT Fizik Soru Bankası","exam":"TYT","subjectSlug":"fizik","totalPages":296,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/2026-TYT-3D-Fizik-Tamami-Video-Cozumlu-Soru-Bankasi-3D-Yayinlari-538904.html","confidence":"high","notes":"2026 künyeli Kitapseç, İKM ve Hepsiburada 296; eski 2023 kaydı da aynı sayıyı veriyor."},
  {"publisher":"3D Yayınları","title":"TYT Biyoloji Soru Bankası","exam":"TYT","subjectSlug":"biyoloji","totalPages":256,"edition":"2026","sourceUrl":"https://www.pelikankitabevi.com.tr/universite-hazirlik-yks-tyt-soru-bankasi-biyoloji/3d-yayinlari/3d-yayinlari-tyt-biyoloji-soru-bankasi","confidence":"medium","notes":"Pelikan 256 (ISBN 9786259841786); eski baskılarda 232. Sayfa sayısı bağımsız ikinci kaynakta yeniden doğrulanamadı."},
  {"publisher":"345 Yayınları","title":"TYT Türkçe Soru Bankası","exam":"TYT","subjectSlug":"turkce","totalPages":440,"edition":"2026","sourceUrl":"https://www.ucdortbes.com/tyt-turkce-soru-bankasi","confidence":"high","notes":"Resmî künye 440; ISBN 9786058116221."},
  {"publisher":"345 Yayınları","title":"TYT Fizik Soru Bankası","exam":"TYT","subjectSlug":"fizik","totalPages":368,"edition":"2026","sourceUrl":"https://www.ucdortbes.com/tyt-fizik-soru-bankasi","confidence":"high","notes":"Resmî künye 368; ISBN 9786058116238."},
  {"publisher":"345 Yayınları","title":"TYT Kimya Soru Bankası","exam":"TYT","subjectSlug":"kimya","totalPages":280,"edition":"2026","sourceUrl":"https://www.ucdortbes.com/tyt-kimya-soru-bankasi","confidence":"high","notes":"Resmî künye 280; ISBN 9786058116207."},
  {"publisher":"345 Yayınları","title":"AYT Edebiyat Soru Bankası","exam":"AYT","subjectSlug":"edebiyat","totalPages":384,"edition":"2026","sourceUrl":"https://www.ucdortbes.com/ayt-edebiyat-soru-bankasi","confidence":"high","notes":"Resmî künye 384 sayfa."},
  {"publisher":"Aydın Yayınları","title":"TYT Fizik Konu Özetli Soru Bankası","exam":"TYT","subjectSlug":"fizik","totalPages":304,"edition":"2026","sourceUrl":"https://www.aydinyayinlari.com.tr/tyt-fizik-konu-ozetli-soru-bankasi-","confidence":"high","notes":"Resmî sitede 304; eski satıcı kayıtlarında 294. Kampanyalı ürün."},
  {"publisher":"Aydın Yayınları","title":"TYT Kimya Konu Özetli Soru Bankası","exam":"TYT","subjectSlug":"kimya","totalPages":336,"edition":"2026","sourceUrl":"https://www.aydinyayinlari.com.tr/tyt-kimya-konu-ozetli-soru-bankasi","confidence":"high","notes":"Resmî sitede 336; baskı yılı belirtilmemiş, güncel müfredat notu var."},
  {"publisher":"Aydın Yayınları","title":"AYT Kimya Konu Özetli Soru Bankası","exam":"AYT","subjectSlug":"kimya","totalPages":408,"edition":"2026","sourceUrl":"https://www.aydinyayinlari.com.tr/ayt-kimya-konu-ozetli-soru-bankasi","confidence":"medium","notes":"Resmî güncel künye (ISBN 9786057945761) 408; N11/İdefix/Pelikan 416 (eski baskı). Resmî künye seçildi."},
  {"publisher":"Biyotik","title":"TYT Biyoloji Soru Kampı","exam":"TYT","subjectSlug":"biyoloji","totalPages":128,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/YKS-TYT-Biyoloji-Biyotik-Soru-Kampi-Biyotik-Yayinlari-929247.html","confidence":"high","notes":"Kitapsayfam, Kitapanka, Kitapdoldur ve Kitapseç 128; Trendyol'daki 251-300 bir sayfa aralığı alanıdır, gerçek sayfa verisi değil."},
  {"publisher":"Biyotik","title":"AYT Biyoloji Soru Kampı","exam":"AYT","subjectSlug":"biyoloji","totalPages":128,"edition":"2026","sourceUrl":"https://kitapsec.com/Products/AYT-Biyoloji-Soru-Kampi-Biyotik-Yayinlari-932338.html","confidence":"high","notes":"Kitapdoldur, Kitap Bulvarı ve İşler Kıbrıs 128; ISBN 9786259674742."},
  {"publisher":"Biyotik","title":"TYT-AYT Biyoloji Sistemler İnsan Fizyolojisi Konu Anlatımlı Soru Bankası","exam":"AYT","subjectSlug":"biyoloji","totalPages":240,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-AYT-Biyoloji-Sistemler-Insan-Fizyolojisi-Konu-Anlatimli-Soru-Bankasi-Biyotik-Yayinlari-670631.html","confidence":"high","notes":"TYT-AYT ortak seri; sistemler AYT ağırlıklı olduğu için AYT'ye atandı. Kitapseç 240."},
  {"publisher":"Biyotik","title":"2028 Üniversiteye Hazırlık Biyoloji Maarif Model Soru Bankası","exam":"TYT","subjectSlug":"biyoloji","totalPages":224,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/2028-Universiteye-Hazirlik-Biyoloji-Maarif-Model-Soru-Bankasi-Biyotik-Yayinlari-937379.html","confidence":"high","notes":"Kitapseç, Dizgi, Kitapiste ve Trendruum 224; başlıktaki 2028 hedef sınav yılıdır, baskı 2026."},
  {"publisher":"Orbital Yayınları","title":"Organik Kimya Konu Özetli Soru Bankası","exam":"AYT","subjectSlug":"kimya","totalPages":197,"edition":"2026","sourceUrl":"https://www.bkmkitap.com/orbital-yayinlari-organik-kimya-konu-ozetli-soru-bankasi","confidence":"high","notes":"BKM, Pelikan, İndeks, AKM ve uygunkitapal 197 (ISBN 9786057323439); Kitapdoldur/Kitapanka 208 azınlıkta. Baskı yılı resmî künyede yok."},
  {"publisher":"Orbital Yayınları","title":"Kimya Maarif Model 1. Aşama Soru Bankası","exam":"TYT","subjectSlug":"kimya","totalPages":312,"edition":"2026","sourceUrl":"https://www.bkmkitap.com/kimya-maarif-model-1-asama-soru-bankasi","confidence":"high","notes":"BKM, Kitapyurdu, Kitapişler ve Kitapdoldur 312; yayın tarihi 24.07.2026. 1. Aşama = TYT kimya."},
  {"publisher":"Orijinal Yayınları","title":"TYT-AYT Geometri Soru Bankası","exam":"TYT","subjectSlug":"geometri","totalPages":432,"edition":"2026","sourceUrl":"https://www.kitapisler.com/orijinal-yayinlari-tyt-ayt-geometri-soru-bankasi_84329.html","confidence":"high","notes":"TYT-AYT ortak; diğer ortak geometri kitaplarıyla tutarlılık için TYT'ye atandı. Kitapişler, Kitapseç ve Pelikan 432."},
  {"publisher":"Barış Yayınları","title":"TYT-AYT Geometri Soru Kitabı","exam":"TYT","subjectSlug":"geometri","totalPages":368,"edition":"2025","sourceUrl":"https://www.kitapsec.com/Products/TYT-AYT-Geometri-Soru-Kitabi-Baris-Yayinlari-860520.html","confidence":"high","notes":"TYT-AYT ortak; TYT'ye atandı. Kitapseç, D&R ve Hepsiburada 368; resmî çıkış tarihi 01.08.2025."},
  {"publisher":"Barış Yayınları","title":"TYT-AYT MSÜ KPSS ALES DGS Problemler Soru Bankası","exam":"TYT","subjectSlug":"matematik","totalPages":200,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-AYT-MSU-KPSS-ALES-DGS-Problemler-Soru-Bankasi-Baris-Yayinlari-847169.html","confidence":"high","notes":"Kitapseç, BKM ve Dizgi 200; İdefix/AKM 196 (kapak sayımı farkı). TYT-AYT ortak, TYT matematiğe atandı."},
  {"publisher":"Hız ve Renk Yayınları","title":"TYT Türkçe Soru Bankası","exam":"TYT","subjectSlug":"turkce","totalPages":352,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-Turkce-Soru-Bankasi-Hiz-ve-Renk-Yayinlari-615748.html","confidence":"medium","notes":"352, ISBN 9786057530851 ve 9786258715217 listelerinde doğrulandı; 2026-27 ürün kaydı sayfa sayısı vermiyor. Baskı yılı satıcı etiketinden, resmî künyede yok."},
  {"publisher":"Hız ve Renk Yayınları","title":"TYT Fizik Soru Bankası","exam":"TYT","subjectSlug":"fizik","totalPages":269,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-Fizik-Soru-Bankasi-Hiz-ve-Renk-Yayinlari-313517.html","confidence":"high","notes":"Kitapseç 269; bazı satıcılar 272 gösteriyor. 2026-27 güncel listing."},
  {"publisher":"Hız ve Renk Yayınları","title":"TYT Kimya Soru Bankası","exam":"TYT","subjectSlug":"kimya","totalPages":288,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-Kimya-Soru-Bankasi-Hiz-ve-Renk-Yayinlari-615738.html","confidence":"high","notes":"Kitapseç 288; Hepsiburada 2027 YKS listingi de 288."},
  {"publisher":"Hız ve Renk Yayınları","title":"AYT Kimya Soru Bankası","exam":"AYT","subjectSlug":"kimya","totalPages":352,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/AYT-Kimya-Soru-Bankasi-Hiz-ve-Renk-Yayinlari-316259.html","confidence":"high","notes":"2026 güncel listing; Kitapseç 352."},
  {"publisher":"Hız ve Renk Yayınları","title":"AYT Edebiyat Soru Bankası","exam":"AYT","subjectSlug":"edebiyat","totalPages":416,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/AYT-Edebiyat-Soru-Bankasi-Hiz-ve-Renk-Yayinlari-631965.html","confidence":"high","notes":"2026 resmî katalogda; Kitapseç 416."},
  {"publisher":"Hız ve Renk Yayınları","title":"TYT-AYT Geometri Soru Bankası","exam":"TYT","subjectSlug":"geometri","totalPages":320,"edition":"2026","sourceUrl":"https://kitapkapimda.com/kategoriler/hiz-ve-renk-yayinlari-tyt-ayt-geometri-soru-bankasi-394.html","confidence":"medium","notes":"Kitapkapımda (ISBN 9786257532440, 2026) ve BBD 320; AKM 334 (eski baskı), Kitapişler 400 (çelişkili veri). 320 seçildi."},
  {"publisher":"Toprak Yayınları","title":"TYT Fizik Soru Bankası","exam":"TYT","subjectSlug":"fizik","totalPages":304,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-Fizik-Soru-Bankasi-Toprak-Yayincilik-827279.html","confidence":"high","notes":"Resmî sitede Güncel olarak satılıyor; Kitapseç 304. Resmî künyede ilk basım 2023."},
  {"publisher":"Toprak Yayınları","title":"AYT Fizik Soru Bankası","exam":"AYT","subjectSlug":"fizik","totalPages":336,"edition":"2026","sourceUrl":"https://www.kitapsepeti.com/ayt-fizik-soru-bankasi-toprak-yayincilik","confidence":"high","notes":"Kitapsepeti ve Kitapseç 336; ISBN 9786257972796."},
  {"publisher":"Toprak Yayınları","title":"TYT Kimya Soru Bankası","exam":"TYT","subjectSlug":"kimya","totalPages":296,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-Kimya-Soru-Bankasi-Toprak-Yayincilik-827280.html","confidence":"high","notes":"Resmî site ve Kitapseç 296; resmî künyede ilk basım 2023."},
  {"publisher":"Toprak Yayınları","title":"AYT Kimya Soru Bankası","exam":"AYT","subjectSlug":"kimya","totalPages":368,"edition":"2026","sourceUrl":"https://www.toprakyayincilik.com/urun?urun=ayt_kimya_soru_bankasi_guncel","confidence":"high","notes":"Resmî site 368; eski baskı 376 (ISBN 9786257972215). Resmî künyede ilk basım 2023."},
  {"publisher":"Toprak Yayınları","title":"TYT Biyoloji Soru Bankası","exam":"TYT","subjectSlug":"biyoloji","totalPages":272,"edition":"2026","sourceUrl":"https://www.toprakyayincilik.com/urun?urun=TYT%20Biyoloji%20Soru%20Bankas%C4%B1%20(G%C3%BCncel)","confidence":"high","notes":"Resmî site 272; şu an stokta yok görünüyor. Resmî künyede ilk basım 2023."},
  {"publisher":"Toprak Yayınları","title":"AYT Biyoloji Soru Bankası","exam":"AYT","subjectSlug":"biyoloji","totalPages":336,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/AYT-Biyoloji-Soru-Bankasi-Toprak-Yayincilik-827287.html","confidence":"high","notes":"Kitapseç, Hepsiburada ve Kitapişler 336; resmî künyede ilk basım 2023."},
  {"publisher":"Palme","title":"TYT Fizik Soru Kitabı","exam":"TYT","subjectSlug":"fizik","totalPages":192,"edition":"2026","sourceUrl":"https://www.palmeyayinevi.com/palme-yks-tyt-fIzIk-soru-kItabi","confidence":"high","notes":"DÜZELTME: 256 değil 192. Resmî Palme, Palmekitabevi, Kitapsepeti, BKM ve İstanbul Kitapçısı 192 (ISBN 9786256441309); 256 eski ISBN 9786052821237."},
  {"publisher":"Palme","title":"AYT Fizik Soru Kitabı","exam":"AYT","subjectSlug":"fizik","totalPages":288,"edition":"2026","sourceUrl":"https://palmekitabevi.com/yks-ayt-fizik-soru-kitab%C4%B1","confidence":"high","notes":"Resmî Palme Kitabevi 288; basım 2023, Palme'de yıllık baskı numarası yok."},
  {"publisher":"Palme","title":"TYT Kimya Soru Kitabı","exam":"TYT","subjectSlug":"kimya","totalPages":296,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-Kimya-Soru-Kitabi-Palme-Yayinevi-315552.html","confidence":"high","notes":"Kitapseç ve Kitapişler 296; ISBN 9786052821336."},
  {"publisher":"Palme","title":"AYT Kimya Soru Kitabı","exam":"AYT","subjectSlug":"kimya","totalPages":280,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/YKS-AYT-Kimya-Soru-Kitabi-Palme-Yayinevi-320586.html","confidence":"high","notes":"Kitapseç, Kitapiste ve Kitapişler 280; ISBN 9786052821893."},
  {"publisher":"Palme","title":"AYT Biyoloji Soru Kitabı","exam":"AYT","subjectSlug":"biyoloji","totalPages":328,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/AYT-Biyoloji-Tamami-Video-Cozumlu-Soru-Kitabi-Palme-Yayinevi-419523.html","confidence":"high","notes":"Kitapseç, Kitapişler ve resmî Palme Kitabevi 328; ISBN 9786052824573."},
  {"publisher":"Mikroorijinal","title":"TYT-AYT Geometri Mikro Soru Bankası","exam":"TYT","subjectSlug":"geometri","totalPages":416,"edition":"2026","sourceUrl":"https://www.kitapsec.com/Products/TYT-AYT-Geometri-Mikro-Soru-Bankasi-Orijinal-Yayinlari-246770.html","confidence":"high","notes":"TYT-AYT ortak. Palme, Kitapseç, Dizgi ve Kitapgelir 416 (ISBN 9786057415264); 2026-27 kataloğunda aynı ISBN. İlk baskı 2023."}
]
```

## 4. Düzeltmeler

| Kitap | Rapor değeri | Onaylanan | Gerekçe |
|---|---:|---:|---|
| Bilgi Sarmal — TYT Fizik Soru Bankası | 334 | **336** | Resmî künye (bilgisarmal.com, ISBN 9786258070545) 336. 334, eski ISBN 9786257905244 baskısına ait. |
| Palme — TYT Fizik Soru Kitabı | 256 (medium) | **192** (high) | Resmî Palme + Palmekitabevi + Kitapsepeti + BKM + İstanbul Kitapçısı aynı ISBN'te 192. 256, eski ISBN 9786052821237. "Mağaza çoğunluğu 256" tespiti hatalıydı. |
| Aydın — AYT Kimya Konu Özetli | 416 (medium) | **408** (medium) | Resmî güncel künye 408; 416 satıcıların eski baskısı. Fark notta. |
| Biyotik — TYT Soru Kampı | 128 (medium) | **128** (high) | 4 bağımsız kaynak 128. Trendyol'un 251-300 değeri sayfa alanı değil, kategori aralığı. |
| Orbital — Organik Kimya | 197 (medium) | **197** (high) | 5 bağımsız kaynak 197; 208 azınlık. |
| Hız — TYT-AYT Geometri | 320 (high) | **320** (medium) | 320 ve 334 eski/yeni baskı; Kitapişler 400 ile çelişiyor. Düşürüldü. |
| Orijinal — TYT-AYT Geometri | AYT | **TYT** | Ortak geometri kitapları için tek politika (bkz. bölüm 2). |
| Barış — TYT-AYT Geometri | AYT | **TYT** | Aynı politika. |

## 5. Yapılan spot check'ler (21 kayıt)

| # | Kayıt | Kontrol edilen | Sonuç |
|---:|---|---|---|
| 1 | Biyotik TYT Soru Kampı | Kitapsayfam, Kitapanka, Kitapdoldur, Trendyol | 128 doğrulandı; Trendyol aralığı geçersiz |
| 2 | Biyotik Full Tekrar Biyokamp | BBD Store, Atlas Kırtasiye, Trendyol, Kitapseç | 288 / 184 / 251-300 / sayfa yok → çözülemedi |
| 3 | Orbital Organik Kimya | Pelikan, BKM, İndeks, AKM, uygunkitapal, Kitapdoldur | 197 (5'e karşı 2) |
| 4 | 345 AYT Matematik (mevcut) | ucdortbes.com resmî künye | 375 (mevcut satır 384) |
| 5 | Hız TYT Türkçe | Goturc, Kitapdoldur, İndeks, Avantaj, Hızlı Kitap | 352 doğrulandı; baskı yılı belirsiz |
| 6 | Palme TYT Fizik | palmeyayinevi.com, palmekitabevi.com, Kitapsepeti, BKM, İstanbul Kitapçısı | 192 (5 kaynak), 256 eski ISBN |
| 7 | Bilgi Sarmal TYT Fizik | bilgisarmal.com resmî künye | 336 (334 eski ISBN) |
| 8 | Bilgi Sarmal AYT Biyoloji | bilgisarmal.com, Kitapişler, Pelikan | 288 (İndeks 280 tek başına) |
| 9 | Bilgi Sarmal TYT-AYT Geometri | bilgisarmal.com, Kitapdoldur, Kitapişler | 400 |
| 10 | 345 TYT Türkçe | ucdortbes.com resmî künye | 440 |
| 11 | 3D TYT Fizik | Kitapseç 2026, İKM, Hepsiburada | 296, 2026 baskısı |
| 12 | 3D TYT Biyoloji | MaviKalem, Kitapdoldur, Fotokopi Loft | ISBN doğrulandı, sayfa sayısı yok → medium |
| 13 | Aydın AYT Kimya | aydinyayinlari.com.tr resmî, N11, İdefix | 408 resmî / 416 satıcı |
| 14 | Aydın AYT Biyoloji | aydinyayinlari.com.tr resmî, Pelikan (aynı ISBN) | 280 / 328 → çözülemedi, elendi |
| 15 | Toprak AYT Kimya | toprakyayincilik.com resmî, Hızlı Kitap | 368 (eski 376 ayrı ISBN) |
| 16 | Hız TYT-AYT Geometri | Kitapkapımda, AKM, Kitapişler, hizverenk.com | 320 / 334 / 400 → 320 medium |
| 17 | Biyotik 2028 Maarif | Dizgi, Kitapiste, Kitapseç, Trendruum | 224 |
| 18 | Mikroorijinal Geometri | Palmekitabevi, Dizgi, Kitapseç, Kitapgelir, İşler Toptan | 416; 2026-27 aynı ISBN |
| 19 | Barış Problemler | Dizgi, İdefix, AKM, Kitapseç/BKM | 200 (3) / 196 (2) |
| 20 | Apotemi AYT Biyoloji | Kitapseç, Dizgi, Kitapsepeti, AKM, Kitapanka | 399 |
| 21 | Orbital Maarif 1. Aşama | BKM, Kitapyurdu, AKM, İndeks, Kitapanka | 312, yayın 24.07.2026 |

## 6. Doğrulanamayanlar

### 6.1 Birleştirme aşamasında elenenler (2)

| Kitap | Neden |
|---|---|
| Aydın Yayınları — AYT Biyoloji Soru Bankası | Aynı ISBN (9786050627787) için resmî Aydın sitesi **280**, Pelikan **328** sayfa. Üçüncü bağımsız kaynak yok, fark 48 sayfa. Ayrıca resmî kayıt "Kampanyalı Ürün / 2025 müfredat" (eski baskı) olduğu için 2026 edisyonu belirsiz. |
| Biyotik — TYT Biyoloji Full Tekrar Biyokamp | Aynı ürün için BBD Store **288**, Atlas Kırtasiye **184**, Trendyol **251-300**, eski baskı **150**. Ayrıca kaynak URL'si "Biyokamp Review" (22 fasiküllük set olabilir) adını taşıyor; brief'in "tek cilt" kuralı riski var. |

### 6.2 Saha ekiplerinin zaten elediği kitaplar (9 kitap + 1 yayınevi notu)

Bunlar hiçbir aşamada aday listesine girmedi; sayıya dahil değildir.

| Kitap | Neden |
|---|---|
| 345 — AYT Fizik Soru Bankası | Resmî sayfada sayfa yok; 351 / 368 / 392 çelişkisi. |
| 3D — AYT Biyoloji Soru Bankası | 232 / 256; güncel ISBN belirsiz. |
| Aydın — TYT Biyoloji Soru Bankası | Resmî 200 / Pelikan 206; ayrıca 184 sayfalık Maarif baskısı. |
| 345 — TYT-AYT Geometri | Tek cilt değil, 440 + 330 iki cilt. |
| Barış — TYT-AYT Geometri Soru Bankası (eski) | Güncel listingte sayfa yok, stokta değil; "Soru Kitabı"nın eski adı olabilir. |
| Hız — AYT Fizik | 272 / 316. |
| Hız — TYT Biyoloji | 202 / 224. |
| Palme — TYT Biyoloji | 240 / 256, farklı ISBN olabilir. |
| Palme — AYT Edebiyat | Güncel listingte sayfa sayısı yok. |
| Biyoanaliz | Yeni ve tekrar etmeyen çalışma kitabı yok (mevcut iki kitap katalogda). |

## 7. Mevcut katalog düzeltmesi (yeni diziye dahil değil)

**Karar: düzeltilmeli.** 345 AYT Matematik, `catalogBooks.ts` satır 85–92:

```ts
totalPages: 384,   // → 375
```

Gerekçe: 345'in resmî ürün sayfası (`https://www.ucdortbes.com/ayt-matematik-soru-bankasi`) güncel künyede **375 sayfa**, ISBN 9786058136816 veriyor. Katalogdaki 384, önceki baskıya ait. `catalogBookId` başlık+yayınevi+edisyon ile üretildiği için sayfa değişikliği kimliği bozmaz; kullanıcıların mevcut ilerlemesi etkilenmez.

## 8. Kalan riskler

1. **Hız TYT Türkçe:** 352 sayısı eski/paralel ISBN'lerde doğrulandı; 2026-27 ürününün sayfası hiçbir kaynakta yok. Yeni baskı farklıysa ±20 sayfa sapma olabilir.
2. **Hız TYT-AYT Geometri:** 320 / 334 / 400 üçlü çelişkisi tam kapanmadı. Kitapişler'in 400'ü doğruysa %25 sapma olur.
3. **Aydın AYT Kimya:** resmî 408 ile satıcı 416 arasındaki 8 sayfa farkı baskı farkı varsayımına dayanıyor.
4. **3D TYT Biyoloji:** 256 tek kaynaklı; bağımsız doğrulama yok.
5. **Ortak cilt sınav ataması:** TYT-AYT geometri kitapları TYT'de görünür, AYT filtresinde çıkmaz. Ürün kararı bu yönde değilse 6 satırın `exam` alanı topluca değiştirilmeli.
6. **Baskı yılı varsayımları:** Palme (yıllık baskı yok), Toprak (ilk basım 2023), Mikroorijinal (2023 ilk baskı) ve Hız satırlarında `edition` satıcı etiketine dayanıyor. Sayfa sayıları sabit olduğu için ilerleme hesabını etkilemez.
