PASS

# Review — tyt-sosyal-1

## Özet
- Toplam satır: **36** — **18 tarih + 18 coğrafya** (hepsi `exam: TYT`)
- Kontrol edilen URL: **11** — 10 satır açıldı
- Örneklenen satır: **10/36 (%28)** — satır 3, 4, 6, 13, 15, 16, 21, 22, 29, 36
- Medium satırların tamamı kontrol edildi: satır 16 (Benim Hocam Tarih Ders Notları), satır 36 (Fenomen Coğrafya)
- Şema: 36/36 geçti. Tüm alanlar mevcut; `exam` TYT, `subjectSlug` yalnızca `tarih`/`cografya`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl` ve tüm `sourceUrls` http(s), `confidence` high/medium.
- Tekrar: `mevcut.ts` (80 kayıt) ve 8 batch raporunun tamamı tarandı; `title + publisher` tekrarı **yok**. Mevcut katalogdaki Bilgi Sarmal/Palme/Karekök/Okyanus/Benim Hocam tarih-coğrafya kayıtlarıyla çakışma yok.
- Kapsam: 18 tarih + 18 coğrafya hedefi tam. Fasikül seti satırı yok; `gaps` Merkez fasiküllerinin sayfa sayısının güvenilir olmadığını ve 3D/Aydın satırlarının elendiğini açıklıyor.
- Sayfa sayısı: resmî künye > aynı ISBN'li mağaza çoğunluğu > eski baskı sırası uygulanmış; çelişkiler `notes`ta belirtilmiş.

## Doğrulanan satırlar (10)
| # | Kitap / Yayınevi | Doğrulanan sayfa | Kaynak |
|---|---|---|---|
| 3 | TYT Tarih Soru Bankası / Hız ve Renk Yayınları | 268 | D&R 268, ISBN 9786257532693, ilk baskı 2024 |
| 4 | TYT Tarih Soru Bankası / Karekök | 320 | Karekök resmî 320, ISBN 9786257154338 |
| 6 | 2026 TYT Tarih Video Çözümlü Soru Bankası / Benim Hocam Yayınları | 272 | Kitapyurdu 272, ISBN 9786255847447, 2026 (stokta yok) |
| 13 | TYT Tarih Garanti Konular Soru Bankası / Paraf Yayınları | 144 | Paraf Akademi resmî 144, ISBN 9786259398907 |
| 15 | 2026 TYT-AYT Tarih Konu Özetli Yeni Nesil Soru Bankası / Marka Yayınları | 208 | Marka resmî 208, ISBN 9786258476767 |
| 16 | 2026 TYT Tarih Ders Notları / Benim Hocam Yayınları | 224 | Kitapyurdu 224; resmî sayfa artık 2027 baskısı 224 |
| 21 | TYT Coğrafya Soru Bankası / Hız ve Renk Yayınları | 286 | Kitapkapımda 286, ISBN 9786057530882 (2026 başlıklı); D&R aynı ISBN 286 (2022) |
| 22 | TYT Coğrafya Soru Bankası / Karekök | 312 | Karekök resmî 312, ISBN 9786258419610 |
| 29 | 2026 TYT Coğrafya Konu Özetli Yeni Nesil Soru Bankası / Marka Yayınları | 192 | Marka resmî 192, ISBN 9786258476439 |
| 36 | Fenomen TYT Coğrafya Soru Bankası / Fenomen Okul Yayınları | 224 / 2027 | Derskitabım 224, ISBN 9786257523844, basım 2027 |

## Düzeltme önerileri (bloklamayan)
- **Satır 16 — `notes` ISBN hatası**: Notta yazılan **9786255847430** bu kitabın değil, Benim Hocam **TYT-AYT Din Kültürü** kitabının ISBN'sidir. Doğru ISBN **9786255847416**. Ayrıca Benim Hocam'ın resmî `2026-tyt-tarih-ders-notlari` URL'si artık **2027 TYT Tarih Ders Notları**ni (224 sayfa, basım 2027, stokta) gösteriyor; Kitapyurdu'ndaki 2026 baskısı "SATIŞ YOK (TÜKENMİŞ)". Başlık/edition 2027'ye güncellenmeli veya resmî 2027 URL'si `sourceUrl` yapılmalı.
- **Satır 6**: Aynı desen; Kitapyurdu'ndaki 2026 baskısı tükenmiş, Benim Hocam 2027 Tarih Video Çözümlü Soru Bankası'nı satıyor. Sayfa 272 doğru; güncel 2027 baskısıyla değiştirilmesi önerilir.
- **Satır 21**: 286 sayfa iki kaynakta ortak. Ancak D&R aynı ISBN'i 2022 baskısı olarak ve stokta yok gösteriyor; 2026 ifadesi Kitapkapımda başlığından geliyor. Sayfa sayısı korunabilir, `notes`ta bu durum açık yazılmalı.
- **Satır 29**: `sourceUrl` adresi "2024-tyt-ayt-tarih..." slug'ı taşıyor; sayfa içeriği ise **2026 TYT Coğrafya** ve 192 sayfa. Ürün doğru, URL slug'ı hatalı; temiz ürün URL'si kullanılmalı.
- **Satır 36**: 224 sayfa ve 2027 baskı mağaza künyesinde net; medium yerine high'a çekilebilir.
- **Satır 3**: Bazı pazaryerlerindeki 285 sayfa farklı baskıya ait; 268 değeri D&R ile doğrulandı.

## Sonuç
36 satırın tamamı şema, tekrar ve kapsam açısından geçerli; 18 tarih + 18 coğrafya hedefi tam. Örneklenen 10 satırın tamamında sayfa sayısı bağımsız kaynakla doğrulandı. **PASS**.
