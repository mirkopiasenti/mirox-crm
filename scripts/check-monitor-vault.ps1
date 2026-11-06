# Prova reale DPAPI/aggiornamento atomico; solo dati sintetici, senza stato del PC.
$ErrorActionPreference = 'Stop'
$vault = Join-Path (Split-Path $PSScriptRoot) 'tools\monitor-windows\vault.ps1'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('mirox-vault-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$statePath = Join-Path $scratch 'synthetic.bin'
function Write-State($value) {
  ($value | ConvertTo-Json -Compress) | & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $vault -Mode write -Path $statePath
  if ($LASTEXITCODE -ne 0) { throw 'Scrittura vault fallita.' }
}
function Read-State {
  $result = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $vault -Mode read -Path $statePath
  if ($LASTEXITCODE -ne 0) { throw 'Lettura vault fallita.' }
  return ($result | ConvertFrom-Json)
}
try {
  $firstSecret = 'a' * 64
  $secondSecret = 'b' * 64
  Write-State @{ secret = $firstSecret; associated = $false }
  $saved = Read-State
  if ($saved.secret -ne $firstSecret -or $saved.associated) { throw 'Prima scrittura non recuperabile.' }
  Write-State @{ secret = $firstSecret; associated = $true }
  $saved = Read-State
  if ($saved.secret -ne $firstSecret -or !$saved.associated) { throw 'Conferma associazione non persistita.' }
  Write-State @{ secret = $secondSecret; associated = $false }
  Write-State @{ secret = $secondSecret; associated = $true }
  $saved = Read-State
  if ($saved.secret -ne $secondSecret -or !$saved.associated) { throw 'Riassociazione non persistita.' }
  if ([IO.File]::Exists($statePath + '.tmp')) { throw 'File temporaneo residuo.' }
  $bytes = [IO.File]::ReadAllBytes($statePath)
  if ([Text.Encoding]::UTF8.GetString($bytes).Contains($secondSecret)) { throw 'Credenziale sintetica non cifrata.' }
  Write-Host 'Vault Windows: prima scrittura, conferma, riassociazione e recupero cifrato verificati.'
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force
}
