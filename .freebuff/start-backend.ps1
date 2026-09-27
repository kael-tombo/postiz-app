# Launch only the backend (compiled build) detached, env from .env, PORT=3000.
$root = Split-Path -Parent $PSScriptRoot

$envFile = Join-Path $root ".env"
$backendDir = Join-Path $root "apps\backend"
$backendLog = Join-Path $root ".freebuff\backend-run.log"
$backendErr = Join-Path $root ".freebuff\backend-run.err.log"

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $v = $Matches[2].Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
    [System.Environment]::SetEnvironmentVariable($Matches[1], $v, "Process")
  }
}
[System.Environment]::SetEnvironmentVariable("PORT", "3000", "Process")
[System.Environment]::SetEnvironmentVariable("MAIN_URL", "http://localhost:4200", "Process")

Start-Process -FilePath "node" `
  -ArgumentList "--experimental-require-module", ".\dist\apps\backend\src\main.js" `
  -WorkingDirectory $backendDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $backendLog `
  -RedirectStandardError $backendErr

Write-Output "launched backend only"
