@echo off
echo Making server HTTP...
ren server.pfx server.pfx.backup 2>nul

echo Killing processes on port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo Starting HTTP server...
node server.js