PASS

# Review — tyt-sosyal-2

## Özet
- Toplam satır: **25** — **15 felsefe + 10 din-kulturu** (hepsi `exam: TYT`)
- Kontrol edilen URL: **6** — 6 satır açıldı
- Örneklenen satır: **6/25 (%24)** — satır 4, 5, 7, 10, 14, 22
- Medium satır yok; tüm satırlar high.
- Şema: 25/25 geçti. Tüm alanlar mevcut; `exam` TYT, `subjectSlug` yalnızca `felsefe`/`din-kulturu`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl` ve tüm `sourceUrls` http(s), `confidence` high.
- Tekrar: `mevcut.ts` (80 kayıt) ve 8 batch raporunun tamamı tarandı; `title + publisher` tekrarı **yok**. Mevcut katalogda felsefe/din kültürü kaydı bulunmuyor; çakışma yok.
- Kapsam: 15 felsefe + 10 din-kültürü hedefi tam. Fasikül seti satırı yok; `gaps` felsefe/din için ayrı fasikül ve kamp kitabı bulunamadığını açıklıyor.
- Sayfa sayısı: resmî künye > aynı ISBN'li mağaza çoğunluğu > eski baskı sırası uygulanmış; çelişkiler `notes`ta belirtilmiş.

## Doğrulanan satırlar (6)
| # | Kitap / Yayınevi | Doğrulanan sayfa | Kaynak |
|---|---|---|---|
| 4 | 2027 TYT Felsefe Ders Notları ve Video Çözümlü Soru Bankası / Benim Hocam Yayınları | 192 / 2027 | Benim Hocam resmî 192, ISBN 9786255847744 |
| 5 | TYT Felsefe Soru Bankası (DİS Serisi) / Ordinat Yayınları | 176 | Ordinat resmî 176, ISBN 9786259812816 |
| 7 | TYT-AYT Felsefe Soru Kitabı / Palme Yayınevi | 232 | Palme resmî 232, ISBN 9786052826997 |
| 10 | TYT Felsefe Soru Bankası / Seviye Yayınları | 160 | Seviye resmî 160, ISBN 978-605-340-892-5 |
| 14 | TYT Felsefe Soru Bankası / Zafer Yayınları | 224 | Zafer resmî 224, resmî satış sitesi |
| 22 | 2027 TYT-AYT Din Kültürü ve Ahlak Bilgisi Ders Notları ve Video Çözümlü Soru Bankası / Benim Hocam Yayınları | 208 / 2027 | Benim Hocam resmî 208, ISBN 9786255847430 |

## Uyarılar (bloklamayan)
- **Satır 7**: Palme resmî künyesi 232; aynı ISBN için bazı mağazalar 216 diyor. Resmî künye önceliği doğru uygulanmış.
- **Satır 14**: Resmî ürün sayfası sayfa sayısını (224) veriyor ancak baskı yılını belirtmiyor; `edition: 2026` bu nedenle varsayım. `notes` bunu açıkça yazıyor; başka bir kaynakta baskı yılı teyit edilirse güncellenmeli.
- **Satır 5 ve 6**: Ordinat ürün sayfalarının alt bölümünde geçen 208/200 sayfa değerleri üst künyedeki 176/192 ile çelişiyor; resmî üst künye esas alınmış, doğru.
- **Satır 22 — ISBN çapraz kontrol**: **9786255847430** bu Din Kültürü kitabına aittir. `tyt-sosyal-1` batch'indeki satır 16'nın `notes`unda aynı ISBN yanlışlıkla Tarih Ders Notları'na yazılmış; düzeltme o dosyada belirtildi.
- **Satır 9 ve 10**: Seviye resmî künyeleri tek kaynak olsa da yayınevinin kendi sayfası olduğu için high tanımına uyuyor.
- **Satır 21**: MUBA resmî künye 112 sayfa; TYT-AYT-MSÜ ortak cilt, TYT batch'ine yazılması brief'e uygun.

## Sonuç
25 satırın tamamı şema, tekrar ve kapsam açısından geçerli; 15 felsefe + 10 din-kültürü hedefi tam. Örneklenen 6 satırın tamamında sayfa sayısı resmî künye veya bağımsız kaynakla doğrulandı. **PASS**.
