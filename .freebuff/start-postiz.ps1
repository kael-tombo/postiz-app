# Launch Postiz dev servers fully detached from the calling shell.
$root = Split-Path -Parent $PSScriptRoot  # project root (script lives in .freebuff)

# --- Backend: compiled build, env from .env, PORT pinned to 3000
$envFile = Join-Path $root ".env"
$backendDir = Join-Path $root "apps\backend"
$backendLog = Join-Path $root ".freebuff\backend-run.log"
$backendErr = Join-Path $root ".freebuff\backend-run.err.log"

# Read .env manually and set vars for the child process
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $v = $Matches[2].Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
    [System.Environment]::SetEnvironmentVariable($Matches[1], $v, "Process")
  }
}
# dotenv-cli does not override existing vars; force the important ones
[System.Environment]::SetEnvironmentVariable("PORT", "3000", "Process")
[System.Environment]::SetEnvironmentVariable("MAIN_URL", "http://localhost:4200", "Process")

Start-Process -FilePath "node" `
  -ArgumentList "--experimental-require-module", ".\dist\apps\backend\src\main.js" `
  -WorkingDirectory $backendDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $backendLog `
  -RedirectStandardError $backendErr

# --- Frontend: Next dev on 4200
$frontendDir = Join-Path $root "apps\frontend"
$frontendLog = Join-Path $root ".freebuff\frontend-run.log"
$frontendErr = Join-Path $root ".freebuff\frontend-run.err.log"
$pnpmExe = (Get-Command pnpm).Source

Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "pnpm run dev > `"$frontendLog`" 2> `"$frontendErr`"" `
  -WorkingDirectory $frontendDir `
  -WindowStyle Hidden

Write-Output "launched backend + frontend"
