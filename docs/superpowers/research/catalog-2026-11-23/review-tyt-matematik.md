FAIL

# Review — tyt-matematik

## Özet
- Toplam satır: **35**
- Kontrol edilen URL: **32** (29 doğrudan fetch + 3 arama indeksi; 2 URL 404, 1 URL Scribd bot koruması döndürdü)
- Örneklenen satır: **24/35 (%69)** — 21 medium satırın tamamı (3, 5, 8, 9, 11, 12, 13, 15, 18, 19, 21, 22, 24, 26, 27, 28, 29, 30, 31, 32, 35) + yüksek güvenli 7, 20, 34
- Şema: 35/35 alan kontrolünden geçti. `exam` TYT, `subjectSlug` `matematik`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl`/`sourceUrls` http(s), `confidence` high/medium.
- Tekrar: `mevcut.ts` (80 kayıt) ve diğer üç rapora karşı `title + publisher` tekrarı **yok**.
- Kapsam: 15 problem kitabı (satır 1–15), 2 fasikül satırı (8, 20), TYT-AYT ortak kitap yok.

## FAIL satırları (3)

### 1. Satır 13 — `TYT Problemler Soru Bankası` / `ENS Yayınları`
- **Alan**: `edition` ve `sourceUrl`
- **Mevcut**: `edition: "2026"`, kaynak Hepsiburada'nın **2022** baskısı (`...tyt-problemler-soru-bankasi-2022-pm-HBC00002BGJS8`)
- **Beklenen**: 2026 baskısı korunacaksa kaynak 2026 baskısını gösteren bir URL ile değiştirilmeli (ör. `https://www.sehadetkitap.com/urun/ens-tyt-problemler-soru-bankasi`, 24.03.2026, 176 sayfa) ve `sourceUrls`'e eklenmeli. 2026 baskısı doğrulanamıyorsa `edition: "2022"` yapılmalı veya satır kaldırılmalı.
- **Gerekçe**: Satırın tek kaynağı açıkça 2022 baskısını listeliyor; 2026 alanı bu kaynakla desteklenmiyor. Sayfa sayısı 176 doğru (2022 ve 2026 baskılarında aynı).

### 2. Satır 19 — `TYT Matematik Konu Anlatımlı 2. Kitap` / `Karekök Yayınları`
- **Alan**: `sourceUrl`, `sourceUrls` (isteğe bağlı `title`)
- **Mevcut**: Yalnızca Scribd belgesi (`https://www.scribd.com/document/823151142/...`); inceleme sırasında bot koruması nedeniyle açılamadı.
- **Beklenen**: Resmî kaynak `https://www.karekok.com.tr/yayinlarimiz/tyt/tyt-mps-kitaplari/tyt-matematik-2-732.html` (384 sayfa, ISBN 9786258419436). Başlık istenirse `TYT Matematik 2 (MPS Konu Anlatımlı Soru Bankası)` olarak hizalanabilir.
- **Gerekçe**: Scribd kullanıcı yüklemesi güvenilir katalog kaynağı değil; sayfa sayısı 384 resmî künyeyle doğrulandı, ancak satırın mevcut kanıtı geçersiz.

### 3. Satır 27 — `49 Günde TYT Matematik Soru Bankası` / `Rehber Matematik`
- **Alan**: `edition` ve `title`
- **Mevcut**: `edition: "2026"`, başlıkta yıl yok
- **Beklenen**: `edition: "2027"`, `title: "2027 49 Günde TYT Matematik Soru Bankası"`
- **Gerekçe**: Kaynak sayfanın başlığı ve URL'si 2027 baskısını gösteriyor (`.../rehber-matematik-2027-49-gunde-tyt-matematik-soru-bankasi_108017.html`); sayfa sayısı 240 doğrulandı. 2026 alanı hatalı.

## Doğrulanan diğer satırlar (21)
| # | Kitap / Yayınevi | Sayfa | Kaynak |
|---|---|---|---|
| 3 | Hiç Problem Değil / Antrenman | 312 | KitapSec 312 |
| 5 | TYT Matematik Acil Problemler / Acil | 191 | KitapSec 191 |
| 7 | TYT KPSS ALES MSÜ DGS Sıfır Risk Problemler / ÜçDörtBeş | 280 | ÜçDörtBeş resmî "280 sayfa" + Kitapİşler 280 |
| 8 | Orijinal Mikro TYT Problemler Fasikülü / Orijinal | 208 | Kitapİşler 208 |
| 9 | TYT Problemler Konu Anlatımlı Eğitim Seti / Orijinal | 208 | Kitapİşler 208 |
| 11 | Matematik Problemler / Çap | 192 | Kitapİşler 192 |
| 12 | Problemler Kuvvet Serisi / Aktif Öğrenme | 192 | Kitapİşler 192 |
| 15 | Matematik Karavanı TYT Tarz Problemler / KR Akademi | 128 | Kitapİşler 128 |
| 18 | TYT Matematik MPS 1. Kitap / Karekök | 374 | BKM 374 |
| 20 | TYT Matematik El Yazısı (8 Fasikül) / KR Akademi | 1236 | KR Akademi resmî fasikül listesi (160+152+140+152+128+144+168+192) |
| 21 | Merhaba TYT Matematik / Şenol Hoca | 221 | İndeks Kitap 221 |
| 22 | TYT Matematik Soru Bankası / Acil | 447 | KitapSec 447 + Maksimum 447 + Amazon 447 |
| 24 | TYT Matematik Soru Bankası / Hoca Kafası | 336 | İndeks Kitap 336 |
| 26 | Sıfırdan Özel Matematik Konu Anlatımı / Bilgi Pusulası | 430 | İndeks Kitap 430 |
| 28 | TYT Twins Matematik / KR Akademi | 224 | Kitapİşler 224 |
| 29 | TYT Matematik Soru Bankası / Hız | 440 | Kitapİşler 440 |
| 30 | TYT Matematik Alıştıran Soru Kütüphanesi / Paraf | 408 | Kitapİşler 408 |
| 31 | TYT Matematik Eyüp Hoca / KR Akademi | 384 | Kitapİşler 384 |
| 32 | TYT Matematik Mikro / Orijinal | 400 | Kitapİşler 400 |
| 34 | DM TYT Matematik Soru Bankası / Sonuç | 488 | Sonuç resmî sitesi "DM Serisi TYT Matematik Soru Bankası 488 Sayfa" |
| 35 | TYT Iceberg Matematik Konu Anlatımı / Okyanus | 408 | İdefix 408 |

