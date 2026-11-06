param([Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
while ($true) {
  try { & $Node (Join-Path $PSScriptRoot 'monitor-host.cjs') 2>$null }
  catch { } # Anche stderr/avvio fallito non devono interrompere il recupero.
  Start-Sleep -Seconds 5
}
