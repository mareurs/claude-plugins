: << 'CMDBLOCK'
@echo off
node "%~dp0constitution-brief.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/constitution-brief.mjs"
