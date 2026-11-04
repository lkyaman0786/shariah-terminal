@echo off
title Shariah Shares Live Terminal - Angel One
echo ===================================================
echo   SHARIAH SHARES LIVE MARKET TERMINAL
echo ===================================================

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo Checking port 8000...
REM Kill any process listening on port 8000
netstat -aon 2>nul | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000" ^| findstr "LISTENING"') do (
        if not "%%a"=="" (
            echo Freeing port 8000 ^(Process %%a^)...
            taskkill /f /pid %%a >nul 2>&1
        )
    )
    timeout /t 1 /nobreak >nul
) else (
    echo Port 8000 is free.
)

echo.
echo Starting Terminal Server...
echo.
python main.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server failed to start!
    echo Make sure Python and all dependencies are installed.
    echo Run: pip install -r requirements.txt
)
pause
