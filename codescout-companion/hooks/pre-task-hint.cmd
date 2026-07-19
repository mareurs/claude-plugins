: << 'CMDBLOCK'
@echo off
node "%~dp0pre-task-hint.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/pre-task-hint.mjs"
