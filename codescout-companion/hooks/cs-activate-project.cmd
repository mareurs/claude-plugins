: << 'CMDBLOCK'
@echo off
node "%~dp0cs-activate-project.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/cs-activate-project.mjs"
