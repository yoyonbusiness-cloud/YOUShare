@echo off
echo Renaming PFX file...
ren server.pfx.backup server.pfx >nul 2>&1

echo Killing processes on port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo Starting HTTPS server...
node server.js