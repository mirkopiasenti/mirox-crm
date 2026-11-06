@echo off
setlocal
title Installazione Mirox Monitor
echo Pacchetto aggiornamenti automatici e KPI rapidi - 06/11/2026
echo Avvio installazione o aggiornamento Mirox Monitor...
echo Questo file va eseguito con il tasto destro: Esegui come amministratore.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Installazione non completata. Conserva questa finestra per leggere l'errore.
  pause
  exit /b 1
)
echo.
echo Aggiornamento completato. Apri avvia-monitor.cmd per visualizzare il monitor.
pause
