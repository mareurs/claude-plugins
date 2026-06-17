: << 'CMDBLOCK'
@echo off
REM Cross-platform polyglot hook wrapper (no args; derives <name>.sh from own name).
REM Windows: cmd runs bash NON-interactively (no --login -i) -> no terminal window.
REM Unix: the sh tail execs the matching .sh.
set "HOOK=%~dp0%~n0.sh"
if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" (
    "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" "%HOOK%"
    exit /b %ERRORLEVEL%
)
if exist "%ProgramFiles%\Git\bin\bash.exe" (
    "%ProgramFiles%\Git\bin\bash.exe" "%HOOK%"
    exit /b %ERRORLEVEL%
)
if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" (
    "%ProgramFiles(x86)%\Git\bin\bash.exe" "%HOOK%"
    exit /b %ERRORLEVEL%
)
for /f "delims=" %%G in ('where git 2^>nul') do (
    if exist "%%~dpG..\bin\bash.exe" (
        "%%~dpG..\bin\bash.exe" "%HOOK%"
        exit /b %ERRORLEVEL%
    )
)
for /f "delims=" %%B in ('where bash 2^>nul') do (
    "%%B" "%HOOK%"
    exit /b %ERRORLEVEL%
)
exit /b 0
CMDBLOCK

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$(basename "$0")"
exec bash "${SCRIPT_DIR}/${SCRIPT_NAME%.cmd}.sh"