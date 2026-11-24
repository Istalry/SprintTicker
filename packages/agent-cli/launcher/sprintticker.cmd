@echo off
rem The sprintticker command of an installed SprintTicker (AGENT-INTERFACE.md 7):
rem the app's own executable runs the bundled script as a plain Node, so
rem nothing else needs installing. It lives in resources\agent\, two folders
rem under SprintTicker.exe.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\SprintTicker.exe" "%~dp0sprintticker.mjs" %*
exit /b %ERRORLEVEL%
