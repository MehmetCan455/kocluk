PASS

# Review — ayt-felsefe-din

## Özet
- Toplam satır: **17** — **15 felsefe-grubu + 2 din-kulturu** (hepsi `exam: AYT`)
- Kontrol edilen URL: **20** — 17 birincil kaynak + 3 ikincil kaynak (Bilgi Sarmal için İKM, Hız ve Renk için Kitapİşler ve Kitapdoldur; resmî sayfaları sayfa sayısı vermeyen 2 satır için)
- Örneklenen satır: **17/17 (%100)** — 9 medium satırın tamamı ve 8 high satırın tamamı kontrol edildi
- Şema: 17/17 geçti. Tüm alanlar mevcut; `exam` AYT, `subjectSlug` yalnızca `felsefe-grubu`/`din-kulturu`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl` ve tüm `sourceUrls` http(s), `confidence` high/medium.
- Tekrar: `mevcut.ts` (80 kayıt) ve 13 batch raporunun tamamı tarandı; `title + publisher` tekrarı **yok**. Yayınevi ekleri normalize edilerek yapılan yakın-tekrar taramasında da çakışma yok.
- Kapsam: **15 felsefe-grubu + 2 din-kulturu** hedefi tam. AYT Din'in yalnızca 2 AYT'ye özel satır içermesi review prompt'una uygun.
- AYT Din ortak ciltleri: `tyt-sosyal-2.json` içinde **5 TYT-AYT ortak Din Kültürü** satırı doğrulandı — Karekök (160), Aydın (248), Palme (112), MUBA (112), Benim Hocam 2027 (208). Bunlar tahminde AYT Din'e de sayılacağı için AYT'ye özel 2 satır yeterli.
- Sayfa sayısı: resmî künye > aynı ISBN'li mağaza çoğunluğu > eski baskı sırası uygulanmış; Bilgi Sarmal (224/223), Karekök (392/385/224), Hız ve Renk (160/132) çelişkileri `notes`ta açıklanmış.

## Doğrulanan sayfa sayıları
| # | Kitap / Yayınevi | Sayfa | Kaynak |
|---|---|---|---|
| 1 | AYT Felsefe Grubu Soru Bankası / Bilgi Sarmal | 224 | Bilgi Sarmal resmî 224; İKM 223 |
| 2 | AYT Felsefe Grubu Soru Bankası / Karekök | 392 | Karekök resmî "Sayfa: 392" |
| 3 | Miray AYT Felsefe Konu Özetli / Miray | 240 | Aydın/Miray resmî 240 |
| 4 | AYT Felsefe Soru Bankası / Hız ve Renk | 160 | Kitapİşler 160 + Kitapdoldur 160 |
| 5 | AYT Felsefe Grubu Soru Bankası / Zafer | 224 | Zafer resmî 224 |
| 6 | AYT Felsefe Soru Bankası (DİS) / Ordinat | 192 | Ordinat resmî 192 |
| 7 | AYT Felsefe Grubu Soru Kitabı / YZ | 192 | Kitapİşler 192 |
| 8 | 2027 AYT Felsefe Grubu Ders Notları ve Video Çözümlü SB / Benim Hocam | 208 | Kitapİşler 208 |
| 9 | AYT Felsefe Atölyesi / KR Akademi | 208 | Kitapİşler 208 |
| 10 | AYT Felsefe Grubu Analitik / Merkez | 192 | Kitapİşler 192 |
| 11 | AYT Felsefe Grubu Soru Kütüphanesi / Paraf | 320 | Kitapİşler 320 (Paraf resmî sayfa sayısı vermiyor) |
| 12 | AYT Felsefe Grubu Ulti Serisi / Ulti | 208 | Kitapİşler 208 |
| 13 | AYT Üçrenk Felsefe Grubu / Esen Üçrenk | 448 | Kitapyurdu 448 |
| 14 | AYT Felsefe Plus / Çap | 192 | Kitapİşler 192 |
| 15 | AYT Felsefe Atak / Delta Kültür | 208 | Kitapİşler 208 |
| 16 | YKS AYT Din Kültürü ve Ahlak Bilgisi Soru Kitabı / Palme | 80 | Kitapyurdu 80 (13.09.2019) |
| 17 | AYT Üçrenk Din Kültürü ve Ahlak Bilgisi / Esen Üçrenk | 176 | Kitapyurdu 176 (27.11.2019) |

## Uyarılar (bloklamayan)
- **Satır 1** — Resmî künye 224, iki mağaza 223; resmî künye esas alınmış, doğru. `confidence: high` resmî künye kuralına uygun.
- **Satır 2** — Resmî 392; mağazalarda 385 ve 224 (farklı ürün/ baskı) görülüyor. Resmî esas alınmış, doğru.
- **Satır 4** — Güncel ISBN 9786057530974 160 sayfa; eski ISBN 132 sayfa. Not doğru.
- **Satır 8** — 2027 basımı; `edition: 2027` doğru.
- **Satır 13, 16, 17** — 2019 baskıları hâlâ satışta; sayfa sayıları Kitapyurdu künyesiyle doğrulandı. Medium güven doğru.
- **Satır 11** — Paraf resmî sayfası sayfa sayısı vermiyor; 320 yalnızca Kitapİşler'de. Medium güven doğru.
- **Satır 9, 10, 12, 14, 15** — Tek güvenilir Kitapİşler kaynağı; medium güven doğru.
- **`gaps`** — AYT Din'de 10 hedefin yalnızca 2 AYT'ye özel kitapla dolduğu, kalanların TYT-AYT ortak olduğu ve TYT batch'ine bırakıldığı açıkça yazılmış. Review prompt'u bu durumu kabul ediyor.

## Sonuç
17 satırın tamamı şema, tekrar ve kapsam açısından geçerli; 15 felsefe-grubu + 2 din-kulturu hedefi tam ve TYT-AYT ortak 5 Din satırı TYT batch'inde mevcut. 17 satırın tamamında sayfa sayısı kaynakla doğrulandı. **PASS**.
