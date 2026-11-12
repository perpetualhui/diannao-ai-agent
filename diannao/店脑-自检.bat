@echo off
title DianNao - Health Check
cd /d "%~dp0"
node scripts\health-check.mjs
echo.
pause
