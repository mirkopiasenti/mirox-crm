#Requires -RunAsAdministrator
# Solo runner Windows effimero: nessun account/DB/credenziale reale.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Questa prova richiede il runner CI Windows isolato.' }
$target = Join-Path $env:ProgramData 'MiroxMonitor'
if ((Test-Path $target) -or (Get-ScheduledTask -TaskName 'Mirox Monitor' -ErrorAction SilentlyContinue)) { throw 'La prova richiede un ambiente privo di installazioni Mirox.' }
$repo = Split-Path $PSScriptRoot
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('mirox-windows-' + [Guid]::NewGuid().ToString('N'))
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$nodeSource = (Get-Command node.exe).Source
$nodeDirectory = Join-Path $env:ProgramFiles 'nodejs'
New-Item -ItemType Directory -Path $nodeDirectory -Force | Out-Null
$node = Join-Path $nodeDirectory 'node.exe'
if ($nodeSource -ne $node) { Copy-Item -LiteralPath $nodeSource -Destination $node -Force }
New-Item -ItemType Directory -Path $scratch | Out-Null
$package = Join-Path $scratch 'package with spaces'
function Run-Installer([bool]$success) {
  $out = Join-Path $scratch 'install-out.txt'
  $err = Join-Path $scratch 'install-error.txt'
  $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $package 'install.ps1') + '"'
  $process = Start-Process $powershell -ArgumentList $arguments -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  if ($success -and $process.ExitCode -ne 0) { Get-Content $out; Get-Content $err; throw 'Installazione Windows non riuscita.' }
  if (!$success -and $process.ExitCode -eq 0) { throw 'Pacchetto guasto accettato inaspettatamente.' }
}
function Read-LocalState {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    try {
      $html = Invoke-WebRequest 'http://127.0.0.1:8765/monitor' -UseBasicParsing -TimeoutSec 2
      $nonce = [regex]::Match($html.Content,'name="mirox-monitor-session" content="([a-f0-9]+)"').Groups[1].Value
      if ($nonce) { return Invoke-RestMethod 'http://127.0.0.1:8765/api/snapshot' -Headers @{'X-Mirox-Monitor-Session'=$nonce} -TimeoutSec 2 }
    } catch { }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Servizio locale non raggiungibile.'
}
try {
  Push-Location $repo
  try {
    $output = Join-Path $scratch 'build'
    $origin = 'https://mirox-monitor-ci-' + [Guid]::NewGuid().ToString('N') + '.netlify.app'
    & $node -e "require('./scripts/build-monitor-package').buildPackage(process.cwd(),process.argv[1],'staging',process.argv[2])" $output $origin
    if ($LASTEXITCODE -ne 0) { throw 'Build del pacchetto sintetico fallita.' }
    Expand-Archive -LiteralPath (Join-Path $output 'assets\mirox-monitor-windows.zip') -DestinationPath $package
  } finally { Pop-Location }
  Run-Installer $true
  if ((Read-LocalState).stato -ne 'non_associato') { throw 'Stato iniziale inatteso.' }
  $task = Get-ScheduledTask -TaskName 'Mirox Monitor'
  if ($task.Principal.UserId -notin @('SYSTEM','S-1-5-18')) { throw 'Il servizio non usa SYSTEM.' }
  $cipherPath = Join-Path $target 'state.bin'
  @{secret=('e' * 64);associated=$true} | ConvertTo-Json -Compress | & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $target 'vault.ps1') -Mode write -Path $cipherPath
  if ($LASTEXITCODE -ne 0) { throw 'DPAPI sintetico non salvato.' }
  $before = (Get-FileHash $cipherPath -Algorithm SHA256).Hash
  Run-Installer $true
  if ((Get-FileHash $cipherPath -Algorithm SHA256).Hash -ne $before) { throw 'Aggiornamento ha alterato la credenziale.' }
  $state = Read-LocalState
  if ($state.stato -eq 'non_associato' -or ($state | ConvertTo-Json -Depth 20).Contains('e' * 64)) { throw 'Credenziale non recuperata sotto SYSTEM o esposta al browser.' }
  foreach ($file in @($target,$cipherPath)) {
    $acl = Get-Acl -LiteralPath $file
    foreach ($rule in $acl.Access) {
      $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if ($sid -notin @('S-1-5-18','S-1-5-32-544')) { throw 'ACL del servizio troppo permissiva.' }
    }
  }
  # Un file corrotto deve essere rifiutato senza fermare il servizio funzionante.
  $css = Join-Path $package 'css\monitor.css'
  $originalCss = [IO.File]::ReadAllBytes($css)
  [IO.File]::AppendAllText($css,'corrotto')
  Run-Installer $false
  if ((Read-LocalState).stato -eq 'non_associato') { throw 'Preflight fallito ha interrotto l’associazione.' }
  [IO.File]::WriteAllBytes($css,$originalCss)
  # Pacchetto integro ma processo guasto: deve ripristinare codice/task/stato.
  $hostFile = Join-Path $package 'monitor-host.cjs'
  $installedHash = (Get-FileHash (Join-Path $target 'monitor-host.cjs') -Algorithm SHA256).Hash
  [IO.File]::WriteAllText($hostFile,"if(require.main===module)process.exit(27);`n" + [IO.File]::ReadAllText($hostFile))
  $manifestPath = Join-Path $package 'version.json'
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $manifest.sha256.PSObject.Properties['monitor-host.cjs'].Value = (Get-FileHash $hostFile -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding UTF8
  Run-Installer $false
  if ((Get-FileHash (Join-Path $target 'monitor-host.cjs') -Algorithm SHA256).Hash -ne $installedHash) { throw 'Codice precedente non ripristinato.' }
  if ((Get-FileHash $cipherPath -Algorithm SHA256).Hash -ne $before) { throw 'Rollback ha alterato la credenziale.' }
  if ((Read-LocalState).stato -eq 'non_associato') { throw 'Rollback non ha riavviato il servizio precedente.' }
  # stderr/uscita nativa non devono far terminare il supervisor.
  $probeDirectory = Join-Path $scratch 'supervisor'
  New-Item -ItemType Directory -Path $probeDirectory | Out-Null
  Copy-Item (Join-Path $repo 'tools\monitor-windows\supervisor.ps1') -Destination $probeDirectory
  [IO.File]::WriteAllText((Join-Path $probeDirectory 'monitor-host.cjs'),"require('node:fs').appendFileSync(require('node:path').join(__dirname,'runs.txt'),'x');process.stderr.write('synthetic');process.exit(27);")
  $probe = Start-Process $powershell -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $probeDirectory 'supervisor.ps1') + '" -Node "' + $node + '"') -PassThru
  try {
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    do { Start-Sleep -Milliseconds 300; $runs = if (Test-Path (Join-Path $probeDirectory 'runs.txt')) { [IO.File]::ReadAllText((Join-Path $probeDirectory 'runs.txt')).Length } else { 0 } } while ($runs -lt 2 -and [DateTime]::UtcNow -lt $deadline)
    if ($runs -lt 2) { throw 'Supervisor interrotto da errore nativo.' }
  } finally { if (!$probe.HasExited) { & taskkill.exe /PID $probe.Id /T /F | Out-Null } }
  Write-Host 'Windows: DPAPI sotto SYSTEM, ACL, installazione, aggiornamento, preflight, rollback e supervisor verificati.'
} finally {
  Stop-ScheduledTask -TaskName 'Mirox Monitor' -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName 'Mirox Monitor' -Confirm:$false -ErrorAction SilentlyContinue
  $pattern = [regex]::Escape($target + '\')
  Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','powershell.exe') -and $_.CommandLine -match $pattern } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  Get-ChildItem $env:ProgramData -Directory -Filter 'MiroxMonitor.*-*' | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
  Remove-Item -LiteralPath $scratch -Recurse -Force
}
