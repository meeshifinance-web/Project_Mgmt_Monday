@echo off
setlocal
title simplixart Startup

echo ==========================================
echo   simplixart Workboard - Starting Up
echo ==========================================
echo.

REM ─────────────────────────────────────────────────────────
REM  [Pre-flight 1/3] PostgreSQL service must be running
REM ─────────────────────────────────────────────────────────
echo [Check 1/3] PostgreSQL service...
sc query postgresql-x64-18 | findstr /C:"RUNNING" >nul
if errorlevel 1 (
    echo.
    echo [ERROR] PostgreSQL service "postgresql-x64-18" is NOT running.
    echo         Start it with one of:
    echo           net start postgresql-x64-18
    echo           services.msc  ^(GUI^)
    echo.
    pause
    exit /b 1
)
echo   OK - PostgreSQL is running.

REM ─────────────────────────────────────────────────────────
REM  [Pre-flight 2/3] Port 3001 (backend) must be free
REM ─────────────────────────────────────────────────────────
echo [Check 2/3] Port 3001 (backend)...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
    echo.
    echo [ERROR] Port 3001 is already in use.
    echo         The backend cannot start because something else is listening.
    echo         Find and stop the process holding it:
    echo.
    powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3001 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize"
    powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3001 -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } | Select-Object Id,ProcessName,Path | Format-Table -AutoSize"
    echo         To kill it:  taskkill /PID ^<pid^> /F
    echo.
    pause
    exit /b 1
)
echo   OK - Port 3001 is free.

REM ─────────────────────────────────────────────────────────
REM  [Pre-flight 3/3] Port 5173 (frontend / Vite) must be free
REM ─────────────────────────────────────────────────────────
echo [Check 3/3] Port 5173 (frontend)...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
    echo.
    echo [ERROR] Port 5173 is already in use.
    echo         Vite is configured with strictPort - it will NOT fall back to 5174.
    echo         Find and stop the process holding it:
    echo.
    powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize"
    powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } | Select-Object Id,ProcessName,Path | Format-Table -AutoSize"
    echo         To kill it:  taskkill /PID ^<pid^> /F
    echo.
    pause
    exit /b 1
)
echo   OK - Port 5173 is free.

echo.
echo All checks passed. Launching services...
echo.

REM Start Backend (Node.js + Express on port 3001)
echo [1/2] Starting Backend on http://localhost:3001 ...
start "simplixart - Backend" cmd /k "cd /d "%~dp0backend" && npm run dev"

REM Wait long enough for the backend's startup migrations to finish
REM (about 7 idempotent CREATE TABLE / ALTER TABLE batches before app.listen)
timeout /t 6 /nobreak > nul

REM Start Frontend (React + Vite on port 5173)
echo [2/2] Starting Frontend on http://localhost:5173 ...
start "simplixart - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo Both servers are starting in separate windows.
echo.
echo   Backend  : http://localhost:3001
echo   Frontend : http://localhost:5173
echo.
echo   Login    : admin@simplixart.com / Admin@1234
echo.
echo If a window closes immediately, open it again from a terminal
echo and read the error message - that's the real failure cause.
echo.
pause
endlocal