## Bloklamayan kaynak düzeltmeleri
- **Satır 20**: `sourceUrl` 8 kitaplık setin değil, **4. Fasikülün** sayfası (152 sayfa). Setin resmî URL'si `https://krakademi.com/urun/tyt-matematik-el-yazisi-konu-anlatim-fasikul-seti-kr-akademi-yayinlari-42` (1236 sayfa, 8 kitap, ISBN 9786247896347) ile değiştirilmeli. Sayfa sayısı doğru.
- **Satır 34**: `sourceUrl` yayınevinin ana sayfası; sayfada "DM Serisi TYT Matematik Soru Bankası 488 Sayfa" geçtiği için sayfa sayısı doğrulandı, ancak ürün sayfası URL'si tercih edilmeli.
- **Satır 18**: BKM 374, PDF 375; mağaza değeri esas alınmış, kabul edilebilir.
- **Satır 22**: 447 lehine üç bağımsız kaynak var; İndeks 431 ve KitapYurdu 414 eski/çelişkili. `notes` bu çoğunluğu belirtebilir.
- **Satır 7**: ÜçDörtBeş ana sayfası "Sıfır Risk Problemler 280 sayfa" ifadesini açıkça içeriyor; resmî kaynak doğrulandı.

## Sonuç
Örneklenen 24 satırın 21'i geçerli; 3'ü düzeltme gerektiriyor (13, 19, 27). Sayfa sayıları doğrulanan satırlarda tutarlı; sorun kaynak/edition alanlarında. **FAIL**.

---

## Re-review (fix verification)

Kapsam: yalnızca önceki FAIL satırları (13, 19, 27) ve bu düzeltmelerin yan etkileri. Güncel dosya yeniden parse edildi; şema ve tekrar taraması tekrar çalıştırıldı; üç kaynak URL'si yeniden açıldı.

- Güncel satır sayısı: **35**
- Re-review'da açılan URL: **3**
- Şema: 35/35 geçti (tüm zorunlu alanlar mevcut; `exam` TYT, `subjectSlug` `matematik`, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl`/`sourceUrls` http(s), `confidence` high/medium).
- Tekrar: `mevcut.ts` (80 kayıt) ve diğer üç TYT raporuna karşı yeni `title + publisher` tekrarı **yok**.
- Diğer satırlar: 13, 19 ve 27 dışındaki satırların başlık, yayınevi, sayfa sayısı ve kaynak değerleri önceki incelemedekiyle aynı; `gaps` listesi değişmemiş.

### Bulgu 1 — ENS Yayınları / TYT Problemler Soru Bankası — PASS (ADDRESSED)
- `edition: "2026"` artık Şehadet Kitap'ın 2026 baskısı kaydıyla destekleniyor.
- Kaynakta doğrulananlar: **176 sayfa**, **ISBN 9786258160826**, basım tarihi **24.03.2026**.
- 2022 Hepsiburada kaydı `sourceUrls` içinde ikincil kaynak olarak duruyor; `notes` iki baskı arasındaki ilişkiyi açıklıyor.
- Sayfa sayısı 176 doğrulandı; edition alanı artık kaynakla tutarlı.

### Bulgu 2 — Karekök Yayınları / TYT Matematik 2 — PASS (ADDRESSED)
- Scribd kaynağı kaldırılmış; yerine resmî Karekök sayfası eklenmiş.
- Resmî künyede doğrulananlar: **384 sayfa**, **ISBN 9786258419436**, **2026-2027 müfredatı**.
- Başlık `TYT Matematik 2 (MPS Konu Anlatımlı Soru Bankası)` olarak güncellenmiş; `confidence: high` resmî künye kuralına uygun.
- Tek kaynak resmî yayınevi sayfası olduğu için yüksek güven geçerli.

### Bulgu 3 — Rehber Matematik / 49 Günde TYT Matematik — PASS (ADDRESSED)
- `edition: "2027"` ve başlık `2027 49 Günde TYT Matematik Soru Bankası` olarak güncellenmiş.
- Kitapİşler kaynağı 2027 baskısını ve **240 sayfa** değerini veriyor; sayfa sayısı doğrulandı.
- Başlık, edition ve kaynak artık birbiriyle tutarlı.

### Re-review sonucu
Üç bulgu da kapatıldı; yeni tekrar, şema kırılması veya satır sayısı değişikliği yok. **Final batch verdict: PASS**.

