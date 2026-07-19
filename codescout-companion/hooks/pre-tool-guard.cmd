: << 'CMDBLOCK'
@echo off
node "%~dp0pre-tool-guard.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/pre-tool-guard.mjs"
