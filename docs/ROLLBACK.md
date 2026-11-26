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
