param([ValidateSet('read','write')][string]$Mode,[string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes('MiroxMonitor-v1')
$scope = [Security.Cryptography.DataProtectionScope]::LocalMachine
if ($Mode -eq 'write') {
  $plain = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())
  $cipher = [Security.Cryptography.ProtectedData]::Protect($plain,$entropy,$scope)
  $temp = $Path + '.tmp'
  [IO.File]::WriteAllBytes($temp,$cipher)
  # Windows PowerShell converte $null in stringa vuota nei parametri string .NET.
  if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temp,$Path,[System.Management.Automation.Language.NullString]::Value) }
  else { [IO.File]::Move($temp,$Path) }
} else {
  $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($Path),$entropy,$scope)
  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
}
