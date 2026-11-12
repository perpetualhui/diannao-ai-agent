@echo off
title DianNao - Start All Services
cd /d "%~dp0"

echo ==========================================
echo   DianNao - Local Services
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  pause
  exit /b 1
)

echo [1/5] Building backend API ...
call npm run build:api
if errorlevel 1 (
  echo [ERROR] API build failed. See messages above.
  pause
  exit /b 1
)

echo [2/5] Starting DianNao API (port 7401) ...
start "DianNao API :7401" /d "%~dp0" cmd /k "node dist\services\api\src\server.js"

echo [3/5] Starting WeChat gateway (port 7402) ...
start "DianNao WeChat Gateway :7402" /d "%~dp0" cmd /k "set DIANNAO_ALLOWED_SENDER_IDS=wxid-staff-luo,wxid-owner-zhou && node adapters\wechat\gateway.mjs"

echo [4/5] Starting web console (port 5173) ...
start "DianNao Web :5173" /d "%~dp0apps\web" cmd /k "node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173"

echo [5/5] Starting WeChat ClawBot / OpenClaw (port 18789) ...
if exist "%~dp0runtime\openclaw\.env" (
  start "DianNao ClawBot :18789" /d "%~dp0runtime\openclaw" cmd /k "node --env-file=.env node_modules\openclaw\openclaw.mjs gateway run"
) else (
  echo   [SKIP] runtime\openclaw\.env not found.
  echo   Run "DianNao - Fill API Key.bat" first.
)

echo.
echo Waiting for services ...
timeout /t 6 /nobreak >nul

echo.
echo ==========================================
echo   URLs
echo     Web console   http://localhost:5173
echo     Backend API   http://localhost:7401
echo     WeChat GW     http://localhost:7402
echo     ClawBot       http://localhost:18789
echo.
echo   Test accounts
echo     manager-a / demo   (owner)
echo     staff-a  / demo    (staff)
echo.
echo   Close each window to stop that service.
echo ==========================================
start http://localhost:5173
pause
