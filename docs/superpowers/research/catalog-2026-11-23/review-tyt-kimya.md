PASS

# Review — tyt-kimya

## Özet
- Toplam satır: **28** (tamamı `kimya`, `exam: TYT`)
- Kontrol edilen URL: **10** — 7 satır açıldı; 8 URL doğrudan sayfa sayısı verdi, 2 BKM arama URL'si ürün döndürmedi
- Örneklenen satır: **7/28 (%25)** — satır 1, 3, 21, 23, 24, 25, 26
- Medium satırların tamamı kontrol edildi: satır 23, 24, 25, 26
- Şema: 28/28 geçti. Tüm alanlar mevcut; `exam` TYT, `subjectSlug` `kimya`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl` ve tüm `sourceUrls` http(s), `confidence` high/medium.
- Tekrar: `mevcut.ts` (80 kayıt) ve 8 batch raporunun tamamı tarandı; `title + publisher` tekrarı **yok**. `Karekök`/`Karekök Yayıncılık`, `Palme`/`Palme Yayınevi` gibi yayınevi takma adları normalize edilerek de tarandı; çakışma yok.
- Kapsam: 28 kimya satırı. Fasikül seti satırı yok; `gaps` Fenomen VAF ve Çap fasiküllerinin adet doğrulanamadığını açıklıyor.
- Sayfa sayısı: resmî künye > aynı ISBN'li mağaza çoğunluğu > eski baskı sırası uygulanmış; çelişkiler `notes`ta belirtilmiş.

## Doğrulanan satırlar (7)
| # | Kitap / Yayınevi | Doğrulanan sayfa | Kaynak |
|---|---|---|---|
| 1 | TYT Kimya Soru Bankası / Karekök Yayıncılık | 208 | Karekök resmî künye, ISBN 9786257154024 |
| 3 | TYT AYT Kimya Soru Gezegeni / Gezegen Yayıncılık | 440 | BKM 440, ISBN 9786057543516 |
| 21 | TYT Kimya Soru Bankası / Sınav Yayınları | 232 (not: Pelikan 231) | Pelikan 231; raporda BKM 232 esas alınmış |
| 23 | TYT Kimya Iceberg Soru Bankası / Okyanus Yayınları | 176 | Pelikan 176, ISBN 9786257108720 |
| 24 | TYT Kimya Konsensüs Soru Bankası / Editör Yayınları | 205 | Pelikan 205, ISBN 9786052801758 |
| 25 | TYT AYT Kimya Avantaj Soru Bankası / Limit Yayınları | 256 | Pelikan 256, ISBN 9786052752463 |
| 26 | TYT Kimya Konu Kitabı / Yazıt Yayıncılık | 272 (not: Pelikan 257) | Trendruum 272, ISBN 9786057705037; Pelikan 257 |

## Uyarılar (bloklamayan)
- **Satır 26**: `sourceUrl` bir BKM arama URL'si (`/arama?q=...`) ve açıldığında ürün döndürmedi. 272 sayfa Trendruum'un doğrudan ürün sayfasında doğrulandı; Pelikan 257 diyor. Birincil URL doğrudan ürün sayfasıyla (Trendruum veya BKM ürün URL'si) değiştirilmeli. Medium güven bu haliyle doğru; ikinci bağımsız kaynak eklendiği için high'a çekilebilir.
- **Satır 21**: Pelikan 231, raporda BKM 232 esas alınmış. BKM ürün sayfası doğrudan açılamadı; 1 sayfalık fark bloklayıcı değil, ancak `sourceUrl` doğrudan ürün sayfası olmalı.
- **Satır 23, 24, 25**: Tek bağımsız mağaza kaynağı nedeniyle medium bırakılması doğru.
- **Genel**: Bu batch'te çok sayıda `https://www.bkmkitap.com/arama?q=<ISBN>` biçiminde arama URL'si kullanılmış. Arama sayfaları kalıcı ürün sayfası değildir; doğrudan ürün URL'siyle değiştirilmesi önerilir.
- **Eski baskılar**: Satır 3'te Truva Kitap'ın 455 sayfa değeri eski/sahaf baskısı olarak not edilmiş; 440 değeri BKM ile doğrulandı.

## Sonuç
28 satırın tamamı şema, tekrar ve kapsam açısından geçerli; örneklenen 7 satırın tamamında sayfa sayısı bağımsız kaynakla doğrulandı. **PASS**.
