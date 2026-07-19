: << 'CMDBLOCK'
@echo off
node "%~dp0git-worktree-guard.mjs"
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/git-worktree-guard.mjs"
