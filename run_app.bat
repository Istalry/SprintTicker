@echo off
echo ========================================================
echo  Launching Antigravity BUSY Bar Companion (Development)
echo ========================================================
call pnpm dev
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Application failed to launch with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
