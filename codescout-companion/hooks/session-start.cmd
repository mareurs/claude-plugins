: << 'CMDBLOCK'
@echo off
node "%~dp0session-start.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/session-start.mjs"
