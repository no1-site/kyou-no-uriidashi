@echo off
setlocal
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-dry-run.ps1" %*
set "DRY_RUN_EXIT=%ERRORLEVEL%"
pause >nul
exit /b %DRY_RUN_EXIT%
