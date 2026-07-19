: << 'CMDBLOCK'
@echo off
node "%~dp0goal-stop-hook.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/goal-stop-hook.mjs"
