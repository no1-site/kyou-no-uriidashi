@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-daily-task.ps1"
set "TASK_EXIT=%ERRORLEVEL%"

echo.
if not "%TASK_EXIT%"=="0" (
  echo Daily update setup failed.
  echo Check the message above, then try again.
  pause
  exit /b %TASK_EXIT%
)

echo Daily update setup is complete.
pause
