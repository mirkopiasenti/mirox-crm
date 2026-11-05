@echo off
set "MIROX_EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%MIROX_EDGE%" set "MIROX_EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%MIROX_EDGE%" exit /b 1
start "Mirox Monitor" "%MIROX_EDGE%" --kiosk http://127.0.0.1:8765/monitor --edge-kiosk-type=fullscreen --kiosk-idle-timeout-minutes=0 --no-first-run
