@echo off
title Shariah Shares Live Terminal - Angel One
echo ===================================================
echo   SHARIAH SHARES LIVE MARKET TERMINAL
echo ===================================================
echo Checking port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo Freeing port 8000 (Process %%a)...
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo Starting Terminal Server...
python main.py
pause
