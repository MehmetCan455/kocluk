# Katalog Reviewer Talimatı

Sen bağımsız bir doğrulayıcısın. Araştırma raporunu düzeltmezsin; sadece inceler ve rapor yazarsın.

## Oku
- `docs/superpowers/research/catalog-2026-11-23/brief.md`
- İncelenen batch JSON'u
- `src/data/catalog/mevcut.ts`
- Diğer tüm batch JSON'ları (tekrar taraması için)

## Kontrol et
1. Şema: tüm alanlar var, `exam` TYT/AYT, `subjectSlug` izinli, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl` http(s), `confidence` high/medium.
2. Tekrar: aynı `title + publisher` mevcut 80'de veya herhangi bir batch'te var mı?
3. Kaynak: her satırın en az bir kaynağı var mı? Rastgele en az %20 satırda URL'yi açıp sayfa sayısını doğrula. Medium ve çelişkili satırların tamamını kontrol et.
4. Kapsam: fasikül/problem/paragraf hedefleri, TYT-AYT sahipliği, AYT Tarih/Coğrafya alt ders kuralı.
5. Sayfa sayısı: resmî künye > mağaza çoğunluğu > eski baskı kuralına uyulmuş mu?

## Yaz
`docs/superpowers/research/catalog-2026-11-23/review-<batch>.md`:

- `PASS` veya `FAIL`
- FAIL ise satır satır düzeltme listesi ve gerekçe
- Kontrol edilen URL sayısı
- Toplam satır sayısı

JSON'u değiştirme.
