: << 'CMDBLOCK'
@echo off
node "%~dp0explore-inject.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/explore-inject.mjs"
