@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-site.ps1"
set "UPDATE_EXIT=%ERRORLEVEL%"

echo.
if not "%UPDATE_EXIT%"=="0" (
  echo Site update failed.
  echo Check the message above, then try again.
  pause
  exit /b %UPDATE_EXIT%
)

echo Site update completed successfully.
pause
