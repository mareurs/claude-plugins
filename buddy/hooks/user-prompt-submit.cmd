: << 'CMDBLOCK'
@echo off
node "%~dp0run.mjs" user-prompt-submit
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/run.mjs" user-prompt-submit
