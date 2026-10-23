@echo off
REM Double-click to run the RSO Funding Assistant. No Docker or API keys needed.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Install the LTS version from https://nodejs.org, then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies, first run only. This takes a minute or two...
  call npm install
  if errorlevel 1 (
    echo npm install failed. See the messages above.
    pause
    exit /b 1
  )
)
call npm run demo
pause
