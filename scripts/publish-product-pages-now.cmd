@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-product-pages.ps1"
set "SEO_EXIT=%ERRORLEVEL%"

echo.
if not "%SEO_EXIT%"=="0" (
  echo SEO product page publication failed.
  pause
  exit /b %SEO_EXIT%
)

echo SEO product pages published successfully.
pause
