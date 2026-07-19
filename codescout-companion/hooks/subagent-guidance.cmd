: << 'CMDBLOCK'
@echo off
node "%~dp0subagent-guidance.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/subagent-guidance.mjs"
