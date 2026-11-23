FAIL

# Review — ayt-biyoloji-cografya

## Özet
- Toplam satır: **43** — **25 biyoloji + 9 cografya-1 + 9 cografya-2** (hepsi `exam: AYT`)
- Kontrol edilen URL: **48** — 43 birincil kaynak + 5 ek kaynak (3D Biyoloji için 2, Eis için 2, Limit için BKM 1); ayrıca 2 satır için arama sonucu kullanıldı
- Örneklenen satır: **43/43 (%100)** — 9 medium satırın tamamı ve 34 high satırın tamamı kontrol edildi
- Şema: 43/43 geçti. Tüm alanlar mevcut; `exam` AYT, `subjectSlug` yalnızca `biyoloji`/`cografya-1`/`cografya-2`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl` ve tüm `sourceUrls` http(s), `confidence` high/medium.
- Tekrar: `mevcut.ts` (80 kayıt) ve 13 batch raporunun tamamı tarandı; `title + publisher` tekrarı **yok**. Ortak "AYT Coğrafya" kitapları `cografya-1` veya `cografya-2` altında **bir kez** yazılmış; iki alt derse kopyalanmamış. Aynı yayınevinin iki ayrı Coğrafya satırı yok.
- Kapsam: 25 biyoloji + 9 cografya-1 + 9 cografya-2 hedefi tam. `gaps` boş; hedefler dolu.
- Sayfa sayısı: 41 satırda resmî künye/mağaza değeri doğrulandı. **2 satırda sayfa sayısı beyan edilen baskıyla uyuşmuyor** (aşağıda).

## FAIL — satır düzeltmeleri

### 1) Satır 42 — Limit Yayınları
- **Kitap**: AYT Coğrafya Soru Bankası
- **Yayınevi**: Limit Yayınları
- **Alan**: `totalPages`
- **Mevcut**: 320
- **Beklenen**: **192**
- **Gerekçe**: Limit'in güncel resmî ürün sayfası (`limityayinlari.com.tr/kitaplar/ayt-cografya-soru-bankasi`) **ISBN 9786052758731** ve **192 sayfa** gösteriyor. 320 sayfa değeri, 2022 baskısı **ISBN 9786052755587**'ye ait (Kitapyurdu, Kitapkapımda, Polat Kitapçılık, Endülüs Kitapevi 320). BKM aynı eski ISBN için 272 sayfa yazıyor. Satırdaki `edition: 2026` ile 320 sayfa birlikte hiçbir kaynakla doğrulanamıyor; `notes`taki "resmî künye 320" ifadesi de güncel resmî sayfayla çelişiyor.
- **Alternatif**: 320 korunacaksa `edition` **2022** yapılmalı ve `notes` "2022 baskısı, ISBN 9786052755587; BKM 272" olarak düzeltilmeli. Güncel katalog için doğru değer **192**.

### 2) Satır 23 — Benim Hocam Yayınları
- **Kitap**: AYT Biyoloji Ders Notları
- **Yayınevi**: Benim Hocam Yayınları
- **Alan**: `totalPages`
- **Mevcut**: 288
- **Beklenen**: **304**
- **Gerekçe**: 2026 baskısı **ISBN 9786255847645**, **304 sayfa** (Kitapyurdu, D&R, Palme Kitabevi, İstanbul Kitapçısı, Kitapestore, İllakitap — hepsi 304). 288 sayfa, 2024 baskısı **ISBN 9786258161403**'e (Dilek Kuvvet) aittir. Satırın `notes` alanındaki "2026/2027 baskısı aynı sayfa sayısıyla satılıyor" ifadesi yanlıştır: 2025 baskısı 304, 2027 baskısı 320 sayfadır. `edition: 2026` ile doğru değer **304**'tür.
- **Alternatif**: 288 korunacaksa `edition` **2024** yapılmalı ve yazar/ISBN notu eklenmeli. Güncel katalog için doğru değer **304**.

## Doğrulanan diğer satırlar (41/41)
| # | Kitap / Yayınevi | Sayfa | Kaynak |
|---|---|---|---|
| 1 | AYT Biyoloji Konu Anlatımlı / Palme | 376 | Palme resmî 376 |
| 2 | AYT Biyoloji Soru Bankası / Endemik | 288 | Endemik resmî 288 |
| 3 | AYT Biyoloji Soru Bankası / Karekök | 280 | Karekök resmî "Sayfa: 280" |
| 4 | AYT Biyoloji Soru Bankası / Aydın | 280 | Aydın resmî 280 |
| 5 | Miray AYT Biyoloji / Miray | 280 | Aydın/Miray resmî 280 |
| 6 | AYT Biyoloji Soru Bankası / Hız | 280 | Hız resmî 280 |
| 7 | AYT Biyoloji Soru Bankası / VİP | 288 | VİP resmî "288 Sayfa" |
| 8 | AYT Biyoloji Soru Bankası / Açı | 224 | Açı resmî 224 |
| 9 | AYT 3D Biyoloji / 3D | 232 | Dizgi 232 + Kitapsayfam 232 (Hepsiburada 403) |
| 10 | AYT 40 Seans Biyoloji / Okyanus | 240 | Okyanus resmî 240 |
| 11 | AYT Biyoloji Plus / Çap | 224 | D&R 224 |
| 12 | AYT Enerji Biyoloji Fasikülleri (4 Fasikül) / Palme | 376 | Palme resmî 376 |
| 13 | AYT Biyoloji Soru Bankası / Tudem | 256 | Tudem resmî 256 |
| 14 | AYT Biyoloji Soru Bankası / Ritim | 288 | Ritim resmî 288 |
| 15 | AYT Başlıyorum Biyoloji / IQ | 264 | IQ resmî 264 |
| 16 | AYT PÜF Biyoloji / IQ | 288 | IQ resmî 288 |
| 17 | AYT Biyoloji Konu Özetli / Üç Dört Beş | 360 | Üç Dört Beş resmî 360 |
| 18 | AYT VAF Biyoloji A / Fenomen | 224 | KitapSec 224 |
| 19 | AYT Biyoloji Süper Öğreten / Kafa Dengi | 216 | Abccadde 216 |
| 20 | AYT Biyoloji Simülatör / Yayın Denizi | 192 | Kitapİşler 192 |
| 21 | AYT Dr. Biyoloji / Oksijen | 256 | Oksijen resmî satış "AYT ... 256 sayfa" |
| 22 | AYT Biyoloji Ders Föyleri (DİS) / Ordinat | 280 | Ordinat resmî 280 |
| 24 | AYT Biyoloji Soru Bankası / Limit | 280 | MaviKalem 280 |
| 25 | AYT Biyoloji Rehber Sorularla / Esen | 432 | Kitapyurdu 432 |
| 26 | AYT Coğrafya Soru Bankası / Karekök | 264 | Karekök resmî 264 |
| 27 | YKS DAF Coğrafya 1. Kitap / Eis | 352 | KitapSec 352 |
| 28 | YKS DAF Coğrafya 2. Kitap / Eis | 400 | KitapSec 400 |
| 29 | AYT Coğrafya Soru Bankası / Bilgi Sarmal | 208 | Bilgi Sarmal resmî 208 |
| 30 | AYT Coğrafya Soru Bankası / Palme | 208 | Palme Kitabevi 208 |
| 31 | AYT Coğrafya Soru Bankası / VİP | 208 | VİP resmî "208 Sayfa" |
| 32 | AYT Coğrafya Soru Bankası / Hız | 208 | Hız resmî 208 |
| 33 | DM Serisi AYT Coğrafya / Sonuç | 280 | Sonuç resmî 280 |
| 34 | AYT Coğrafya Soru Bankası / Tudem | 240 | Kitapyurdu 240 |
| 35 | AYT Coğrafya Soru Bankası / Pegem | 192 | Kitapyurdu 192 |
| 36 | AYT Iceberg Coğrafya Konu Anlatımı / Okyanus | 216 | Kitapyurdu 216 |
| 37 | AYT Coğrafya Soru Bankası (Güncel) / Toprak | 224 | Toprak resmî 224 |
| 38 | AYT Coğrafya Soru Bankası / Açı | 224 | Açı resmî 224 |
| 39 | AYT Coğrafya Soru Bankası / Endemik | 188 | Endemik resmî 188 |
| 40 | AYT Coğrafya Ders Föyleri (DİS) / Ordinat | 240 | Ordinat resmî 240 |
| 41 | AYT 3D Coğrafya / 3D | 224 | Dizgi 224 |
| 43 | AYT Coğrafya Plus / Çap | 237 | Pelikan 237 |

## Uyarılar (bloklamayan)
- **Satır 34, 35, 36 — edition 2026 / eski basım**: Tudem 2022, Pegem 2023, Okyanus Iceberg 2019 basımı olarak listeli; `edition: 2026` katalog yılı olarak kullanılmış. Sayfa sayıları doğru, yalnızca edition semantiği diğer batch'lerle tutarsız.
- **Satır 42 — ortak cilt sahipliği**: Limit AYT Coğrafya, Coğrafya-1 ve Coğrafya-2 ortak tek cilt olarak `cografya-2` altında bir kez yazılmış; kopya yok. Düzeltme sonrası bu sahiplik korunabilir.
- **Satır 27/28 — Eis DAF**: 12. sınıf setinin 1. ve 2. kitabı; `cografya-2` sahipliği doğru. 1. Kitap 352 (KitapSec) ile 384 (Kitapsepeti) arasında çelişki notta belirtilmiş; mağaza çoğunluğu 352.
- **Ortak Coğrafya kitapları**: Bilgi Sarmal, Palme, VİP, Hız, Sonuç, Tudem, Pegem, Okyanus Iceberg `cografya-1`; Toprak, Açı, Endemik, Ordinat, 3D, Limit, Çap `cografya-2` altında. Hiçbiri iki kez yazılmamış.

## Sonuç
41 satır geçerli; **2 satır sayfa sayısı/baskı uyuşmazlığı nedeniyle FAIL**: Limit AYT Coğrafya (320 → 192) ve Benim Hocam AYT Biyoloji Ders Notları (288 → 304). Bu iki düzeltme yapılmadan batch kabul edilmemeli.

---

## Re-review (fix verification)

Kapsam: yalnızca önceki FAIL satırları (23 ve 42) ve bu düzeltmelerin yan etkileri. Güncel dosya yeniden parse edildi; şema ve tekrar taraması tekrar çalıştırıldı; iki kaynak URL'si yeniden açıldı.

- Güncel satır sayısı: **43** — **25 biyoloji + 9 cografya-1 + 9 cografya-2** (değişmedi)
- Re-review'da açılan URL: **2**
- Şema: 43/43 geçti (tüm zorunlu alanlar mevcut; `exam` AYT, `subjectSlug` izinli, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl`/`sourceUrls` http(s), `confidence` high/medium).
- Tekrar: `mevcut.ts` (80 kayıt) ve 13 batch raporunun tamamına karşı yeni `title + publisher` tekrarı **yok**. Yakın-tekrar taraması da temiz.
- Diğer satırlar: 23 ve 42 dışındaki 41 satırın başlık, yayınevi, sayfa sayısı, edition ve kaynak değerleri önceki incelemedekiyle aynı; `gaps` listesi değişmemiş.

