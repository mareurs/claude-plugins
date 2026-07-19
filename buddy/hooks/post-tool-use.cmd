: << 'CMDBLOCK'
@echo off
node "%~dp0run.mjs" post-tool-use
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/run.mjs" post-tool-use
