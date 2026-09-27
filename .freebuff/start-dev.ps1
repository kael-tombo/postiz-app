# One-command startup for the local Postiz dev stack.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .freebuff/start-dev.ps1
#
# Steps:
#   1. Docker services (base compose + override: Postgres on 5433, Temporal
#      stack health-checked and restart:always)
#   2. Prisma schema push (skipped when the DB already has tables)
#   3. Backend/orchestrator builds (only when missing)
#   4. Kill leftover app processes, then relaunch backend/frontend/orchestrator
#      detached (PORT pinned to 3000 to defeat a machine-wide PORT=0 var)
#   5. Wait for HTTP health and print a status table

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Http($url) {
  try {
    Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch { return $false }
}

function Test-Tcp($port) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $port); return $true }
  catch { return $false }
  finally { $c.Close() }
}

Write-Output "== 1/5 Docker services =="
docker compose -f docker-compose.dev.yaml -f docker-compose.dev.override.yaml up -d `
  postiz-postgres postiz-redis temporal temporal-postgresql temporal-elasticsearch 2>&1 | Out-Null

# If temporal still isn't running (e.g. it raced its DB before this override
# existed), give its dependencies a moment and start it once.
$running = @(docker ps --format "{{.Names}}")
if ($running -notcontains "temporal") {
  Start-Sleep -Seconds 10
  docker start temporal 2>&1 | Out-Null
}
$tries = 0
while ($tries -lt 30 -and -not (Test-Tcp 7233)) { Start-Sleep -Seconds 2; $tries++ }
if (Test-Tcp 7233) { Write-Output "temporal up on :7233" } else { Write-Output "WARNING: temporal not reachable on :7233" }

Write-Output "== 2/5 Prisma schema =="
$tables = docker exec postiz-postgres psql -U postiz-local -d postiz-db-local -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>$null
if ([int]($tables -as [int]) -ge 30) {
  Write-Output "schema present ($tables tables) - skipped"
} else {
  Write-Output "pushing schema..."
  pnpm run prisma-db-push 2>&1 | Select-Object -Last 2
}

Write-Output "== 3/5 Builds =="
if (-not (Test-Path "apps\backend\dist\apps\backend\src\main.js")) {
  Write-Output "building backend..."
  pnpm --filter ./apps/backend run build 2>&1 | Select-Object -Last 2
} else { Write-Output "backend build present" }
if (-not (Test-Path "apps\orchestrator\dist\apps\orchestrator\src\main.js")) {
  Write-Output "building orchestrator..."
  pnpm --filter ./apps/orchestrator run build 2>&1 | Select-Object -Last 2
} else { Write-Output "orchestrator build present" }

Write-Output "== 4/5 Launching apps =="
$busy = $false
foreach ($p in 3000, 4200, 3002) {
  if (Test-Tcp $p) { $busy = $true }
}
if ($busy) {
  Write-Output "existing app processes found - stopping them first"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root ".freebuff\kill-postiz.ps1") | Out-Null
  Start-Sleep -Seconds 3
}
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root ".freebuff\start-postiz.ps1")
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root ".freebuff\start-orchestrator.ps1")

Write-Output "== 5/5 Health checks =="
$targets = @(
  @{ name = "backend      :3000"; url = "http://localhost:3000/" },
  @{ name = "orchestrator :3002"; url = "http://localhost:3002/health/status" },
  @{ name = "frontend     :4200"; url = "http://localhost:4200/auth" }
)
$deadline = (Get-Date).AddMinutes(4)
while ((Get-Date) -lt $deadline) {
  $allUp = $true
  foreach ($t in $targets) { if (-not (Test-Http $t.url)) { $allUp = $false } }
  if ($allUp) { break }
  Start-Sleep -Seconds 10
}
foreach ($t in $targets) {
  $status = if (Test-Http $t.url) { "UP" } else { "DOWN" }
  Write-Output ("  {0} -> {1}" -f $t.name, $status)
}
