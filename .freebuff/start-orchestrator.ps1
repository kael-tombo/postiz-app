# Launch the Postiz orchestrator (Temporal worker) fully detached.
$root = Split-Path -Parent $PSScriptRoot

$envFile = Join-Path $root ".env"
$orchDir = Join-Path $root "apps\orchestrator"
$log = Join-Path $root ".freebuff\orchestrator-run.log"
$errLog = Join-Path $root ".freebuff\orchestrator-run.err.log"

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $v = $Matches[2].Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
    [System.Environment]::SetEnvironmentVariable($Matches[1], $v, "Process")
  }
}

Start-Process -FilePath "node" `
  -ArgumentList "--experimental-require-module", ".\dist\apps\orchestrator\src\main.js" `
  -WorkingDirectory $orchDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $log `
  -RedirectStandardError $errLog

Write-Output "launched orchestrator"
