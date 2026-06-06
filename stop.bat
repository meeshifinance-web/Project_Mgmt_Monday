@echo off
REM ============================================================
REM  Simplix - Stop dev servers
REM  Kills whatever is listening on the backend + frontend ports
REM  (backend = 3001, frontend/Vite = 5173)
REM ============================================================
setlocal enabledelayedexpansion

set "PORTS=3001 5173"
set "FOUND="

for %%P in (%PORTS%) do (
    for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
        if not "%%I"=="0" (
            echo Stopping process on port %%P  (PID %%I) ...
            taskkill /F /PID %%I >nul 2>&1
            set "FOUND=1"
        )
    )
)

if not defined FOUND (
    echo No dev servers were running on ports %PORTS%.
) else (
    echo Dev servers stopped.
)

endlocal
