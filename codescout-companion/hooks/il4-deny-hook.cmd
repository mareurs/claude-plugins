: << 'CMDBLOCK'
@echo off
node "%~dp0il4-deny-hook.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/il4-deny-hook.mjs"
