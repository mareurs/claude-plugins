: << 'CMDBLOCK'
@echo off
node "%~dp0pre-edit-hint.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/pre-edit-hint.mjs"
