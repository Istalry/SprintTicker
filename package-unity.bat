@echo off
echo ========================================================
echo  Packaging Antigravity BUSY Bar Unity Plugin
echo ========================================================
call pnpm package:unity
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Unity plugin packaging failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Unity plugin package created successfully.
pause
