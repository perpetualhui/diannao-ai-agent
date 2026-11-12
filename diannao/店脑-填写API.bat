@echo off
title DianNao - Fill API Key
cd /d "%~dp0runtime\openclaw"

if not exist ".env" (
  echo # DianNao AI API Key > .env
)

echo ==========================================
echo   DianNao - Fill your AI API Key
echo ==========================================
echo.
echo  Notepad will open the config file.
echo.
echo  1. Find the line:  # DEEPSEEK_API_KEY=sk-...
echo  2. Delete the leading # and paste your real key
echo  3. Save with Ctrl+S, then close Notepad
echo.
echo  File location:
echo  %cd%\.env
echo.
pause

start "" notepad .env

echo.
echo ==========================================
echo  Done.
echo  Go back to Claude and say: filled, use deepseek
echo ==========================================
pause
