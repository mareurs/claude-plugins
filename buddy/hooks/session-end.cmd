: << 'CMDBLOCK'
@echo off
node "%~dp0run.mjs" session-end
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/run.mjs" session-end
