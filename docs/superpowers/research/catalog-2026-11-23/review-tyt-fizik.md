PASS

# Review — tyt-fizik

## Özet
- Toplam satır: **28**
- Kontrol edilen URL: **10**
- Örneklenen satır: **9/28 (%32)** — satır 1, 6, 8, 13, 19, 22, 23, 24, 27
- Şema: 28/28 geçti. Tüm alanlar mevcut; `exam` TYT, `subjectSlug` `fizik`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl`/`sourceUrls` http(s), `confidence` high.
- Tekrar: `mevcut.ts` (80 kayıt) ve diğer üç rapora karşı `title + publisher` tekrarı **yok**. Mevcut katalogdaki Bilgi Sarmal / Apotemi / 3D / 345 / Hız ve Renk / Toprak fizik kayıtlarıyla çakışma yok.
- Kapsam: 28 fizik satırı; 3 fasikül seti (Çap 5, Merkez 11, Fenomen 4); TYT-AYT ortak `Gelişim Serisi Fizik B` TYT olarak işaretli (satır 25).
- Sayfa sayısı: örneklenen tüm satırlarda resmî künye veya bağımsız mağaza değeri doğrulandı.

## Doğrulanan satırlar (9)
| # | Kitap / Yayınevi | Doğrulanan sayfa | Kaynak |
|---|---|---|---|
| 1 | TYT Fizik Soru Bankası / Karekök | 256 | Karekök resmî 256 (mağazalar 262 azınlık) |
| 6 | TYT 40 Seans Fizik / Okyanus | 336 | Okyanus resmî 336 (mağazalar 368 azınlık) |
| 8 | TYT Fizik 0'dan Başlayanlara / Aktif Öğrenme | 352 | KitapSec 352, Kitapiste 352 |
| 13 | TYT Fizik Temel ve Orta Düzey SB / Kafa Dengi | 224 | Kafa Dengi resmî 224 (mağazalar 176 azınlık) |
| 19 | Analitik TYT Fizik Konu-Soru Fasikülleri (11 Fasikül) / Merkez | 312 | Merkez resmî 312 sayfa / 11 fasikül |
| 22 | TYT Fizik Tersyüz Soru Kitabı / Nitelik | 248 | KitapSec 248 |
| 23 | TYT VAF Fizik Fasikülleri Seti (4 Fasikül) / Fenomen | 400 | BKM 400 |
| 24 | TYT Fizik Kamp Kitabı / Karaağaç | 472 | mehmetkaraagac.com.tr resmî 472 (220 ifadesi ebat, sayfa değil) |
| 27 | DM Serisi TYT Fizik SB / Sonuç | 304 | Sonuç resmî kategori sayfası "304 Sayfa Sayısı" |

## Uyarılar (bloklamayan)
- **Satır 8**: `sourceUrl` (İndeks Kitap) `sourceUrls` listesinde yer almıyor; liste yalnızca Kitapiste ve KitapSec'i içeriyor. Sayfa sayısı 352 her iki listede de doğrulandı, ancak birincil URL listeye eklenmeli.
- **Satır 24**: Resmî sayfa başlığı "2026 TYT Fizik Ders Kitabı" iken satır başlığı "TYT Fizik Kamp Kitabı". Aynı ürün (sayfada "TYT FİZİK KAMP KİTABI (2026)" ve 472 sayfa geçiyor); başlık künyedeki ana ada göre hizalanabilir.
- **Eski baskılar**: Satır 7 (2018) ve 10 (2017) hâlâ satışta; `notes` bunu belirtiyor. Sayfa sayıları doğru, güncellik araştırmacının sorumluluğunda.
- **Satır 19**: Siteye HTTPS ile erişilemedi; HTTP üzerinden resmî künye doğrulandı. `sourceUrl` https olduğu için tarayıcıda sorun çıkarsa http'ye çevrilebilir veya ikinci mağaza URL'si eklenebilir.

## Sonuç
28 satırın tamamı şema, tekrar ve kapsam açısından geçerli; örneklenen 9 satırın tamamında sayfa sayısı bağımsız kaynakla doğrulandı. **PASS**.
