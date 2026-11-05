$ErrorActionPreference = 'Stop'
# Solo il browser della postazione: Assigned Access lo riapre automaticamente.
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
  $_.CommandLine -match '--kiosk\s+"?http://127\.0\.0\.1:8765/monitor(?:[\s"]|$)'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
