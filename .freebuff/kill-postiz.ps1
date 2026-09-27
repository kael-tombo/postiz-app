$names = @('node.exe','pnpm.exe','cmd.exe')
$procs = Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name }
$patterns = @('*postiz-app*', '*dist\apps\backend\src\main*', '*dist\apps\orchestrator\src\main*')
foreach ($p in $procs) {
  if ($p.CommandLine) {
    $match = $false
    foreach ($pat in $patterns) {
      if ($p.CommandLine -like $pat) { $match = $true; break }
    }
    if ($match) {
      $cl = $p.CommandLine
      if ($cl.Length -gt 110) { $cl = $cl.Substring(0,110) }
      Write-Output ("Killing PID " + $p.ProcessId + " [" + $p.Name + "] : " + $cl)
      taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null
    }
  }
}
Write-Output "done"
