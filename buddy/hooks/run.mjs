// buddy hook launcher — cross-platform.
//
// Claude Code always runs on a system Node (it requires Node >= 20), so
// `node run.mjs <event>` is a portable hook entry point on every OS. Its only
// job is to resolve a Python interpreter (python3 -> python -> `py -3`) and run
// the Python dispatcher, since Python's interpreter name is not uniform across
// platforms (`python3` is absent on Windows; bare `python` is often absent on
// macOS). This is a thin shim, not a rewrite — buddy's logic stays in Python.
//
// stdin/stdout/stderr are inherited so the event JSON and any injected context
// pass straight through. Fail-open: any launcher error exits 0 (buddy is
// non-blocking); only an intentional pre-tool-use judge block (exit 2) is
// forwarded to Claude Code. Claude Code's PID is passed as BUDDY_HOOK_PPID so
// the Python side keys the by-ppid index on Claude Code, not on this launcher.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const dispatch = join(HERE, 'hook_dispatch.py');
const event = process.argv[2] || '';

// A real interpreter beats the Windows Store app-execution-alias stubs that sit first on
// PATH: under endpoint protection each stub start costs about 1 s, a real python.exe
// about 0.3 s, and this launcher runs on every tool call. $BUDDY_PYTHON overrides; on
// Windows the newest python.exe under %ProgramFiles% or %LOCALAPPDATA%/Programs/Python
// is next. Elsewhere, and when none is found, the PATH names below apply unchanged.
function directPythons() {
  if (process.env.BUDDY_PYTHON) return [[process.env.BUDDY_PYTHON, []]];
  if (process.platform !== 'win32') return [];
  const roots = [
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Python'),
  ].filter(Boolean);
  const found = [];
  for (const root of roots) {
    try {
      for (const d of readdirSync(root)) {
        const exe = join(root, d, 'python.exe');
        if (/^Python3[0-9]+$/.test(d) && existsSync(exe)) found.push([d, exe]);
      }
    } catch { /* root missing or unreadable: skip it */ }
  }
  found.sort((a, b) => Number(b[0].slice(6)) - Number(a[0].slice(6)));
  return found.slice(0, 1).map(([, exe]) => [exe, []]);
}

// Interpreter candidates, in preference order.
const candidates = [
  ...directPythons(),
  ['python3', []],
  ['python', []],
  ['py', ['-3']],
];

function run() {
  if (!event || !existsSync(dispatch)) return 0;
  // Run the dispatcher DIRECTLY with each candidate in turn; there is no separate
  // probe spawn. A probe costs one full interpreter start per hook call, and where
  // `python3` is a version-manager shim (pyenv) that start is ~55 ms of pure shim
  // overhead — measured 78 ms for `python3 -c ''` against 23 ms for the real binary,
  // paid on every PreToolUse/PostToolUse.
  //
  // The probe's one job — rejecting an interpreter that is not really Python, such as
  // the Windows Store app-execution-alias stub — is kept by reading the exit status.
  // hook_dispatch.py returns 0, or 2 for the intentional pre-tool-use block, on every
  // path (it catches its own exceptions), so any other status means the interpreter
  // itself failed to run it: fall through to the next candidate. The stub exits
  // without reading stdin, so the next candidate still receives the event JSON.
  for (const [cmd, pre] of candidates) {
    const res = spawnSync(cmd, [...pre, dispatch, event], {
      stdio: 'inherit',
      env: { ...process.env, BUDDY_HOOK_PPID: String(process.ppid) },
    });
    if (res.error) continue; // not found / not executable — next candidate
    if (res.status === 2) return 2; // the intentional block — forward it
    if (res.status === 0) return 0;
    // Any other status (nonzero stub, interpreter crash, killed): next candidate.
  }
  return 0; // no working interpreter — fail open
}

process.exit(run());
