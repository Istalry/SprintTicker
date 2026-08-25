@echo off
echo ========================================================
echo  Packaging Antigravity BUSY Bar Desktop App (Windows)
echo ========================================================
rem Compile animations
echo Compiling .anim files...
node scripts\build-anims.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Animation compilation failed.
    pause
    exit /b %ERRORLEVEL%
)
echo.

rem Bundles Fastify into main process bundle and packages Windows binaries via electron-builder
taskkill /F /IM "Antigravity BUSY Bar Companion.exe" >nul 2>&1
call pnpm package:win
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Windows packaging failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
call pnpm verify:packed
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Packed binary verification failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Windows package created in packages/desktop-app/dist-electron/
echo.
echo Copying unity-plugin to win-unpacked directory...
xcopy "packages\unity-plugin" "packages\desktop-app\dist-electron\win-unpacked\packages\unity-plugin" /E /I /H /Y
echo.
pause
