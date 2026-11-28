# Runs one short `claude -p` session with mod-probe loaded, from the current directory (run it
# from a git checkout), then prints the summary. Output: scripts\mod-probe\run\.
# Usage (PowerShell): powershell -ExecutionPolicy Bypass -File scripts\mod-probe\run.ps1
$D = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out = Join-Path $D 'run'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Remove-Item -ErrorAction SilentlyContinue (Join-Path $D 'out.json')
$Prompt = 'This is a hook probe. Make EXACTLY these three tool calls, one per turn, and do not retry: 1. Read the first 5 lines of README.md. 2. Run the Bash command: git --version 3. Run the Bash command: git status --short. Then reply with one word: done.'
$sw = [Diagnostics.Stopwatch]::StartNew()
& claude -p $Prompt --model haiku --max-turns 8 --no-session-persistence `
  --allowedTools Read Bash --plugin-dir $D --output-format stream-json --verbose `
  --debug-file (Join-Path $Out 'debug.log') > (Join-Path $Out 'stream.jsonl') 2> (Join-Path $Out 'stderr.txt')
"claude exit: $LASTEXITCODE  wall: $([int]$sw.Elapsed.TotalSeconds) s"
& node (Join-Path $D 'summarize.mjs') (Join-Path $Out 'debug.log') (Join-Path $D 'out.json') | Tee-Object -FilePath (Join-Path $Out 'summary.txt')
