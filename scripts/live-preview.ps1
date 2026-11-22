param()

$ErrorActionPreference = 'Stop'
$tag = 'live-2026-11-22'

git rev-parse --verify "$tag^{commit}" | Out-Null

$dirty = git status --porcelain
if ($dirty) {
  throw 'Commit edilmemiş değişiklik var. Önce commit veya stash yap.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "backup/calisma-$stamp"
git branch $backup
git switch --detach $tag

Write-Host "Canlı sürüm ($tag) açıldı."
Write-Host "Mevcut çalışma $backup dalına yedeklendi."
Write-Host "Çalışma dalına dönmek için: git switch main"
Write-Host "Önizleme için: npm install; npm run dev -- --host"
