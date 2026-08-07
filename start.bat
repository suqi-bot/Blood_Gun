@echo off
setlocal
title BloodGun - Devil's Roulette
cd /d "%~dp0"

if not exist node_modules (
  echo [ERROR] node_modules not found. Please run: npm install
  echo.
  pause
  exit /b 1
)

echo Starting server...
start "BloodGun Server" /min cmd /c "node server\index.js"

echo Opening browser...
timeout /t 2 /nobreak >nul
start "" "http://localhost:8080"

echo.
echo ==========================================
echo   BloodGun is running!
echo   Local : http://localhost:8080
echo   LAN   : http://YOUR-IP:8080  (see server window)
echo ==========================================
echo.
echo Close the "BloodGun Server" window to stop the game.
echo.
pause