### Bulgu 1 — Limit Yayınları / AYT Coğrafya Soru Bankası — PASS (ADDRESSED)
- `totalPages` **320 → 192** olarak güncellenmiş; `edition: 2026` korunmuş.
- `sourceUrl` artık Limit'in güncel resmî ürün sayfası: **192 sayfa**, **ISBN 9786052758731** (canlı fetch ile doğrulandı).
- `notes` düzeltilmiş: 320'nin 2022 baskısına (ISBN 9786052755587) ait olduğu, BKM'nin eski ISBN için 272 yazdığı belirtiliyor. Önceki "resmî künye 320" çelişkisi kalmamış.
- `confidence: high` resmî künye kuralına uygun; ortak Coğrafya-1/Coğrafya-2 cildi `cografya-2` altında tek satır olarak duruyor, kopya yok.

### Bulgu 2 — Benim Hocam Yayınları / AYT Biyoloji Ders Notları — PASS (ADDRESSED)
- `totalPages` **288 → 304** olarak güncellenmiş; `edition: 2026` korunmuş.
- `sourceUrl` artık Kitapyurdu'nun 2026 baskısı: **304 sayfa**, **ISBN 9786255847645**, yayın tarihi **31.08.2025** (canlı fetch ile doğrulandı).
- `notes` düzeltilmiş: 288'in 2024 baskısına (ISBN 9786258161403, Dilek Kuvvet) ait olduğu, 2027 baskısının 320 sayfa olduğu belirtiliyor. Önceki hatalı "2026/2027 aynı sayfa sayısı" ifadesi kaldırılmış.
- `confidence: medium` tek güvenilir mağaza kaynağı kuralına uygun.

### Re-review sonucu
İki bulgu da kapatıldı; yeni tekrar, şema kırılması veya satır sayısı değişikliği yok. **Final batch verdict: PASS**.
