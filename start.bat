@echo off
title DdecorMonday Startup

echo ==========================================
echo   DdecorMonday Workboard - Starting Up
echo ==========================================
echo.

REM Start Backend (Node.js + Express on port 3001)
echo [1/2] Starting Backend on http://localhost:3001 ...
start "DdecorMonday - Backend" cmd /k "cd /d "%~dp0backend" && npm run dev"

REM Brief pause before starting frontend
timeout /t 2 /nobreak > nul

REM Start Frontend (React + Vite on port 5173)
echo [2/2] Starting Frontend on http://localhost:5173 ...
start "DdecorMonday - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo Both servers are starting in separate windows.
echo.
echo   Backend  : http://localhost:3001
echo   Frontend : http://localhost:5173
echo.
echo   Login    : admin@ddecor.com / Admin@1234
echo.
pause
