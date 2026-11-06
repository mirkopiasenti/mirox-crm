#Requires -RunAsAdministrator
param([string]$Origin)
$ErrorActionPreference = 'Stop'
$target = Join-Path $env:ProgramData 'MiroxMonitor'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (!(Test-Path $node)) { throw 'Installa Node.js LTS (versione 22 o successiva) da nodejs.org in Program Files, poi riprova.' }
$major = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Serve Node.js 22 o successivo.' }
if ($PSScriptRoot -eq $target) { throw 'Esegui install.ps1 dalla cartella estratta, non dalla destinazione.' }
# Preflight completo prima di fermare una postazione funzionante.
$manifest = Get-Content (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json
if ($manifest.versione -ne 1 -or !$manifest.sha256 -or @($manifest.sha256.PSObject.Properties).Count -lt 10) { throw 'Manifest non valido.' }
foreach ($entry in $manifest.sha256.PSObject.Properties) {
  if ($entry.Name -notmatch '^[a-zA-Z0-9._/-]+$' -or $entry.Name.Contains('..') -or $entry.Name.StartsWith('/') -or $entry.Name -in @('state.bin','state.bin.tmp','version.json')) { throw 'Manifest non valido.' }
  if ($entry.Value -notmatch '^[a-f0-9]{64}$') { throw 'Impronta manifest non valida.' }
  $source = Join-Path $PSScriptRoot $entry.Name
  if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Il pacchetto contiene collegamenti non consentiti.' }
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw ('File non integro: ' + $entry.Name) }
}
$config = Get-Content (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
if ($Origin) { $config.origin = $Origin }
& $node -e "require(process.argv[1]).validateOrigin(process.argv[2],process.argv[3])" (Join-Path $PSScriptRoot 'monitor-host.cjs') $config.origin $config.environment
if ($LASTEXITCODE -ne 0) { throw 'Indirizzo remoto non valido. Lo staging richiede -Origin con il suo deploy dedicato.' }
if (Test-Path $target) {
  if ((Get-Item $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'La destinazione non deve essere un collegamento.' }
  if (Get-ChildItem $target -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'La destinazione contiene collegamenti non consentiti.' }
}
function Protect-Folder([string]$folder) {
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  $admins = New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'
  $acl.SetOwner($admins)
  foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
    $identity = New-Object Security.Principal.SecurityIdentifier $sid
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $folder -AclObject $acl
  if (Get-ChildItem -LiteralPath $folder -Force) {
    & icacls.exe ($folder + '\*') /setowner '*S-1-5-32-544' /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Impossibile verificare il proprietario dei file del servizio.' }
    & icacls.exe ($folder + '\*') /reset /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Impossibile proteggere i file del servizio.' }
  }
}
function Stop-MonitorProcesses {
  foreach ($item in @(@{Name='powershell.exe';Script='supervisor.ps1'},@{Name='node.exe';Script='monitor-host.cjs'})) {
    $pattern = '(?:^|\s)"?' + [regex]::Escape((Join-Path $target $item.Script)) + '"?(?:\s|$)'
    Get-CimInstance Win32_Process -Filter ("Name='" + $item.Name + "'") | Where-Object { $_.CommandLine -match $pattern } | ForEach-Object {
      $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
      if ($process) {
        try { Stop-Process -InputObject $process -Force -ErrorAction SilentlyContinue; if (!$process.WaitForExit(10000)) { throw 'Il processo monitor precedente non si arresta.' } }
        finally { $process.Dispose() }
      }
    }
  }
}
$suffix = [Guid]::NewGuid().ToString('N')
$stage = $target + '.install-' + $suffix
$backup = $target + '.previous-' + $suffix
$existing = Get-ScheduledTask -TaskName 'Mirox Monitor' -ErrorAction SilentlyContinue
$oldTaskXml = if ($existing) { Export-ScheduledTask -TaskName 'Mirox Monitor' } else { $null }
$stopped = $false
$installed = $false
$moved = $false
try {
  New-Item -ItemType Directory -Path $stage | Out-Null
  # Proteggere lo staging prima di copiarvi codice SYSTEM o credenziali.
  Protect-Folder $stage
  foreach ($entry in $manifest.sha256.PSObject.Properties) {
    $destination = Join-Path $stage $entry.Name
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $entry.Name) -Destination $destination
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw ('Copia non integra: ' + $entry.Name) }
  }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'version.json') -Destination $stage
  $config | ConvertTo-Json | Set-Content (Join-Path $stage 'config.json') -Encoding UTF8
  $stopped = $true
  if ($existing) { Stop-ScheduledTask -TaskName 'Mirox Monitor' }
  Stop-MonitorProcesses
  $state = Join-Path $target 'state.bin'
  if (Test-Path $state) { Copy-Item -LiteralPath $state -Destination (Join-Path $stage 'state.bin') }
  Protect-Folder $stage
  if (Test-Path $target) { Move-Item -LiteralPath $target -Destination $backup; $moved = $true }
  Move-Item -LiteralPath $stage -Destination $target
  $installed = $true
  $action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $target 'supervisor.ps1') + '" -Node "' + $node + '"')
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName 'Mirox Monitor' -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'Servizio locale sola lettura per il monitor KPI Mirox' -Force | Out-Null
  Start-ScheduledTask -TaskName 'Mirox Monitor'
  $ready = $false
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    try { $page = Invoke-WebRequest 'http://127.0.0.1:8765/monitor' -UseBasicParsing -TimeoutSec 2; $ready = $page.StatusCode -eq 200 -and $page.Content.Contains('mirox-monitor-release') } catch { }
    if ($ready) { break }
    Start-Sleep -Milliseconds 300
  }
  if (!$ready) { throw 'Il nuovo servizio non risponde. Ripristino della versione precedente.' }
  if ($moved) { try { Remove-Item -LiteralPath $backup -Recurse -Force } catch { Write-Warning 'Servizio aggiornato; copia precedente ancora conservata nella cartella protetta.' } }
  Write-Host 'Installazione completata. Il servizio locale risponde correttamente.'
  Write-Host 'Riavvia il PC. Associazione esistente e configurazione chiosco sono conservate.'
  Write-Host 'Solo per la prima associazione: apri avvia-monitor.cmd e inserisci un codice Admin.'
} catch {
  $failure = $_
  if ($stopped) {
    try {
      Stop-ScheduledTask -TaskName 'Mirox Monitor' -ErrorAction SilentlyContinue
      Stop-MonitorProcesses
      if ($installed -and (Test-Path $target)) { Remove-Item -LiteralPath $target -Recurse -Force }
      if ($moved) { Move-Item -LiteralPath $backup -Destination $target }
      if ($oldTaskXml) { Register-ScheduledTask -TaskName 'Mirox Monitor' -Xml $oldTaskXml -Force | Out-Null; Start-ScheduledTask -TaskName 'Mirox Monitor' }
      else { Unregister-ScheduledTask -TaskName 'Mirox Monitor' -Confirm:$false -ErrorAction SilentlyContinue }
      Write-Host 'Configurazione precedente ripristinata; associazione conservata.'
    } catch { Write-Warning 'Ripristino automatico incompleto: conserva questa finestra per assistenza.' }
  }
  throw $failure
} finally {
  if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
