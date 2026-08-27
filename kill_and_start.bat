@echo off
set PORT=%PORT%
if "%PORT%"=="" set PORT=8080
echo Killing processes on port %PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT%') do (
  echo Killing PID %%a
  taskkill /F /PID %%a >nul 2>&1
)
echo Starting server on port %PORT%...
node server.js