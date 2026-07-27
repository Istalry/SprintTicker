@echo off
echo ========================================================
echo  Running Antigravity BUSY Bar Test Coverage
echo ========================================================
call pnpm test:coverage
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Test coverage failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Test coverage finished successfully.
pause
