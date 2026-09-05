@echo off
echo ========================================================
echo  Packaging SprintTicker Unity Plugin
echo ========================================================
call pnpm verify:unity
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Unity plugin packaging failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Unity plugin package created successfully.
pause
