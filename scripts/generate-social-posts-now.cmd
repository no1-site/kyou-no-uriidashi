@echo off
setlocal

cd /d "%~dp0.."
node scripts\generate-social-posts.mjs
set "SOCIAL_EXIT=%ERRORLEVEL%"

echo.
if not "%SOCIAL_EXIT%"=="0" (
  echo SNS post generation failed.
  pause
  exit /b %SOCIAL_EXIT%
)

echo SNS post candidates generated successfully.
pause
