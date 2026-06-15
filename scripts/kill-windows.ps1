param(
  [int]$KeepPid = 0,
  [string]$Root = ""
)

$patterns = @(
  [regex]::Escape($Root),
  'start-all\.js',
  'stop-karvon\.js',
  'scraper\.js',
  '[\\/]index\.js',
  ' index\.js'
) | Where-Object { $_ }

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
  if ($_.ProcessId -eq $KeepPid) { return }

  $cmd = $_.CommandLine
  if (-not $cmd) { return }

  $isKarvon = $false
  foreach ($p in $patterns) {
    if ($cmd -match $p) { $isKarvon = $true; break }
  }
  if (-not $isKarvon) { return }

  Write-Host "[karvon] To'xtatilmoqda PID $($_.ProcessId): $($cmd.Substring(0, [Math]::Min(90, $cmd.Length)))"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
