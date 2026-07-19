: << 'CMDBLOCK'
@echo off
node "%~dp0run.mjs" pre-tool-use
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/run.mjs" pre-tool-use
