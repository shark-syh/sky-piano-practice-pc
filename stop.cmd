@echo off
chcp 65001 >nul
set "DIR=%~dp0"
echo Stopping Sky Studio PC ...
node "%DIR%daemon.mjs" stop
ping -n 2 127.0.0.1 >nul
