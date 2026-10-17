@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 24 or newer from https://nodejs.org/zh-cn/download
  echo Then reopen this file.
  pause
  exit /b 1
)
node scripts\local-preview.mjs
if errorlevel 1 (
  echo.
  echo Please keep the error message above for troubleshooting.
  pause
)
