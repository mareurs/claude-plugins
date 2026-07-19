: << 'CMDBLOCK'
@echo off
node "%~dp0worktree-write-guard.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/worktree-write-guard.mjs"
