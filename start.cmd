@echo off
chcp 65001 >nul
setlocal
set "DIR=%~dp0"
set "PORT=8766"
if not "%~1"=="" set "PORT=%~1"
set "URL=http://127.0.0.1:%PORT%/"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ and add it to PATH.
  pause
  exit /b 1
)

echo Starting Sky Studio PC on port %PORT% ...
node "%DIR%daemon.mjs" start %PORT%
if errorlevel 1 (
  echo [ERROR] Server failed to start.
  pause
  exit /b 1
)

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME64=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

for %%B in ("%EDGE%" "%EDGE64%" "%CHROME%" "%CHROME64%") do (
  if exist "%%~B" (
    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%%~B' -ArgumentList '--app=%URL%','--window-size=1280,800','--window-position=0,0','--user-data-dir=%DIR%.browser-profile','--no-first-run','--no-default-browser-check','--force-device-scale-factor=1','--high-dpi-support=1','--remote-debugging-port=9222'"
    exit /b 0
  )
)
start "" "%URL%"
exit /b 0
