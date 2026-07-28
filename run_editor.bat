@echo off
echo ========================================================
echo  Launching Antigravity BUSY Bar Pixel Art Editor
echo ========================================================
echo.
start "" "http://localhost:39124"
node tools/pixel-editor/server.js
pause
