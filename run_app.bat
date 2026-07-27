@echo off
echo ========================================================
echo  Launching Antigravity BUSY Bar Desktop App (Dev Mode)
echo ========================================================
call pnpm dev
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Application exited with error code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
