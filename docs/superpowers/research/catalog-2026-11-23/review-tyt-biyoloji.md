PASS

# Review — tyt-biyoloji

## Özet
- Toplam satır: **29** (tamamı `biyoloji`, `exam: TYT`)
- Kontrol edilen URL: **8** — 8 satır açıldı; 7 URL doğrudan sayfa sayısı verdi, Paraf resmî sayfası yalnızca ISBN verdi
- Örneklenen satır: **8/29 (%28)** — satır 2, 4, 8, 11, 17, 18, 27, 29
- Medium satırın tamamı kontrol edildi: satır 8 (Endemik)
- Şema: 29/29 geçti. Tüm alanlar mevcut; `exam` TYT, `subjectSlug` `biyoloji`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl` ve tüm `sourceUrls` http(s), `confidence` high/medium.
- Tekrar: `mevcut.ts` (80 kayıt) ve 8 batch raporunun tamamı tarandı; `title + publisher` tekrarı **yok**. Özellikle Apotemi TYT Biyoloji mevcut katalogda yalnızca AYT olarak var; bu satır çakışmıyor.
- Kapsam: 29 biyoloji satırı; 1 fasikül seti (Palme Enerji 2 Fasikül, satır 4). `gaps` doğrulanamayan Hız ve Renk, Limit, Kafa Dengi ve Biyotik föylerini açıklıyor.
- Sayfa sayısı: resmî künye > aynı ISBN'li mağaza çoğunluğu > eski baskı sırası uygulanmış; çelişkiler `notes`ta belirtilmiş.

## Doğrulanan satırlar (8)
| # | Kitap / Yayınevi | Doğrulanan sayfa | Kaynak |
|---|---|---|---|
| 2 | TYT Biyoloji Konu Anlatımlı / Palme Yayınevi | 288 | Palme Kitabevi resmî künye, ISBN 9786052825136 |
| 4 | TYT Enerji Biyoloji Konu Özetli Soru Fasikülleri (2 Fasikül) / Palme Yayınevi | 200 | Palme Kitabevi 200, 2023, ISBN 9786256441521 |
| 8 | TYT Biyoloji Soru Bankası / Endemik Yayınları | 192 (önceki ISBN) | KitapSec 192, ISBN 9786257430159 (eski baskı) |
| 11 | TYT Biyoloji Ders Notları / Benim Hocam Yayınları | 224 / 2027 | Benim Hocam resmî 224, ISBN 9786255847607, basım 2027 |
| 17 | TYT Dr. Biyoloji Video Ders Kitabı / Oksijen Yayınları | 158 | Oksijen resmî satış sitesi 158 |
| 18 | TYT Biyoloji Soru Bankası / Apotemi | 272 | KitapSec 272, ISBN 9786057551498 |
| 27 | TYT 28 Saatte Biyoloji Soru Bankası / Paraf Yayınları | 224 (mağazalar) | Paraf resmî ISBN 9786257423977; mağazalar 224 |
| 29 | Görev TYT Biyoloji Yeni Nesil Çalışma Föyleri / Armada Yayınları | 296 | Kitapzen 296, 2022-07, ISBN 9786057150097 |

## Uyarılar (bloklamayan)
- **Satır 8 (medium)**: Yeni ISBN 9786257430647 için yayımlanmış sayfa sayısı yok; 192 değeri önceki ISBN'li baskıdan (9786257430159) geliyor ve KitapSec'te bu baskı tükenmiş. Medium güven ve `notes` açıklaması doğru; yeni baskının sayfası teyit edilirse güncellenmeli.
- **Satır 11**: `sourceUrl` `/2026-tyt-biyoloji-ders-notlari` olsa da sayfa artık **2027** baskısını (224 sayfa, ISBN 9786255847607) gösteriyor. Satırdaki `edition: 2027` doğru; URL'nin 2027 sürümüyle değiştirilmesi önerilir.
- **Satır 27**: Paraf resmî sayfası sayfa sayısı vermiyor, yalnızca ISBN veriyor; 224 iki mağazada ortak. Mağazalar aynı ISBN'i "Z Takımı TYT Biyoloji Soru Bankası" adıyla satıyor; resmî ad ("28 Saatte") esas alınmış, bu doğru tercih.
- **Satır 4**: 2 fasiküllük setin toplamı 200; başlıkta "(2 Fasikül)" var, brief'e uygun.
- **Eski baskılar**: Satır 25 (Bilfen 2022), satır 28 (Üçgen 2022), satır 29 (Armada 2022) hâlâ satışta; sayfa sayıları doğrulandı.

## Sonuç
29 satırın tamamı şema, tekrar ve kapsam açısından geçerli; örneklenen 8 satırın tamamında sayfa sayısı bağımsız kaynakla doğrulandı. **PASS**.
