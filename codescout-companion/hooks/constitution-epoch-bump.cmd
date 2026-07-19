: << 'CMDBLOCK'
@echo off
node "%~dp0constitution-epoch-bump.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/constitution-epoch-bump.mjs"
