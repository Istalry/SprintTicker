@echo off
echo ========================================================
echo  Launching SprintTicker Pixel Art Editor
echo ========================================================
echo.
start "" "http://localhost:39124"
node tools/pixel-editor/server.js
pause
