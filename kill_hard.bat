@echo off
echo Killing everything on port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
  echo Killing PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo Killing all node processes...
taskkill /F /IM node.exe >nul 2>&1

echo Waiting 2 seconds...
timeout /t 2 >nul

echo Checking port 3001...
netstat -ano | findstr :3001
if errorlevel 1 (
  echo Port 3001 is free!
) else (
  echo Port 3001 is still in use!
)

echo Starting server...
node server.js