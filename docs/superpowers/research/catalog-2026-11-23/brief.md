# Katalog Araştırma Brief'i (2026-11-23)

## Amaç
YKS TYT/AYT kataloğuna eklenecek 456 yeni kitabı, doğrulanmış sayfa sayılarıyla araştırmak.

## Zorunlu kurallar
- Sadece gerçek, güncel satışta olan kitaplar.
- `exam` yalnızca TYT veya AYT.
- `subjectSlug` şu listeden: turkce, matematik, geometri, fizik, kimya, biyoloji, tarih, cografya, felsefe, din-kulturu, edebiyat, tarih-1, tarih-2, cografya-1, cografya-2, felsefe-grubu.
- `totalPages` pozitif tam sayı.
- `edition` 4 haneli yıl; çoğunlukla 2026.
- Her satırda `sourceUrl` ve en az bir `sourceUrls` girdisi.
- `confidence`: high (resmî künye veya en az 2 bağımsız kaynak), medium (tek güvenilir kaynak), low (kabul edilmez).
- Aynı `title + publisher` mevcut `src/data/catalog/mevcut.ts` içinde varsa ekleme (edition farklı olsa bile).
- TYT-AYT ortak tek cilt kitaplar TYT batch'ine yazılır; `exam: "TYT"`.
- AYT Tarih-1/Tarih-2 ve AYT Coğrafya-1/Coğrafya-2 için hem tek alt dersi hedefleyen kitaplar hem de iki alt dersi birlikte kapsayan tek cilt "AYT Tarih"/"AYT Coğrafya" kitapları eklenebilir. Ortak tek ciltler `tarih-1` veya `cografya-1` slug'ıyla **bir kez** yazılır; ilerleme tahmininde iki alt derse de sayılır. Başlıkta `Tarih-1`, `Tarih-2`, `Coğrafya-1`, `Coğrafya-2` ayrımı yoksa ortak kabul edilir.
- Deneme sınavı kitapçıkları, DVD, poster, defter ekleme.
- Fasikül seti tek satırsa başlıkta `(X Fasikül)` yaz; `totalPages` setin toplamı olsun.
- Başlık ve yayınevi adlarını Türkçe ve künyedeki haliyle yaz.

## Sayfa sayısı çelişkisi
Resmî yayınevi künyesi > aynı ISBN'li mağaza çoğunluğu > eski baskı. Farkı `notes` alanına yaz.

## Rapor biçimi
`docs/superpowers/research/catalog-2026-11-23/<batch>.json`:

```json
{
  "batch": "<batch>",
  "books": [
    {
      "title": "...",
      "publisher": "...",
      "exam": "TYT",
      "subjectSlug": "matematik",
      "totalPages": 400,
      "edition": "2026",
      "sourceUrl": "https://...",
      "sourceUrls": ["https://..."],
      "confidence": "high",
      "notes": "..."
    }
  ],
  "gaps": ["doğrulanamayan kitaplar"]
}
```

## Kapsam hedefleri
- Fasikül, problemler ve paragraf kitapları özellikle hedeflenir.
- Her batch hedefini `gaps` olmadan doldurmaya çalış; dolduramadığın kısmı `gaps`e yaz.

## Yasak
- Uygulama kodu değiştirme.
- Kaynaksız veya uydurma satır yazma.
