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

```bash
git switch backup/live-2026-11-22
npm install
npm run dev -- --host
```

İş bitince çalışma dalına dön:

```bash
git switch main
```

## `main` dalını canlı sürüme geri almadan önce

Önce mevcut çalışmayı koru:

```bash
git switch main
git branch backup/deneme-$(date +%Y%m%d-%H%M)
```

Sonra canlı sürüme döndür (dikkat: commit edilmemiş değişiklikleri siler):

```bash
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

## Not

- GitHub Pages yayını `main` dalına push ile tetiklenir; bu kayıt sırasında
  canlı site `1afd5c0` sürümündedir.
- `d7eaf46` yalnızca dokümantasyon içerir; canlı siteyi değiştirmez.
