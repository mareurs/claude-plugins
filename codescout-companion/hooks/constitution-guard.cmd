: << 'CMDBLOCK'
@echo off
node "%~dp0constitution-guard.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/constitution-guard.mjs"
