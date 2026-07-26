@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required to run The Last Eagle.
  echo Install Node.js, then run this launcher again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing the game tools for the first launch...
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Review the message above and try again.
    pause
    exit /b 1
  )
)

echo Starting The Last Eagle...
echo Your browser will open automatically. Keep this window open while playing.
echo Press Ctrl+C here when you want to stop the game.
call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
