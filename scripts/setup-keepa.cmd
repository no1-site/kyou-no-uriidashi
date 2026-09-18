@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-keepa.ps1"
set "exitCode=%ERRORLEVEL%"
echo.
if not "%exitCode%"=="0" echo Keepa setup failed. Check the message above.
pause
exit /b %exitCode%
