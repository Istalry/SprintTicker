@echo off
echo ========================================================
echo  Packaging Antigravity BUSY Bar Desktop App (Windows)
echo ========================================================
rem Uses bundledDependencies in desktop-app/package.json to bundle CJS dependencies (Fastify, avvio, better-sqlite3)
call pnpm package:win
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Windows packaging failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Windows package created in packages/desktop-app/dist-electron/
pause
