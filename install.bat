@echo off
echo ========================================================
echo  Installing Antigravity BUSY Bar Workspace Dependencies
echo ========================================================
call pnpm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Installation failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Dependencies installed successfully.
pause
