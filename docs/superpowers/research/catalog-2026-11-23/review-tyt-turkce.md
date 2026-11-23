PASS

# Review — tyt-turkce

## Özet
- Toplam satır: **35**
- Kontrol edilen URL: **11** (10 doğrudan fetch + 1 arama indeksi; `alternatifyayinlari.com` doğrudan fetch'te 403 döndü)
- Örneklenen satır: **9/35 (%26)** — satır 1, 3, 5, 20, 29, 30, 32, 34, 35
- Şema: 35/35 geçti. Tüm alanlar mevcut; `exam` TYT, `subjectSlug` `turkce`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl`/`sourceUrls` http(s), `confidence` high.
- Tekrar: `mevcut.ts` (80 kayıt) ve diğer üç rapora karşı `title + publisher` tekrarı **yok**.
- Kapsam: 16 paragraf kitabı, 4 fasikül satırı (satır 27, 32, 33, 34), TYT-AYT ortak kitaplar TYT olarak işaretli.
- Sayfa sayısı: örneklenen tüm satırlarda künye/mağaza değeri doğrulandı; çelişkiler `notes` alanında ve öncelik kuralına uygun çözülmüş.

## Doğrulanan satırlar (9)
| # | Kitap / Yayınevi | Doğrulanan sayfa | Kaynak |
|---|---|---|---|
| 1 | Kronometre Paragraf Soru Bankası / Limit | 368 | Palme Kitabevi 368, Kitapzen 368 (KitapSec 360 azınlık) |
| 3 | 2027 Parla Paragraf Soru Bankası / Benim Hocam | 384 | Benim Hocam resmî 384 |
| 5 | TYT Master Paragraf Soru Bankası / Okyanus | 264 | Okyanus resmî 264 |
| 20 | TYT Türkçe Ders İşleme Föyü / Pegem | 272 | Pegem resmî 272 |
| 29 | TYT Dil Bilgisi Konu Anlatımlı SB / Paragrafın Şifresi | 340 | Resmî künye 340 |
| 30 | TYT-AYT Türkçe Konu Anlatımlı / Karekök | 504 | Karekök resmî 504 |
| 32 | Konu Kapandı mı? TYT Türkçe (16 Fasikül) / Alternatif | 136 | Alternatif resmî künye 136 / 16 fasikül (site 403; arama indeksi içeriği) |
| 34 | TYT Türkçe Fasikül Soru Kitabı / Test Okul | 304 | İstanbul Kitapçısı 304 |
| 35 | TYT Türkçe El Kitabı / Limit | 400 | Kitapİşler 400 (KitapSec 460 azınlık) |

## Uyarılar (bloklamayan)
- **Satır 4** (`Paragraf Konu Anlatımlı Soru Bankası` / Apotemi): `sourceUrls` içinde aynı KitapSec URL'si iki kez var. Tekrarı temizleyin.
- **Satır 32**: Yayınevinin resmî sitesi inceleme sırasında 403 verdi; 136 sayfa / 16 fasikül değeri arama indeksindeki resmî künye içeriğiyle doğrulandı. Kaynak erişimi kalıcı değilse ikinci bir mağaza URL'si eklenmeli.
- **Yayınevi adı tutarlılığı**: Bu batch'te `Palme Yayınevi` (satır 12, 19, 27, 33), diğer batch'lerde `Palme Yayınları` / `Palme` kullanılıyor. Aynı başlık+yayınevi tekrarı değil, ancak katalog genelinde tek yazım tercih edilmeli.
- **Satır 1** ve **35**: `notes` alanındaki azınlık sayfa değerleri doğru şekilde belirtilmiş; resmî/çoğunluk değeri kullanılmış.

## Sonuç
35 satırın tamamı şema, tekrar ve kapsam açısından geçerli; örneklenen 9 satırın tamamında sayfa sayısı bağımsız kaynakla doğrulandı. **PASS**.
