Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  $cl = if ($_.CommandLine) { $_.CommandLine } else { '<none>' }
  if ($cl.Length -gt 130) { $cl = $cl.Substring(0,130) }
  Write-Output ("{0} :: {1}" -f $_.ProcessId, $cl)
}
