#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
Stop-ScheduledTask -TaskName 'Mirox Monitor' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'Mirox Monitor' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host 'Avvio automatico del servizio rimosso. Revoca il monitor dall Admin.'
Write-Host 'File e credenziale protetta restano in ProgramData\MiroxMonitor; nessuna cancellazione automatica.'
