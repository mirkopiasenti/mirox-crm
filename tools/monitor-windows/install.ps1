#Requires -RunAsAdministrator
param([string]$Origin)
$ErrorActionPreference = 'Stop'
$target = Join-Path $env:ProgramData 'MiroxMonitor'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (!(Test-Path $node)) { throw 'Installa Node.js LTS (versione 22 o successiva) da nodejs.org in Program Files, poi riprova.' }
$major = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Serve Node.js 22 o successivo.' }
if ($PSScriptRoot -eq $target) { throw 'Esegui install.ps1 dalla cartella estratta, non dalla destinazione.' }
$config = Get-Content (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
if ($Origin) { $config.origin = $Origin }
& $node -e "require(process.argv[1]).validateOrigin(process.argv[2],process.argv[3])" (Join-Path $PSScriptRoot 'monitor-host.cjs') $config.origin $config.environment
if ($LASTEXITCODE -ne 0) { throw 'Indirizzo remoto non valido. Lo staging richiede -Origin con il suo deploy dedicato.' }
$existing = Get-ScheduledTask -TaskName 'Mirox Monitor' -ErrorAction SilentlyContinue
if ($existing) { Stop-ScheduledTask -TaskName 'Mirox Monitor' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
if ((Get-Item $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'La destinazione non deve essere un collegamento.' }
# Il codice avviato come SYSTEM non deve essere scrivibile dagli utenti standard.
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$admins = New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'
$acl.SetOwner($admins)
foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
  $identity = New-Object Security.Principal.SecurityIdentifier $sid
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -Path $target -AclObject $acl
if (Get-ChildItem $target -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'La destinazione contiene collegamenti non consentiti.' }
$manifest = Get-Content (Join-Path $PSScriptRoot 'version.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.sha256.PSObject.Properties) {
  if ($entry.Name -notmatch '^[a-zA-Z0-9._/-]+$' -or $entry.Name.Contains('..') -or $entry.Name.StartsWith('/')) { throw 'Manifest non valido.' }
  $source = Join-Path $PSScriptRoot $entry.Name
  if ((Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw ('File non integro: ' + $entry.Name) }
  $destination = Join-Path $target $entry.Name
  New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
  Copy-Item $source -Destination $destination -Force
}
Copy-Item (Join-Path $PSScriptRoot 'version.json') -Destination $target -Force
# Anche file residui di un'installazione precedente ereditano la sola ACL protetta.
& icacls.exe ($target + '\*') /setowner '*S-1-5-32-544' /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Impossibile verificare il proprietario dei file del servizio.' }
& icacls.exe ($target + '\*') /reset /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Impossibile proteggere i file del servizio.' }
$config | ConvertTo-Json | Set-Content (Join-Path $target 'config.json') -Encoding UTF8
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $target 'supervisor.ps1') + '" -Node "' + $node + '"')
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Mirox Monitor' -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'Servizio locale sola lettura per il monitor KPI Mirox' -Force | Out-Null
Start-ScheduledTask -TaskName 'Mirox Monitor'
Write-Host 'Installazione completata. Configura Edge cartellonistica su http://127.0.0.1:8765/monitor e associa il codice Admin.'
Write-Host 'Nessun account, autologon, timer TV, alimentazione o riavvio Windows e stato modificato.'
