: << 'CMDBLOCK'
@echo off
node "%~dp0worktree-activate.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/worktree-activate.mjs"
