param(
  [int]$KeepPid = 0,
  [string]$Root = ""
)

# Faqat Karvon skriptlari — Root ni umumiy pattern sifatida ISHLATMASLIK
# (Cursor/VSCode tsserver ham Karvon papkasini command line da ko'rsatishi mumkin)
$scriptPatterns = @(
  'start-all\.js',
  'stop-karvon\.js',
  'server\.js',
  'scraper\.js',
  'test-groups\.js',
  'test-pipeline\.js',
  'backfill\.js',
  '[\\/]index\.js',
  ' index\.js'
)

$rootEscaped = [regex]::Escape($Root)

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
  if ($_.ProcessId -eq $KeepPid) { return }

  $cmd = $_.CommandLine
  if (-not $cmd) { return }

  # Karvon papkasidagi node jarayoni: path + skript nomi ikkalasi mos kelishi kerak
  if ($cmd -notmatch $rootEscaped) { return }

  $isKarvon = $false
  foreach ($p in $scriptPatterns) {
    if ($cmd -match $p) { $isKarvon = $true; break }
  }
  if (-not $isKarvon) { return }

  $preview = if ($cmd.Length -gt 90) { $cmd.Substring(0, 90) + '...' } else { $cmd }
  Write-Host "[karvon] To'xtatilmoqda PID $($_.ProcessId): $preview"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
