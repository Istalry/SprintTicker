@echo off
echo ========================================================
echo  Building Antigravity BUSY Bar Desktop App
echo ========================================================
call pnpm build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Build failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Build completed successfully.
pause
