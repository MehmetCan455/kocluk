param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$tag = 'live-2026-11-22'

git rev-parse --verify "$tag^{commit}" | Out-Null

if (-not $Force) {
  throw "Bu işlem main dalını canlı sürüme döndürür. Onaylıyorsan -Force ile çalıştır."
}

$dirty = git status --porcelain
if ($dirty) {
  throw 'Commit edilmemiş değişiklik var. Önce commit veya stash yap.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "backup/calisma-$stamp"
git branch $backup
git switch main
git reset --hard $tag

Write-Host "main dalı $tag sürümüne döndü."
Write-Host "Mevcut çalışma $backup dalına yedeklendi."
Write-Host "Yeni kodu uzak sunucuya göndermek için (onay sonrası): git push origin main"
