@echo off
rem Wake client for the companion hook daemon (Windows, Claude Code only).
rem Claude Code runs this without a shell wrapper: {"command":"cmd.exe","args":["/d","/c","<this file>"],"asyncRewake":true}.
rem Posts the PostToolUse event (stdin) to the daemon and waits. An empty answer means nothing to wake;
rem a non-empty answer is the wake text: it goes to stderr and the exit code is 2 (asyncRewake wakes the model).
rem The daemon down or any failure answers nothing: fail open.
if not defined COMPANION_HOOKD_PORT set COMPANION_HOOKD_PORT=47615
curl.exe -s -m 7200 -H "X-Hookd-Token: %CLAUDE_PLUGINS_HOOKD_TOKEN%" --data-binary @- http://127.0.0.1:%COMPANION_HOOKD_PORT%/wake 2>nul | findstr /r "." 1>&2 && exit /b 2
exit /b 0
