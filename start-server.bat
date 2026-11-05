@echo off
cd /d "%~dp0"
echo Starting the local preview at http://localhost:8000
node --experimental-strip-types --no-warnings server.ts
pause
