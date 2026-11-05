param([Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
while ($true) {
  & $Node (Join-Path $PSScriptRoot 'monitor-host.cjs') 2>$null
  Start-Sleep -Seconds 5
}
