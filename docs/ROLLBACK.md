# Geri Dönüş Noktası — Sayfa Bazlı Kitap Modeli Öncesi

- Kayıt tarihi: 2026-11-22 12:34 (+03:00)
- Canlı sürüm commit'i: `1afd5c0` — `fix: validate branch results on backup import`
- Canlı sürümün uzak dalı: `origin/main`
- Yerel tag: `live-2026-11-22`
- Yerel yedek dal: `backup/live-2026-11-22`
- Tasarım/plan commit'i: `d7eaf46` — `docs: add page-based books design and phase 1 plan`
- Çalışma dalı: `main` (`d7eaf46`, `origin/main`'in 1 commit önünde)

Bu nokta, kitaplar sayfa bazlı modele geçmeden önceki son canlı sürümdür.
Yeni çalışma sırasında bir sorun olursa aşağıdaki komutlarla geri dönülebilir.

## Eski sürümü yerelde açmak

Tek komut:

```bash
npm run live:preview
```

Bu komut, mevcut çalışmayı zaman damgalı bir yedek dalına alır, canlı sürüm
tag'ini açar ve önizleme komutunu hatırlatır. İş bitince çalışma dalına dön:

```bash
git switch main
```

Manuel yol:

```bash
git switch backup/live-2026-11-22
npm install
npm run dev -- --host
```

## `main` dalını canlı sürüme geri alma

Commit edilmemiş değişiklik yoksa tek komut:

```bash
npm run live:restore -- -Force
```

Bu komut mevcut `main`'i zaman damgalı bir yedek dalına alır ve `main`'i canlı
sürüm tag'ine döndürür. Commit edilmemiş değişiklik varsa komut bilerek durur.

Manuel yol (dikkat: commit edilmemiş değişiklikleri siler):

```bash
git switch main
git branch backup/deneme-$(date +%Y%m%d-%H%M)
git reset --hard live-2026-11-22
```

## Tek bir kötü commit'i geri almak

Geçmişi silmeden, yalnızca o commit'in etkisini geri al:

```bash
git revert <commit-hash>
```

## Uzak sunucuya taşımak

Tag ve yedek dal şu an yalnızca bu bilgisayarda. Uzak sunucuda da kalıcı
olmasını istersen (sadece bu iki ref push edilir, kod push edilmez):

```bash
git push origin live-2026-11-22 backup/live-2026-11-22
```

Bu komut, kullanıcı onayı olmadan çalıştırılmamalıdır. Yeni kitap/plan kodu
local preview onayı alınmadan `main`'e push edilmez.

## Dexie v9 istemci geri dönüşü (sayfa zinciri)

Sayfa zinciri sürümü istemci veritabanını Dexie **v9**'a yükseltir. Bir kullanıcı
v9 istemcisini açtıktan sonra tarayıcıdaki veritabanı v9 şemasındadır; daha eski
(v8) bir istemci `VersionError` ile açılamaz.

- **Sunucu/API/migration geri dönüşü tek başına güvenlidir.** `004_page_chain.sql`
  additive olduğu için sunucu tarafını geri almak yerel veriyi bozmaz; yeni
  istemciyi yayında bırakın.
- **v9 kullanıldıktan sonra eski istemci dağıtmayın.** `dist/` içeriğini eski bir
  commit'ten yeniden yayınlamak, açmış kullanıcılarda `VersionError` üretir.
- Geri dönüş kaçınılmazsa önce bir kurtarma yolu ekleyin: kullanıcıya sayfayı
  yenilemesini/yeni sürümü yüklemesini söyleyen bir yükleme ekranı veya v9
  verisini dışa aktarıp temizleyen kontrollü bir göç akışı olmadan eski istemci
  deploy edilmemelidir.

## Not

- GitHub Pages yayını `main` dalına push ile tetiklenir; bu kayıt sırasında
  canlı site `1afd5c0` sürümündedir.
- `d7eaf46` yalnızca dokümantasyon içerir; canlı siteyi değiştirmez.

## Sayfa zinciri özel dağılımı (`chunk_sizes`) geri dönüşü — 2026-11-28

Bu bölüm, yukarıdaki 004 dönemi değerlendirmesini tamamlar. `006_page_chain_chunk_sizes.sql`
sonrası “API/migration geri dönüşü tek başına güvenlidir” kuralı geçerli değildir.

`006_page_chain_chunk_sizes.sql` yalnızca `schedule_page_chains` tablosuna nullable
`chunk_sizes TEXT NULL` kolonu ekler. `NULL` “legacy formül” demektir; eski zincirler
backfill edilmez ve mevcut `floor + son gün` aralıklarını korur.

- **API/migration geri alımı tek başına güvenli değildir.** Yeni istemci
  `chunkSizes` alanını push eder; alanı bilmeyen eski API bunu reddeder ve her
  zincir push’u dead-letter olur. Yeni istemci yayındayken yalnızca API veya
  migration’ı geri almayın.
- **Deploy sırası:** `006_page_chain_chunk_sizes.sql` → API → istemci. Migration
  önce çalışmazsa yeni istemci alanı gönderdiğinde sunucu kolonu tanımaz.
- **Geri dönüş kapı sorgusu** (karardan önce çalıştır):
  ```sql
  SELECT COUNT(*) FROM `schedule_page_chains` WHERE `chunk_sizes` IS NOT NULL;
  ```
  Sonuç `0` ise ve yeni dağılımlı zincir yoksa geri dönüş sırası
  **istemci → API → migration** olabilir: önce eski istemci yayınlanır (o sürüm
  alanı göndermez), yeni API `NULL` kabul eder, sonra API/migration geri alınır.
- **Kapı sorgusu yalnızca sunucuya senkron edilmiş satırları sayar.** Çevrimdışı
  oluşturulmuş veya istemcinin kuyruğunda bekleyen özel dağılımlar görünmez.
  Karar öncesi tüm istemcilerin senkron olmasını bekleyin; emin değilseniz
  sonucu sıfır değil kabul edin.
- **Sonuç `0` değilse istemci geri alımı desteklenmez.** Eski istemci yeni
  zincirin dağılımını bilmez; bekleyen görev aralıklarını legacy formülle
  yeniden yazar ve günlük sayfa adetleri yanlış olur. Sunucu koruması yalnızca
  `chunk_sizes` değerinin silinmesini engeller; eski istemcinin aralık hesabını
  düzeltmez. Bu durumda **ileriye dönük düzeltme** yapılır: hata yeni istemcide
  düzeltilir, geri dönüş denenmez.
- Dexie sürümü artmadığı için `VersionError` riski yoktur; kısıt veri şemasından
  değil, eski istemcinin dağılımı yanlış hesaplamasından doğar.
