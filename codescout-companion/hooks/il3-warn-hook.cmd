: << 'CMDBLOCK'
@echo off
node "%~dp0il3-warn-hook.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/il3-warn-hook.mjs"
