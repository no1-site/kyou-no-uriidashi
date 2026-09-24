@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-social-posts-now.ps1"
set "SOCIAL_EXIT=%ERRORLEVEL%"
echo.
if not "%SOCIAL_EXIT%"=="0" echo SNS queue update failed. Check the message above.
pause
exit /b %SOCIAL_EXIT%
