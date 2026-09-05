@echo off
echo ========================================================
echo  Running SprintTicker Test Coverage
echo ========================================================
call pnpm lint
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] ESLint checks failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
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
